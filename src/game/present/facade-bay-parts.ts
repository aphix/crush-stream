import * as THREE from "three";
import { hypot2, hypot3 } from "../kernel/physics-core.js";
import { BAY, bayOutline, BAY_FLOORS, DOOR, HOME_HEIGHT, HOME_LEVELS, LOT_WIDTH, STOOP, stoopStepRange } from "../world/openworld/openworld-facade-solids.ts";
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

  /** A triangle, its corners counter-clockwise seen from outside, each with its own texture point (u, v). */
  triangle(corners: readonly [Point, Point, Point], uvs: readonly [readonly [number, number], readonly [number, number], readonly [number, number]], colour: THREE.Color, tint: number): void {
    const [a, b, c] = corners;
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
    for (const [at, point] of corners.entries()) {
      this.positions.push(point[0], point[1], point[2]);
      this.normals.push(normalX / length, normalY / length, normalZ / length);
      this.uvs.push(uvs[at]![0], uvs[at]![1]);
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

/** Where the door stands in the kit's x (m). */
const DOOR_X = -DOOR.across;

type PlanPoint = readonly [x: number, z: number];

/** The bay's outline (`bayOutline`) in the kit's x and z, wall corner to wall corner along +x. */
function kitOutline(offset: number): readonly PlanPoint[] {
  return bayOutline(offset)
    .map((corner): PlanPoint => [-corner.across, corner.out])
    .reverse();
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
  const outline = kitOutline(offset);
  for (let edge = 0; edge < cells.length; edge++) {
    const from = outline[edge]!;
    const to = outline[edge + 1]!;
    builder.quad([from[0], y0, from[1]], [to[0], y0, to[1]], [to[0], y1, to[1]], [from[0], y1, from[1]], cells[edge]!, colour, tint);
  }
}

/** The flat top (`up`) or underside of the bay's footprint at height `y`. */
function plate(builder: KitBuilder, y: number, offset: number, up: boolean, cell: UvRect, colour: THREE.Color): void {
  const [a, b, c, d] = kitOutline(offset);
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
  ring(builder, 0, BAY.plinthTop, 0, [KIT_CELL.marble, KIT_CELL.basement, KIT_CELL.marble], WHITE, FIXED);
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

/** The stoop: solid marble steps (landing at the wall, riser and tread for each step, cheeks to the ground) under the door. */
export function buildStoopGeometry(): THREE.BufferGeometry {
  const builder = new KitBuilder();
  const left = DOOR_X - STOOP.width / 2;
  const right = DOOR_X + STOOP.width / 2;
  for (let step = 1; step <= STOOP.steps; step++) {
    const { near, far, top } = stoopStepRange(step);
    const previous = top - STOOP.rise;
    builder.quad([left, previous, far], [right, previous, far], [right, top, far], [left, top, far], KIT_CELL.marble, RISER_SHADE, ACCENT);
    builder.quad([left, top, far], [right, top, far], [right, top, near], [left, top, near], KIT_CELL.marble, TREAD_SHADE, ACCENT);
    builder.quad([right, 0, far], [right, 0, near], [right, top, near], [right, top, far], KIT_CELL.marble, CHEEK_SHADE, ACCENT);
    builder.quad([left, 0, near], [left, 0, far], [left, top, far], [left, top, near], KIT_CELL.marble, CHEEK_SHADE, ACCENT);
  }
  return builder.geometry(true);
}

/** The flat door surround of a house with no fanlight: stone jambs beside the hole and a hood over it. */
export function buildSurroundGeometry(): THREE.BufferGeometry {
  const builder = new KitBuilder();
  for (const side of [-1, 1]) {
    const inner = DOOR_X + side * DOOR.halfWidth;
    const outer = DOOR_X + side * (DOOR.halfWidth + JAMB_WIDTH);
    builder.box(Math.min(inner, outer), Math.max(inner, outer), DOOR.sill, DOOR.head, 0, JAMB_DEPTH, FACE.front | FACE.left | FACE.right, KIT_CELL.stone, TRIM, FIXED);
  }
  const hoodHalf = DOOR.halfWidth + JAMB_WIDTH + HOOD_OVER;
  builder.box(DOOR_X - hoodHalf, DOOR_X + hoodHalf, DOOR.head, DOOR.head + HOOD_HEIGHT, 0, HOOD_OUT, ALL_BUT_BACK, KIT_CELL.stone, TRIM, FIXED);
  return builder.geometry(true);
}

/**
 * The Federal door: white pilasters beside the hole, an arched fanlight over it (a fan of glass in a proud white ring, a keystone at its crown) and a slim cap over the arch. The fan springs from the
 * door's head and is as wide as the hole; every number is in metres.
 */
const PILASTER_WIDTH = 0.14;
const PILASTER_OUT = 0.07;
const FAN_SEGMENTS = 8;
const FAN_RING_WIDTH = 0.16;
const FAN_RING_OUT = 0.06;
const FAN_GLASS_OUT = 0.02;
const KEYSTONE_HALF = 0.07;
const KEYSTONE_RISE = 0.08;
const KEYSTONE_OUT = 0.09;
const ARCH_CAP_HALF = 0.8;
const ARCH_CAP_GAP = 0.04;
const ARCH_CAP_HEIGHT = 0.1;
const ARCH_CAP_OUT = 0.2;
const FEDERAL_WHITE = new THREE.Color(0xf2efe6);

/** A point on the fan's circle of radius `radius` at `angle` (0 on the door's +x side, up to PI on its other), in the kit's x and y. */
function fanPoint(radius: number, angle: number, out: number): Point {
  return [DOOR_X + radius * Math.cos(angle), DOOR.head + radius * Math.sin(angle), out];
}

/** The half ring over the fan: its front, its outer and its inner wall, a segment at a time. */
function archRing(builder: KitBuilder, inner: number, outer: number): void {
  const cell = KIT_CELL.panel;
  for (let segment = 0; segment < FAN_SEGMENTS; segment++) {
    const from = (Math.PI * segment) / FAN_SEGMENTS;
    const to = (Math.PI * (segment + 1)) / FAN_SEGMENTS;
    builder.quad(fanPoint(inner, from, FAN_RING_OUT), fanPoint(outer, from, FAN_RING_OUT), fanPoint(outer, to, FAN_RING_OUT), fanPoint(inner, to, FAN_RING_OUT), cell, FEDERAL_WHITE, FIXED);
    builder.quad(fanPoint(outer, from, 0), fanPoint(outer, to, 0), fanPoint(outer, to, FAN_RING_OUT), fanPoint(outer, from, FAN_RING_OUT), cell, FEDERAL_WHITE, FIXED);
    builder.quad(fanPoint(inner, to, 0), fanPoint(inner, from, 0), fanPoint(inner, from, FAN_RING_OUT), fanPoint(inner, to, FAN_RING_OUT), cell, FEDERAL_WHITE, FIXED);
  }
}

/** The fan of glass: a triangle a segment from the springing point, each reading its slice of the fanlight cell (its flat edge along the cell's bottom). */
function fanGlass(builder: KitBuilder, radius: number): void {
  const cell = KIT_CELL.fanlight;
  const uvOf = (angle: number): readonly [number, number] => [cell.u0 + (cell.u1 - cell.u0) * (0.5 + 0.5 * Math.cos(angle)), cell.v0 + (cell.v1 - cell.v0) * Math.sin(angle)];
  for (let segment = 0; segment < FAN_SEGMENTS; segment++) {
    const from = (Math.PI * segment) / FAN_SEGMENTS;
    const to = (Math.PI * (segment + 1)) / FAN_SEGMENTS;
    builder.triangle([fanPoint(0, 0, FAN_GLASS_OUT), fanPoint(radius, from, FAN_GLASS_OUT), fanPoint(radius, to, FAN_GLASS_OUT)], [[cell.u0 + (cell.u1 - cell.u0) / 2, cell.v0], uvOf(from), uvOf(to)], WHITE, FIXED);
  }
}

export function buildFanlightGeometry(): THREE.BufferGeometry {
  const builder = new KitBuilder();
  for (const side of [-1, 1]) {
    const inner = DOOR_X + side * DOOR.halfWidth;
    const outer = DOOR_X + side * (DOOR.halfWidth + PILASTER_WIDTH);
    builder.box(Math.min(inner, outer), Math.max(inner, outer), DOOR.sill, DOOR.head, 0, PILASTER_OUT, FACE.front | FACE.left | FACE.right | FACE.top, KIT_CELL.panel, FEDERAL_WHITE, FIXED);
  }
  const ringOuter = DOOR.halfWidth + FAN_RING_WIDTH;
  fanGlass(builder, DOOR.halfWidth);
  archRing(builder, DOOR.halfWidth, ringOuter);
  builder.box(DOOR_X - KEYSTONE_HALF, DOOR_X + KEYSTONE_HALF, DOOR.head + DOOR.halfWidth, DOOR.head + ringOuter + KEYSTONE_RISE, 0, KEYSTONE_OUT, ALL_BUT_BACK, KIT_CELL.panel, FEDERAL_WHITE, FIXED);
  const capBottom = DOOR.head + ringOuter + KEYSTONE_RISE + ARCH_CAP_GAP;
  builder.box(DOOR_X - ARCH_CAP_HALF, DOOR_X + ARCH_CAP_HALF, capBottom, capBottom + ARCH_CAP_HEIGHT, 0, ARCH_CAP_OUT, ALL_BUT_BACK, KIT_CELL.panel, FEDERAL_WHITE, FIXED);
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

/**
 * What stands on a rowhome's flat roof, in the kit's frame with y from the roof's surface and z negative behind the facade: a brick chimney astride the party wall at the kit's +x
 * edge (each house draws the one on its own side, so every party wall has one) and a roof hatch; some houses also have a condenser box or a timber roof deck.
 */
const CHIMNEY_BRICK = new THREE.Color(0x9a4a35);
const HATCH_GREY = new THREE.Color(0x5f6266);
const CONDENSER_GREY = new THREE.Color(0xc8ccd0);
const DECK_WOOD = new THREE.Color(0x8b6544);
const DECK_IRON = new THREE.Color(0x2a2a2e);
/** The chimney: its half width across the party wall and half depth along it, its height and its middle behind the facade, then its cap's overhang and thickness (m). */
const CHIMNEY_HALF_WIDTH = 0.35;
const CHIMNEY_HALF_DEPTH = 0.7;
const CHIMNEY_HEIGHT = 1.3;
const CHIMNEY_BACK = 9.5;
const CHIMNEY_CAP_OVER = 0.07;
const CHIMNEY_CAP = 0.12;
/** The hatch: its middle (kit x, behind the facade), half side, curb height and lid. */
const HATCH_X = -0.6;
const HATCH_BACK = 5.5;
const HATCH_HALF = 0.45;
const HATCH_CURB = 0.35;
const HATCH_LID_OVER = 0.05;
const HATCH_LID = 0.05;
/** The condenser: its middle, half sides and height (m). */
const CONDENSER_X = 1;
const CONDENSER_BACK = 11.5;
const CONDENSER_HALF_WIDTH = 0.65;
const CONDENSER_HALF_DEPTH = 0.5;
const CONDENSER_HEIGHT = 1;
/** The deck: its half width, its front and back behind the facade, its platform's height, its rail's height and the rail's and posts' section (m). */
const DECK_HALF_WIDTH = 1.6;
const DECK_FRONT = 2.5;
const DECK_BACK = 5.5;
const DECK_PLATFORM = 0.3;
const DECK_RAIL = 1;
const DECK_BAR = 0.05;

const ALL_BUT_BOTTOM = FACE.front | FACE.back | FACE.left | FACE.right | FACE.top;

/** A box standing on the roof: its middle (kit x, behind the facade), half sides, foot and top. */
function roofBox(builder: KitBuilder, x: number, back: number, halfWidth: number, halfDepth: number, y0: number, y1: number, cell: UvRect, colour: THREE.Color): void {
  builder.box(x - halfWidth, x + halfWidth, y0, y1, -back - halfDepth, -back + halfDepth, ALL_BUT_BOTTOM, cell, colour, FIXED);
}

/** Every house's roof: the chimney on its +x party wall and the hatch. */
export function buildRoofGeometry(): THREE.BufferGeometry {
  const builder = new KitBuilder();
  const party = LOT_WIDTH / 2;
  roofBox(builder, party, CHIMNEY_BACK, CHIMNEY_HALF_WIDTH, CHIMNEY_HALF_DEPTH, 0, CHIMNEY_HEIGHT, KIT_CELL.stone, CHIMNEY_BRICK);
  roofBox(builder, party, CHIMNEY_BACK, CHIMNEY_HALF_WIDTH + CHIMNEY_CAP_OVER, CHIMNEY_HALF_DEPTH + CHIMNEY_CAP_OVER, CHIMNEY_HEIGHT, CHIMNEY_HEIGHT + CHIMNEY_CAP, KIT_CELL.stone, TRIM);
  roofBox(builder, HATCH_X, HATCH_BACK, HATCH_HALF, HATCH_HALF, 0, HATCH_CURB, KIT_CELL.stone, HATCH_GREY);
  roofBox(builder, HATCH_X, HATCH_BACK, HATCH_HALF + HATCH_LID_OVER, HATCH_HALF + HATCH_LID_OVER, HATCH_CURB, HATCH_CURB + HATCH_LID, KIT_CELL.panel, HATCH_GREY);
  return builder.geometry(true);
}

/** An air-conditioning condenser on the roof. */
export function buildCondenserGeometry(): THREE.BufferGeometry {
  const builder = new KitBuilder();
  roofBox(builder, CONDENSER_X, CONDENSER_BACK, CONDENSER_HALF_WIDTH, CONDENSER_HALF_DEPTH, 0, CONDENSER_HEIGHT, KIT_CELL.panel, CONDENSER_GREY);
  return builder.geometry(true);
}

/** A timber roof deck over the front of the roof, railed on its front and sides. */
export function buildDeckGeometry(): THREE.BufferGeometry {
  const builder = new KitBuilder();
  const halfDepth = (DECK_BACK - DECK_FRONT) / 2;
  const middle = (DECK_FRONT + DECK_BACK) / 2;
  const railTop = DECK_PLATFORM + DECK_RAIL;
  roofBox(builder, 0, middle, DECK_HALF_WIDTH, halfDepth, 0, DECK_PLATFORM, KIT_CELL.panel, DECK_WOOD);
  for (const [x, back] of [[-DECK_HALF_WIDTH, DECK_FRONT], [DECK_HALF_WIDTH, DECK_FRONT], [-DECK_HALF_WIDTH, DECK_BACK], [DECK_HALF_WIDTH, DECK_BACK]] as const) {
    roofBox(builder, x, back, DECK_BAR / 2, DECK_BAR / 2, DECK_PLATFORM, railTop, KIT_CELL.stone, DECK_IRON);
  }
  roofBox(builder, 0, DECK_FRONT, DECK_HALF_WIDTH, DECK_BAR / 2, railTop - DECK_BAR, railTop, KIT_CELL.stone, DECK_IRON);
  for (const side of [-1, 1]) roofBox(builder, side * DECK_HALF_WIDTH, middle, DECK_BAR / 2, halfDepth, railTop - DECK_BAR, railTop, KIT_CELL.stone, DECK_IRON);
  return builder.geometry(true);
}

/** A louvred shutter as a unit panel (1 m wide, 1 m tall, `SHUTTER_THICK` proud of the wall): each instance scales it to its window. */
const SHUTTER_THICK = 0.04;

export function buildShutterGeometry(): THREE.BufferGeometry {
  const builder = new KitBuilder();
  builder.box(-0.5, 0.5, 0, 1, 0, SHUTTER_THICK, ALL_BUT_BACK, KIT_CELL.louvre, WHITE, ACCENT);
  return builder.geometry(true);
}

/** A window air-conditioning unit as a unit box (1 m each way, its back on the wall): each instance scales it to a unit's size. */
export function buildAirconGeometry(): THREE.BufferGeometry {
  const builder = new KitBuilder();
  builder.box(-0.5, 0.5, 0, 1, 0, 1, ALL_BUT_BACK, KIT_CELL.panel, CONDENSER_GREY, FIXED);
  return builder.geometry(true);
}

/** A window box as a unit piece (1 m wide, tall and out of the wall; each instance scales it to its window): a trough in the house's accent paint, its soil, four plants of different heights in greens and two blooms (60 triangles). */
const BOX_TROUGH = 0.36;
const BOX_SOIL = 0.04;
const BOX_SOIL_INSET = 0.04;
const BOX_SOIL_COLOUR = new THREE.Color(0x4a3a2c);
/** Each plant: its middle across (the box's width 1), its width, its height over the soil (a share of what the box's height leaves above the trough and soil), how far out of the wall it stands and how deep, and its leaf colour. */
const BOX_PLANTS: readonly (readonly [across: number, width: number, height: number, from: number, depth: number, colour: THREE.Color])[] = [
  [-0.36, 0.26, 0.45, 0.18, 0.64, new THREE.Color(0x3f7a35)],
  [-0.1, 0.3, 0.7, 0.16, 0.68, new THREE.Color(0x2f6a30)],
  [0.16, 0.26, 0.5, 0.18, 0.64, new THREE.Color(0x5f9a45)],
  [0.38, 0.2, 0.38, 0.2, 0.6, new THREE.Color(0x58903f)],
];
/** The blooms on top of two plants: which plant (an index into `BOX_PLANTS`), their size (a share of the unit box) and colour. */
const BOX_BLOOMS: readonly (readonly [plant: number, size: number, colour: THREE.Color])[] = [
  [1, 0.14, new THREE.Color(0xd23c4b)],
  [2, 0.12, new THREE.Color(0xf2c400)],
];
const BOX_PLANT_FACES = FACE.front | FACE.top | FACE.left | FACE.right;

export function buildWindowBoxGeometry(): THREE.BufferGeometry {
  const builder = new KitBuilder();
  builder.box(-0.5, 0.5, 0, BOX_TROUGH, 0, 1, ALL_BUT_BACK, KIT_CELL.panel, WHITE, ACCENT);
  const soilTop = BOX_TROUGH + BOX_SOIL;
  builder.box(-0.5 + BOX_SOIL_INSET, 0.5 - BOX_SOIL_INSET, BOX_TROUGH, soilTop, BOX_SOIL_INSET, 1 - BOX_SOIL_INSET, FACE.top, KIT_CELL.stone, BOX_SOIL_COLOUR, FIXED);
  for (const [across, width, height, from, depth, colour] of BOX_PLANTS) {
    builder.box(across - width / 2, across + width / 2, soilTop, soilTop + height * (1 - soilTop), from, from + depth, BOX_PLANT_FACES, KIT_CELL.panel, colour, FIXED);
  }
  for (const [plant, size, colour] of BOX_BLOOMS) {
    const [across, , height, from, depth] = BOX_PLANTS[plant]!;
    const top = soilTop + height * (1 - soilTop);
    builder.box(across - size / 2, across + size / 2, top, top + size, from + depth / 2 - size / 2, from + depth / 2 + size / 2, BOX_PLANT_FACES, KIT_CELL.panel, colour, FIXED);
  }
  return builder.geometry(true);
}
