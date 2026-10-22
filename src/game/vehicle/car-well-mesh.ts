import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { detAtan2, detCos, detSin } from "../kernel/physics-core.js";
import { INNER_PANEL } from "./constants.ts";
import type { BodyStyle } from "./car-variants.ts";
import { floorY, rockerAt } from "./car-lines.ts";
import { bootCut, ensureOutwardNormals, lerp, loftFromRings, sampleSlice, TUB_EDGE, WELL_LINER_WIDTH, type BodySource, type Pt } from "./car-mesh.ts";
import { carFrame } from "./car-rig.ts";

/**
 * The wheel wells: the liner over each tyre (in both builds: the cage carries it), the hump that closes the liner where it stands up
 * through an open floor (a bed's wheel tubs in both builds, else the drawn body's only), and on the drawn body the arch's lip.
 */

/** The liner's middle across the car: over the tyre, or held inside the body side where the tyre stands outboard of it (the monster's). */
function linerX(wx: number, wz: number, style: BodyStyle): number {
  const hw = sampleSlice(wz, style.profile).hw;
  return Math.abs(wx) > hw ? Math.sign(wx) * (hw - WELL_LINER_WIDTH / 2) : wx;
}

/**
 * Each wheel's liner: a half-tube over the tyre. Drawn, it is two-sided (the paint culls back faces: the bay sees its outside, the
 * tyre its inside), and where the tyre stands outboard of the body (the monster's) it closes its inboard end, so the arch opens onto a
 * dark well up to its crown, not through the body: at the liner's end, or at a floor's side wall where one stands over it (the bed's,
 * which culls from the arch's side).
 */
export function makeWellLiners(style: BodyStyle, source: BodySource): THREE.BufferGeometry[] {
  const r = style.arch.radius;
  return carFrame(style).wheels.map(([wx, wy, wz]) => {
    const x = linerX(wx, wz, style);
    const geo = new THREE.CylinderGeometry(r, r, WELL_LINER_WIDTH, 14, 1, true, 0, Math.PI);
    geo.rotateZ(Math.PI / 2);
    geo.rotateY(wx > 0 ? 0 : Math.PI);
    geo.translate(x, wy, wz);
    if (source === "cage") return withLinerUv(geo);
    const inside = geo.clone();
    const index = inside.getIndex()!;
    for (let t = 0; t < index.count; t += 3) {
      const b = index.getX(t + 1);
      index.setX(t + 1, index.getX(t + 2));
      index.setX(t + 2, b);
    }
    const parts: THREE.BufferGeometry[] = [geo, inside];
    if (x !== wx) {
      // A half disc over the hub, facing out through the opening.
      const end = wellFloor(style, source, wy, wz) < Infinity ? sampleSlice(wz, style.profile).hw - BED_WALL_INSET + 2 * HUMP_SINK : Math.abs(x) - WELL_LINER_WIDTH / 2;
      const cap = new THREE.CircleGeometry(r, 14, 0, Math.PI).rotateY((Math.sign(wx) * Math.PI) / 2);
      parts.push(cap.translate(Math.sign(wx) * end, wy, wz));
    }
    const liner = mergeGeometries(parts, false);
    if (!liner) throw new Error("Failed to merge a wheel-well liner's sides");
    for (const g of parts) g.dispose();
    return withLinerUv(liner);
  });
}

function withLinerUv(geo: THREE.BufferGeometry): THREE.BufferGeometry {
  const uv = geo.getAttribute("uv") as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, 0.12, i / uv.count);
  return geo;
}

/** A hump clears the liner it closes by this much (m), and sinks this far into the floor and wall it stands on. */
const HUMP_CLEAR = 0.015;
const HUMP_SINK = 0.005;
/** The floor's side wall stands this far (m) in from the body side (`halfRing`'s floor edge). */
const BED_WALL_INSET = 0.06;
/** Its top's inner edge is rounded off over this much (m); rings along it, from floor to floor over the wheel. */
const HUMP_ROUND = 0.03;
const HUMP_STEPS = 8;

/** The open floor (m) the liner of the wheel at (`wy`, `wz`) stands up through (the style's tubs, and drawn the boot's hollow; not the bay), or Infinity. */
function wellFloor(style: BodyStyle, source: BodySource, wy: number, wz: number): number {
  const r = style.arch.radius;
  const cut = source === "drawn" ? bootCut(style) : null;
  const floors = cut ? [...style.tubs, [cut.rear, cut.front, cut.floor] as const] : style.tubs;
  let floor = Infinity;
  for (const [z0, z1, f] of floors) {
    const top = Math.max(f, floorY(wz, style));
    const reach = top > wy ? Math.sqrt(Math.max(0, r * r - (top - wy) ** 2)) : r;
    if (wy + r > top && wz + reach > z0 + TUB_EDGE && wz - reach < z1 - TUB_EDGE) floor = Math.min(floor, top);
  }
  return floor;
}

/**
 * Over each wheel whose liner stands up through an open floor (`wellFloor`), a hump from the floor's side wall inward, its top a half
 * ellipse along the car: a style's `wheelTub` in both builds, else on the drawn body one to just past the liner's inner edge, 1.5 cm over
 * the liner's arc. The floor between the humps stays flat (`halfRing`). Null when there is none.
 */
export function wellHumpGeometry(style: BodyStyle, source: BodySource): THREE.BufferGeometry | null {
  const tub = style.wheelTub;
  if (source === "cage" && !tub) return null;
  const r = style.arch.radius;
  const humps: THREE.BufferGeometry[] = [];
  for (const [wx, wy, wz] of carFrame(style).wheels) {
    const floor = wellFloor(style, source, wy, wz);
    if (floor === Infinity) continue;
    const rise = tub ? tub.rise : wy + r + HUMP_CLEAR - floor;
    const half = tub ? tub.length / 2 : (floor > wy ? Math.sqrt(r * r - (floor - wy) ** 2) : r) + HUMP_CLEAR;
    const inner = tub
      ? sampleSlice(wz, style.profile).hw - BED_WALL_INSET - tub.width
      : Math.abs(linerX(wx, wz, style)) - WELL_LINER_WIDTH / 2 - HUMP_CLEAR - HUMP_ROUND;
    const side = Math.sign(wx);
    const rings: Pt[][] = [];
    const zs: number[] = [];
    for (let k = 0; k <= HUMP_STEPS; k++) {
      const a = (k / HUMP_STEPS - 0.5) * Math.PI;
      const z = wz + half * detSin(a);
      const wall = sampleSlice(z, style.profile).hw - BED_WALL_INSET + HUMP_SINK;
      const top = floor + Math.max(rise * detCos(a), 2 * HUMP_SINK);
      const round = Math.min(HUMP_ROUND, (top - floor) / 2);
      const bottom = floor - HUMP_SINK;
      rings.push(
        [
          [wall, bottom],
          [inner, bottom],
          [inner, top - round],
          [inner + round, top],
          [wall, top],
        ].map(([x, y]) => ({ x: side * x!, y: y! })),
      );
      zs.push(z);
    }
    if (inner >= rings[HUMP_STEPS / 2]![0]!.x * side) continue;
    const hump = loftFromRings(rings, zs, 0, 1, false);
    ensureOutwardNormals(hump);
    humps.push(hump);
  }
  return merged(humps);
}

/** Rings round an arch's lip from the rear foot over the top to the front foot (each foot's leg adds one). */
const LIP_ARC_STEPS = 12;
/** The lip's toe sinks this far (m) into the skin it fairs into. */
const LIP_SINK = 0.004;
/** A squared lip's outline: the superellipse exponent its corners follow (2 = the round opening). */
const LIP_SQUARE = 4;
/** The lip rolls under the opening's edge over this radius (m), so its crown catches light over a shaded underside; its return runs this deep (m) past the skin into the well. */
const LIP_ROLL = 0.01;
const LIP_RETURN = 0.035;
/** A box flare's face steps out over its outer `STEP` (m). */
const LIP_STEP = 0.016;

/**
 * The lip's section (m) as [out from the opening's edge, off the skin, primer tone]: its toe faired into the skin, its crown, rolled
 * round the edge and returned into the well, unpainted (`INNER_PANEL`) from the roll's underside so the edge reads over a dark gap.
 */
function lipSection(flare: number, width: number, square: boolean): (readonly [number, number, number])[] {
  const crown = 0.1 * width;
  const section: (readonly [number, number, number])[] = square
    ? [
        [width, -LIP_SINK, 0],
        [width - LIP_STEP, flare, 0],
        [crown, flare, 0],
        [crown - LIP_ROLL, flare - LIP_ROLL, INNER_PANEL],
      ]
    : [
        [width, -LIP_SINK, 0],
        [width * 0.45, flare * 0.6, 0],
        [crown, flare, 0],
        [crown - LIP_ROLL, flare - LIP_ROLL, 0],
        [crown - 0.7 * LIP_ROLL, flare - 1.7 * LIP_ROLL, INNER_PANEL],
      ];
  section.push([Math.min(section.at(-1)![0], -LIP_SINK), -LIP_RETURN, INNER_PANEL]);
  return section;
}

/**
 * The drawn loft's outermost side (m, |x|) on side `side` at height `y`, station `z`: off its own triangles between the two rings `z`
 * falls between (`loft`'s first ring × slices vertices, as `loftFromRings` lays them out). -Infinity where no side triangle spans (y, z).
 */
function skinX(loft: THREE.BufferGeometry, side: number, y: number, z: number): number {
  const { ring: n, slices } = loft.userData.loft as { ring: number; slices: number };
  const pos = loft.getAttribute("position");
  let s = 0;
  while (s < slices - 2 && pos.getZ((s + 1) * n) < z) s++;
  let best = -Infinity;
  const tri = (a: number, b: number, c: number) => {
    const [ay, az, by, bz, cy, cz] = [pos.getY(a), pos.getZ(a), pos.getY(b), pos.getZ(b), pos.getY(c), pos.getZ(c)];
    const det = (by - ay) * (cz - az) - (bz - az) * (cy - ay);
    if (Math.abs(det) < 1e-12) return;
    const u = ((y - ay) * (cz - az) - (z - az) * (cy - ay)) / det;
    const v = ((by - ay) * (z - az) - (bz - az) * (y - ay)) / det;
    if (u < -1e-9 || v < -1e-9 || u + v > 1 + 1e-9) return;
    const x = pos.getX(a) + u * (pos.getX(b) - pos.getX(a)) + v * (pos.getX(c) - pos.getX(a));
    if (x * side > best) best = x * side;
  };
  for (let i = 0; i < n; i++) {
    const a = s * n + i;
    const b = s * n + ((i + 1) % n);
    tri(a, b, a + n);
    tri(b, b + n, a + n);
  }
  return best;
}

/** A lip's stations round the opening of the wheel at (`wy`, `wz`): [z, y] on its edge and the outward unit [uz, uy] there, rear foot to front foot. */
function lipPath(style: BodyStyle, wy: number, wz: number, square: boolean): [number, number, number, number][] {
  const r = style.arch.radius;
  const foot = (sign: number) => rockerAt(wz + sign * r, style);
  // The arc's end angle from the top: down to hub height, or up to where the rocker meets the opening over it.
  const reachDown = (sign: number) => {
    const c = Math.min(1, (foot(sign) - wy) / r);
    return foot(sign) < wy ? Math.PI / 2 : detAtan2(Math.sqrt(1 - c * c), c);
  };
  const path: [number, number, number, number][] = [];
  const [start, end] = [-reachDown(-1), reachDown(1)];
  if (foot(-1) < wy) path.push([wz - r, foot(-1), -1, 0]);
  for (let k = 0; k <= LIP_ARC_STEPS; k++) {
    const a = lerp(start, end, k / LIP_ARC_STEPS);
    const s = detSin(a);
    const c = detCos(a);
    const reach = square ? r * (Math.abs(s) ** LIP_SQUARE + Math.abs(c) ** LIP_SQUARE) ** (-1 / LIP_SQUARE) : r;
    path.push([wz + reach * s, wy + reach * c, s, c]);
  }
  if (foot(1) < wy) path.push([wz + r, foot(1), 1, 0]);
  return path;
}

/** Where a lip's point lands on no side triangle (the opening's chord between two rings), its skin is sought this far (m) further out, in 5 mm steps. */
const LIP_SEEK = 0.03;

/**
 * Each wheel arch's lip (`arch.lip`, drawn only): a strip round the opening's edge, its crown `flare` proud of the skin, faired into it
 * `width` out and rolled under the edge into the well; round the opening's arc, then straight down its sides to the rocker. It sits on
 * the drawn `loft` (its first ring × slices vertices). Its index holds the four lips in wheel order, `userData.perWheel` the index count
 * of each (`panelRegions` peels each with its arch), `userData.tone` each vertex's primer (the body's `PRIMER_ATTRIBUTE`).
 */
export function archLipGeometry(style: BodyStyle, loft: THREE.BufferGeometry): THREE.BufferGeometry | null {
  const lip = style.arch.lip;
  if (!lip) return null;
  const section = lipSection(lip.flare, lip.width, lip.square === true);
  const m = section.length;
  const positions: number[] = [];
  const indices: number[] = [];
  const perWheel: number[] = [];
  const tone: number[] = [];
  for (const [wx, wy, wz] of carFrame(style).wheels) {
    const side = Math.sign(wx);
    const path = lipPath(style, wy, wz, lip.square === true);
    const first = positions.length / 3;
    for (const [z, y, uz, uy] of path) {
      for (const [out, off, t] of section) {
        let skin = -Infinity;
        for (let seek = Math.max(out, 0); skin === -Infinity && seek <= Math.max(out, 0) + LIP_SEEK; seek += 0.005) skin = skinX(loft, side, y + uy * seek, z + uz * seek);
        if (skin === -Infinity) throw new Error(`${style.id}: no body side under the arch lip at y ${y}, z ${z}`);
        positions.push(side * (skin + off), y + uy * out, z + uz * out);
        tone.push(t);
      }
    }
    const from = indices.length;
    for (let s = 0; s < path.length - 1; s++) {
      for (let k = 0; k < m - 1; k++) {
        const a = first + s * m + k;
        const b = a + 1;
        const c = a + m;
        const d = c + 1;
        if (side > 0) indices.push(a, c, b, b, c, d);
        else indices.push(a, b, c, b, d, c);
      }
    }
    perWheel.push(indices.length - from);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute("uv", new THREE.Float32BufferAttribute(new Float32Array((positions.length / 3) * 2), 2));
  geo.setIndex(indices);
  geo.userData.perWheel = perWheel;
  geo.userData.tone = Float32Array.from(tone);
  geo.computeVertexNormals();
  return geo;
}

function merged(parts: THREE.BufferGeometry[]): THREE.BufferGeometry | null {
  if (parts.length === 0) return null;
  const geo = mergeGeometries(parts, false);
  for (const g of parts) g.dispose();
  if (!geo) throw new Error("Failed to merge the wheel-well humps");
  return geo;
}
