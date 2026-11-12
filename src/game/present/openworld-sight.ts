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

/** The slots of the query a frame's tests run on: the thing's middle (x, z), its radius across the view, and the height of its top. */
const QUERY_X = 0;
const QUERY_Z = 1;
const QUERY_RADIUS = 2;
const QUERY_TOP = 3;
const QUERY_SLOTS = 4;
/** The slots of a line's walk over the grid (`walk`). */
const WALK_NEXT_COLUMN = 0;
const WALK_NEXT_ROW = 1;
const WALK_COLUMN_EVERY = 2;
const WALK_ROW_EVERY = 3;
const WALK_SLOTS = 4;
/** The t of a crossing a line parallel to a grid line never makes: past any line's end. */
const NEVER_CROSSES = 1e30;
/** Lines a thing is tested with: to its middle and to both sides across the view. */
const LINES = 3;
/** The slots of the slab a line is clipped to: where it starts along the axis, how far it goes, and the slab's two faces. */
const SLAB_SLOTS = 4;
/** Which projection row each of the six frustum planes adds to or takes from the last row (right, left, bottom, top, far, near), and its sign. */
const PLANE_SIGN = [-1, 1, 1, -1, -1, 1] as const;
const PLANE_ROW = [0, 0, 1, 1, 2, 2] as const;

/**
 * What a query is asked with. A number passed to a call that is not inlined is boxed (a heap number a call), so a query is written into this object's fields (which are stored in place) and asked by a call that takes none:
 * `seenAtProbe`, `seenThroughFace`, `playerInside`. The fields a query reads are named at each.
 */
class SightProbe {
  x = 0;
  z = 0;
  radius = 0;
  yaw = 0;
  halfDepth = 0;
  halfWidth = 0;
  top = 0;
}

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
  /** Where a line's span of t stands (its two ends), and the slab a call clips it to: scratch, so the tests pass no numbers. */
  private readonly span = new Float64Array(2);
  private readonly slab = new Float64Array(SLAB_SLOTS);
  /** A line's walk over the grid: the t of its next crossing of a column's edge and of a row's, and the t between two such crossings. Kept here, not in locals that change round a loop: those are boxed, a heap number a step. */
  private readonly walk = new Float64Array(WALK_SLOTS);
  private readonly query = new Float64Array(QUERY_SLOTS);
  private readonly ends = new Float64Array(LINES * 2);
  /** The input of the zero-boxing queries (`seenAtProbe`, `seenThroughFace`, `playerInside`): the caller writes its fields. */
  readonly probe = new SightProbe();
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

  /** The ids `claim` gave are free again, their clocks with them. A release after `clear` (an owner disposed after the field let go of everything) is nothing. */
  release(first: number, count: number): void {
    if (first + count > this.claimed) return;
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
    const probe = this.probe;
    probe.x = x;
    probe.z = z;
    probe.radius = radius;
    return this.seenAtProbe();
  }

  /** `seen` of the probe's `x`, `z` and `radius`: nothing is passed, so nothing is boxed. */
  seenAtProbe(): boolean {
    if (!this.enabled || this.eyeCount === 0) return true;
    this.askAbout(this.probe.x, this.probe.z, this.probe.radius, THING_TOP_M);
    return this.someEyeSees();
  }

  /** `seen` of the `count` things at (`xs[i]`, `zs[i]`), each of `radius` m, into `out[i]` (1 seen, 0 not): the whole crowd in one call. */
  seenMany(xs: ArrayLike<number>, zs: ArrayLike<number>, count: number, radius: number, out: Uint8Array): void {
    const everything = !this.enabled || this.eyeCount === 0;
    for (let thing = 0; thing < count; thing++) {
      if (!everything) this.askAbout(xs[thing]!, zs[thing]!, radius, THING_TOP_M);
      out[thing] = everything || this.someEyeSees() ? 1 : 0;
    }
  }

  /** `seen`, and the id's clock: its first look starts its grace, a sighting restarts it. */
  observe(id: number, x: number, z: number, radius: number): boolean {
    return this.recordSighting(id, this.seen(x, z, radius));
  }

  /** `observe` of the probe's `x`, `z` and `radius`. */
  observeAtProbe(id: number): boolean {
    return this.recordSighting(id, this.seenAtProbe());
  }

  /**
   * Whether any eye sees into the box the probe describes (its `x`, `z`, `yaw`, its `halfDepth` along its local x and `halfWidth` along its local z, as an `Occluder`'s; a building's front is its local +x) through its
   * openings on `face`, up to the probe's `top` m: the eye stands inside the box, or in front of that face with the face in its frustum and a line to its middle or either end clear of every other building
   * (the box lies wholly behind its face, so it never blocks a line from in front). What an interior needs: a room behind a wall, or behind another building, is not seen.
   */
  seenThroughFace(face: Face): boolean {
    if (!this.enabled || this.eyeCount === 0) return true;
    const probe = this.probe;
    const cos = Math.cos(probe.yaw);
    const sin = Math.sin(probe.yaw);
    const outX = cos * face;
    const outZ = -sin * face;
    const middleX = probe.x + outX * probe.halfDepth;
    const middleZ = probe.z + outZ * probe.halfDepth;
    this.askAbout(middleX, middleZ, probe.halfWidth, probe.top);
    this.ends[0] = middleX;
    this.ends[1] = middleZ;
    this.ends[2] = middleX + sin * probe.halfWidth;
    this.ends[3] = middleZ + cos * probe.halfWidth;
    this.ends[4] = middleX - sin * probe.halfWidth;
    this.ends[5] = middleZ - cos * probe.halfWidth;
    for (let eye = 0; eye < this.eyeCount; eye++) {
      const fromX = this.eyeX[eye]! - probe.x;
      const fromZ = this.eyeZ[eye]! - probe.z;
      if (Math.abs(fromX * cos - fromZ * sin) < probe.halfDepth && Math.abs(fromX * sin + fromZ * cos) < probe.halfWidth) return true;
      if ((this.eyeX[eye]! - middleX) * outX + (this.eyeZ[eye]! - middleZ) * outZ <= 0) continue;
      if (this.inFrustum(eye) && !this.allBlocked(eye)) return true;
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

  /** Whether a player (a seated car, or the walker out of his) stands inside the box the probe describes (its `x`, `z`, `yaw`, `halfDepth`, `halfWidth`, as `seenThroughFace`'s): someone in a building keeps its interior whatever its doors. */
  playerInside(): boolean {
    const probe = this.probe;
    const cos = Math.cos(probe.yaw);
    const sin = Math.sin(probe.yaw);
    for (let player = 0; player < this.playerCount; player++) {
      const fromX = this.playerX[player]! - probe.x;
      const fromZ = this.playerZ[player]! - probe.z;
      if (Math.abs(fromX * cos - fromZ * sin) < probe.halfDepth && Math.abs(fromX * sin + fromZ * cos) < probe.halfWidth) return true;
    }
    return false;
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

  /** The eye's position and the six planes of its view, read off its projection and view matrices (the planes' normals' x and z, their offsets, how much each lifts with height, and how wide its normal is flat): nothing is allocated. */
  private readEye(eye: number, camera: THREE.Camera): void {
    camera.updateMatrixWorld();
    const matrix = this.viewProjection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse).elements;
    const world = camera.matrixWorld.elements;
    this.eyeX[eye] = world[12]!;
    this.eyeY[eye] = world[13]!;
    this.eyeZ[eye] = world[14]!;
    for (let plane = 0; plane < FRUSTUM_PLANES; plane++) {
      const sign = PLANE_SIGN[plane]!;
      const row = PLANE_ROW[plane]!;
      const a = matrix[3]! + sign * matrix[row]!;
      const b = matrix[7]! + sign * matrix[4 + row]!;
      const c = matrix[11]! + sign * matrix[8 + row]!;
      const d = matrix[15]! + sign * matrix[12 + row]!;
      const length = Math.sqrt(a * a + b * b + c * c);
      const at = eye * FRUSTUM_PLANES + plane;
      this.planeX[at] = a / length;
      this.planeZ[at] = c / length;
      this.planeConstant[at] = d / length;
      this.planeUp[at] = Math.max(0, b / length);
      this.planeSpread[at] = Math.sqrt(a * a + c * c) / length;
    }
  }

  /** `near` of the probe's `x`, `z` and `radius`. */
  nearProbe(): boolean {
    return this.near(this.probe.x, this.probe.z, this.probe.radius);
  }

  /** The query the next tests run on: a column at (x, z) of `radius` m across the view, 0 to `top` m high. */
  private askAbout(x: number, z: number, radius: number, top: number): void {
    this.query[QUERY_X] = x;
    this.query[QUERY_Z] = z;
    this.query[QUERY_RADIUS] = radius;
    this.query[QUERY_TOP] = top;
  }

  /** Whether some eye has the query's column in its frustum and a clear line to it. */
  private someEyeSees(): boolean {
    for (let eye = 0; eye < this.eyeCount; eye++) {
      if (this.inFrustum(eye) && !this.hiddenFrom(eye)) return true;
    }
    return false;
  }

  /** The query's column is not wholly outside any of the six planes of the eye's view. */
  private inFrustum(eye: number): boolean {
    const x = this.query[QUERY_X]!;
    const z = this.query[QUERY_Z]!;
    const radius = this.query[QUERY_RADIUS]!;
    const top = this.query[QUERY_TOP]!;
    for (let plane = 0; plane < FRUSTUM_PLANES; plane++) {
      const at = eye * FRUSTUM_PLANES + plane;
      if (this.planeX[at]! * x + this.planeZ[at]! * z + this.planeConstant[at]! + this.planeUp[at]! * top + radius * this.planeSpread[at]! < 0) return false;
    }
    return true;
  }

  /** The lines to the query's column through its middle and both sides across the view are all blocked. */
  private hiddenFrom(eye: number): boolean {
    const x = this.query[QUERY_X]!;
    const z = this.query[QUERY_Z]!;
    const dx = x - this.eyeX[eye]!;
    const dz = z - this.eyeZ[eye]!;
    const length = Math.sqrt(dx * dx + dz * dz);
    if (length < PARALLEL_M) return false;
    const sideX = (-dz / length) * this.query[QUERY_RADIUS]!;
    const sideZ = (dx / length) * this.query[QUERY_RADIUS]!;
    this.ends[0] = x;
    this.ends[1] = z;
    this.ends[2] = x + sideX;
    this.ends[3] = z + sideZ;
    this.ends[4] = x - sideX;
    this.ends[5] = z - sideZ;
    return this.allBlocked(eye);
  }

  /** The lines from the eye to the three ends (`ends`), each at the query's top, are all blocked; the first clear one ends the test. */
  private allBlocked(eye: number): boolean {
    for (let end = 0; end < LINES; end++) {
      if (!this.rayBlocked(eye, end)) return false;
    }
    return true;
  }

  /** Walks the cells under the line from the eye to end `end`, nearest the eye first, and asks each one's solids. */
  private rayBlocked(eye: number, end: number): boolean {
    if (this.solidCount === 0) return false;
    const ax = this.eyeX[eye]!;
    const az = this.eyeZ[eye]!;
    const dx = this.ends[end * 2]! - ax;
    const dz = this.ends[end * 2 + 1]! - az;
    this.span[0] = 0;
    this.span[1] = 1;
    this.slab[0] = ax;
    this.slab[1] = dx;
    this.slab[2] = this.originX;
    this.slab[3] = this.originX + this.columns * CELL_M;
    if (!this.clipSlab()) return false;
    this.slab[0] = az;
    this.slab[1] = dz;
    this.slab[2] = this.originZ;
    this.slab[3] = this.originZ + this.rows * CELL_M;
    if (!this.clipSlab()) return false;
    const lo = this.span[0]!;
    const hi = this.span[1]!;
    if (++this.rayStamp === RAY_STAMP_LIMIT) {
      this.stamp.fill(0);
      this.rayStamp = 1;
    }
    let column = Math.min(this.columns - 1, Math.max(0, Math.floor((ax + dx * lo - this.originX) / CELL_M)));
    let row = Math.min(this.rows - 1, Math.max(0, Math.floor((az + dz * lo - this.originZ) / CELL_M)));
    const lastColumn = Math.min(this.columns - 1, Math.max(0, Math.floor((ax + dx * hi - this.originX) / CELL_M)));
    const lastRow = Math.min(this.rows - 1, Math.max(0, Math.floor((az + dz * hi - this.originZ) / CELL_M)));
    const stepColumn = dx > 0 ? 1 : -1;
    const stepRow = dz > 0 ? 1 : -1;
    const walk = this.walk;
    walk[WALK_NEXT_COLUMN] = dx === 0 ? NEVER_CROSSES : (this.originX + (dx > 0 ? column + 1 : column) * CELL_M - ax) / dx;
    walk[WALK_NEXT_ROW] = dz === 0 ? NEVER_CROSSES : (this.originZ + (dz > 0 ? row + 1 : row) * CELL_M - az) / dz;
    walk[WALK_COLUMN_EVERY] = dx === 0 ? NEVER_CROSSES : CELL_M / Math.abs(dx);
    walk[WALK_ROW_EVERY] = dz === 0 ? NEVER_CROSSES : CELL_M / Math.abs(dz);
    for (let guard = this.columns + this.rows + 2; guard > 0; guard--) {
      const cell = row * this.columns + column;
      for (let at = this.cellStart[cell]!; at < this.cellStart[cell + 1]!; at++) {
        const solid = this.cellSolid[at]!;
        if (this.stamp[solid] === this.rayStamp) continue;
        this.stamp[solid] = this.rayStamp;
        if (this.blocks(solid, eye, end)) return true;
      }
      if (column === lastColumn && row === lastRow) return false;
      if (walk[WALK_NEXT_COLUMN]! < walk[WALK_NEXT_ROW]!) {
        column += stepColumn;
        walk[WALK_NEXT_COLUMN] = walk[WALK_NEXT_COLUMN]! + walk[WALK_COLUMN_EVERY]!;
      } else {
        row += stepRow;
        walk[WALK_NEXT_ROW] = walk[WALK_NEXT_ROW]! + walk[WALK_ROW_EVERY]!;
      }
      if (column < 0 || column >= this.columns || row < 0 || row >= this.rows) return false;
    }
    return false;
  }

  /** Whether the line from the eye to end `end` passes through `solid` at or under its top, neither end standing inside it. */
  private blocks(solid: number, eye: number, end: number): boolean {
    const cos = this.solidCos[solid]!;
    const sin = this.solidSin[solid]!;
    const halfX = this.solidHalfX[solid]!;
    const halfZ = this.solidHalfZ[solid]!;
    const fromX = this.eyeX[eye]! - this.solidX[solid]!;
    const fromZ = this.eyeZ[eye]! - this.solidZ[solid]!;
    const toX = this.ends[end * 2]! - this.solidX[solid]!;
    const toZ = this.ends[end * 2 + 1]! - this.solidZ[solid]!;
    const startX = fromX * cos - fromZ * sin;
    const startZ = fromX * sin + fromZ * cos;
    const endX = toX * cos - toZ * sin;
    const endZ = toX * sin + toZ * cos;
    if (Math.abs(startX) < halfX && Math.abs(startZ) < halfZ) return false;
    if (Math.abs(endX) < halfX && Math.abs(endZ) < halfZ) return false;
    this.span[0] = 0;
    this.span[1] = 1;
    this.slab[0] = startX;
    this.slab[1] = endX - startX;
    this.slab[2] = -halfX;
    this.slab[3] = halfX;
    if (!this.clipSlab()) return false;
    this.slab[0] = startZ;
    this.slab[1] = endZ - startZ;
    this.slab[2] = -halfZ;
    this.slab[3] = halfZ;
    if (!this.clipSlab()) return false;
    const eyeY = this.eyeY[eye]!;
    const rise = this.query[QUERY_TOP]! - eyeY;
    return Math.min(eyeY + rise * this.span[0]!, eyeY + rise * this.span[1]!) < this.solidTop[solid]!;
  }

  /** Cuts the span of t (0 to 1) in which start + move * t lies within [min, max] (the four in `slab`, as written by the caller); false once nothing of the span is left. */
  private clipSlab(): boolean {
    const start = this.slab[0]!;
    const move = this.slab[1]!;
    const min = this.slab[2]!;
    const max = this.slab[3]!;
    if (Math.abs(move) < PARALLEL_M) return start >= min && start <= max;
    const atMin = (min - start) / move;
    const atMax = (max - start) / move;
    this.span[0] = Math.max(this.span[0]!, Math.min(atMin, atMax));
    this.span[1] = Math.min(this.span[1]!, Math.max(atMin, atMax));
    return this.span[0]! < this.span[1]!;
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
