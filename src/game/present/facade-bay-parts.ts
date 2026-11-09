import * as THREE from "three";
import { hypot2, hypot3 } from "../kernel/physics-core.js";
import { BAY, BAY_FLOORS, DOOR, HOME_HEIGHT, HOME_LEVELS, LOT_WIDTH, STOOP, stoopStepRange } from "../world/openworld/openworld-facade-solids.ts";
import { KIT_CELL, RAIL_SOLID_CELL, type UvRect } from "./facade-kit-atlas.ts";

/**
 * The rowhome kit's pieces as geometry, in metres: x across the facade, y up, z out from the building's drawn front face, the lot's middle at x = 0.
 * Each piece is built once and drawn once per rowhome by an instanced mesh (`facade-bays.ts`). The kit's x is the lot's u negated (a right-handed frame with z out and y up), so the door (u +1.8) stands at x -1.8.
 */

type Point = readonly [x: number, y: number, z: number];

/** Cream trim and the shades of stone (linear): treads catch the sky, risers and cheeks stand in shade. */
const TRIM = new THREE.Color(0xe6dfcd);
const WHITE = new THREE.Color(0xffffff);
const TREAD_SHADE = new THREE.Color().setScalar(0.95);
const RISER_SHADE = new THREE.Color().setScalar(0.78);
const CHEEK_SHADE = new THREE.Color().setScalar(0.62);

/** How far a quad's tint share reaches: 1 takes the instance's accent colour, 0 keeps its own. */
const ACCENT = 1;
const FIXED = 0;

const FACE = { front: 1, back: 2, top: 4, bottom: 8, left: 16, right: 32 } as const;
const ALL_BUT_BACK = FACE.front | FACE.top | FACE.bottom | FACE.left | FACE.right;

/** The per-vertex attribute that says how much of the instance's colour a vertex takes. */
export const TINT_ATTRIBUTE = "tintShare";

/** Positions, normals (from each quad's winding), uvs, colours and tint shares of the quads a piece is made of. */
class KitBuilder {
  private readonly positions: number[] = [];
  private readonly normals: number[] = [];
  private readonly uvs: number[] = [];
  private readonly colours: number[] = [];
  private readonly tints: number[] = [];

  /** A quad, its corners counter-clockwise seen from outside, its texture running `cell` from the first corner to the third. */
  quad(a: Point, b: Point, c: Point, d: Point, cell: UvRect, colour: THREE.Color, tint: number): void {
    const edgeX = b[0] - a[0];
    const edgeY = b[1] - a[1];
    const edgeZ = b[2] - a[2];
    const otherX = c[0] - a[0];
    const otherY = c[1] - a[1];
    const otherZ = c[2] - a[2];
    const normalX = edgeY * otherZ - edgeZ * otherY;
    const normalY = edgeZ * otherX - edgeX * otherZ;
    const normalZ = edgeX * otherY - edgeY * otherX;
    const length = hypot3(normalX, normalY, normalZ);
    const corners: readonly [Point, number, number][] = [
      [a, cell.u0, cell.v0],
      [b, cell.u1, cell.v0],
      [c, cell.u1, cell.v1],
      [a, cell.u0, cell.v0],
      [c, cell.u1, cell.v1],
      [d, cell.u0, cell.v1],
    ];
    for (const [point, u, v] of corners) {
      this.positions.push(point[0], point[1], point[2]);
      this.normals.push(normalX / length, normalY / length, normalZ / length);
      this.uvs.push(u, v);
      this.colours.push(colour.r, colour.g, colour.b);
      this.tints.push(tint);
    }
  }

  /** The faces of the axis-aligned box that `faces` (a mask of `FACE`) names, each reading `cell`. */
  box(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, faces: number, cell: UvRect, colour: THREE.Color, tint: number): void {
    if (faces & FACE.front) this.quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], cell, colour, tint);
    if (faces & FACE.back) this.quad([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], cell, colour, tint);
    if (faces & FACE.top) this.quad([x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0], cell, colour, tint);
    if (faces & FACE.bottom) this.quad([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], cell, colour, tint);
    if (faces & FACE.left) this.quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], cell, colour, tint);
    if (faces & FACE.right) this.quad([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], cell, colour, tint);
  }

  /** The merged geometry; `tinted` pieces carry colour and tint share per vertex, a bare one position, normal and uv. */
  geometry(tinted: boolean): THREE.BufferGeometry {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(this.positions, 3));
    geometry.setAttribute("normal", new THREE.Float32BufferAttribute(this.normals, 3));
    geometry.setAttribute("uv", new THREE.Float32BufferAttribute(this.uvs, 2));
    if (tinted) {
      geometry.setAttribute("color", new THREE.Float32BufferAttribute(this.colours, 3));
      geometry.setAttribute(TINT_ATTRIBUTE, new THREE.Float32BufferAttribute(this.tints, 1));
    }
    geometry.computeBoundingSphere();
    return geometry;
  }
}

/** Where the door and the bay's footprint stand in the kit's x (m). */
const DOOR_X = -DOOR.across;
const BAY_X = -BAY.across;

type PlanPoint = readonly [x: number, z: number];

/** The bay's footprint (flat front, 45-degree sides) about its middle, pushed `offset` m outward on every edge: wall corner, front corner, front corner, wall corner. */
function bayOutline(offset: number): readonly PlanPoint[] {
  const half = BAY.front / 2;
  const mitre = offset * (Math.SQRT2 - 1);
  return [
    [BAY_X - (half + BAY.out) - offset * Math.SQRT2, 0],
    [BAY_X - half - mitre, BAY.out + offset],
    [BAY_X + half + mitre, BAY.out + offset],
    [BAY_X + half + BAY.out + offset * Math.SQRT2, 0],
  ];
}

type Cells = readonly [left: UvRect, front: UvRect, right: UvRect];

const uniform = (cell: UvRect): Cells => [cell, cell, cell];

const lerp = (from: number, to: number, share: number): number => from + (to - from) * share;

/** A side face is `BAY.out` long on each of two legs: the share of the front window's texture it shows. */
const SIDE_SHARE = hypot2(BAY.out, BAY.out) / BAY.front;
const WINDOW_CELL = KIT_CELL.window;
const WINDOW_CELLS: Cells = [{ ...WINDOW_CELL, u1: lerp(WINDOW_CELL.u0, WINDOW_CELL.u1, SIDE_SHARE) }, WINDOW_CELL, { ...WINDOW_CELL, u0: lerp(WINDOW_CELL.u1, WINDOW_CELL.u0, SIDE_SHARE) }];

/** The wall of the bay stack between two heights, one quad for each of its three faces. */
function ring(builder: KitBuilder, y0: number, y1: number, offset: number, cells: Cells, colour: THREE.Color, tint: number): void {
  const outline = bayOutline(offset);
  for (let edge = 0; edge < cells.length; edge++) {
    const from = outline[edge]!;
    const to = outline[edge + 1]!;
    builder.quad([from[0], y0, from[1]], [to[0], y0, to[1]], [to[0], y1, to[1]], [from[0], y1, from[1]], cells[edge]!, colour, tint);
  }
}

/** The flat top (`up`) or underside of the bay's footprint at height `y`. */
function plate(builder: KitBuilder, y: number, offset: number, up: boolean, cell: UvRect, colour: THREE.Color): void {
  const [a, b, c, d] = bayOutline(offset);
  const corners = up ? [a!, b!, c!, d!] : [d!, c!, b!, a!];
  builder.quad([corners[0]![0], y, corners[0]![1]], [corners[1]![0], y, corners[1]![1]], [corners[2]![0], y, corners[2]![1]], [corners[3]![0], y, corners[3]![1]], cell, colour, FIXED);
}

/** The belts and the slab of the stack project this far past the bay's walls (m). */
const BELT_LIP = 0.06;
const SLAB_LIP = 0.1;

/** A projecting band: its wall, its underside and its top. */
function band(builder: KitBuilder, y0: number, y1: number, lip: number): void {
  ring(builder, y0, y1, lip, uniform(KIT_CELL.stone), TRIM, FIXED);
  plate(builder, y0, lip, false, KIT_CELL.stone, TRIM);
  plate(builder, y1, lip, true, KIT_CELL.stone, TRIM);
}

/**
 * The bay stack beside the door: a stone plinth from the ground (its front a barred half-basement window) under a band, then for every storey a panelled apron, the window
 * (flat front, two angled sides) and a belt band; a panel and a roof slab cap it. Every ring is cut from the same outline, so each floor's bay stands on the one below.
 */
export function buildBayGeometry(): THREE.BufferGeometry {
  const builder = new KitBuilder();
  ring(builder, 0, BAY.plinthTop, 0, [KIT_CELL.stone, KIT_CELL.basement, KIT_CELL.stone], WHITE, FIXED);
  let cursor = BAY.plinthTop + BAY.plinthBand;
  band(builder, BAY.plinthTop, cursor, BELT_LIP);
  for (const floor of BAY_FLOORS) {
    ring(builder, cursor, floor.sill, 0, uniform(KIT_CELL.panel), WHITE, ACCENT);
    ring(builder, floor.sill, floor.head, 0, WINDOW_CELLS, WHITE, FIXED);
    cursor = floor.head + BAY.capBand;
    band(builder, floor.head, cursor, BELT_LIP);
  }
  ring(builder, cursor, cursor + BAY.capPanel, 0, uniform(KIT_CELL.panel), WHITE, ACCENT);
  band(builder, cursor + BAY.capPanel, cursor + BAY.capPanel + BAY.capSlab, SLAB_LIP);
  return builder.geometry(true);
}

/** The door's stone jambs: 0.12 m wide beside the 1.0 m hole, standing 0.06 m proud; the hood over it stands 0.3 m out and 0.2 m high, 0.3 m wider than the hole each side. */
const JAMB_WIDTH = 0.12;
const JAMB_DEPTH = 0.06;
const HOOD_OUT = 0.3;
const HOOD_HEIGHT = 0.2;
const HOOD_OVER = 0.3;

/** The stoop: solid stone steps (landing at the wall, riser and tread for each step, cheeks to the ground) under the door, with its jambs and hood. */
export function buildStoopGeometry(): THREE.BufferGeometry {
  const builder = new KitBuilder();
  const left = DOOR_X - STOOP.width / 2;
  const right = DOOR_X + STOOP.width / 2;
  for (let step = 1; step <= STOOP.steps; step++) {
    const { near, far, top } = stoopStepRange(step);
    const previous = top - STOOP.rise;
    builder.quad([left, previous, far], [right, previous, far], [right, top, far], [left, top, far], KIT_CELL.stone, RISER_SHADE, ACCENT);
    builder.quad([left, top, far], [right, top, far], [right, top, near], [left, top, near], KIT_CELL.stone, TREAD_SHADE, ACCENT);
    builder.quad([right, 0, far], [right, 0, near], [right, top, near], [right, top, far], KIT_CELL.stone, CHEEK_SHADE, ACCENT);
    builder.quad([left, 0, near], [left, 0, far], [left, top, far], [left, top, near], KIT_CELL.stone, CHEEK_SHADE, ACCENT);
  }
  for (const side of [-1, 1]) {
    const inner = DOOR_X + side * DOOR.halfWidth;
    const outer = DOOR_X + side * (DOOR.halfWidth + JAMB_WIDTH);
    builder.box(Math.min(inner, outer), Math.max(inner, outer), DOOR.sill, DOOR.head, 0, JAMB_DEPTH, FACE.front | FACE.left | FACE.right, KIT_CELL.stone, TRIM, FIXED);
  }
  const hoodHalf = DOOR.halfWidth + JAMB_WIDTH + HOOD_OVER;
  builder.box(DOOR_X - hoodHalf, DOOR_X + hoodHalf, DOOR.head, DOOR.head + HOOD_HEIGHT, 0, HOOD_OUT, ALL_BUT_BACK, KIT_CELL.stone, TRIM, FIXED);
  return builder.geometry(true);
}

/** The roofline cornice across one lot: a frieze, brackets under a projecting shelf, a fascia over it. The shelf and frieze depths (m) and the brackets' pitch, width and height. */
const CORNICE_SHELF_HEIGHT = 0.25;
const CORNICE_FRIEZE_HEIGHT = 0.4;
const CORNICE_SHELF_OUT = 0.4;
const CORNICE_FRIEZE_OUT = 0.02;
/** The fascia stands clear of the building mesh's own parapet face (0.125 m out of the drawn front). */
const CORNICE_FASCIA_OUT = 0.15;
const CORNICE_BRACKETS = 5;
const CORNICE_BRACKET_PITCH = 1.1;
const CORNICE_BRACKET_WIDTH = 0.12;
const CORNICE_BRACKET_OUT = 0.3;
const CORNICE_BRACKET_DROP = 0.05;

export function buildCorniceGeometry(): THREE.BufferGeometry {
  const builder = new KitBuilder();
  const half = LOT_WIDTH / 2;
  const top = HOME_HEIGHT;
  const friezeBottom = top - HOME_LEVELS.parapet;
  const shelfBottom = friezeBottom + CORNICE_FRIEZE_HEIGHT;
  const shelfTop = shelfBottom + CORNICE_SHELF_HEIGHT;
  const panel = KIT_CELL.panel;
  builder.quad([-half, friezeBottom, CORNICE_FRIEZE_OUT], [half, friezeBottom, CORNICE_FRIEZE_OUT], [half, shelfBottom, CORNICE_FRIEZE_OUT], [-half, shelfBottom, CORNICE_FRIEZE_OUT], panel, WHITE, ACCENT);
  for (let bracket = 0; bracket < CORNICE_BRACKETS; bracket++) {
    const centre = (bracket - (CORNICE_BRACKETS - 1) / 2) * CORNICE_BRACKET_PITCH;
    builder.box(centre - CORNICE_BRACKET_WIDTH / 2, centre + CORNICE_BRACKET_WIDTH / 2, friezeBottom + CORNICE_BRACKET_DROP, shelfBottom, CORNICE_FRIEZE_OUT, CORNICE_BRACKET_OUT, FACE.front | FACE.left | FACE.right | FACE.bottom, panel, WHITE, ACCENT);
  }
  builder.box(-half, half, shelfBottom, shelfTop, 0, CORNICE_SHELF_OUT, ALL_BUT_BACK, panel, WHITE, ACCENT);
  builder.box(-half, half, shelfTop, top, 0, CORNICE_FASCIA_OUT, FACE.front | FACE.top | FACE.left | FACE.right, panel, WHITE, ACCENT);
  return builder.geometry(true);
}

/** The railing: 0.9 m high on the stoop's cheeks 0.05 m in from their outer edge, bars every 0.12 m, a post at the top and the foot of the stair. */
const RAIL_HEIGHT = 0.9;
const RAIL_INSET = 0.05;
const BAR_PITCH = 0.12;
const POST_HALF = 0.035;
const POST_OVER = 0.05;

/** Each side's railing: a flat run along the landing, a sloped run down the nosings, two posts. Bars are the strip's alpha; posts read its solid top rail. */
export function buildRailingGeometry(): THREE.BufferGeometry {
  const builder = new KitBuilder();
  const landingTop = STOOP.sill;
  const footNose = STOOP.rise;
  const slopeLength = hypot2(STOOP.run - STOOP.landing, landingTop - footNose);
  const landingBars = { u0: 0, v0: 0, u1: STOOP.landing / BAR_PITCH, v1: 1 };
  const slopeBars = { u0: 0, v0: 0, u1: slopeLength / BAR_PITCH, v1: 1 };
  for (const side of [-1, 1]) {
    const x = DOOR_X + side * (STOOP.width / 2 - RAIL_INSET);
    builder.quad([x, landingTop, 0], [x, landingTop, STOOP.landing], [x, landingTop + RAIL_HEIGHT, STOOP.landing], [x, landingTop + RAIL_HEIGHT, 0], landingBars, WHITE, FIXED);
    builder.quad([x, landingTop, STOOP.landing], [x, footNose, STOOP.run], [x, footNose + RAIL_HEIGHT, STOOP.run], [x, landingTop + RAIL_HEIGHT, STOOP.landing], slopeBars, WHITE, FIXED);
    for (const [along, base] of [[STOOP.landing, landingTop], [STOOP.run, footNose]] as const) {
      builder.box(x - POST_HALF, x + POST_HALF, base, base + RAIL_HEIGHT + POST_OVER, along - POST_HALF, along + POST_HALF, FACE.front | FACE.back | FACE.left | FACE.right | FACE.top, RAIL_SOLID_CELL, WHITE, FIXED);
    }
  }
  return builder.geometry(false);
}
