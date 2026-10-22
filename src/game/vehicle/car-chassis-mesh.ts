import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { detSin } from "../kernel/physics-core.js";
import { BLACKOUT, CABIN_TRIM, INNER_PANEL, MATTE_BLACKOUT, PRIMER_ATTRIBUTE, WELL_PANEL } from "./constants.ts";
import { markSkinDynamic } from "../deform/fast-normals.ts";
import type { BodyStyle, ProfileStation } from "./car-variants.ts";
import { makeGreenhouseFrame, makeBox, makeRoofGeometry } from "./car-greenhouse-mesh.ts";
import { makeRoofFittings } from "./car-fittings-mesh.ts";
import { archLipGeometry, makeWellLiners, wellHumpGeometry } from "./car-well-mesh.ts";
import {
  bayAt,
  cabinAt,
  bootCut,
  bootInfill,
  bootCutAt,
  bodyTubs,
  DOOR_EDGE,
  SEAM_HALF,
  SEDAN,
  ROCKER,
  TUB_EDGE,
  ensureOutwardNormals,
  loftFromRings,
  noseRefined,
  recessShutLine,
  sampleSlice,
  sectionPoints,
  SHUT_RAMP,
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
 * face, in `END_ROLL_STEPS` chords. The inset stays small because a head lamp's housing stands within 1 cm of the nose's top corner,
 * and the skin may recede 1.5 cm under it (`lamps.test.ts`). A base station closer than `ROLL_CLEARANCE` (m) to the roll's first
 * ring is dropped: the roll's own rings resolve that end, and every ring costs the skin 21 vertices a frame.
 */
const END_ROLL_LENGTH = 0.03;
const END_ROLL_INSET = 0.015;
const END_ROLL_STEPS = 2;
/** The drawn nose rolls over in one chord more: its corner is the one in view. */
const NOSE_ROLL_STEPS = 3;
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

/** A cut's ring this close (m) to another knot's is that knot's. */
const KNOT_MERGE = 0.005;
/** An arch's leg rings (`arch.feet`) stand this far (m) either side of the opening's edge: the inner one's well (over 3 cm) still lifts it to the arch, the outer stays on the rocker. */
const ARCH_FOOT = 0.002;
/** A plain loft station this close (m) outside an arch's leg moves onto the leg's outer ring, so each leg adds one ring, not two. */
const FOOT_SNAP = 0.06;

/**
 * Loft stations: warped base spacing (≈7 cm at nose/tail, 13 cm mid) plus feature edges, and the roll's own rings at each end. `bootOpen`
 * (the drawn body's) adds the boot cut's ramps, `noseFill` (the drawn body's) the nose's own rings (`noseRefined`, `NOSE_ROLL_STEPS`).
 */
export function sliceZs(style: BodyStyle, source: BodySource, bootOpen = source === "drawn", noseFill = source === "drawn"): number[] {
  const p = style.profile;
  const z0 = p[0]!.z;
  const z1 = p[p.length - 1]!.z;
  const [a0, a1] = style.door.aperture;
  const knots = [a0, a0 + DOOR_EDGE, a1 - DOOR_EDGE, a1];
  for (const [a, b] of bodyTubs(style, source)) knots.push(a - TUB_EDGE, a + TUB_EDGE, b - TUB_EDGE, b + TUB_EDGE);
  const seam = style.rearDoorSeam;
  if (seam !== null) knots.push(seam - SEAM_HALF, seam, seam + SEAM_HALF);
  const { z0: hoodRear, z1: hoodFront, kind } = style.hood;
  if (source === "drawn" && kind === "clamshell") knots.push(hoodRear, hoodRear + SHUT_RAMP, hoodFront - SHUT_RAMP, hoodFront);
  // The boot's cut keeps its ramps' rings even inside the tail roll's clearance, so its opening ends where the lid's does. A cut
  // carrying an open floor on through the tail ramps in on that floor's own rings.
  const cut = bootOpen ? bootCut(style) : null;
  const ends = cut ? [...(cut.lined ? [cut.front, ...(cut.rear > z0 ? [cut.rear] : [])] : []), ...(cut.face ? [cut.face.front] : [])] : [];
  const cutKnots = ends.flatMap((k) => [k - TUB_EDGE, k + TUB_EDGE]).filter((k) => knots.every((other) => Math.abs(other - k) > KNOT_MERGE));
  knots.push(...cutKnots);
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
  // A bare door cut keeps only its knots' rings: inside it the ring is the sill and floor, straight along z.
  const [cutIn, cutOut] = style.bareDoorCut ? [a0 + DOOR_EDGE, a1 - DOOR_EDGE] : [Infinity, -Infinity];
  const stations = zs.filter((z) => z > rollRear + ROLL_CLEARANCE && z < rollFront - ROLL_CLEARANCE && (z <= cutIn || z >= cutOut || knots.includes(z)));
  stations.push(...cutKnots.filter((k) => k > rollRear && k <= rollRear + ROLL_CLEARANCE));
  const noseSteps = noseFill ? NOSE_ROLL_STEPS : END_ROLL_STEPS;
  for (let step = 0; step <= END_ROLL_STEPS; step++) stations.push(z0 + END_ROLL_LENGTH * (1 - detSin((step / END_ROLL_STEPS) * (Math.PI / 2))));
  for (let step = 0; step <= noseSteps; step++) stations.push(z1 - END_ROLL_LENGTH * (1 - detSin((step / noseSteps) * (Math.PI / 2))));
  stations.sort((a, b) => a - b);
  const split = style.ringSplit;
  if (split) {
    for (let k = stations.length - 1; k > 0; k--) {
      const mid = (stations[k - 1]! + stations[k]!) / 2;
      if (mid >= split[0] && mid <= split[1]) stations.splice(k, 0, mid);
    }
  }
  if (style.arch.feet) {
    const r = style.arch.radius;
    for (const wz of new Set(carFrame(style).wheels.map(([, , z]) => z))) {
      for (const out of [-1, 1]) {
        const leg = wz + out * r;
        // The nearest plain station just outside the leg moves onto the leg's outer ring; without one the leg adds it.
        let near = -1;
        for (let k = 0; k < stations.length; k++) {
          const gap = out * (stations[k]! - leg);
          if (gap > 0 && gap < FOOT_SNAP && !knots.includes(stations[k]!) && (near < 0 || gap < out * (stations[near]! - leg))) near = k;
        }
        if (near < 0) stations.push(leg + out * ARCH_FOOT);
        else stations[near] = leg + out * ARCH_FOOT;
        stations.push(leg - out * ARCH_FOOT);
      }
    }
    stations.sort((a, b) => a - b);
  }
  return noseFill ? noseRefined(stations, p) : stations;
}

/**
 * A tub's wall top (ring points 1 and n - 2 at each slice `inner` marks): the wall under it gets its own copy of the vertex, so the fender
 * strip beside a hood or lid shades by its own faces, not the wall's twenty times larger area. Returns each copy's id and its slice.
 */
function splitWallTops(body: THREE.BufferGeometry, ring: number, inner: readonly number[]): [number, number][] {
  const pos = body.getAttribute("position");
  const uv = body.getAttribute("uv");
  const index = body.getIndex()!.array;
  const positions = Array.from(pos.array);
  const uvs = Array.from(uv.array);
  const copies: [number, number][] = [];
  for (let s = 0; s < inner.length; s++) {
    if (inner[s] === 0) continue;
    // The wall is ring segment 0 on the left (points 0 to 1) and n - 2 on the right (points n - 2 to n - 1), on the quads either side of the slice.
    for (const [point, segment] of [[1, 0], [ring - 2, ring - 2]] as const) {
      const v = s * ring + point;
      const copy = positions.length / 3;
      positions.push(pos.getX(v), pos.getY(v), pos.getZ(v));
      uvs.push(uv.getX(v), uv.getY(v));
      for (const quad of [s - 1, s]) {
        if (quad < 0 || quad >= inner.length - 1) continue;
        for (let k = (quad * ring + segment) * 6; k < (quad * ring + segment + 1) * 6; k++) if (index[k] === v) index[k] = copy;
      }
      copies.push([copy, s]);
    }
  }
  body.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  body.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  body.computeVertexNormals();
  return copies;
}

/**
 * The door cut's end rings (`door.shutCrease`): the ramp into the cut gets its own copy of each ring point down to the rocker, so the
 * panel beside it shades from its own faces up to the shut line instead of rolling off into a round cap. Returns each copy and its original.
 */
function splitShutRings(body: THREE.BufferGeometry, ring: number, zs: readonly number[], [a0, a1]: readonly [number, number]): [number, number][] {
  const pos = body.getAttribute("position");
  const uv = body.getAttribute("uv");
  const index = body.getIndex()!.array;
  const positions = Array.from(pos.array);
  const uvs = Array.from(uv.array);
  const copies: [number, number][] = [];
  // The ramp runs ahead of the rear end's ring and behind the front end's.
  for (const [s, quad] of [[zs.indexOf(a0), zs.indexOf(a0)], [zs.indexOf(a1), zs.indexOf(a1) - 1]] as const) {
    if (s < 0 || quad < 0 || quad >= zs.length - 1) continue;
    for (let i = 0; i <= ROCKER; i++) {
      for (const point of [i, ring - 1 - i]) {
        const v = s * ring + point;
        const copy = positions.length / 3;
        positions.push(pos.getX(v), pos.getY(v), pos.getZ(v));
        uvs.push(uv.getX(v), uv.getY(v));
        for (let k = quad * ring * 6; k < (quad + 1) * ring * 6; k++) if (index[k] === v) index[k] = copy;
        copies.push([copy, v]);
      }
    }
  }
  body.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  body.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  body.computeVertexNormals();
  return copies;
}

/** A `blackout.cowl` darkens the deck from this far (m) under the windshield's foot to as far under the hood's rear edge. */
const COWL_LAP = 0.05;

export function makeChassisGeometry(style: BodyStyle = SEDAN, source: BodySource = "drawn"): THREE.BufferGeometry {
  const zs = sliceZs(style, source);
  const sectionAt = (z: number) => {
    const ring = sectionPoints(sampleSlice(z, style.profile), style, source);
    if (source === "drawn") recessShutLine(ring, z, style);
    return ring;
  };
  const rings = zs.map((z) => (source === "cage" ? sectionAt(z) : insetRing(sectionAt(z), endRollInset(z, style.profile))));
  const n = rings[0]!.length;
  const body = loftFromRings(rings, zs, 0, 1, source === "cage");
  ensureOutwardNormals(body);
  // How far each drawn slice has dropped into the bay's trough: its walls and floor are unpainted inner panel. Into a lid's lined boot: its
  // walls and floor are the cabin's dark trim, the boot's carpet as the references' popped lids show it. Into the cabin's tub: its floor
  // is dark cabin trim, as the glass shows it (the tub's walls keep one vertex with the belt, so they shade from it to the trim; the door
  // cards cover them).
  const cut = bootCut(style);
  const bay = source === "drawn" ? zs.map((z) => bayAt(z, style)) : [];
  const boot = source === "drawn" ? zs.map((z) => (cut.lined ? bootCutAt(z, cut).open : 0)) : [];
  const trim = bay.map((b, s) => (b > 0 ? 0 : boot[s]! > 0 ? boot[s]! : cabinAt(zs[s]!, style)));
  const tone = (s: number): number => (trim[s]! > 0 ? CABIN_TRIM * trim[s]! : INNER_PANEL * bay[s]!);
  const wallTops = source === "drawn" ? splitWallTops(body, n, bay.map((b, s) => Math.max(b, boot[s]!))) : [];
  const shutCopies = source === "drawn" && style.door.shutCrease === true ? splitShutRings(body, n, zs, style.door.aperture) : [];
  const roof = makeRoofGeometry(style, source);
  const parts: THREE.BufferGeometry[] = [body, roof];
  parts.push(...makeWellLiners(style, source, body));
  parts.push(...makeGreenhouseFrame(style, source));
  // The cowl wall under the dash and the wall behind the rear seats: cabin trim, as the glass shows them.
  const cabinWall = (geo: THREE.BufferGeometry) => Object.assign(geo, { userData: { ...geo.userData, cabinTrim: true } });
  parts.push(cabinWall(makeBox(1.2, 0.52, 0.045, 0, 0.6, 0.72)));
  const rb = style.rearBulkhead;
  parts.push(cabinWall(makeBox(1.16, rb.yTop - 0.34, 0.045, 0, (rb.yTop + 0.34) * 0.5, rb.z)));
  // The wells' lips (drawn only) and humps (the cage's: a bed's wheel tubs), after every other cage part so each keeps its vertex ids;
  // each lip's triangles are kept for its arch's panel.
  const lips = source === "drawn" ? archLipGeometry(style, body) : null;
  const lipIndex = parts.reduce((total, g) => total + g.getIndex()!.count, 0);
  const lipFrom = parts.reduce((total, g) => total + g.getAttribute("position").count, 0);
  if (lips) parts.push(lips);
  const humps = wellHumpGeometry(style, source);
  // The cage's tubs: kept out of its hull's decimation (`CageSource.tubs`).
  const tubs = { from: parts.reduce((n, g) => n + g.getAttribute("position").count, 0), count: source === "cage" ? (humps?.getAttribute("position").count ?? 0) : 0 };
  if (humps) parts.push(humps);
  if (source === "drawn") parts.push(...bootInfill(style));
  // The wheel liners, merged after the loft and roof: unpainted like the bay they rise into.
  const linerFrom = body.getAttribute("position").count + parts[1]!.getAttribute("position").count;
  const linerTo = linerFrom + parts.slice(2, 2 + carFrame(style).wheels.length).reduce((n, g) => n + g.getAttribute("position").count, 0);
  // Last, so every other part keeps its vertex ids; the drawn body only (the cage never carries them).
  const fittings = source === "drawn" ? makeRoofFittings(style) : null;
  const fittingCount = fittings?.geometry.getAttribute("position").count ?? 0;
  if (fittings) parts.push(fittings.geometry);
  const merged = mergeGeometries(parts, false);
  if (!merged) throw new Error("Failed to merge chassis");
  // 0 = paint, 1 = primer (`car-materials.ts` withPrimer): torn panels; `BLACKOUT` gloss black: blacked-out pillars, roof rails and
  // glass panel, the cowl; `CABIN_TRIM` the cabin: the headliner, the tub's floor and walls, the cowl and rear walls; `INNER_PANEL` an
  // unpainted inner panel.
  const primer = new Float32Array(merged.getAttribute("position").count);
  let start = 0;
  for (const g of parts) {
    const count = g.getAttribute("position").count;
    if (g.userData.blackout === true) primer.fill(g.userData.matte === true ? MATTE_BLACKOUT : BLACKOUT, start, start + count);
    if (g.userData.cabinTrim === true && source === "drawn") primer.fill(CABIN_TRIM, start, start + count);
    start += count;
  }
  if (lips) primer.set(lips.userData.tone as Float32Array, lipFrom);
  for (const g of parts) g.dispose();
  merged.computeVertexNormals();
  merged.computeBoundingBox();
  merged.computeBoundingSphere();
  merged.userData.tubs = tubs;
  // The loft is merged first: its vertex `s * ring + i` and its first (slices - 1) * ring * 2 triangles (`panelRegions` cuts panels out of them).
  merged.userData.loft = { ring: n, slices: zs.length };
  merged.userData.wallTops = wallTops.length;
  merged.userData.shutCopies = shutCopies.length;
  if (lips) merged.userData.archLips = { from: lipIndex, perWheel: lips.userData.perWheel as number[] };
  const roofFrom = body.getAttribute("position").count;
  const roofTwins: unknown = roof.userData.shellTwins;
  const twins = roofTwins instanceof Int32Array ? roofTwins.map((v) => v + roofFrom) : new Int32Array(0);
  // The drawn headliner (the roof's inner face) is the cabin's dark trim; the cage build is all paint.
  if (source === "drawn") for (let k = 0; k < twins.length; k += 2) primer[twins[k]!] = CABIN_TRIM;
  merged.userData.shellTwins = twins;
  if (fittings) primer.fill(BLACKOUT, primer.length - fittingCount, primer.length - fittingCount + fittings.dark);
  if (source === "drawn") {
    // The trough's, the boot's and the cabin's floor corner on each side (ring points 0 and n - 1): their tone, or the well's where the
    // arch of a tyre standing outboard of the body (the monster's) spans the slice, seen through it; and the trough's and boot's walls'
    // own copies of their tops.
    const { wheels } = carFrame(style);
    const r = style.arch.radius;
    const archAt = (z: number) => wheels.find(([, , wz]) => Math.abs(z - wz) < r);
    const openArchAt = (z: number) => wheels.some(([wx, , wz]) => Math.abs(z - wz) < r && Math.abs(wx) > sampleSlice(wz, style.profile).hw);
    for (let s = 0; s < zs.length; s++) for (const i of [0, n - 1]) primer[s * n + i] = trim[s]! > 0 ? tone(s) : (openArchAt(zs[s]!) ? WELL_PANEL : INNER_PANEL) * bay[s]!;
    // A lid wrapping the tail cuts its face open too; the tail cap shares that ring's corners, so their floor trim would fade across the cap
    // beside the lid (a dark V under each tail lamp): they stay paint.
    if (cut.lined && cut.face) for (const i of [0, n - 1]) primer[i] = 0;
    for (const [copy, s] of wallTops) primer[copy] = tone(s);
    if (style.blackout?.cowl === true) {
      const [foot, hoodRear] = [style.windshield.base[1], style.hood.z0];
      for (let s = 0; s < zs.length; s++) if (zs[s]! >= Math.min(foot, hoodRear) - COWL_LAP && zs[s]! <= Math.max(foot, hoodRear) + COWL_LAP) for (const i of [0, n - 1]) primer[s * n + i] = BLACKOUT;
    }
    // Each well's ceiling inside an arch, toned like its liner so the lip reads over a dark gap: the sill's two points, and the last
    // tuck row and rocker once the tuck row over them sits under the arch's lip (`halfRing` lifts it toward the edge), so no painted side fades into them.
    for (let s = 0; s < zs.length; s++) {
      const wheel = archAt(zs[s]!);
      if (!wheel) continue;
      const edge = wheel[1] + Math.sqrt(r * r - (zs[s]! - wheel[2]) ** 2);
      const atEdge = rings[s]![ROCKER - 2]!.y <= edge + (style.arch.lip?.width ?? 0);
      for (let i = atEdge ? ROCKER - 1 : ROCKER + 1; i <= ROCKER + 2; i++) primer[s * n + i] = primer[s * n + n - 1 - i] = WELL_PANEL;
    }
    // The floor pan (each ring's floor-outer points and keel) is bare underseal, as a car on its roof shows it; the sill corners keep the paint the side shows.
    const h = (n - 1) / 2;
    for (let s = 0; s < zs.length; s++) for (const i of [h - 1, h, h + 1]) primer[s * n + i] = INNER_PANEL;
    for (const [copy, v] of shutCopies) primer[copy] = primer[v]!;
    primer.fill(WELL_PANEL, linerFrom, linerTo);
  }
  merged.setAttribute(PRIMER_ATTRIBUTE, new THREE.BufferAttribute(primer, 1));
  return markSkinDynamic(merged);
}
