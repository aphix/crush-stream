import * as THREE from "three";
import { hypot2, detSin } from "../kernel/physics-core.js";
import { once } from "../kernel/scalar.ts";
import { CAR_STYLE_IDS, CAR_STYLES, type BodyStyle } from "./car-variants.ts";
import { splitCreases } from "./car-crease.ts";
import { CREASE_DEGREES, SEDAN, sampleSlice, sideX } from "./car-mesh.ts";
import { rockerAt } from "./car-lines.ts";
import { MIRROR_REACH, MIRROR_ROOT } from "./part-geometry.ts";
import { doorCardGeometry } from "./interior-geometry.ts";
import { PLATFORM_HARDPOINTS } from "./car-styles/platform.ts";
import { CABIN_TRIM, PRIMER_ATTRIBUTE } from "./constants.ts";

/** The platform door as the sim readers still take it (door contact, hull gap, wear, car-parts) until they read `style.door`; `mirrorX` is its mirror base out from the hinge. */
export const DOOR = { ...PLATFORM_HARDPOINTS.door, mirrorX: 0.06 } as const;

/** Door skin over the body side at its outer face (m). */
export const DOOR_PROUD = 0.003;
/** The door skin is a slab this thick (m) inboard of its outer face. */
const DOOR_THICKNESS = 0.05;
/** The skin covers the door cut with this much (m) past each end. */
const DOOR_SKIN_OVERLAP = 0.02;
/** The skin's face meets the body side at each cut end and stands `DOOR_PROUD` proud this far (m) inside it, so the hinge and latch slices read as shut lines, not steps. */
const DOOR_TAPER = 0.02;

/** The door skin's centre along z in hinge space: the door cut's middle. */
export function doorSkinZ(style: BodyStyle): number {
  const [z0, z1] = style.door.aperture;
  return (z0 + z1) / 2 - style.door.hingeZ;
}

/** The mirror's seat in door space: x on the drawn door skin (the vertex grid's flat triangles) where the mirror is inside the door cut and the face's height, else on the body side, less the arm root's offset at the mirror's x-scale, so the arm starts on the skin. */
export function mirrorSeatX(style: BodyStyle): number {
  const d = style.door;
  const grid = doorGrid(style);
  const zl = -(d.mirrorZ ?? 0) - doorSkinZ(style);
  const armRoot = MIRROR_ROOT * (d.mirrorReach / MIRROR_REACH);
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
  return sideX(d.hingeY + d.mirrorY, sl.hw, sl.yBelt, rockerAt(z, style)) + DOOR_PROUD - d.hingeX - armRoot;
}
/** Outer-face rows (bunched toward the top by `DOOR_ROW_WARP`, so the shoulder roll reads round) and columns before the edge rolls are added. */
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

interface DoorGrid {
  h: number;
  halfLength: number;
  skinLength: number;
  rows: number[];
  columns: number[];
}

/** The door skin's row and column stations (door space) and the extents they span. */
function doorGrid(style: BodyStyle): DoorGrid {
  const d = style.door;
  const h = d.halfHeight;
  const [z0, z1] = d.aperture;
  const skinLength = z1 - z0 + 2 * DOOR_SKIN_OVERLAP;
  const halfLength = skinLength / 2;
  const rowInterior = Array.from({ length: DOOR_ROWS - 1 }, (_, k) => h * (1 - 2 * (1 - (k + 1) / DOOR_ROWS) ** DOOR_ROW_WARP));
  const taperFromOutline = DOOR_SKIN_OVERLAP + DOOR_TAPER;
  const columnInterior = [
    -halfLength + taperFromOutline,
    ...Array.from({ length: DOOR_COLUMNS - 1 }, (_, k) => -halfLength + (skinLength * (k + 1)) / DOOR_COLUMNS),
    halfLength - taperFromOutline,
  ];
  return { h, halfLength, skinLength, rows: doorStations(h, rowInterior), columns: doorStations(halfLength, columnInterior) };
}

/** The drawn outer-face vertex at a grid `rowStation` and column `z` (door space): `x` after the edge roll, `y` after the end slopes, `outer` before the roll. */
function doorFaceVertex(style: BodyStyle, grid: DoorGrid, rowStation: number, z: number) {
  const d = style.door;
  const { h, halfLength } = grid;
  let y = rowStation;
  if (z > halfLength - DOOR_FRONT_SLOPE.fromEdge) y += (z - (halfLength - DOOR_FRONT_SLOPE.fromEdge)) * DOOR_FRONT_SLOPE.rise;
  if (z < -(halfLength - DOOR_REAR_SLOPE.fromEdge)) y += (-(halfLength - DOOR_REAR_SLOPE.fromEdge) - z) * DOOR_REAR_SLOPE.rise;
  const zCar = d.hingeZ + doorSkinZ(style) + z;
  const sl = sampleSlice(zCar, style.profile);
  const intoCut = Math.min(z + halfLength, halfLength - z) - DOOR_SKIN_OVERLAP;
  const proud = DOOR_PROUD * THREE.MathUtils.clamp(intoCut / DOOR_TAPER, 0, 1);
  const outer = sideX(d.hingeY + y, sl.hw, sl.yBelt, rockerAt(zCar, style)) + proud - d.hingeX;
  const drop = doorEdgeDrop(Math.min(rowStation + h, h - rowStation), Math.min(z + halfLength, halfLength - z));
  return { x: outer - drop, y, outer };
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
 * follows the body side (`sideX`) at each height and station and rolls over its perimeter in a rounded edge into a
 * slab `DOOR_THICKNESS` thick inboard, closed by a flat inner face; its rows bunch toward the top so the shoulder
 * roll reads round.
 */
export function makeDoorGeometry(sign: number, style: BodyStyle = SEDAN): THREE.BufferGeometry {
  const grid = doorGrid(style);
  const { h, halfLength, skinLength, rows, columns } = grid;
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const outerX: number[] = [];
  const tri = (a: number, b: number, c: number, outward: boolean) => (outward ? indices.push(a, b, c) : indices.push(a, c, b));
  for (const rowStation of rows) {
    for (const z of columns) {
      const v = doorFaceVertex(style, grid, rowStation, z);
      positions.push(sign * v.x, v.y, z);
      outerX.push(v.outer);
      uvs.push((z + halfLength) / skinLength, (rowStation + h) / (2 * h));
    }
  }
  const faceVertices = positions.length / 3;
  for (let r = 0; r < rows.length - 1; r++) {
    for (let c = 0; c < columns.length - 1; c++) {
      const a = r * columns.length + c;
      const b = a + 1;
      const above = a + columns.length;
      tri(a, b, above, sign < 0);
      tri(b, above + 1, above, sign < 0);
    }
  }
  const loop = gridPerimeter(columns.length, rows.length);
  const slabEdge = loop.map((faceVertex, k) => {
    positions.push(sign * (outerX[faceVertex]! - DOOR_THICKNESS), positions[faceVertex * 3 + 1]!, positions[faceVertex * 3 + 2]!);
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
