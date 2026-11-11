import * as THREE from "three";
import { hypot2 } from "../../kernel/physics-core.js";
import { stairBoxes, wallBoxes } from "../../world/openworld/interior-draft.ts";
import { ceilingOver, lookKind, PARTITION, ROOM_LOOK, STREET_SKIN, type Alcove, type Box, type InteriorPlan, type Wall } from "../../world/openworld/interior-kinds.ts";
import type { Piece } from "../prefab-pieces.ts";
import { BAY } from "../../world/openworld/openworld-facade-solids.ts";
import { brick } from "./interior-brick.ts";
import { ROOM_CELL } from "./interior-constants.ts";
import { furnishingParts } from "./interior-kit.ts";

/** A slab's top matches a floor's height within this (m). */
const FLOOR_MATCH = 1e-6;
/** A floor's wearing layer on top of its slab (m). */
const FLOOR_LAYER = 0.03;
/** The glass's colour: a pale blue-green, seen against the light. */
const GLASS_COLOR = 0xbfd8e6;
/** A plate on a floor or under a ceiling stands this far (m) clear of the slab beside it, so the two never share a plane. */
const PLATE_LIFT = 0.004;
/** A point of the building's local frame: x toward the street, y up, z along its face. */
type Point = readonly [x: number, y: number, z: number];

/** The turn each furnishing's front (its +x) takes it to, as a rotation about y in the building's local frame (front is +x there). */
const TURN_ANGLE = [0, -Math.PI / 2, Math.PI, Math.PI / 2] as const;

type Look = (typeof ROOM_LOOK)[InteriorPlan["kind"]];

/** A plan box as a box in the building's local frame (x toward the street, z along its face). */
function localBox(plan: InteriorPlan, solid: Box): THREE.BufferGeometry {
  const x0 = plan.depth / 2 - solid.deep1;
  const x1 = plan.depth / 2 - solid.deep0;
  return brick(x1 - x0, solid.y1 - solid.y0, solid.across1 - solid.across0, (x0 + x1) / 2, (solid.y0 + solid.y1) / 2, (solid.across0 + solid.across1) / 2);
}

/** A plan point (deep, across) at height `y` as a point of the building's local frame. */
function at(plan: InteriorPlan, deep: number, y: number, across: number): Point {
  return [plan.depth / 2 - deep, y, across];
}

/** The two triangles of any quad, one index shared by them all. */
const QUAD_INDEX = new THREE.Uint16BufferAttribute([0, 1, 2, 0, 2, 3], 1);
const QUAD_CORNERS = 4;
const POINT_FLOATS = 3;

/** A flat quad through four points in order, its normal that of the first triangle. */
function quad(a: Point, b: Point, c: Point, d: Point): THREE.BufferGeometry {
  const corners = new Float32Array(QUAD_CORNERS * POINT_FLOATS);
  corners.set(a, 0);
  corners.set(b, POINT_FLOATS);
  corners.set(c, 2 * POINT_FLOATS);
  corners.set(d, 3 * POINT_FLOATS);
  const ux = b[0] - a[0];
  const uy = b[1] - a[1];
  const uz = b[2] - a[2];
  const vx = c[0] - a[0];
  const vy = c[1] - a[1];
  const vz = c[2] - a[2];
  const nx = uy * vz - uz * vy;
  const ny = uz * vx - ux * vz;
  const nz = ux * vy - uy * vx;
  const length = hypot2(nx, hypot2(ny, nz));
  const normals = new Float32Array(QUAD_CORNERS * POINT_FLOATS);
  for (let corner = 0; corner < QUAD_CORNERS; corner++) {
    normals[corner * POINT_FLOATS] = nx / length;
    normals[corner * POINT_FLOATS + 1] = ny / length;
    normals[corner * POINT_FLOATS + 2] = nz / length;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(corners, POINT_FLOATS));
  geometry.setAttribute("normal", new THREE.BufferAttribute(normals, POINT_FLOATS));
  geometry.setIndex(QUAD_INDEX);
  return geometry;
}

/** How many cells of `ROOM_CELL` a face `length` m long is cut into. */
const cellsOf = (length: number): number => Math.max(1, Math.round(length / ROOM_CELL));

/** The corners of a grid cell's two triangles as (s, t) bits, wound to face `u × v`, and wound the other way. */
const CELL_PLAIN = [0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1] as const;
const CELL_FLIPPED = [0, 0, 1, 1, 1, 0, 0, 0, 0, 1, 1, 1] as const;
const CELL_FLOATS = 18;

/** How many cells a grid of `nu` by `nv` has, with `parity` (see `gridFace`). */
const cellsIn = (nu: number, nv: number, parity: 0 | 1 | null): number => (parity === null ? nu * nv : parity === 0 ? Math.ceil((nu * nv) / 2) : Math.floor((nu * nv) / 2));

/** Writes a grid's triangles into `position` and `normals` from float `at`; the float after the last. */
function fillGrid(position: Float32Array, normals: Float32Array, at: number, origin: Point, u: Point, v: Point, nu: number, nv: number, normal: Point, parity: 0 | 1 | null): number {
  // Wound so the triangles face `normal`.
  const flip = (u[1] * v[2] - u[2] * v[1]) * normal[0] + (u[2] * v[0] - u[0] * v[2]) * normal[1] + (u[0] * v[1] - u[1] * v[0]) * normal[2] < 0;
  const order = flip ? CELL_FLIPPED : CELL_PLAIN;
  let written = at;
  for (let j = 0; j < nv; j++) {
    for (let i = 0; i < nu; i++) {
      if (parity !== null && (i + j) % 2 !== parity) continue;
      for (let corner = 0; corner < order.length; corner += 2) {
        const s = (i + order[corner]!) / nu;
        const t = (j + order[corner + 1]!) / nv;
        position[written] = origin[0] + u[0] * s + v[0] * t;
        position[written + 1] = origin[1] + u[1] * s + v[1] * t;
        position[written + 2] = origin[2] + u[2] * s + v[2] * t;
        normals[written] = normal[0];
        normals[written + 1] = normal[1];
        normals[written + 2] = normal[2];
        written += POINT_FLOATS;
      }
    }
  }
  return written;
}

/** A geometry of the triangles in `position` and `normals`. */
function flatGeometry(position: Float32Array, normals: Float32Array): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(position, POINT_FLOATS));
  geometry.setAttribute("normal", new THREE.BufferAttribute(normals, POINT_FLOATS));
  return geometry;
}

/**
 * One flat grid of `nu` by `nv` cells from `origin` along `u` and `v` (m vectors of the whole face), facing `normal`, two triangles a cell, a corner a vertex: the room-facing side of a
 * floor, ceiling or wall, fine enough for baked light to show. `parity`: only the cells whose (i + j) % 2 equals it (a floor's two shades). Sized up front: a growing array of doubles costs several times the face's own bytes, on every build.
 */
function gridFace(origin: Point, u: Point, v: Point, nu: number, nv: number, normal: Point, parity: 0 | 1 | null = null): THREE.BufferGeometry {
  const position = new Float32Array(cellsIn(nu, nv, parity) * CELL_FLOATS);
  const normals = new Float32Array(position.length);
  fillGrid(position, normals, 0, origin, u, v, nu, nv, normal, parity);
  return flatGeometry(position, normals);
}

/** A colour's channels scaled by `k`. */
const shade = (hex: number, k: number): number => (Math.round(((hex >> 16) & 255) * k) << 16) | (Math.round(((hex >> 8) & 255) * k) << 8) | Math.round((hex & 255) * k);

/** A sheet standing over the plan segment from `from` to `to` between two heights. */
function upright(plan: InteriorPlan, from: readonly [deep: number, across: number], to: readonly [deep: number, across: number], y0: number, y1: number): THREE.BufferGeometry {
  return quad(at(plan, from[0], y0, from[1]), at(plan, to[0], y0, to[1]), at(plan, to[0], y1, to[1]), at(plan, from[0], y1, from[1]));
}

/** A level sheet over an alcove's four outline corners at height `y`. */
function plate(plan: InteriorPlan, corners: Alcove["corners"], y: number): THREE.BufferGeometry {
  const [a, b, c, d] = corners.map(([deep, across]) => at(plan, deep, y, across));
  return quad(a!, b!, c!, d!);
}

/** An alcove's sill board reaches this far (m) into the room over the apron, is this thick, and the skirting under the apron is this high: the apron reads as a wall with a sill, not a slab in front of the glass. */
const SILL_DEPTH = 0.12;
const SILL_THICK = 0.05;
const SKIRTING_HEIGHT = 0.12;

/** A plan point as (deep, across). */
type PlanPoint = readonly [deep: number, across: number];

/** The unit step, in plan, from the segment `from`-`to` into the alcove (toward the middle of its corners). */
function inward(corners: Alcove["corners"], from: PlanPoint, to: PlanPoint): PlanPoint {
  const along: PlanPoint = [to[0] - from[0], to[1] - from[1]];
  const length = hypot2(along[0], along[1]);
  const normal: PlanPoint = [along[1] / length, -along[0] / length];
  const middle = corners.reduce<PlanPoint>((sum, corner) => [sum[0] + corner[0] / corners.length, sum[1] + corner[1] / corners.length], [0, 0]);
  const toMiddle = (middle[0] - from[0]) * normal[0] + (middle[1] - from[1]) * normal[1];
  return toMiddle >= 0 ? normal : [-normal[0], -normal[1]];
}

/**
 * Every alcove of `level`: its floor carried out over the bay, its ceiling at the glass's head, and on its three sides the apron up to the sill: skirting, a body in the room's wood (a window seat's face, not a
 * white slab), and a sill board at the glass's bottom edge that reaches into the room.
 */
function alcovePieces(plan: InteriorPlan, look: Look, level: number): Piece[] {
  const out: Piece[] = [];
  for (const alcove of plan.alcoves) {
    if (alcove.level !== level) continue;
    // The bay's floor and ceiling reach past the wall plane to where the room's own slabs begin: no slot at its mouth.
    const sealed = alcove.corners.map((corner): PlanPoint => (corner[0] === 0 ? [STREET_SKIN + PLATE_LIFT, corner[1]] : corner));
    out.push([plate(plan, sealed, alcove.floorY + PLATE_LIFT), look.floor], [plate(plan, sealed, alcove.head - PLATE_LIFT), look.ceiling]);
    for (let side = 0; side + 1 < alcove.corners.length; side++) {
      const from = alcove.corners[side]!;
      const to = alcove.corners[side + 1]!;
      const step = inward(alcove.corners, from, to);
      const boardFrom: PlanPoint = [from[0] + step[0] * SILL_DEPTH, from[1] + step[1] * SILL_DEPTH];
      const boardTo: PlanPoint = [to[0] + step[0] * SILL_DEPTH, to[1] + step[1] * SILL_DEPTH];
      out.push(
        [upright(plan, from, to, alcove.floorY, alcove.floorY + SKIRTING_HEIGHT), look.trim],
        [upright(plan, from, to, alcove.floorY + SKIRTING_HEIGHT, alcove.sill), look.wood],
        [quad(at(plan, from[0], alcove.sill, from[1]), at(plan, to[0], alcove.sill, to[1]), at(plan, boardTo[0], alcove.sill, boardTo[1]), at(plan, boardFrom[0], alcove.sill, boardFrom[1])), look.trim],
        [upright(plan, boardFrom, boardTo, alcove.sill - SILL_THICK, alcove.sill), look.trim],
      );
    }
  }
  return out;
}

/**
 * The bay's opening in the street wall is as wide as the bay's outline, but its glass is set in from the outline, so it meets the wall's plane short of the opening's edge: the strip between
 * them (a wedge no wider than a hand) is closed on each side by a return of the wall, from the floor to the glass's head, so the alcove has no crack to see out through.
 */
function jambPieces(plan: InteriorPlan, look: Look, level: number): Piece[] {
  const out: Piece[] = [];
  for (const alcove of plan.alcoves) {
    if (alcove.level !== level) continue;
    for (const corner of [alcove.corners[0]!, alcove.corners[alcove.corners.length - 1]!]) {
      const edge = BAY.across + Math.sign(corner[1] - BAY.across) * (BAY.width / 2);
      out.push([upright(plan, [corner[0], edge], corner, alcove.floorY, alcove.head), look.wall]);
    }
  }
  return out;
}

/** The glass of the windows and bays of the levels `levels` names, a pane a piece. */
function glassOf(plan: InteriorPlan, levels: (level: number) => boolean): Piece[] {
  const out: Piece[] = [];
  for (const pane of plan.panes) if (levels(pane.level)) out.push([upright(plan, [pane.deep0, pane.across0], [pane.deep1, pane.across1], pane.y0, pane.y1), GLASS_COLOR]);
  return out;
}

/** The room look of `level` of the plan. */
const lookOf = (plan: InteriorPlan, level: number): Look => ROOM_LOOK[lookKind(plan.kind, level)];

function wallPieces(plan: InteriorPlan, shell: boolean): Piece[] {
  const out: Piece[] = [];
  for (const wall of plan.walls) {
    if (wall.shell !== shell) continue;
    const look = lookOf(plan, wall.level);
    const floorY = plan.floors[wall.level]!;
    const ceilingY = ceilingOver(plan.floors, plan.topCeiling, wall.level);
    const solids = wallBoxes(wall, floorY, ceilingY);
    for (const solid of solids) out.push([localBox(plan, solid), look.wall]);
    out.push(...wallGrids(plan, wall, solids, look.wall), ...trimPieces(plan, wall, solids, floorY, ceilingY));
  }
  return out;
}

/** Whether `wall` is part of the envelope (the street, back and party walls of any level): only its face toward the room is seen. */
const isEnvelope = (wall: Wall): boolean => wall.thick !== PARTITION;

/** Whether the room lies toward the greater coordinate of an envelope wall's thin axis (deep for a wall that runs across, across for one that runs deep). */
const roomIsBeyond = (plan: InteriorPlan, wall: Wall): boolean => wall.fixed < (wall.axis === "across" ? plan.depth / 2 : 0);

/** Whether the grid on `box`'s far (`far`) or near long face is made: an envelope wall has only the one toward the room. */
const gridWanted = (plan: InteriorPlan, wall: Wall, far: boolean): boolean => !isEnvelope(wall) || far === roomIsBeyond(plan, wall);

/** How many cells `box`'s wall grids hold on a face: three rows, along the wall. */
const wallCells = (wall: Wall, box: Box): number => cellsOf(wall.axis === "across" ? box.across1 - box.across0 : box.deep1 - box.deep0) * 3;

/**
 * The light grids on the long faces of `boxes` (a wall's boxes), `PLATE_LIFT` proud of them, all in one piece (one geometry a wall, not one a face); an envelope wall has only the face toward the room.
 */
function wallGrids(plan: InteriorPlan, wall: Wall, boxes: readonly Box[], colour: number): Piece[] {
  let cells = 0;
  for (const box of boxes) for (let side = 0; side < 2; side++) if (gridWanted(plan, wall, side === 0)) cells += wallCells(wall, box);
  if (cells === 0) return [];
  const position = new Float32Array(cells * CELL_FLOATS);
  const normals = new Float32Array(position.length);
  let at = 0;
  for (const box of boxes) {
    const height = box.y1 - box.y0;
    for (let side = 0; side < 2; side++) {
      const far = side === 0;
      if (!gridWanted(plan, wall, far)) continue;
      if (wall.axis === "across") {
        // A wall that runs across: its faces are at deep0 and deep1; local x is depth / 2 - deep, so the far face looks toward -x.
        const x = plan.depth / 2 - (far ? box.deep1 + PLATE_LIFT : box.deep0 - PLATE_LIFT);
        const along = box.across1 - box.across0;
        at = fillGrid(position, normals, at, [x, box.y0, box.across0], [0, 0, along], [0, height, 0], cellsOf(along), 3, [far ? -1 : 1, 0, 0], null);
      } else {
        const z = far ? box.across1 + PLATE_LIFT : box.across0 - PLATE_LIFT;
        const along = box.deep1 - box.deep0;
        at = fillGrid(position, normals, at, [plan.depth / 2 - box.deep1, box.y0, z], [along, 0, 0], [0, height, 0], cellsOf(along), 3, [0, 0, far ? 1 : -1], null);
      }
    }
  }
  return [[flatGeometry(position, normals), colour]];
}

/** A skirting and a crown strip stand this proud (m) of the wall, a wainscot or band this proud, and the crown is this high. */
const TRIM_PROUD = 0.02;
const BAND_PROUD = 0.01;
const CROWN_HEIGHT = 0.08;

/** The corners of a box in the building's frame: its low and high x, y, z. */
const BOX_LOW = new Float64Array(3);
const BOX_HIGH = new Float64Array(3);
/** The corners of a face's quad as (b, c) bits, and the order of its two triangles facing out of the face and into it. */
const QUAD_BITS = [0, 0, 1, 0, 1, 1, 0, 1] as const;
const QUAD_OUT = [0, 1, 2, 0, 2, 3] as const;
const QUAD_IN = [0, 3, 2, 0, 2, 1] as const;
const BOX_FLOATS = 108;

/** The plan boxes `boxes` as the triangles of one geometry (twelve a box), so a run of strips is one piece. */
function boxesGeometry(plan: InteriorPlan, boxes: readonly Box[]): THREE.BufferGeometry {
  const position = new Float32Array(boxes.length * BOX_FLOATS);
  const normals = new Float32Array(position.length);
  let at = 0;
  for (const solid of boxes) {
    BOX_LOW[0] = plan.depth / 2 - solid.deep1;
    BOX_LOW[1] = solid.y0;
    BOX_LOW[2] = solid.across0;
    BOX_HIGH[0] = plan.depth / 2 - solid.deep0;
    BOX_HIGH[1] = solid.y1;
    BOX_HIGH[2] = solid.across1;
    for (let axis = 0; axis < 3; axis++) {
      const b = (axis + 1) % 3;
      const c = (axis + 2) % 3;
      for (let side = 0; side < 2; side++) {
        const order = side === 1 ? QUAD_OUT : QUAD_IN;
        for (let corner = 0; corner < order.length; corner++) {
          const bits = order[corner]! * 2;
          position[at + axis] = side === 1 ? BOX_HIGH[axis]! : BOX_LOW[axis]!;
          position[at + b] = QUAD_BITS[bits]! === 1 ? BOX_HIGH[b]! : BOX_LOW[b]!;
          position[at + c] = QUAD_BITS[bits + 1]! === 1 ? BOX_HIGH[c]! : BOX_LOW[c]!;
          normals[at + axis] = side === 1 ? 1 : -1;
          at += POINT_FLOATS;
        }
      }
    }
  }
  return flatGeometry(position, normals);
}

/** `box` cut to heights `y0` to `y1` and grown `proud` m on the sides `near` and `farSide` (0 or 1) of its wall's thin axis, pushed on `into`; nothing when the cut is under 2 cm tall. */
function pushStrip(into: Box[], wall: Wall, box: Box, y0: number, y1: number, proud: number, near: number, farSide: number): void {
  const low = Math.max(box.y0, y0);
  const high = Math.min(box.y1, y1);
  if (high - low < 0.02) return;
  into.push(wall.axis === "across" ? { ...box, deep0: box.deep0 - proud * near, deep1: box.deep1 + proud * farSide, y0: low, y1: high } : { ...box, across0: box.across0 - proud * near, across1: box.across1 + proud * farSide, y0: low, y1: high });
}

/** The trim on a wall's boxes: a skirting and a crown in the room's trim colour on every wall, one piece; a 0.9 m wainscot in a bar (wood) and a coffee shop (accent), a band at 1.1 m in an office and a shop (accent), a home has the skirting and crown only, one piece of its own. An envelope wall's trim stands proud toward the room only. */
function trimPieces(plan: InteriorPlan, wall: Wall, boxes: readonly Box[], floorY: number, ceilingY: number): Piece[] {
  const kind = lookKind(plan.kind, wall.level);
  const look = ROOM_LOOK[kind];
  const near = isEnvelope(wall) && roomIsBeyond(plan, wall) ? 0 : 1;
  const farSide = isEnvelope(wall) && !roomIsBeyond(plan, wall) ? 0 : 1;
  const trim: Box[] = [];
  const band: Box[] = [];
  for (const box of boxes) {
    pushStrip(trim, wall, box, floorY, floorY + SKIRTING_HEIGHT, TRIM_PROUD, near, farSide);
    pushStrip(trim, wall, box, ceilingY - CROWN_HEIGHT, ceilingY, TRIM_PROUD, near, farSide);
    if (kind === "bar" || kind === "coffee") pushStrip(band, wall, box, floorY, floorY + 0.9, BAND_PROUD, near, farSide);
    else if (kind !== "rowhome") pushStrip(band, wall, box, floorY + 1.1, floorY + 1.25, BAND_PROUD, near, farSide);
  }
  const out: Piece[] = [];
  if (trim.length > 0) out.push([boxesGeometry(plan, trim), look.trim]);
  if (band.length > 0) out.push([boxesGeometry(plan, band), kind === "bar" ? look.wood : look.accent]);
  return out;
}

/** A slab is its body in the ceiling's colour (the room below's) and, except under the roof, a floor layer on top (the room above's). */
function slabPieces(plan: InteriorPlan, shell: boolean): Piece[] {
  const out: Piece[] = [];
  for (const slab of plan.slabs) {
    if (slab.shell !== shell) continue;
    const roof = slab.y0 === plan.topCeiling;
    const level = roof ? plan.floors.length - 1 : plan.floors.findIndex((floor) => Math.abs(floor - slab.y1) < FLOOR_MATCH);
    out.push([localBox(plan, { ...slab.rect, y0: slab.y0, y1: roof ? slab.y1 : slab.y1 - FLOOR_LAYER }), lookOf(plan, Math.max(0, roof ? level : level - 1)).ceiling]);
    if (!roof) out.push([localBox(plan, { ...slab.rect, y0: slab.y1 - FLOOR_LAYER, y1: slab.y1 }), lookOf(plan, level).floor]);
    const x0 = plan.depth / 2 - slab.rect.deep1;
    const xSpan = slab.rect.deep1 - slab.rect.deep0;
    const zSpan = slab.rect.across1 - slab.rect.across0;
    const nx = cellsOf(xSpan);
    const nz = cellsOf(zSpan);
    // The ceiling the room below sees, and the floor in two shades, each a grid a hair clear of the slab.
    if (roof || level > 0) out.push([gridFace([x0, slab.y0 - PLATE_LIFT, slab.rect.across0], [xSpan, 0, 0], [0, 0, zSpan], nx, nz, [0, -1, 0]), lookOf(plan, roof ? level : level - 1).ceiling]);
    if (!roof) {
      out.push([gridFace([x0, slab.y1 + PLATE_LIFT, slab.rect.across0], [xSpan, 0, 0], [0, 0, zSpan], nx, nz, [0, 1, 0], 0), lookOf(plan, level).floor]);
      if (nx * nz > 1) out.push([gridFace([x0, slab.y1 + PLATE_LIFT, slab.rect.across0], [xSpan, 0, 0], [0, 0, zSpan], nx, nz, [0, 1, 0], 1), shade(lookOf(plan, level).floor, 0.92)]);
    }
  }
  return out;
}

/** The ground floor's envelope: what shows through a door from the street, with the glass of its windows and its bay; pieces in the building's own frame (x toward the street, z along its face). */
export function buildShell(plan: InteriorPlan): { solid: Piece[]; glass: Piece[] } {
  return { solid: [...wallPieces(plan, true), ...slabPieces(plan, true), ...alcovePieces(plan, lookOf(plan, 0), 0), ...jambPieces(plan, lookOf(plan, 0), 0)], glass: glassOf(plan, (level) => level === 0) };
}

/** Everything else: partitions, upper floors, their bays, stairs and the furniture (lit and unlit apart) and the upper floors' glass; pieces in the building's own frame, a list empty when it has none. */
export function buildDetail(plan: InteriorPlan): { solid: Piece[]; glow: Piece[]; glass: Piece[] } {
  const solid: Piece[] = [...wallPieces(plan, false), ...slabPieces(plan, false)];
  for (let level = 1; level < plan.floors.length; level++) solid.push(...alcovePieces(plan, lookOf(plan, level), level), ...jambPieces(plan, lookOf(plan, level), level));
  const glow: Piece[] = [];
  for (const flight of plan.stairs) for (const tread of stairBoxes(flight, plan.floors[flight.level]!)) solid.push([localBox(plan, tread), lookOf(plan, flight.level).wood]);
  for (const piece of plan.furnishings) {
    const parts = furnishingParts(piece, lookKind(plan.kind, piece.level));
    const lx = plan.depth / 2 - piece.deep;
    const y = plan.floors[piece.level]! + piece.lift;
    for (const made of [...parts.solid, ...parts.glow]) made[0].rotateY(TURN_ANGLE[piece.facing]).translate(lx, y, piece.across);
    solid.push(...parts.solid);
    glow.push(...parts.glow);
  }
  return { solid, glow, glass: glassOf(plan, (level) => level > 0) };
}
