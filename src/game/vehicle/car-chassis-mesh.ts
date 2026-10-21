import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { detSin } from "../kernel/physics-core.js";
import { INNER_PANEL, PRIMER_ATTRIBUTE } from "./constants.ts";
import { markSkinDynamic } from "../deform/fast-normals.ts";
import type { BodyStyle, ProfileStation } from "./car-variants.ts";
import { makeGreenhouseFrame, makeBox, makeRoofGeometry } from "./car-greenhouse-mesh.ts";
import { makeRoofFittings } from "./car-fittings-mesh.ts";
import {
  bayAt,
  bodyTubs,
  DOOR_EDGE,
  SEAM_HALF,
  SEDAN,
  TUB_EDGE,
  ensureOutwardNormals,
  loftFromRings,
  sampleSlice,
  sectionPoints,
  type BodySource,
  type Pt,
} from "./car-mesh.ts";
import { carFrame } from "./car-rig.ts";

/** Base loft stations: with SLICE_WARP ≈7 cm apart at nose/tail, 13 cm mid-cabin (8e2dc49 commit notes). */
const BASE_SLICES = 40;
/** >1 spreads slices over the cabin and packs them into the crumple zones. */
const SLICE_WARP = 1.166;

/**
 * The nose and tail roll over in a quarter ellipse `END_ROLL_LENGTH` (m) long: it leaves the straight loft that far from the end
 * face (inside the bumper seat, so the loft at the seat is the straight loft) and ends `END_ROLL_INSET` (m) pulled in at the flat
 * face, in `END_ROLL_STEPS` chords; the last chord then meets the face at 40°, not 90°. The inset stays small because a head lamp's
 * housing stands within 1 cm of the nose's top corner, and the skin may recede 1.5 cm under it (`lamps.test.ts`). The first base
 * station past the roll (7 cm from the end face) is dropped when closer than `ROLL_CLEARANCE` (m) to the roll's first ring: the roll's
 * own three rings already resolve that end, and every ring costs the skin 21 vertices a frame.
 */
const END_ROLL_LENGTH = 0.03;
const END_ROLL_INSET = 0.015;
const END_ROLL_STEPS = 2;
const ROLL_CLEARANCE = 0.045;

/** Where along the roll the ring at `z` is: 0 on the straight loft, 1 at the end face (the sine of the roll's angle). */
function endRollProgress(z: number, profile: readonly ProfileStation[]): number {
  const rear = (profile[0]!.z + END_ROLL_LENGTH - z) / END_ROLL_LENGTH;
  const front = (z - (profile[profile.length - 1]!.z - END_ROLL_LENGTH)) / END_ROLL_LENGTH;
  return THREE.MathUtils.clamp(Math.max(rear, front), 0, 1);
}

/** How far (m) the ring at `z` is pulled in from its station's section: a quarter ellipse, 0 on the straight loft. */
function endRollInset(z: number, profile: readonly ProfileStation[]): number {
  const progress = endRollProgress(z, profile);
  return END_ROLL_INSET * (1 - Math.sqrt(1 - progress * progress));
}

/** `ring` scaled about its middle so every side is `inset` closer to it. */
function insetRing(ring: Pt[], inset: number): Pt[] {
  if (inset === 0) return ring;
  let cx = 0;
  let cy = 0;
  for (const p of ring) {
    cx += p.x / ring.length;
    cy += p.y / ring.length;
  }
  const reachX = Math.max(...ring.map((p) => Math.abs(p.x - cx)));
  const reachY = Math.max(...ring.map((p) => Math.abs(p.y - cy)));
  return ring.map((p) => ({ x: cx + (p.x - cx) * (1 - inset / reachX), y: cy + (p.y - cy) * (1 - inset / reachY) }));
}

/** Loft stations: warped base spacing (≈7 cm at nose/tail, 13 cm mid) plus feature edges, and the roll's own rings at each end. */
function sliceZs(style: BodyStyle, source: BodySource): number[] {
  const p = style.profile;
  const z0 = p[0]!.z;
  const z1 = p[p.length - 1]!.z;
  const [a0, a1] = style.door.aperture;
  const knots = [a0, a0 + DOOR_EDGE, a1 - DOOR_EDGE, a1];
  for (const [a, b] of bodyTubs(style, source)) knots.push(a - TUB_EDGE, a + TUB_EDGE, b - TUB_EDGE, b + TUB_EDGE);
  const seam = style.rearDoorSeam;
  if (seam !== null) knots.push(seam - SEAM_HALF, seam, seam + SEAM_HALF);
  const zs = knots.filter((k) => k > z0 && k < z1);
  const mid = (z0 + z1) * 0.5;
  const half = (z1 - z0) * 0.5;
  for (let i = 0; i < BASE_SLICES; i++) {
    const t = (i / (BASE_SLICES - 1)) * 2 - 1;
    const z = mid + half * t * (SLICE_WARP + (1 - SLICE_WARP) * t * t);
    const end = i === 0 || i === BASE_SLICES - 1;
    if (end || knots.every((k) => Math.abs(k - z) > 0.022)) zs.push(z);
  }
  if (source === "cage") return zs.sort((a, b) => a - b);
  const rollRear = z0 + END_ROLL_LENGTH;
  const rollFront = z1 - END_ROLL_LENGTH;
  const stations = zs.filter((z) => z > rollRear + ROLL_CLEARANCE && z < rollFront - ROLL_CLEARANCE);
  for (let step = 0; step <= END_ROLL_STEPS; step++) {
    const progress = detSin((step / END_ROLL_STEPS) * (Math.PI / 2));
    stations.push(z0 + END_ROLL_LENGTH * (1 - progress), z1 - END_ROLL_LENGTH * (1 - progress));
  }
  return stations.sort((a, b) => a - b);
}

/** The wheel-well liner's width across the car (m). */
const WELL_LINER_WIDTH = 0.24;

function makeWellLiner(wx: number, wy: number, wz: number, archR: number): THREE.BufferGeometry {
  const geo = new THREE.CylinderGeometry(archR, archR, WELL_LINER_WIDTH, 14, 1, true, 0, Math.PI);
  geo.rotateZ(Math.PI / 2);
  geo.rotateY(wx > 0 ? 0 : Math.PI);
  geo.translate(wx, wy, wz);
  const uv = geo.getAttribute("uv") as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, 0.12, i / uv.count);
  return geo;
}

export function makeChassisGeometry(style: BodyStyle = SEDAN, source: BodySource = "drawn"): THREE.BufferGeometry {
  const zs = sliceZs(style, source);
  const sectionAt = (z: number) => sectionPoints(sampleSlice(z, style.profile), style, source);
  const rings = zs.map((z) => (source === "cage" ? sectionAt(z) : insetRing(sectionAt(z), endRollInset(z, style.profile))));
  const body = loftFromRings(rings, zs, 0, 1, source === "cage");
  ensureOutwardNormals(body);
  const parts: THREE.BufferGeometry[] = [body, makeRoofGeometry(style)];
  for (const [wx, wy, wz] of carFrame(style).wheels) {
    const hw = sampleSlice(wz, style.profile).hw;
    // A tyre standing outboard of the body (the monster's) keeps its liner inside the body side.
    const x = Math.abs(wx) > hw ? Math.sign(wx) * (hw - WELL_LINER_WIDTH / 2) : wx;
    parts.push(makeWellLiner(x, wy, wz, style.arch.radius));
  }
  parts.push(...makeGreenhouseFrame(style, source));
  parts.push(makeBox(1.2, 0.52, 0.045, 0, 0.6, 0.72));
  const rb = style.rearBulkhead;
  parts.push(makeBox(1.16, rb.yTop - 0.34, 0.045, 0, (rb.yTop + 0.34) * 0.5, rb.z));
  // The wheel liners, merged after the loft and roof: unpainted like the bay they rise into.
  const linerFrom = body.getAttribute("position").count + parts[1]!.getAttribute("position").count;
  const linerTo = linerFrom + parts.slice(2, 2 + carFrame(style).wheels.length).reduce((n, g) => n + g.getAttribute("position").count, 0);
  // Last, so every other part keeps its vertex ids; the drawn body only (the cage never carries them).
  const fittings = source === "drawn" ? makeRoofFittings(style) : null;
  const fittingCount = fittings?.geometry.getAttribute("position").count ?? 0;
  if (fittings) parts.push(fittings.geometry);
  const merged = mergeGeometries(parts, false);
  for (const g of parts) g.dispose();
  if (!merged) throw new Error("Failed to merge chassis");
  merged.computeVertexNormals();
  merged.computeBoundingBox();
  merged.computeBoundingSphere();
  // The loft is merged first: its vertex `s * ring + i` and its first (slices - 1) * ring * 2 triangles (`panelRegions` cuts panels out of them).
  merged.userData.loft = { ring: rings[0]!.length, slices: zs.length };
  // 0 = paint, 1 = primer (`car-materials.ts` withPrimer): a torn panel's vertices are set dark, and so are the roof's rails and glass
  // panel; `INNER_PANEL` an unpainted inner panel.
  const primer = new Float32Array(merged.getAttribute("position").count);
  if (fittings) primer.fill(1, primer.length - fittingCount, primer.length - fittingCount + fittings.dark);
  if (source === "drawn") {
    // The bay trough's floor corner and wall top on each side: ring points 0, 1 and their mirrors.
    const n = rings[0]!.length;
    for (let s = 0; s < zs.length; s++) {
      const w = INNER_PANEL * bayAt(zs[s]!, style);
      for (const i of [0, 1, n - 2, n - 1]) primer[s * n + i] = w;
    }
    primer.fill(INNER_PANEL, linerFrom, linerTo);
  }
  merged.setAttribute(PRIMER_ATTRIBUTE, new THREE.BufferAttribute(primer, 1));
  return markSkinDynamic(merged);
}
