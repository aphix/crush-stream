import * as THREE from "three";
import { MAX_CARS } from "../scenes/fleet.ts";
import type { Occluder } from "./spectate-cam.ts";

/** Seconds a thing no eye sees stays drawn before it is phased out: a glance away and back costs nothing. */
export const HIDE_GRACE = 3;
/** Ids a field hands out (people, cars, lots, signs): a claim past this throws at construction time, not mid-frame. */
export const SIGHT_ID_CAPACITY = 4096;
/** The tallest thing asked about (m), a person: a line to a column's top is clear whenever a line to any lower part of it is. */
const THING_TOP_M = 2;
/** Eyes a field reads: the player's camera, with room for a mirror or a spectator view. */
const MAX_EYES = 4;
const FRUSTUM_PLANES = 6;
/** Bucket edge (m), about one lot's depth: a lot lands in one or two cells and a street-long line crosses a handful. */
const CELL_M = 16;
/** Solids lower than this (m) hide nothing worth culling behind: parked cars, hedges, railings (a person is 2 m, a roof 3 m). */
const MIN_HIDING_HEIGHT_M = 2.5;
/** A segment that moves less than this (m) across a slab runs parallel to it. */
const PARALLEL_M = 1e-9;
/** The ray stamp restarts here, long before an int32 runs out. */
const RAY_STAMP_LIMIT = 0x40000000;
const NEVER_SEEN = -1;
/** Players a field reads: every seated car, and one walker out of his. */
const MAX_PLAYERS = MAX_CARS + 1;

/** Which face of a box a query looks through: its local +x (a building's front, the street) or -x (its back). */
export const FACE = { front: 1, back: -1 } as const;
type Face = (typeof FACE)[keyof typeof FACE];

/** Where a player is: a `DeformableCar` is one, and so is the walker's torso. */
export type SightPlayer = { readonly group: { readonly position: { readonly x: number; readonly z: number } } };

/**
 * What the local eyes can see of the open world, for everything that draws or streams: in some eye's frustum and not behind a building.
 * Flat ground at y 0. Solids are boxes only (round ones hide nothing worth the test); a box an endpoint stands in never blocks that line,
 * so a thing at its own door or an eye inside its lot is not hidden by that lot. Netplay: each peer culls what it draws; `near` is what
 * the host keeps simulating (a player's car within reach), never `seen`.
 */
export class SightField {
  /** `HIDE_GRACE`, for consumers that may not import this file (a layer below present). */
  readonly hideGrace = HIDE_GRACE;
  /** Off: everything is seen, so nothing is culled (the A/B probes' arm with no culling, as `Witness.enabled`). */
  enabled = true;
  private solidCount = 0;
  private solidX = new Float64Array(0);
  private solidZ = new Float64Array(0);
  private solidCos = new Float64Array(0);
  private solidSin = new Float64Array(0);
  private solidHalfX = new Float64Array(0);
  private solidHalfZ = new Float64Array(0);
  private solidTop = new Float64Array(0);
  private stamp = new Int32Array(0);
  private rayStamp = 0;
  private spanLow = 0;
  private spanHigh = 1;
  private originX = 0;
  private originZ = 0;
  private columns = 0;
  private rows = 0;
  private cellStart = new Int32Array(0);
  private cellSolid = new Int32Array(0);

  private eyeCount = 0;
  private readonly eyeX = new Float64Array(MAX_EYES);
  private readonly eyeY = new Float64Array(MAX_EYES);
  private readonly eyeZ = new Float64Array(MAX_EYES);
  private readonly planeX = new Float64Array(MAX_EYES * FRUSTUM_PLANES);
  private readonly planeZ = new Float64Array(MAX_EYES * FRUSTUM_PLANES);
  private readonly planeConstant = new Float64Array(MAX_EYES * FRUSTUM_PLANES);
  private readonly planeUp = new Float64Array(MAX_EYES * FRUSTUM_PLANES);
  private readonly planeSpread = new Float64Array(MAX_EYES * FRUSTUM_PLANES);
  private readonly viewProjection = new THREE.Matrix4();
  private readonly frustum = new THREE.Frustum();

  private playerCount = 0;
  private readonly playerX = new Float64Array(MAX_PLAYERS);
  private readonly playerZ = new Float64Array(MAX_PLAYERS);

  private now = 0;
  private claimed = 0;
  /** Ranges given back below `claimed`, first come first reused: an owner rebuilt mid-session (the traffic on a new crowd key) takes ids again without running the field out. */
  private readonly freeRanges: { first: number; count: number }[] = [];
  private readonly lastSeen: Float64Array;

  constructor(solids: readonly Occluder[], idCapacity: number) {
    this.lastSeen = new Float64Array(idCapacity).fill(NEVER_SEEN);
    this.setSolids(solids);
  }

  /** The buildings (and other tall boxes) that hide things: the grid is rebuilt, ids and clocks are kept. */
  setSolids(solids: readonly Occluder[]): void {
    const hiding = solids.filter((solid) => !solid.circle && solid.y1 - solid.y0 >= MIN_HIDING_HEIGHT_M);
    const count = hiding.length;
    this.solidCount = count;
    this.solidX = Float64Array.from(hiding, (solid) => solid.x);
    this.solidZ = Float64Array.from(hiding, (solid) => solid.z);
    this.solidCos = Float64Array.from(hiding, (solid) => solid.cos);
    this.solidSin = Float64Array.from(hiding, (solid) => solid.sin);
    this.solidHalfX = Float64Array.from(hiding, (solid) => solid.hx);
    this.solidHalfZ = Float64Array.from(hiding, (solid) => solid.hz);
    this.solidTop = Float64Array.from(hiding, (solid) => solid.y1);
    this.stamp = new Int32Array(count);
    this.rayStamp = 0;
    this.bucket(hiding.map((solid) => Math.sqrt(solid.hx * solid.hx + solid.hz * solid.hz)));
  }

  /** `count` ids no other claimant has, as the first of them; give them back with `release` when their owner is disposed. */
  claim(count: number): number {
    const reusable = this.freeRanges.findIndex((range) => range.count >= count);
    if (reusable >= 0) {
      const range = this.freeRanges[reusable]!;
      const first = range.first;
      range.first += count;
      range.count -= count;
      if (range.count === 0) this.freeRanges.splice(reusable, 1);
      return first;
    }
    if (this.claimed + count > this.lastSeen.length) throw new RangeError(`SightField: ${count} ids asked, ${this.lastSeen.length - this.claimed} left`);
    const first = this.claimed;
    this.claimed += count;
    return first;
  }

  /** The ids `claim` gave are free again, their clocks with them. */
  release(first: number, count: number): void {
    this.lastSeen.fill(NEVER_SEEN, first, first + count);
    this.freeRanges.push({ first, count });
    this.freeRanges.sort((a, b) => a.first - b.first);
    for (let at = this.freeRanges.length - 1; at > 0; at--) {
      const before = this.freeRanges[at - 1]!;
      const range = this.freeRanges[at]!;
      if (before.first + before.count !== range.first) continue;
      before.count += range.count;
      this.freeRanges.splice(at, 1);
    }
    const last = this.freeRanges[this.freeRanges.length - 1];
    if (last !== undefined && last.first + last.count === this.claimed) {
      this.claimed = last.first;
      this.freeRanges.pop();
    }
  }

  /** The director stopped: every claim, every clock and the solids go. */
  clear(): void {
    if (this.claimed === 0 && this.solidCount === 0) return;
    this.claimed = 0;
    this.freeRanges.length = 0;
    this.lastSeen.fill(NEVER_SEEN);
    this.setSolids([]);
  }

  /** Once a frame: every local eye's frustum and position, the players' cars, the clock (s). */
  update(eyes: readonly THREE.Camera[], nowSeconds: number, players: readonly SightPlayer[]): void {
    this.now = nowSeconds;
    this.eyeCount = Math.min(eyes.length, MAX_EYES);
    for (let eye = 0; eye < this.eyeCount; eye++) this.readEye(eye, eyes[eye]!);
    this.playerCount = Math.min(players.length, MAX_PLAYERS);
    for (let player = 0; player < this.playerCount; player++) {
      const position = players[player]!.group.position;
      this.playerX[player] = position.x;
      this.playerZ[player] = position.z;
    }
  }

  /** Whether any eye sees a thing of `radius` m at (x, z): in its frustum and with some line across it clear of the buildings. No eyes read yet, or `enabled` off: everything is seen. */
  seen(x: number, z: number, radius: number): boolean {
    if (!this.enabled || this.eyeCount === 0) return true;
    for (let eye = 0; eye < this.eyeCount; eye++) {
      if (this.inFrustum(eye, x, z, radius, THING_TOP_M) && !this.hiddenFrom(eye, x, z, radius)) return true;
    }
    return false;
  }

  /** `seen`, and the id's clock: its first look starts its grace, a sighting restarts it. */
  observe(id: number, x: number, z: number, radius: number): boolean {
    return this.recordSighting(id, this.seen(x, z, radius));
  }

  /**
   * Whether any eye sees into a box (centre, yaw and half sizes along its local x and z as an `Occluder`'s; a building's front is its local +x) through its
   * openings on `face`, up to `top` m: the eye stands inside the box, or in front of that face with the face in its frustum and a line to its middle or
   * either end clear of every other building (the box lies wholly behind its face, so it never blocks a line from in front). What an interior needs: a room behind a wall, or behind another building, is not seen.
   */
  seenThroughFace(x: number, z: number, yaw: number, halfDepth: number, halfWidth: number, top: number, face: Face): boolean {
    if (!this.enabled || this.eyeCount === 0) return true;
    const cos = Math.cos(yaw);
    const sin = Math.sin(yaw);
    const outX = cos * face;
    const outZ = -sin * face;
    const middleX = x + outX * halfDepth;
    const middleZ = z + outZ * halfDepth;
    for (let eye = 0; eye < this.eyeCount; eye++) {
      const fromX = this.eyeX[eye]! - x;
      const fromZ = this.eyeZ[eye]! - z;
      if (Math.abs(fromX * cos - fromZ * sin) < halfDepth && Math.abs(fromX * sin + fromZ * cos) < halfWidth) return true;
      if ((this.eyeX[eye]! - middleX) * outX + (this.eyeZ[eye]! - middleZ) * outZ <= 0) continue;
      if (!this.inFrustum(eye, middleX, middleZ, halfWidth, top)) continue;
      const acrossX = sin * halfWidth;
      const acrossZ = cos * halfWidth;
      if (!this.allBlocked(eye, middleX, middleZ, middleX + acrossX, middleZ + acrossZ, middleX - acrossX, middleZ - acrossZ, top)) return true;
    }
    return false;
  }

  /** The id's clock takes a verdict of its owner's own (`seenThroughFace` of one face or two): its first verdict starts its grace, a sighting restarts it. One call per id a frame. */
  recordSighting(id: number, seen: boolean): boolean {
    if (seen || this.lastSeen[id]! === NEVER_SEEN) this.lastSeen[id] = this.now;
    return seen;
  }

  /** Seconds since the id was last seen (0 while seen, and for an id never observed). */
  unseenFor(id: number): number {
    const at = this.lastSeen[id]!;
    return at === NEVER_SEEN ? 0 : this.now - at;
  }

  /** The id is reused: its clock starts over. */
  reset(id: number): void {
    this.lastSeen[id] = NEVER_SEEN;
  }

  /** Whether a player's car is within `radius` m of (x, z): what the host keeps simulating. */
  near(x: number, z: number, radius: number): boolean {
    const reach = radius * radius;
    for (let player = 0; player < this.playerCount; player++) {
      const dx = this.playerX[player]! - x;
      const dz = this.playerZ[player]! - z;
      if (dx * dx + dz * dz <= reach) return true;
    }
    return false;
  }

  private readEye(eye: number, camera: THREE.Camera): void {
    camera.updateMatrixWorld();
    this.viewProjection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.viewProjection);
    const world = camera.matrixWorld.elements;
    this.eyeX[eye] = world[12]!;
    this.eyeY[eye] = world[13]!;
    this.eyeZ[eye] = world[14]!;
    for (let plane = 0; plane < FRUSTUM_PLANES; plane++) {
      const { normal, constant } = this.frustum.planes[plane]!;
      const at = eye * FRUSTUM_PLANES + plane;
      this.planeX[at] = normal.x;
      this.planeZ[at] = normal.z;
      this.planeConstant[at] = constant;
      this.planeUp[at] = Math.max(0, normal.y);
      this.planeSpread[at] = Math.sqrt(normal.x * normal.x + normal.z * normal.z);
    }
  }

  /** The column (radius, 0 to `top` m high) is not wholly outside any of the six planes. */
  private inFrustum(eye: number, x: number, z: number, radius: number, top: number): boolean {
    for (let plane = 0; plane < FRUSTUM_PLANES; plane++) {
      const at = eye * FRUSTUM_PLANES + plane;
      if (this.planeX[at]! * x + this.planeZ[at]! * z + this.planeConstant[at]! + this.planeUp[at]! * top + radius * this.planeSpread[at]! < 0) return false;
    }
    return true;
  }

  /** The line to the column's top through its middle and both sides across the view are all blocked. */
  private hiddenFrom(eye: number, x: number, z: number, radius: number): boolean {
    const dx = x - this.eyeX[eye]!;
    const dz = z - this.eyeZ[eye]!;
    const length = Math.sqrt(dx * dx + dz * dz);
    if (length < PARALLEL_M) return false;
    const sideX = (-dz / length) * radius;
    const sideZ = (dx / length) * radius;
    return this.allBlocked(eye, x, z, x + sideX, z + sideZ, x - sideX, z - sideZ, THING_TOP_M);
  }

  /** The lines from the eye to the three points, each at `top` m, are all blocked; the first clear one ends the test. */
  private allBlocked(eye: number, firstX: number, firstZ: number, secondX: number, secondZ: number, thirdX: number, thirdZ: number, top: number): boolean {
    const ex = this.eyeX[eye]!;
    const ey = this.eyeY[eye]!;
    const ez = this.eyeZ[eye]!;
    return this.rayBlocked(ex, ey, ez, firstX, top, firstZ) && this.rayBlocked(ex, ey, ez, secondX, top, secondZ) && this.rayBlocked(ex, ey, ez, thirdX, top, thirdZ);
  }

  /** Walks the cells under the segment a to b, nearest the eye first, and asks each one's solids. */
  private rayBlocked(ax: number, ay: number, az: number, bx: number, by: number, bz: number): boolean {
    if (this.solidCount === 0) return false;
    const dx = bx - ax;
    const dz = bz - az;
    this.spanLow = 0;
    this.spanHigh = 1;
    if (!this.narrow(ax, dx, this.originX, this.originX + this.columns * CELL_M) || !this.narrow(az, dz, this.originZ, this.originZ + this.rows * CELL_M)) return false;
    const lo = this.spanLow;
    const hi = this.spanHigh;
    if (++this.rayStamp === RAY_STAMP_LIMIT) {
      this.stamp.fill(0);
      this.rayStamp = 1;
    }
    let column = this.columnOf(ax + dx * lo);
    let row = this.rowOf(az + dz * lo);
    const lastColumn = this.columnOf(ax + dx * hi);
    const lastRow = this.rowOf(az + dz * hi);
    const stepColumn = dx > 0 ? 1 : -1;
    const stepRow = dz > 0 ? 1 : -1;
    const deltaColumn = dx === 0 ? Infinity : CELL_M / Math.abs(dx);
    const deltaRow = dz === 0 ? Infinity : CELL_M / Math.abs(dz);
    let nextColumn = dx === 0 ? Infinity : (this.originX + (dx > 0 ? column + 1 : column) * CELL_M - ax) / dx;
    let nextRow = dz === 0 ? Infinity : (this.originZ + (dz > 0 ? row + 1 : row) * CELL_M - az) / dz;
    for (let guard = this.columns + this.rows + 2; guard > 0; guard--) {
      const cell = row * this.columns + column;
      for (let at = this.cellStart[cell]!; at < this.cellStart[cell + 1]!; at++) {
        const solid = this.cellSolid[at]!;
        if (this.stamp[solid] === this.rayStamp) continue;
        this.stamp[solid] = this.rayStamp;
        if (this.blocks(solid, ax, ay, az, bx, by, bz)) return true;
      }
      if (column === lastColumn && row === lastRow) return false;
      if (nextColumn < nextRow) {
        column += stepColumn;
        nextColumn += deltaColumn;
      } else {
        row += stepRow;
        nextRow += deltaRow;
      }
      if (column < 0 || column >= this.columns || row < 0 || row >= this.rows) return false;
    }
    return false;
  }

  /** Whether the line a to b passes through `solid` at or under its top, neither end standing inside it. */
  private blocks(solid: number, ax: number, ay: number, az: number, bx: number, by: number, bz: number): boolean {
    const cos = this.solidCos[solid]!;
    const sin = this.solidSin[solid]!;
    const halfX = this.solidHalfX[solid]!;
    const halfZ = this.solidHalfZ[solid]!;
    const fromX = ax - this.solidX[solid]!;
    const fromZ = az - this.solidZ[solid]!;
    const toX = bx - this.solidX[solid]!;
    const toZ = bz - this.solidZ[solid]!;
    const startX = fromX * cos - fromZ * sin;
    const startZ = fromX * sin + fromZ * cos;
    const endX = toX * cos - toZ * sin;
    const endZ = toX * sin + toZ * cos;
    if (Math.abs(startX) < halfX && Math.abs(startZ) < halfZ) return false;
    if (Math.abs(endX) < halfX && Math.abs(endZ) < halfZ) return false;
    this.spanLow = 0;
    this.spanHigh = 1;
    if (!this.narrow(startX, endX - startX, -halfX, halfX) || !this.narrow(startZ, endZ - startZ, -halfZ, halfZ)) return false;
    const rise = by - ay;
    return Math.min(ay + rise * this.spanLow, ay + rise * this.spanHigh) < this.solidTop[solid]!;
  }

  /** Cuts the span of t (0 to 1) in which start + move * t lies within [min, max]; false once nothing of the span is left. */
  private narrow(start: number, move: number, min: number, max: number): boolean {
    if (Math.abs(move) < PARALLEL_M) return start >= min && start <= max;
    const atMin = (min - start) / move;
    const atMax = (max - start) / move;
    this.spanLow = Math.max(this.spanLow, Math.min(atMin, atMax));
    this.spanHigh = Math.min(this.spanHigh, Math.max(atMin, atMax));
    return this.spanLow < this.spanHigh;
  }

  private columnOf(x: number): number {
    return Math.min(this.columns - 1, Math.max(0, Math.floor((x - this.originX) / CELL_M)));
  }

  private rowOf(z: number): number {
    return Math.min(this.rows - 1, Math.max(0, Math.floor((z - this.originZ) / CELL_M)));
  }

  /** The grid of cells over the solids' reach, each cell listing the solids whose bounding circle touches it. */
  private bucket(reach: readonly number[]): void {
    const count = this.solidCount;
    let west = Infinity;
    let north = Infinity;
    let east = -Infinity;
    let south = -Infinity;
    for (let solid = 0; solid < count; solid++) {
      west = Math.min(west, this.solidX[solid]! - reach[solid]!);
      east = Math.max(east, this.solidX[solid]! + reach[solid]!);
      north = Math.min(north, this.solidZ[solid]! - reach[solid]!);
      south = Math.max(south, this.solidZ[solid]! + reach[solid]!);
    }
    this.originX = count === 0 ? 0 : west;
    this.originZ = count === 0 ? 0 : north;
    this.columns = count === 0 ? 0 : Math.max(1, Math.ceil((east - west) / CELL_M));
    this.rows = count === 0 ? 0 : Math.max(1, Math.ceil((south - north) / CELL_M));
    const lists = Array.from({ length: this.columns * this.rows }, () => new Array<number>());
    for (let solid = 0; solid < count; solid++) {
      const lastColumn = this.columnOf(this.solidX[solid]! + reach[solid]!);
      const lastRow = this.rowOf(this.solidZ[solid]! + reach[solid]!);
      for (let row = this.rowOf(this.solidZ[solid]! - reach[solid]!); row <= lastRow; row++) {
        for (let column = this.columnOf(this.solidX[solid]! - reach[solid]!); column <= lastColumn; column++) lists[row * this.columns + column]!.push(solid);
      }
    }
    this.cellStart = new Int32Array(lists.length + 1);
    for (let cell = 0; cell < lists.length; cell++) this.cellStart[cell + 1] = this.cellStart[cell]! + lists[cell]!.length;
    this.cellSolid = Int32Array.from(lists.flat());
  }
}
