import * as THREE from "three";
import { hypot2, detCos, detSin } from "../kernel/physics-core.js";
import { CAR_STYLES, type BodyStyle, type LidDrop, type ProfileStation, type YZ } from "./car-variants.ts";
import { beltY, floorY, rockerAt } from "./car-lines.ts";
import { splitCreases } from "./car-crease.ts";
import { markSkinDynamic } from "../deform/fast-normals.ts";
import { carFrame } from "./car-rig.ts";
import { bootPivot } from "./hinge-spec.ts";

export const SEDAN = CAR_STYLES.sedan;

/**
 * The hard edges the drawn parts declare: the angle (degrees) between two faces past which `splitCreases` gives the edge its
 * own vertices, so the live per-skin normals stay hard across a crush and smooth everywhere else. Faces turning less than the
 * angle shade as one surface.
 * - deckLid: a bonnet or boot lid's top meets its skirt at 90° (the shut line); its dome and skirt chords turn under 2°. Its flat end
 *   caps (own vertices, set by the loft) meet a side wall that leans in plan by up to 30°, i.e. at 60° or more, so the angle stays under that.
 * - tailgate: the hatch's bowed panel meets its edge at 90°; its bow turns under 2° a chord; the same cap rule.
 * - door: the slab's edge wall meets the inner face at 90°; the edge roll turns 45° at most a chord and the shoulder under 30°.
 * - bumper: the fascia's splitter lip and back turn 73° and 90° (the lip's lower chord 67°); its rounded top and intake recess turn
 *   49° at most a chord. A quad the corner wrap warps folds 63° along its diagonal, which no fan of vertices can keep hard, so the angle sits above that.
 * The body loft is never split (`panelRegions` primes and peels it by vertex id: a copy would stay painted while its original tears
 * to primer), and the greenhouse pillars, roof, liners and bulkheads are parts with their own vertices, hard against each other.
 */
export const CREASE_DEGREES = { deckLid: 45, tailgate: 45, door: 60, bumper: 70 } as const;

/**
 * Which build of a body part a builder draws. `drawn`: the smoothed mesh the player sees. `cage`: the plain build the collision
 * cage is decimated from (`cageSourceOf`); the sim was tuned on it, so smoothing never reaches it.
 */
export type BodySource = "drawn" | "cage";

export type Pt = { x: number; y: number };
export type V3 = readonly [number, number, number];

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/**
 * PCHIP tangent (Fritsch–Butland) of station field `key` at station `i`: flat at a local extremum, the end
 * interval's secant at either end. Keeps the loft's width and beltline C1 along z without overshoot; a
 * smoothstep per interval flattened every station into a visible ring.
 */
function stationSlope(p: readonly ProfileStation[], i: number, key: "hw" | "yBelt"): number {
  const secant = (k: number) => (p[k + 1]![key] - p[k]![key]) / (p[k + 1]!.z - p[k]!.z);
  if (i === 0) return secant(0);
  if (i === p.length - 1) return secant(i - 1);
  const d0 = secant(i - 1);
  const d1 = secant(i);
  if (d0 * d1 <= 0) return 0;
  const h0 = p[i]!.z - p[i - 1]!.z;
  const h1 = p[i + 1]!.z - p[i]!.z;
  const w0 = 2 * h1 + h0;
  const w1 = h1 + 2 * h0;
  return (w0 + w1) / (w0 / d0 + w1 / d1);
}

export function sampleSlice(z: number, profile: readonly ProfileStation[]): ProfileStation {
  if (z <= profile[0]!.z) return { ...profile[0]!, z };
  for (let i = 1; i < profile.length; i++) {
    const a = profile[i - 1]!;
    const b = profile[i]!;
    if (z <= b.z) {
      const h = b.z - a.z;
      const t = (z - a.z) / h;
      const s = THREE.MathUtils.smoothstep(t, 0, 1);
      // Cubic Hermite on [a, b] with PCHIP tangents for the shell's width and beltline.
      const hermite = (key: "hw" | "yBelt") =>
        (2 * t ** 3 - 3 * t ** 2 + 1) * a[key] +
        (t ** 3 - 2 * t ** 2 + t) * h * stationSlope(profile, i - 1, key) +
        (3 * t ** 2 - 2 * t ** 3) * b[key] +
        (t ** 3 - t ** 2) * h * stationSlope(profile, i, key);
      return {
        z,
        hw: hermite("hw"),
        yBelt: hermite("yBelt"),
        yRoof: lerp(a.yRoof, b.yRoof, s),
        cabinHw: lerp(a.cabinHw, b.cabinHw, s),
        cabin: lerp(a.cabin, b.cabin, s),
      };
    }
  }
  return { ...profile[profile.length - 1]!, z };
}

/** Roof surface height and half-width (roof panel, glass tops, pillar tops all agree). */
export function roofAt(z: number, style: BodyStyle): { y: number; x: number } {
  const sl = sampleSlice(z, style.profile);
  const c = Math.max(sl.cabin, 0.25);
  return { y: lerp(sl.yBelt, sl.yRoof, c), x: lerp(sl.hw * 0.55, sl.cabinHw, c) };
}

/** Height of the roof panel's top at (`x`, `z`), the top ring of `makeRoofGeometry`: the centre-line crown, the dome's
 *  shoulder, then down to the cant line at the roof's half-width. */
export function roofTopY(x: number, z: number, style: BodyStyle): number {
  const r = roofAt(z, style);
  const [us, ys] = ROOF_SHOULDER;
  const u = Math.min(Math.abs(x) / r.x, 1);
  return r.y + (u < us ? lerp(ROOF_CROWN, ys, u / us) : lerp(ys, 0, (u - us) / (1 - us)));
}

/** Side glass top edge: tucked under the roof cant rail. */
export function glassTopY(z: number, style: BodyStyle): number {
  return roofAt(z, style).y - 0.075;
}

export function cantX(z: number, style: BodyStyle): number {
  return roofAt(z, style).x + 0.08;
}

/** Tumblehome: side glass leans in from the belt to the roof cant. */
export function glassX(z: number, y: number, style: BodyStyle): number {
  const top = glassTopY(z, style);
  const belt = beltY(z, style);
  return lerp(style.belt.x, cantX(z, style), THREE.MathUtils.clamp((y - belt) / (top - belt), 0, 1));
}

function wheelWell(z: number, wheels: readonly V3[], archR: number): number {
  let w = 0;
  for (const [, , wz] of wheels) {
    const dz = z - wz;
    if (Math.abs(dz) < archR) w = Math.max(w, Math.sqrt(archR * archR - dz * dz));
  }
  return w;
}

/** Fender flare band just outside the arch opening. */
function archFlare(z: number, y: number, wheels: readonly V3[], archR: number): number {
  let f = 0;
  for (const [, wy, wz] of wheels) {
    const dz = z - wz;
    const r = y >= wy ? hypot2(dz, y - wy) : Math.abs(dz);
    const band =
      THREE.MathUtils.smoothstep(r, archR - 0.04, archR + 0.02) *
      (1 - THREE.MathUtils.smoothstep(r, archR + 0.06, archR + 0.17));
    f = Math.max(f, band);
  }
  return f;
}

/** Front door cut feathered over DOOR_EDGE at both ends. */
export const DOOR_EDGE = 0.04;

/** Front door cut (A-pillar to B-pillar) along z (m, car frame, + = forward), per style (`style.door.aperture`). Rear quarter stays a solid panel. */
export function doorAperture(z: number, style: BodyStyle): number {
  const [z0, z1] = style.door.aperture;
  if (z <= z0 || z >= z1) return 0;
  const a = THREE.MathUtils.smoothstep(z, z0, z0 + DOOR_EDGE);
  const b = 1 - THREE.MathUtils.smoothstep(z, z1 - DOOR_EDGE, z1);
  return a * b;
}

/** Half-width (m) of the blend into and out of a style's tub floor along z (8e2dc49). */
export const TUB_EDGE = 0.025;

function tubAt(z: number, style: BodyStyle): { t: number; floor: number } {
  let t = 0;
  let floor = floorY(z, style);
  for (const [z0, z1, f] of style.tubs) {
    const w =
      THREE.MathUtils.smoothstep(z, z0 - TUB_EDGE, z0 + TUB_EDGE) *
      (1 - THREE.MathUtils.smoothstep(z, z1 - TUB_EDGE, z1 + TUB_EDGE));
    if (w > t) {
      t = w;
      floor = f;
    }
  }
  return { t, floor };
}

/** Half-width (m) of the rear-door shut-line groove; seamInset sets its 9 mm depth (8e2dc49). */
export const SEAM_HALF = 0.012;

function seamInset(z: number, style: BodyStyle): number {
  if (style.rearDoorSeam === null) return 0;
  return 0.009 * Math.max(0, 1 - Math.abs(z - style.rearDoorSeam) / SEAM_HALF);
}

/** The side's widest line sits this far below the belt (m), `SIDE_OUT` proud of the station half-width. */
const FEATURE_DROP = 0.1;
const SIDE_OUT = 0.004;
/** Shoulder: a quarter-ellipse from the feature line (vertical tangent) toward the deck edge, `SHOULDER` = [out, up] radii (m). */
const SHOULDER = [0.074, 0.104] as const;
/** The side's shoulder stops at this arc angle (rad); the deck (or the door glass) takes over above it. */
const SHOULDER_TOP = Math.PI / 3;
/** Tuck-under from the feature line to the rocker (m, parabolic in height). */
const TUCK = 0.03;

/**
 * Body-side half-width at height `y` for a station of half-width `hw` and belt `yb`: the shoulder rolls in
 * above the feature line, the side tucks under below it to the rocker at `rockerY`, C1 at the feature line. The door skin follows it too.
 */
export function sideX(y: number, hw: number, yb: number, rockerY: number): number {
  const yF = yb - FEATURE_DROP;
  if (y >= yF) {
    const sin = Math.min((y - yF) / SHOULDER[1], detSin(SHOULDER_TOP));
    return hw + SIDE_OUT - SHOULDER[0] * (1 - Math.sqrt(1 - sin * sin));
  }
  const v = Math.min((yF - y) / (yF - rockerY), 1);
  return hw + SIDE_OUT - TUCK * v * v;
}

/** Shoulder arc angles sampled by the ring (rad), top down; the feature line (0) follows. Two 30° chords sag 3 mm. */
const SHOULDER_RING = [SHOULDER_TOP, Math.PI / 6] as const;
/**
 * Points the ring spends on the tuck-under between the feature line and the rocker, evenly spaced down the side. The drawn body
 * gives the arch lip's parabola (`TUCK`, 3 cm) three chords, which sag under 1 mm each; the cage's plain build keeps its one.
 */
const TUCK_ROWS = { drawn: 2, cage: 1 } as const;
/** Half-ring indices of the feature line, and the drawn body's rocker: the side points between them flare at the arches. */
const FLARE_FIRST = 4;
export const ROCKER = FLARE_FIRST + TUCK_ROWS.drawn + 1;

/** The sill's outer corner over the floor pan (m), as first built on the 0.145 floor. */
const SILL_CORNER_RISE = 0.165 - 0.145;
/** The door cut's sill rows over the rocker (m), outboard to inboard, then the last tuck row's: as first built on the 0.2 rocker. */
const SILL_ROWS = [0.235, 0.236, 0.234, 0.231, 0.226].map((y) => y - 0.2);
const SILL_TUCK = 0.22 - 0.2;

/**
 * Lower body ring (left half top→bottom, keel, right half bottom→top; the
 * wrap edge is the deck). Deck crown → deck edge → rounded shoulder → feature
 * line → tuck-under → rocker → sill. Tubs open the deck into a floor with walls;
 * the door cut drops the side to the sill. Greenhouse is never lofted metal.
 */
function halfRing(s: ProfileStation, style: BodyStyle, source: BodySource): [number, number][] {
  const { hw, yBelt: yb, z } = s;
  const hole = doorAperture(z, style);
  const rockerY = rockerAt(z, style);
  const floor = floorY(z, style);
  const tub = tubAt(z, style);
  const { wheels } = carFrame(style);
  const well = wheelWell(z, wheels, style.arch.radius);
  const archY = wheels[0]![1] + well;
  const inset = seamInset(z, style);
  const yF = yb - FEATURE_DROP;
  const side = (y: number): [number, number] => [sideX(y, hw, yb, rockerY) - inset, y];
  const tuckRows = TUCK_ROWS[source];
  const rocker = FLARE_FIRST + tuckRows + 1;
  // The ring's half: deck crown and edge, the shoulder, the feature line, the tuck-under, the rocker, then the sill and the floor.
  const half: [number, number][] = [
    [lerp(hw - 0.22, hw - 0.06, tub.t), lerp(yb + 0.012, tub.floor, tub.t)],
    [lerp(hw - 0.07, hw - 0.06, tub.t), lerp(yb + 0.004, yb - 0.006, tub.t)],
    ...SHOULDER_RING.map((a) => side(yF + SHOULDER[1] * detSin(a))),
    side(yF),
    ...Array.from({ length: tuckRows }, (_, row) => side(lerp(yF, rockerY, (row + 1) / (tuckRows + 1)))),
    side(rockerY),
    [hw - 0.05, floor + SILL_CORNER_RISE],
    [hw * 0.8, floor + 0.004],
  ];
  // The door cut: every point above the rocker drops onto the sill's top, the last tuck row onto its far edge.
  const sill: [number, number][] = [
    [hw - 0.1, rockerY + SILL_ROWS[0]!],
    [hw - 0.07, rockerY + SILL_ROWS[1]!],
    [hw - 0.05, rockerY + SILL_ROWS[2]!],
    [hw - 0.036, rockerY + SILL_ROWS[3]!],
    [hw - 0.029, rockerY + SILL_ROWS[4]!],
    ...Array.from({ length: tuckRows }, (_, row): [number, number] =>
      row === tuckRows - 1
        ? [hw - TUCK + SIDE_OUT, rockerY + SILL_TUCK]
        : [lerp(hw - 0.029, hw - TUCK + SIDE_OUT, (row + 1) / tuckRows), lerp(rockerY + SILL_ROWS[4]!, rockerY + SILL_TUCK, (row + 1) / tuckRows)],
    ),
  ];
  for (let i = 0; i < sill.length; i++) {
    const p = half[i]!;
    p[0] = lerp(p[0], sill[i]![0], hole);
    p[1] = lerp(p[1], sill[i]![1], hole);
  }
  for (let i = FLARE_FIRST; i <= rocker; i++) half[i]![0] += 0.022 * archFlare(z, half[i]![1], wheels, style.arch.radius);
  for (const p of half) {
    if (well < 0.03 || p[0] < hw * 0.58 || p[1] > archY + 0.02) continue;
    const t = THREE.MathUtils.smoothstep((p[0] - hw * 0.58) / (hw * 0.42), 0, 1);
    p[1] = Math.max(p[1], lerp(p[1], archY, t));
  }
  return half;
}

/** The cage's own build has one tuck row, so the cage hull's side below the feature line ends at this half-ring index. */
const CAGE_ROCKER = FLARE_FIRST + TUCK_ROWS.cage + 1;

/**
 * The drawn side stays inside the cage hull: each tuck row the drawn ring added sits on the cage ring's chord at its height, never
 * proud of it. The fender flare is a bump the cage's one tuck row spans with a straight chord, so a drawn row that took the flare at
 * its own height stood up to 2.3 cm outside the hull the cage carries the ground on, and a car resting on its flank sank into the
 * ground by that much.
 */
function holdInsideCageHull(half: [number, number][], cageHalf: readonly (readonly [number, number])[]): void {
  for (let i = FLARE_FIRST + 1; i < ROCKER; i++) {
    const point = half[i]!;
    for (let k = FLARE_FIRST; k < CAGE_ROCKER; k++) {
      const [upperX, upperY] = cageHalf[k]!;
      const [lowerX, lowerY] = cageHalf[k + 1]!;
      if (point[1] > Math.max(upperY, lowerY) || point[1] < Math.min(upperY, lowerY)) continue;
      const chordX = lerp(upperX, lowerX, (upperY - point[1]) / (upperY - lowerY || 1));
      point[0] = Math.min(point[0], chordX);
      break;
    }
  }
}

export function sectionPoints(s: ProfileStation, style: BodyStyle, source: BodySource): Pt[] {
  const half = halfRing(s, style, source);
  if (source === "drawn") holdInsideCageHull(half, halfRing(s, style, "cage"));
  const left = half.map(([x, y]) => ({ x: -x, y }));
  const right = half.map(([x, y]) => ({ x, y })).reverse();
  return [...left, { x: 0, y: floorY(s.z, style) }, ...right];
}

export function loftFromRings(rings: Pt[][], zs: number[], u0: number, u1: number, capsOwnRings = true): THREE.BufferGeometry {
  const positions: number[] = [];
  const uvs: number[] = [];
  const n = rings[0]!.length;
  const zA = zs[0]!;
  const zSpan = zs[zs.length - 1]! - zA;
  for (let s = 0; s < rings.length; s++) {
    const z = zs[s]!;
    const u = u0 + ((u1 - u0) * (z - zA)) / zSpan;
    const ring = rings[s]!;
    for (let i = 0; i < n; i++) {
      const p = ring[i]!;
      positions.push(p.x, p.y, z);
      uvs.push(u, i / n);
    }
  }
  const indices: number[] = [];
  for (let s = 0; s < rings.length - 1; s++) {
    for (let i = 0; i < n; i++) {
      const i1 = (i + 1) % n;
      const a = s * n + i;
      const b = s * n + i1;
      const c = (s + 1) * n + i;
      const d = (s + 1) * n + i1;
      indices.push(a, b, c, b, d, c);
    }
  }
  // A small loft's end caps are its real hard edges (end panels, 50–90° off the loft): each gets its own copy of the end
  // ring, so the cap shades flat and the loft smooth instead of averaging the corner into both. The copies share rest
  // positions, so they skin (and wrinkle) as one. The body's rolled ends flow into their caps, which share the end ring.
  const cap = (slice: number, inward: boolean) => {
    const ring = rings[slice]!;
    const z = zs[slice]!;
    let cx = 0,
      cy = 0;
    const base = capsOwnRings ? positions.length / 3 : slice * n;
    for (const p of ring) {
      cx += p.x;
      cy += p.y;
      if (!capsOwnRings) continue;
      positions.push(p.x, p.y, z);
      uvs.push(inward ? 0 : 1, 0.5);
    }
    const center = positions.length / 3;
    positions.push(cx / n, cy / n, z);
    uvs.push(inward ? 0 : 1, 0.5);
    for (let i = 0; i < n; i++) {
      const i1 = (i + 1) % n;
      if (inward) indices.push(center, base + i1, base + i);
      else indices.push(center, base + i, base + i1);
    }
  };
  cap(0, true);
  cap(rings.length - 1, false);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.userData.loft = { ring: n, slices: rings.length };
  return geo;
}

/** Flip winding if the area-weighted face normals point at the centroid on balance. */
export function ensureOutwardNormals(geo: THREE.BufferGeometry): void {
  const pos = geo.getAttribute("position") as THREE.BufferAttribute;
  const idx = geo.getIndex();
  if (!idx) return;
  const a = idx.array;
  let cx = 0,
    cy = 0,
    cz = 0;
  for (let i = 0; i < pos.count; i++) {
    cx += pos.getX(i);
    cy += pos.getY(i);
    cz += pos.getZ(i);
  }
  const c = new THREE.Vector3(cx / pos.count, cy / pos.count, cz / pos.count);
  const p0 = new THREE.Vector3();
  const p1 = new THREE.Vector3();
  const p2 = new THREE.Vector3();
  const e1 = new THREE.Vector3();
  const e2 = new THREE.Vector3();
  let flux = 0;
  for (let i = 0; i < a.length; i += 3) {
    p0.fromBufferAttribute(pos, a[i]!);
    p1.fromBufferAttribute(pos, a[i + 1]!);
    p2.fromBufferAttribute(pos, a[i + 2]!);
    e1.subVectors(p1, p0);
    e2.subVectors(p2, p0);
    e1.cross(e2);
    flux += e1.dot(p0.add(p1).add(p2).multiplyScalar(1 / 3).sub(c));
  }
  if (flux < 0) {
    for (let i = 0; i < a.length; i += 3) {
      const t = a[i + 1]!;
      a[i + 1] = a[i + 2]!;
      a[i + 2] = t;
    }
    idx.needsUpdate = true;
  }
  geo.computeVertexNormals();
}

/** Roof crown above the cant line at the centre line (m): the roof panel's gentle dome. */
export const ROOF_CROWN = 0.026;
/** The dome's shoulder: [share of the roof half-width, rise above the cant line (m)]. */
export const ROOF_SHOULDER = [0.45, 0.018] as const;

/** A wrapping lid's fold over the tail edge: its radius (m), its quarter turn's rings, and the face's rings below it. */
const LID_FOLD_R = 0.08;
const LID_FOLD_STEPS = 3;
const LID_FACE_STEPS = 2;

/**
 * Lid lofted on the deck line (hood / trunk), local to its hinge origin. With a `drop` the lid also folds over the tail edge
 * and runs down the rear face to `drop.y`, narrowing to the face half-width `drop.w`; the face stands at `z1`.
 */
function makeDeckPanel(style: BodyStyle, z0: number, z1: number, origin: YZ, source: BodySource, drop?: LidDrop): THREE.BufferGeometry {
  const segs = 10;
  const tk = 0.04;
  const skirt = 0.06;
  const dome = 0.012;
  const [oy, oz] = origin;
  const ring = (w: number, y: number): Pt[] => [
    { x: -w, y },
    { x: -w * 0.45, y: y + dome * 0.7 },
    { x: 0, y: y + dome },
    { x: w * 0.45, y: y + dome * 0.7 },
    { x: w, y },
    { x: w, y: y - skirt * 0.55 },
    { x: w, y: y - skirt },
    { x: w - tk, y: y - skirt },
    { x: w - tk, y: y - tk },
    { x: -w + tk, y: y - tk },
    { x: -w + tk, y: y - skirt },
    { x: -w, y: y - skirt },
    { x: -w, y: y - skirt * 0.55 },
  ];
  const fold = drop ? LID_FOLD_R : 0;
  const zEnd = z1 + fold;
  const rings: Pt[][] = [];
  const zs: number[] = [];
  for (let s = 0; s <= segs; s++) {
    const z = lerp(z0, zEnd, s / segs);
    const sl = sampleSlice(z, style.profile);
    rings.push(ring(sl.hw - 0.075, sl.yBelt + 0.016 - oy));
    zs.push(z - oz);
  }
  // The fold and the face are lofted straight on past the deck's end (z = path length), then bent onto the tail below.
  const end = sampleSlice(zEnd, style.profile);
  const wEnd = end.hw - 0.075;
  const yc = end.yBelt + 0.016 - oy - fold;
  const zA = zEnd - oz;
  const arc = (fold * Math.PI) / 2;
  if (drop) {
    const run = arc + yc - (drop.y - oy);
    for (let k = 1; k <= LID_FOLD_STEPS + LID_FACE_STEPS; k++) {
      rings.push(ring(wEnd, 0));
      zs.push(zA - (k <= LID_FOLD_STEPS ? (k / LID_FOLD_STEPS) * arc : arc + ((k - LID_FOLD_STEPS) / LID_FACE_STEPS) * (run - arc)));
    }
  }
  const geo = loftFromRings(rings, zs, 0, 1);
  if (drop) bendOverTail(geo.getAttribute("position") as THREE.BufferAttribute, zA, yc, drop.w / wEnd);
  ensureOutwardNormals(geo);
  if (source === "drawn") splitCreases(geo, CREASE_DEGREES.deckLid);
  geo.computeBoundingBox();
  return geo;
}

/**
 * Bends the straight run lofted past `zA` (its z the path length, its y the offset off the panel) a quarter turn down over the
 * tail edge, about the fold's centre (`yc`, `zA`), then straight down the face, scaling x to `wFace` × on the way round.
 */
function bendOverTail(pos: THREE.BufferAttribute, zA: number, yc: number, wFace: number): void {
  const arc = (LID_FOLD_R * Math.PI) / 2;
  for (let i = 0; i < pos.count; i++) {
    const s = zA - pos.getZ(i);
    if (s < 1e-9) continue;
    const turn = Math.min(s / LID_FOLD_R, Math.PI / 2);
    const r = LID_FOLD_R + pos.getY(i);
    pos.setXYZ(i, pos.getX(i) * lerp(1, wFace, turn / (Math.PI / 2)), yc + r * detCos(turn) - Math.max(0, s - arc), zA - r * detSin(turn));
  }
}

/** The tailgate stops this far (m) inside the tail panel's half-width: the tail lamps stand upright in the corners. */
const TAILGATE_INSET = 0.135;

/** Hatch / tailgate: a slightly bowed panel leaning from its bottom edge [y0, z0] up to its hinge at its top edge. */
function makeTailgate(style: BodyStyle, y0: number, z0: number, origin: YZ, source: BodySource): THREE.BufferGeometry {
  const [y1, oz] = origin;
  const w = sampleSlice(oz, style.profile).hw - TAILGATE_INSET;
  const tk = 0.03;
  const bow = 0.02;
  const segs = 5;
  const rings: Pt[][] = [];
  const hs: number[] = [];
  for (let s = 0; s <= segs; s++) {
    rings.push([
      { x: -w, y: 0 },
      { x: -w * 0.5, y: bow * 0.75 },
      { x: 0, y: bow },
      { x: w * 0.5, y: bow * 0.75 },
      { x: w, y: 0 },
      { x: w, y: -tk },
      { x: -w, y: -tk },
    ]);
    hs.push(lerp(y0, y1, s / segs) - y1);
  }
  const geo = loftFromRings(rings, hs, 0, 1);
  const pos = geo.getAttribute("position") as THREE.BufferAttribute;
  const lean = (z0 - oz) / (y0 - y1);
  for (let i = 0; i < pos.count; i++) pos.setXYZ(i, pos.getX(i), pos.getZ(i), -(pos.getY(i) - pos.getZ(i) * lean));
  ensureOutwardNormals(geo);
  if (source === "drawn") splitCreases(geo, CREASE_DEGREES.tailgate);
  geo.computeBoundingBox();
  return geo;
}

export function makeHoodGeometry(style: BodyStyle = SEDAN, source: BodySource = "drawn"): THREE.BufferGeometry {
  const { z0, z1, origin } = style.hood;
  return markSkinDynamic(makeDeckPanel(style, z0, z1, origin, source));
}

/** Trunk lid, hatch or tailgate per style; local to the boot's pivot (`bootPivot`, [y, z]). */
export function makeTrunkGeometry(style: BodyStyle = SEDAN, source: BodySource = "drawn"): THREE.BufferGeometry {
  const b = style.boot;
  const g = b.kind === "lid" ? makeDeckPanel(style, b.z0, b.z1, b.origin, source, b.drop) : makeTailgate(style, b.y0, b.z0 ?? b.origin[1], b.origin, source);
  const [py, pz] = bootPivot(b);
  if (py !== b.origin[0] || pz !== b.origin[1]) g.translate(0, b.origin[0] - py, b.origin[1] - pz);
  return markSkinDynamic(g);
}

/** How far inside the body side (m) a bumper's wrapped corner is held: a tail or nose narrower than the fascia would show the corner through the skin. */
const BUMPER_TUCK = 0.01;
/** The fascia's section shrinks by this share at its wrapped end. */
const BUMPER_WRAP_SHRINK = 0.228;
/** The fascia top's crown runs out this far (m) past each end of its span. */
const BUMPER_CROWN_RUN = 0.03;

/** Bumper fascia: rounded top, intake recess, splitter lip, wrapped corners, the corners held inside `style`'s body side. */
export function makeBumperGeometry(front: boolean, style: BodyStyle): THREE.BufferGeometry {
  const s = front ? 1 : -1;
  const { seat, fascia, span, wrap } = front ? style.bumpers.front : style.bumpers.rear;
  const wrapAt = (x: number) => Math.max(0, Math.abs(x) - wrap.from) / (span - wrap.from);
  const stations = 16;
  const rings: Pt[][] = [];
  const xs: number[] = [];
  const wraps: number[] = [];
  for (let i = 0; i <= stations; i++) {
    const x = lerp(-span, span, i / stations);
    const u = wrapAt(x);
    const crown = (1 - Math.abs(x) / (span + BUMPER_CROWN_RUN)) * 0.02;
    rings.push(fascia.map(([y, out]) => ({ x: y + crown, y: out * (1 - u * BUMPER_WRAP_SHRINK) })));
    xs.push(x);
    wraps.push(u);
  }
  const geo = loftFromRings(rings, xs, 0, 1);
  const pos = geo.getAttribute("position") as THREE.BufferAttribute;
  const n = fascia.length;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getZ(i);
    const ring = Math.min(stations, Math.floor(i / n));
    const u = i < (stations + 1) * n ? wraps[ring]! : wrapAt(x);
    const y = pos.getX(i);
    const z = s * (pos.getY(i) - u * wrap.back);
    const slice = sampleSlice(s * seat.z + z, style.profile);
    const side = sideX(seat.y + y, slice.hw, slice.yBelt, rockerAt(s * seat.z + z, style)) - BUMPER_TUCK;
    pos.setXYZ(i, Math.sign(x) * Math.min(Math.abs(x), side), y, z);
  }
  ensureOutwardNormals(geo);
  return splitCreases(geo, CREASE_DEGREES.bumper);
}
