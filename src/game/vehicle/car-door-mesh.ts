import * as THREE from "three";
import { hypot2, detSin } from "../kernel/physics-core.js";
import { once } from "../kernel/scalar.ts";
import { CAR_STYLE_IDS, CAR_STYLES, type BodyStyle } from "./car-variants.ts";
import { splitCreases, splitsOnLowDiagonal } from "./car-crease.ts";
import { CREASE_DEGREES, SEDAN, drawnSideRing, drawnSideX, glassX, sampleSlice, shoulderDrop, sideX } from "./car-mesh.ts";
import { rockerAt } from "./car-lines.ts";
import { MIRROR_REACH, MIRROR_ROOT } from "./part-geometry.ts";
import { doorCardGeometry } from "./interior-geometry.ts";
import { CABIN_TRIM, PRIMER_ATTRIBUTE } from "./constants.ts";

/** Door skin over the body side at its outer face (m). */
const DOOR_PROUD = 0.003;
/** The door skin is a slab this thick (m) on average: its flat inner face stands this far inboard of the outer face's mean x, so it carries none of the side's waves. */
const DOOR_THICKNESS = 0.05;
/** The cage's door slab (m): thick enough that its inner face reaches inside the cage's own side at door heights, so no gap lies behind the face a side hit meets. */
export const CAGE_DOOR_THICKNESS = 0.25;
/** The skin covers the door cut with this much (m) past each end. */
const DOOR_SKIN_OVERLAP = 0.02;
/** The skin's face meets the body side at each cut end and stands `DOOR_PROUD` proud this far (m) inside it, so the hinge and latch slices read as shut lines, not steps. */
const DOOR_TAPER = 0.02;

/** The door skin's centre along z in hinge space: the door cut's middle. */
export function doorSkinZ(style: BodyStyle): number {
  const [z0, z1] = style.door.aperture;
  return (z0 + z1) / 2 - style.door.hingeZ;
}

/**
 * The mirror's seat in door space: x on the drawn door skin (the vertex grid's flat triangles) where the mirror is inside the door cut and the
 * face's height, else on the body side, or on the door glass's plane for a glass mount, less the arm root's offset at the mirror's x-scale, so
 * the arm starts on the surface.
 */
export function mirrorSeatX(style: BodyStyle): number {
  const d = style.door;
  const armRoot = MIRROR_ROOT * (d.mirrorReach / MIRROR_REACH);
  if (d.mirror?.mount === "glass") return glassX(d.hingeZ - (d.mirrorZ ?? 0), d.hingeY + d.mirrorY, style) - d.hingeX - armRoot;
  const grid = doorGrid(style);
  const zl = -(d.mirrorZ ?? 0) - doorSkinZ(style);
  const { columns } = grid;
  const cutHalf = grid.halfLength - DOOR_SKIN_OVERLAP;
  let upper = 1;
  while (upper < columns.length - 1 && columns[upper]! < zl) upper++;
  const z0 = columns[upper - 1]!;
  const z1 = columns[upper]!;
  const onDoor = Math.abs(zl) < cutHalf ? THREE.MathUtils.lerp(faceXAtHeight(style, grid, z0, d.mirrorY), faceXAtHeight(style, grid, z1, d.mirrorY), (zl - z0) / (z1 - z0)) : NaN;
  if (!Number.isNaN(onDoor)) return onDoor - armRoot;
  const z = d.hingeZ - (d.mirrorZ ?? 0);
  const sl = sampleSlice(z, style.profile);
  return sideX(d.hingeY + d.mirrorY, sl.hw, sl.yBelt, rockerAt(z, style), shoulderDrop(z, style)) + (d.proud ?? DOOR_PROUD) - d.hingeX - armRoot;
}
/**
 * Outer-face columns before the edge rolls are added. The face's rows between its edge rolls are the body ring's side rows, and over
 * the topmost of them the old warped rows (bunched toward the top by `DOOR_ROW_WARP`, so the shoulder roll reads round).
 */
const DOOR_ROWS = 8;
const DOOR_ROW_WARP = 1.6;
const DOOR_COLUMNS = 6;
/** The outer face rolls over its perimeter in a quarter circle of this radius (m), in `DOOR_EDGE_STEPS` chords, and meets the slab's edge wall tangent to it. */
const DOOR_EDGE_RADIUS = 0.02;
const DOOR_EDGE_STEPS = 2;
/** A face row or column nearer than this (m) to where the edge roll starts is dropped: two stations a few millimetres apart are only skin cost. */
const DOOR_EDGE_CLEARANCE = 0.01;
/** The skin's trailing end slopes down and the leading end up within these distances (m) of its ends, as the body side does at the hinge and latch. */
const DOOR_FRONT_SLOPE = { fromEdge: 0.13, rise: -0.06 } as const;
const DOOR_REAR_SLOPE = { fromEdge: 0.09, rise: -0.04 } as const;

/** Stations along one axis of the door skin, from `-halfExtent` to `halfExtent`: the edge roll's chords at each end, `interior` stations between them. */
function doorStations(halfExtent: number, interior: readonly number[]): number[] {
  const fromEdge = Array.from({ length: DOOR_EDGE_STEPS + 1 }, (_, k) => DOOR_EDGE_RADIUS * (1 - detSin((Math.PI / 2) * (1 - k / DOOR_EDGE_STEPS))));
  const kept = interior.filter((station) => halfExtent - Math.abs(station) >= DOOR_EDGE_RADIUS + DOOR_EDGE_CLEARANCE);
  return [...fromEdge.map((d) => d - halfExtent), ...kept, ...[...fromEdge].reverse().map((d) => halfExtent - d)];
}

/** How far (m) the outer face has rolled back at `distanceToRowEdge` and `distanceToColumnEdge` from the outline: 0 where the roll starts, `DOOR_EDGE_RADIUS` at the outline. */
function doorEdgeDrop(distanceToRowEdge: number, distanceToColumnEdge: number): number {
  const r = DOOR_EDGE_RADIUS;
  const into = Math.min(r, hypot2(Math.max(r - distanceToRowEdge, 0), Math.max(r - distanceToColumnEdge, 0)));
  return r - Math.sqrt(r * r - into * into);
}

/** Loop of grid vertex ids around a `columns` x `rows` grid (row-major), bottom row left to right, then up the right side, back along the top and down the left. */
function gridPerimeter(columns: number, rows: number): number[] {
  const loop: number[] = [];
  for (let c = 0; c < columns; c++) loop.push(c);
  for (let r = 1; r < rows; r++) loop.push(r * columns + columns - 1);
  for (let c = columns - 2; c >= 0; c--) loop.push((rows - 1) * columns + c);
  for (let r = rows - 2; r >= 1; r--) loop.push(r * columns);
  return loop;
}

/** A face row: a station (door space) of the top or bottom edge roll, or the body ring's side row `ring` (`drawnSideRowYs`), followed along the door. */
type DoorRow = number | { ring: number };

interface DoorGrid {
  h: number;
  /** How far (m) the skin's top row comes down at the hinge cut, past the hinge end's slope: 0 unless the style sets `hingeTop`. */
  hingeDrop: number;
  halfLength: number;
  skinLength: number;
  rows: DoorRow[];
  columns: number[];
}

/** The door skin's rows and column stations (door space) and the extents they span. */
function doorGrid(style: BodyStyle): DoorGrid {
  const d = style.door;
  const h = d.halfHeight;
  const [z0, z1] = d.aperture;
  const skinLength = z1 - z0 + 2 * DOOR_SKIN_OVERLAP;
  const halfLength = skinLength / 2;
  const taperFromOutline = DOOR_SKIN_OVERLAP + DOOR_TAPER;
  const columnInterior = [
    -halfLength + taperFromOutline,
    ...Array.from({ length: DOOR_COLUMNS - 1 }, (_, k) => -halfLength + (skinLength * (k + 1)) / DOOR_COLUMNS),
    halfLength - taperFromOutline,
  ];
  const columns = doorStations(halfLength, columnInterior);
  const slopedTop = d.hingeY + h + (DOOR_FRONT_SLOPE.fromEdge - DOOR_SKIN_OVERLAP) * DOOR_FRONT_SLOPE.rise;
  const hingeDrop = d.hingeTop === undefined ? 0 : slopedTop - d.hingeTop;
  const edges = doorStations(h, []);
  const [bottom, top] = [edges.slice(0, DOOR_EDGE_STEPS + 1), edges.slice(DOOR_EDGE_STEPS + 1)];
  const rolls: DoorGrid = { h, hingeDrop, halfLength, skinLength, rows: edges, columns };
  const cuts = [-(halfLength - DOOR_SKIN_OVERLAP), halfLength - DOOR_SKIN_OVERLAP];
  // A ring row stays clear of the bottom roll everywhere and of the top roll at both cuts: one squeezed under the top roll folds the corner.
  const rings = drawnSideRing(0, style)
    .map((_, ring) => ring)
    .filter(
      (ring) =>
        columns.every((z) => ringRowY(style, rolls, ring, z) >= doorFaceVertex(style, rolls, bottom[DOOR_EDGE_STEPS]!, z).y + DOOR_EDGE_CLEARANCE) &&
        cuts.every((z) => ringRowY(style, rolls, ring, z) <= doorFaceVertex(style, rolls, top[0]!, z).y - DOOR_EDGE_CLEARANCE),
    );
  const topRing = rings.length === 0 ? -h : Math.max(...columns.map((z) => ringRowY(style, rolls, rings[0]!, z)));
  const warped = Array.from({ length: DOOR_ROWS - 1 }, (_, k) => h * (1 - 2 * (1 - (k + 1) / DOOR_ROWS) ** DOOR_ROW_WARP));
  const shoulder = doorStations(h, warped)
    .slice(DOOR_EDGE_STEPS + 1, -(DOOR_EDGE_STEPS + 1))
    .filter((station) => columns.every((z) => doorFaceVertex(style, rolls, station, z).y >= topRing + DOOR_EDGE_CLEARANCE));
  return { ...rolls, rows: [...bottom, ...[...rings].reverse().map((ring) => ({ ring })), ...shoulder, ...top] };
}

/**
 * The body ring's side point `ring` (`drawnSideRing`)'s height (door space, m) along the door: its height at each cut, lerped between
 * them and held past them.
 */
function ringRowY(style: BodyStyle, grid: DoorGrid, ring: number, z: number): number {
  const d = style.door;
  const cut = grid.halfLength - DOOR_SKIN_OVERLAP;
  const at = (end: number) => drawnSideRing(d.hingeZ + doorSkinZ(style) + end * cut, style)[ring]![1] - d.hingeY;
  return THREE.MathUtils.lerp(at(-1), at(1), THREE.MathUtils.clamp((z + cut) / (2 * cut), 0, 1));
}

/** The skin's stand-off (m) over the body side at car height `yCar`, before the cut-end taper: its `proud` (`DOOR_PROUD` default) and, with `door.lowProud`, no less than that easing in below the lowest ring row it carries (`ringY`, car y; undefined: none) to the door's bottom edge. */
function doorStand(d: BodyStyle["door"], ringY: number | undefined, yCar: number): number {
  const proud = d.proud ?? DOOR_PROUD;
  if (d.lowProud === undefined || ringY === undefined) return proud;
  return Math.max(proud, d.lowProud * THREE.MathUtils.clamp((ringY - yCar) / (ringY - (d.hingeY - d.halfHeight)), 0, 1));
}

/** The lowest body-ring row the skin carries at door-space `z`, as car height (m); undefined where it carries none (the grid's edge-roll pass). */
function lowestRingY(style: BodyStyle, grid: DoorGrid, z: number): number | undefined {
  const row = grid.rows.find((r): r is { ring: number } => typeof r !== "number");
  return row === undefined ? undefined : style.door.hingeY + ringRowY(style, grid, row.ring, z);
}

/** How far the skin's stand has come up at door-space `z`: 0 at each cut end, easing to 1 over `DOOR_TAPER`. */
function cutTaper(grid: DoorGrid, z: number): number {
  return THREE.MathUtils.clamp((Math.min(z + grid.halfLength, grid.halfLength - z) - DOOR_SKIN_OVERLAP) / DOOR_TAPER, 0, 1);
}

/** `doorStand` for what rides on the skin (the chrome strips) at car-local `z` and height `y`: the skin's own stand, cut-end taper included. */
export function doorSkinStand(style: BodyStyle): (z: number, y: number) => number {
  const grid = doorGrid(style);
  return (z, y) => {
    const local = z - style.door.hingeZ - doorSkinZ(style);
    return doorStand(style.door, lowestRingY(style, grid, local), y) * cutTaper(grid, local);
  };
}

/**
 * The drawn outer-face vertex on `row` at column `z` (door space): `x` after the edge roll, `y` after the edge rows' end slopes, `outer`
 * before the roll, `station` the row's height before the slopes. A ring row is held `DOOR_EDGE_CLEARANCE` under the top roll's start.
 */
function doorFaceVertex(style: BodyStyle, grid: DoorGrid, row: DoorRow, z: number) {
  const d = style.door;
  const { h, hingeDrop, halfLength } = grid;
  let station: number;
  let y: number;
  if (typeof row === "number") {
    station = y = row;
    const intoFront = z - (halfLength - DOOR_FRONT_SLOPE.fromEdge);
    if (intoFront > 0) y += intoFront * DOOR_FRONT_SLOPE.rise;
    const hingeClosing = THREE.MathUtils.clamp(intoFront / (DOOR_FRONT_SLOPE.fromEdge - DOOR_SKIN_OVERLAP), 0, 1);
    y -= hingeClosing * ((station + h) / (2 * h)) * hingeDrop;
    if (z < -(halfLength - DOOR_REAR_SLOPE.fromEdge)) y += (-(halfLength - DOOR_REAR_SLOPE.fromEdge) - z) * DOOR_REAR_SLOPE.rise;
  } else {
    station = y = Math.min(ringRowY(style, grid, row.ring, z), doorFaceVertex(style, grid, h - DOOR_EDGE_RADIUS, z).y - DOOR_EDGE_CLEARANCE);
  }
  const [zCar, yCar] = [d.hingeZ + doorSkinZ(style) + z, d.hingeY + y];
  const sl = sampleSlice(zCar, style.profile);
  const rockerY = rockerAt(zCar, style);
  const crestDrop = shoulderDrop(zCar, style);
  // On the ring's chords over the span of the ring rows the face carries, so it meets the body there; above and below it, on the side's
  // curve, held continuous at the span's ends.
  const ringRows = grid.rows.filter((r): r is { ring: number } => typeof r !== "number");
  const bottom = lowestRingY(style, grid, z);
  const proud = doorStand(d, bottom, yCar) * cutTaper(grid, z);
  let side = sideX(yCar, sl.hw, sl.yBelt, rockerY, crestDrop);
  if (bottom !== undefined) {
    const top = d.hingeY + ringRowY(style, grid, ringRows[ringRows.length - 1]!.ring, z);
    const held = THREE.MathUtils.clamp(yCar, bottom, top);
    side += drawnSideX(zCar, held, style) - sideX(held, sl.hw, sl.yBelt, rockerY, crestDrop);
  }
  const outer = side + proud - d.hingeX;
  const drop = doorEdgeDrop(Math.min(station + h, h - station), Math.min(z + halfLength, halfLength - z));
  return { x: outer - drop, y, outer, station };
}

/** The drawn outer face's x at height `y` on grid column `z`: the lerp between the two rows whose vertices bracket `y`; NaN off the face. */
function faceXAtHeight(style: BodyStyle, grid: DoorGrid, z: number, y: number): number {
  const { rows } = grid;
  let below = doorFaceVertex(style, grid, rows[0]!, z);
  if (y < below.y) return NaN;
  for (let r = 1; r < rows.length; r++) {
    const above = doorFaceVertex(style, grid, rows[r]!, z);
    if (y <= above.y) return below.x + ((above.x - below.x) * (y - below.y)) / (above.y - below.y);
    below = above;
  }
  return NaN;
}

/** The drawn door card stands at least this far (m) inboard of every style's door skin. */
const CARD_CLEAR = 0.003;

/** The door card as drawn on side `sign` (every style shares it): each vertex held `CARD_CLEAR` inboard of every style's door skin outer face, so no card shows where a skin tucks in low on the door. The sim keeps the card's own box (`doorCardGeometry`). */
function cardInsideSkins(sign: number): THREE.BufferGeometry {
  const card = doorCardGeometry(sign);
  const pos = card.getAttribute("position") as THREE.BufferAttribute;
  for (const id of CAR_STYLE_IDS) {
    const style = CAR_STYLES[id];
    const grid = doorGrid(style);
    for (let i = 0; i < pos.count; i++) {
      const limit = faceXAtHeight(style, grid, pos.getZ(i) - doorSkinZ(style), pos.getY(i)) - CARD_CLEAR;
      if (sign * pos.getX(i) > limit) pos.setX(i, sign * limit);
    }
  }
  card.computeVertexNormals();
  return card;
}

const DRAWN_CARDS = [once(() => cardInsideSkins(-1)), once(() => cardInsideSkins(1))] as const;

/** The door card the part batch draws on side `sign`, inside every style's door skin (`cardInsideSkins`). */
export function drawnDoorCard(sign: number): THREE.BufferGeometry {
  return DRAWN_CARDS[sign < 0 ? 0 : 1]();
}

/**
 * Door skin in hinge-local space (parent at the A-pillar hinge, the skin centred on the door cut). The outer face
 * follows the body side (`sideX`) at each height and station, its rows on the body ring's side rows so its facets
 * meet the body's at each cut, and rolls over its perimeter in a rounded edge into a slab `thickness` (m, the drawn `DOOR_THICKNESS` by default; the cage's
 * is `CAGE_DOOR_THICKNESS`) thick inboard, closed by a flat inner face.
 */
export function makeDoorGeometry(sign: number, style: BodyStyle = SEDAN, thickness = DOOR_THICKNESS): THREE.BufferGeometry {
  const grid = doorGrid(style);
  const { h, halfLength, skinLength, rows, columns } = grid;
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const outerX: number[] = [];
  const tri = (a: number, b: number, c: number, outward: boolean) => (outward ? indices.push(a, b, c) : indices.push(a, c, b));
  for (const row of rows) {
    for (const z of columns) {
      const v = doorFaceVertex(style, grid, row, z);
      positions.push(sign * v.x, v.y, z);
      outerX.push(v.outer);
      uvs.push((z + halfLength) / skinLength, (v.station + h) / (2 * h));
    }
  }
  const faceVertices = positions.length / 3;
  const firstRingRow = rows.findIndex((row) => typeof row !== "number");
  // The lifted bottom row (door.lowProud) sits on the cell diagonal's low end at the latch end only; mirror the diagonal on the hinge half so the lift reaches the same share of both end cells.
  const mirrored = style.door.lowProud !== undefined;
  const vertexAt = (v: number) => new THREE.Vector3(positions[v * 3]!, positions[v * 3 + 1]!, positions[v * 3 + 2]!);
  const facing = new THREE.Vector3(sign, 0, 0);
  for (let r = 0; r < rows.length - 1; r++) {
    for (let c = 0; c < columns.length - 1; c++) {
      const a = r * columns.length + c;
      const b = a + 1;
      const above = a + columns.length;
      if (mirrored && r < firstRingRow ? columns[c]! >= 0 : splitsOnLowDiagonal(vertexAt(a), vertexAt(b), vertexAt(above), vertexAt(above + 1), facing)) {
        tri(a, b, above + 1, sign < 0);
        tri(a, above + 1, above, sign < 0);
      } else {
        tri(a, b, above, sign < 0);
        tri(b, above + 1, above, sign < 0);
      }
    }
  }
  const loop = gridPerimeter(columns.length, rows.length);
  const slabX = outerX.reduce((sum, x) => sum + x, 0) / outerX.length - thickness;
  const slabEdge = loop.map((faceVertex, k) => {
    positions.push(sign * slabX, positions[faceVertex * 3 + 1]!, positions[faceVertex * 3 + 2]!);
    uvs.push(uvs[faceVertex * 2]!, uvs[faceVertex * 2 + 1]!);
    return faceVertices + k;
  });
  let centreY = 0;
  let centreZ = 0;
  let centreX = 0;
  for (const v of slabEdge) {
    centreX += positions[v * 3]! / slabEdge.length;
    centreY += positions[v * 3 + 1]! / slabEdge.length;
    centreZ += positions[v * 3 + 2]! / slabEdge.length;
  }
  const centre = positions.length / 3;
  positions.push(centreX, centreY, centreZ);
  uvs.push(0.5, 0.5);
  for (let k = 0; k < loop.length; k++) {
    const next = (k + 1) % loop.length;
    tri(loop[k]!, loop[next]!, slabEdge[k]!, sign > 0);
    tri(loop[next]!, slabEdge[next]!, slabEdge[k]!, sign > 0);
    tri(centre, slabEdge[k]!, slabEdge[next]!, sign > 0);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  // The flat inner face (its rim and centre) is the cabin's dark trim, as the glass shows it; the skin and its rolled edge are paint.
  const primer = new Float32Array(positions.length / 3);
  for (const v of [...slabEdge, centre]) primer[v] = CABIN_TRIM;
  geo.setAttribute(PRIMER_ATTRIBUTE, new THREE.Float32BufferAttribute(primer, 1));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return splitCreases(geo, CREASE_DEGREES.door);
}
