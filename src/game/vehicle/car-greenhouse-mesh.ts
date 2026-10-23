import * as THREE from "three";
import { detAtan2, detCos, detSin, hypot2 } from "../kernel/physics-core.js";
import type { BodyStyle, PillarSpan, YZ } from "./car-variants.ts";
import { roofHinged } from "./hinge-spec.ts";
import { aPillarTopZ, aPostRearZ, bPillarBand, beltX, beltY, cantDrop, doorGlassFrontZ, pillarBands, ROOF_DRIP, roofDrip, sideBowZ } from "./car-lines.ts";
import { domeFall, drawnQuarter, quarterSillZs, rearGlassCornerZ, rearGlassInset, windshieldSideBase, windshieldSideX } from "./car-glass.ts";
import { splitCreases, splitLoftOnLowDiagonals } from "./car-crease.ts";
import { drawnRoofTopY, roofEndAcross, roofEndBows, roofEndHeldZ, roofEndWeight, roofSourceZ, type RoofEnd } from "./car-roof-end.ts";
import {
  CREASE_DEGREES,
  ROOF_ARC_T,
  ROOF_CROWN,
  ROOF_LIP_OUT,
  ROOF_SHOULDER,
  arcY,
  cantX,
  cantY,
  ensureOutwardNormals,
  glassTopY,
  glassX,
  lerp,
  loftFromRings,
  roofArc,
  roofAt,
  roofDome,
  roofSquareShare,
  roofTopY,
  sampleSlice,
  sectionPoints,
  shoulderTop,
  type BodySource,
  type Pt,
  type V3,
} from "./car-mesh.ts";

/** The drawn roof's side rolls up from the cant line into its dome's edge through a quarter ellipse at these angles (rad, 0 at the cant line). */
const ROOF_ROLL = [0, Math.PI / 6, Math.PI / 3, Math.PI / 2] as const;
/** The drawn roof's side meets its flat underside near 90°: split there, so the side keeps its own normals instead of shading half down (a grey band). */
const ROOF_CREASE_DEGREES = 60;
/** The drawn headliner stands this far (m) inside the roof skin: a few mm, the skin's inner face, never past it. */
const HEADLINER_INSET = 0.004;
/** The skin points the headliner is inset from, past the left side's roll: right cant, crown, left cant (the dome bows 4 mm past the chords between). */
const HEADLINER_POINTS = [4, 2, 0] as const;
/** The roof's z segments: the cage's, and the drawn one's, fewer so its headliner keeps the body within its vertex budget (the chords sag 0.5 mm). */
const ROOF_SEGS = { cage: 16, drawn: 12 } as const;
/** A rolled end's run (`roofEnds`) gets drawn stations at these shares of it from the end: its quarter ellipse turns near the end; two keep a coupe rolled at both ends within its body's vertex budget. */
const ROOF_ROLL_STATIONS = [0.05, 0.25] as const;

/** The drawn roof's side (+x), cant line up to the dome's edge at (`x`, `y`): a quarter ellipse `reach` × (`ROOF_LIP_OUT + drip`) out and `lip` down. */
function roofRoll(x: number, y: number, lip: number, drip: number, angles: readonly number[] = ROOF_ROLL, reach = 1): Pt[] {
  return angles.map((a) => ({ x: x + reach * (ROOF_LIP_OUT + drip) * detCos(a), y: y - lip * (1 - detSin(a)) }));
}

/** `skin` (an open section, left side over the crown to the right side, its left cant at `cant`) and its `HEADLINER_POINTS` `inset` inside it. */
function shellRing(skin: Pt[], cant: number, inset: number): Pt[] {
  const inner: Pt[] = [];
  for (const offset of HEADLINER_POINTS) {
    const k = cant + offset;
    const tx = skin[k + 1]!.x - skin[k - 1]!.x;
    const ty = skin[k + 1]!.y - skin[k - 1]!.y;
    const len = hypot2(tx, ty);
    // Left to right over the crown, (-ty, tx) is the skin's outward normal.
    inner.push({ x: skin[k]!.x + (ty / len) * inset, y: skin[k]!.y - (tx / len) * inset });
  }
  return [...skin, ...inner];
}

/** The front end's skin points between two headliner points move at most this far (m) in z onto their chord (scaled by the ring's share of the end's move): the windshield's top row under them stays within 5 mm of the roof. */
const FRONT_CHORD_PULL = 0.003;

/**
 * The drawn roof's `ends` bow in plan with the glass tops under them, fading to nothing at each glass's top corners, and every ring of a
 * rolled end's run moves with it (`roofEndWeight`), so the roll keeps its slope instead of folding back at the bowed end ring. A
 * headliner vertex (`twins`: each inner vertex, then the skin vertex it is inset from) moves as its skin vertex does, so it stays inset.
 * A vertex the pane's top row pulls forward is held inside the roof's side lip at its new z, where the cabin narrows.
 * On every moved ring (`ringLength` a ring) the skin points between two headliner points are then pulled onto the chord of those two (the
 * front's by at most `FRONT_CHORD_PULL` times the ring's weight) and stay on the drawn roof (`drawnRoofTopY`): the cap's strip across
 * them twists less under the bow's arc over the straight headliner.
 */
function bowRoofEnds(geo: THREE.BufferGeometry, ends: readonly RoofEnd[], twins: readonly number[], ringLength: number, style: BodyStyle): void {
  const skinOf = new Map<number, number>();
  for (let k = 0; k < twins.length; k += 2) skinOf.set(twins[k]!, twins[k + 1]!);
  const pos = geo.getAttribute("position");
  const bowed = new Map<number, { end: RoofEnd; weight: number }>();
  for (let v = 0; v < pos.count; v++) {
    const z = pos.getZ(v);
    const end = ends.find((e) => roofEndWeight(e, z) > 0);
    if (!end) continue;
    const weight = roofEndWeight(end, z);
    const skinX = pos.getX(skinOf.get(v) ?? v);
    const held = roofEndHeldZ(end, skinX);
    const moved = z + (held - end.z) * weight;
    pos.setZ(v, moved);
    bowed.set(v, { end, weight });
    const [x, lip] = [pos.getX(v), cantX(moved, style) + roofDrip(style)];
    if (held > end.z + end.bow * roofEndAcross(end, skinX) && Math.abs(x) > lip) pos.setX(v, Math.sign(x) * lip);
  }
  const skins = [...skinOf.values()].sort((a, b) => a - b);
  for (let k = 1; k < skins.length; k++) {
    const [a, b] = [skins[k - 1]!, skins[k]!];
    const ring = bowed.get(a);
    if (ring === undefined || Math.floor(a / ringLength) !== Math.floor(b / ringLength)) continue;
    const pull = ring.end.paneTop === undefined ? Infinity : FRONT_CHORD_PULL * ring.weight;
    for (let m = a + 1; m < b; m++) {
      const z = THREE.MathUtils.clamp(lerp(pos.getZ(a), pos.getZ(b), (pos.getX(m) - pos.getX(a)) / (pos.getX(b) - pos.getX(a))), pos.getZ(m) - pull, pos.getZ(m) + pull);
      pos.setZ(m, z);
      pos.setY(m, drawnRoofTopY(pos.getX(m), z, style));
    }
  }
}

/**
 * Re-cuts the cap whose triangles start at index `first` (`ring`'s copy at vertex `base`) as a strip from the skin's arc to the
 * headliner's points, keeping its facing: bowed, the ear-clip's skin-only slivers (crown to shoulders) fold the cap and tip its normals.
 */
function stripCap(index: THREE.BufferAttribute["array"], first: number, base: number, ring: readonly Pt[], cant: number): void {
  const turn = (a: number, b: number, c: number) =>
    (ring[b]!.x - ring[a]!.x) * (ring[c]!.y - ring[a]!.y) - (ring[b]!.y - ring[a]!.y) * (ring[c]!.x - ring[a]!.x);
  const facing = Math.sign(turn(index[first]! - base, index[first + 1]! - base, index[first + 2]! - base));
  const m = ring.length - HEADLINER_POINTS.length;
  const inner = HEADLINER_POINTS.map((offset, j) => ({ v: m + j, skin: cant + offset })).reverse();
  const tris: number[] = [];
  let j = 0;
  for (let i = 0; i < m - 1; i++) {
    // Past the shoulder between two headliner points, the strip steps to the next one.
    if (j + 1 < inner.length && 2 * i >= inner[j]!.skin + inner[j + 1]!.skin) {
      tris.push(i, inner[j + 1]!.v, inner[j]!.v);
      j++;
    }
    tris.push(i, i + 1, inner[j]!.v);
  }
  for (let t = 0; t < tris.length; t += 3) {
    const [a, b, c] = [tris[t]!, tris[t + 1]!, tris[t + 2]!];
    const swap = turn(a, b, c) * facing < 0;
    index.set([base + a, base + (swap ? c : b), base + (swap ? b : c)], first + t);
  }
}

/** The drawn roof loft's ring stations (z, ascending): `ROOF_SEGS` even ones, plus each rolled end's `ROOF_ROLL_STATIONS` in the drawn roof. */
function roofRingZs(style: BodyStyle, source: BodySource): number[] {
  const [z0, z1] = style.roofZ;
  const segs = ROOF_SEGS[source];
  const zs = Array.from({ length: segs + 1 }, (_, s) => lerp(z0, z1, s / segs));
  if (source === "drawn") {
    const { rear, front } = style.roofEnds ?? {};
    const rolled = [...(rear === undefined ? [] : ROOF_ROLL_STATIONS.map((k) => z0 + rear * k)), ...(front === undefined ? [] : ROOF_ROLL_STATIONS.map((k) => z1 - front * k))];
    zs.push(...rolled.filter((z) => zs.every((w) => Math.abs(w - z) > 0.001)));
    zs.sort((a, b) => a - b);
  }
  return zs;
}

/**
 * The roof panel. The cage keeps its knee-lip section down to a keel under the crown. The drawn roof's side rolls into the dome with
 * no shelf, and it is a thin shell: its inner face, inset `HEADLINER_INSET` from the skin's cants and crown, is the headliner
 * (`userData.shellTwins`: each inner vertex, then the skin vertex it is inset from).
 */
export function makeRoofGeometry(style: BodyStyle, source: BodySource = "drawn"): THREE.BufferGeometry {
  const [, z1] = style.roofZ;
  const lip = cantDrop(style);
  const rings: Pt[][] = [];
  const zs = roofRingZs(style, source);
  for (const z of zs) {
    if (source === "drawn") {
      const half = roofHalf(z, style);
      const skin = [...half.slice(1).reverse().map((p) => ({ x: -p.x, y: p.y })), ...half];
      rings.push(shellRing(skin, (skin.length - 5) / 2, HEADLINER_INSET));
      continue;
    }
    const { y, x } = roofAt(z, style);
    const side: Pt[] = [
      { x: x + ROOF_LIP_OUT, y: y - lip },
      { x: x + ROOF_LIP_KNEE[0], y: y - ROOF_LIP_KNEE[1] },
    ];
    const dome = [{ x: 0, y: y + ROOF_CROWN }, { x: x * ROOF_SHOULDER[0], y: y + ROOF_SHOULDER[1] }, { x, y }, ...[...side].reverse()];
    const skin = [...dome.slice(1).reverse().map((p) => ({ x: -p.x, y: p.y })), ...dome];
    rings.push([...skin, { x: 0, y: y - 0.085 }]);
  }
  const geo = loftFromRings(rings, zs, 0.28, 0.72);
  ensureOutwardNormals(geo);
  if (source === "cage") return geo;
  // The loft's rings, then each end cap's own copy of its ring: the shell's ring is concave, so `loftFromRings` ear-clips its caps
  // and adds no centre between the copies.
  const n = rings[0]!.length;
  const cant = (n - HEADLINER_POINTS.length - 5) / 2;
  const twins: number[] = [];
  for (const base of [...zs.map((_, s) => s * n), zs.length * n, zs.length * n + n]) {
    for (let j = 0; j < HEADLINER_POINTS.length; j++) twins.push(base + n - HEADLINER_POINTS.length + j, base + cant + HEADLINER_POINTS[j]!);
  }
  const ends = roofEndBows(style);
  bowRoofEnds(geo, ends, twins, n, style);
  splitLoftOnLowDiagonals(geo);
  // Each cap's ear-clip (`n` - 2 triangles) follows the loft's quads: the rear cap at `zs[0]`, then the front.
  const capStart = (zs.length - 1) * n * 6;
  const index = geo.getIndex()!.array;
  for (const end of ends) {
    const front = end.z === z1;
    stripCap(index, capStart + (front ? 3 * (n - 2) : 0), zs.length * n + (front ? n : 0), rings[front ? rings.length - 1 : 0]!, cant);
  }
  const unsplit = geo.getAttribute("position").count;
  splitCreases(geo, ROOF_CREASE_DEGREES);
  // A crease's copy of a headliner vertex (`splitCreases` appends them) is a headliner vertex too.
  const pos = geo.getAttribute("position");
  const key = (v: number) => `${pos.getX(v)},${pos.getY(v)},${pos.getZ(v)}`;
  const skinOf = new Map<string, number>();
  for (let k = 0; k < twins.length; k += 2) skinOf.set(key(twins[k]!), twins[k + 1]!);
  for (let v = unsplit; v < pos.count; v++) {
    const skin = skinOf.get(key(v));
    if (skin !== undefined) twins.push(v, skin);
  }
  geo.userData.shellTwins = Int32Array.from(twins);
  return geo;
}

/**
 * Each lengthwise edge of a greenhouse rail or the A-post is cut by one 45° chamfer (`PILLAR_FILLET_STEPS` = 1 chord of a quarter
 * circle of radius `PILLAR_FILLET`, m; at most `PILLAR_FILLET_SHARE` of the section side it cuts), so the vertex normals roll round the
 * edge in two 45° steps instead of turning 90° at once; the section never grows past the box.
 */
const PILLAR_FILLET = 0.007;
const PILLAR_FILLET_SHARE = 0.45;
const PILLAR_FILLET_STEPS = 1;
/** A drawn post's (B, C, divider) corners round at this share of its depth in `POST_ROUND_STEPS` chords: a curved section, 30° a chord, its depth sides all but rounded off. */
const POST_ROUND = 0.45;
const POST_ROUND_STEPS = 3;
/** Quarter-circle corners of the unit section, counter-clockwise from the corner at (1, 0): the corner, the arc's centre sign and its start angle (rad). */
const FILLET_CORNERS = [
  { x: 1, y: 0, startAngle: -Math.PI / 2 },
  { x: 1, y: 1, startAngle: 0 },
  { x: 0, y: 1, startAngle: Math.PI / 2 },
  { x: 0, y: 0, startAngle: Math.PI },
] as const;

/** The fraction of a section side (m) that a fillet of `radius` takes off each end; none on a side of no length. */
function filletShare(side: number, radius = PILLAR_FILLET): number {
  return side > 0 ? Math.min(radius, PILLAR_FILLET_SHARE * side) / side : 0;
}

/** A crowned pillar's outer face bulges this far (m) at its middle over its edges, through points at these shares of its flat between the corners: it reads curved, not a flat box. */
const PILLAR_CROWN = 0.008;
const CROWN_POINTS = [0.25, 0.5, 0.75] as const;

/**
 * A rectangle's outline in the unit square with elliptical-arc corners of radii `radiusU` x `radiusW` (unit fractions along each
 * axis), `steps` chords each; `crownU` (a unit fraction of u) bulges its outer face (u = 1) out in a parabola, 0 at its edges.
 */
function filletedUnitSection(radiusU: number, radiusW: number, steps = PILLAR_FILLET_STEPS, crownU = 0): Pt[] {
  const section: Pt[] = [];
  for (const corner of FILLET_CORNERS) {
    const centreU = corner.x === 1 ? 1 - radiusU : radiusU;
    const centreW = corner.y === 1 ? 1 - radiusW : radiusW;
    for (let step = 0; step <= steps; step++) {
      const angle = corner.startAngle + (step / steps) * (Math.PI / 2);
      section.push({ x: centreU + radiusU * detCos(angle), y: centreW + radiusW * detSin(angle) });
    }
    // The outer face runs from this corner's last point to the next one's first, its crown points spread over the flat between the arcs.
    if (crownU > 0 && corner.x === 1 && corner.y === 0) for (const w of CROWN_POINTS) section.push({ x: 1, y: radiusW + w * (1 - 2 * radiusW) });
  }
  if (crownU > 0) for (const p of section) if (p.x > 0.5) p.x += crownU * (1 - (2 * p.y - 1) ** 2);
  return section;
}

/**
 * Box mapped onto four outer-face corners (+x side), thickness inward;
 * sign -1 mirrors to the left without flipping the winding.
 */
function boxFromCorners(
  sign: number,
  c: { fb: V3; rb: V3; rt: V3; ft: V3 },
  thick: number,
  hs = 1,
): THREE.BufferGeometry {
  const geo = new THREE.BoxGeometry(1, 1, 1, 1, hs, 1);
  const pos = geo.getAttribute("position") as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const u = pos.getX(i) + 0.5;
    const v = pos.getY(i) + 0.5;
    const w = pos.getZ(i) + 0.5;
    const at = (k: number) => lerp(lerp(c.rb[k]!, c.fb[k]!, w), lerp(c.rt[k]!, c.ft[k]!, w), v);
    const outer = at(0);
    const x = sign > 0 ? outer - (1 - u) * thick : -(outer - u * thick);
    pos.setXYZ(i, x, at(1), at(2));
  }
  return geo;
}

/** A pillar section's outer-face rear and front points at one station along it (+x side), and the plan direction [x share, z share] its depth runs in along (absent: straight in, -x). */
type Rail = { rear: V3; front: V3; inward?: readonly [number, number] };

/**
 * Pillar lofted through `rails` (belt to top), thickness inward, its unit `section` at each rail's width and station `k` (default: corners rounded at
 * `radius` (m) in `steps` chords, the outer face bulged `crown` (m)); sign -1 mirrors to the left, its outer face still at u = 1.
 * Its end caps share the end rings; `open`: both ends are buried (in the body, the roof's side), so it draws no caps.
 */
function roundedPillarAlong(
  sign: number,
  rails: readonly Rail[],
  thick: number,
  {
    radius = PILLAR_FILLET,
    steps = PILLAR_FILLET_STEPS,
    open = false,
    crown = 0,
    section = (width: number) => filletedUnitSection(filletShare(thick, radius), filletShare(width, radius), steps, crown / thick),
  }: { radius?: number; steps?: number; open?: boolean; crown?: number; section?: (width: number, k: number) => Pt[] } = {},
): THREE.BufferGeometry {
  const last = rails.length - 1;
  const stations = rails.map((_, k) => k / last);
  const sections = rails.map(({ rear, front }, k) => section(hypot2(hypot2(front[0] - rear[0], front[1] - rear[1]), front[2] - rear[2]), k));
  if (sections.some((s) => s.length !== sections[0]!.length)) throw new Error("a pillar's sections have different point counts along it");
  const geo = loftFromRings(sections, stations, 0, 1, false);
  if (open) {
    // The loft's rings and side triangles come first, its caps' centres and fans after.
    const ring = sections[0]!.length;
    geo.setIndex(Array.from(geo.index!.array.subarray(0, last * ring * 6)));
    for (const name of ["position", "uv"]) {
      const attribute = geo.getAttribute(name);
      geo.setAttribute(name, new THREE.Float32BufferAttribute(attribute.array.slice(0, rails.length * ring * attribute.itemSize), attribute.itemSize));
    }
  }
  const pos = geo.getAttribute("position") as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const u = pos.getX(i);
    const w = pos.getY(i);
    const { rear, front, inward = [1, 0] } = rails[Math.round(pos.getZ(i) * last)]!;
    const depth = (1 - u) * thick;
    pos.setXYZ(i, sign * (lerp(rear[0], front[0], w) - depth * inward[0]), lerp(rear[1], front[1], w), lerp(rear[2], front[2], w) + depth * inward[1]);
  }
  ensureOutwardNormals(geo);
  return geo;
}

/** A drawn post's unit section (u across its `thick` depth, the outer face at 1; w across its `width`): `POST_ROUND` corners, the outer face crowned `crown` (m). */
export function postSection(thick: number, width: number, crown = PILLAR_CROWN): Pt[] {
  const radius = POST_ROUND * thick;
  return filletedUnitSection(filletShare(thick, radius), filletShare(width, radius), POST_ROUND_STEPS, crown / thick);
}

/** Where a post section's outline points start: its four corner arcs (`ARC_POINTS` each), the outer face's crown points after the first. The front corner's arc starts at `FRONT_ARC`, the inner corners' at `INNER_ARCS`. */
const ARC_POINTS = POST_ROUND_STEPS + 1;
const FRONT_ARC = ARC_POINTS + CROWN_POINTS.length;
const INNER_ARCS = FRONT_ARC + 2 * ARC_POINTS;

/**
 * `postSection` cut along w = `share` (from the rear edge), its rear part (`gate`) or its front part (`body`): the corner arcs whole, the outer face's crown carried by one middle point
 * each side of the cut, so the point count never depends on where the cut falls, and the cut is a flat chord from the outer face to the inner. Both parts compute the cut's two points
 * from the same numbers, so they share them to the bit. The cut must lie on the outer face's flat, between the corner arcs.
 */
function cutSection(thick: number, width: number, share: number, side: "gate" | "body"): Pt[] {
  const outline = postSection(thick, width);
  const [rearFlat, frontFlat] = [outline[ARC_POINTS - 1]!.y, outline[FRONT_ARC]!.y];
  if (!(share > rearFlat && share < frontFlat)) throw new Error(`a post's cut at ${share} is not on its outer face's flat (${rearFlat.toFixed(3)}..${frontFlat.toFixed(3)})`);
  const crownU = PILLAR_CROWN / thick;
  const crowned = (y: number): Pt => ({ x: 1 + crownU * (1 - (2 * y - 1) ** 2), y });
  const [cutOuter, cutInner] = [crowned(share), { x: 0, y: share }];
  return side === "gate"
    ? [...outline.slice(0, ARC_POINTS), crowned((rearFlat + share) / 2), cutOuter, cutInner, ...outline.slice(INNER_ARCS)]
    : [cutOuter, crowned((share + frontFlat) / 2), ...outline.slice(FRONT_ARC, INNER_ARCS), cutInner];
}

/**
 * Drawn post (`postSection`) mapped onto four outer-face corners (+x side), its depth straight in, or square to its face in plan when
 * `square` (the C-pillar, whose face turns toward the tail); sign -1 mirrors to the left. `cut` keeps one `side` of the post's section cut at its [foot, head] `share`;
 * the gate's side is closed at both ends, a whole post and the body's side are buried in the body and the roof.
 */
function roundedPillarFromCorners(
  sign: number,
  c: PostCorners,
  thick: number,
  square = false,
  cut?: { share: readonly [number, number]; side: "gate" | "body" },
): THREE.BufferGeometry {
  const rails = [0, 1].map((v): Rail => {
    const rear: V3 = [lerp(c.rb[0], c.rt[0], v), lerp(c.rb[1], c.rt[1], v), lerp(c.rb[2], c.rt[2], v)];
    const front: V3 = [lerp(c.fb[0], c.ft[0], v), lerp(c.fb[1], c.ft[1], v), lerp(c.fb[2], c.ft[2], v)];
    const [dx, dz] = [front[0] - rear[0], front[2] - rear[2]];
    return square ? { rear, front, inward: [dz / hypot2(dx, dz), dx / hypot2(dx, dz)] } : { rear, front };
  });
  const section = (width: number, k: number): Pt[] => (cut ? cutSection(thick, width, cut.share[k]!, cut.side) : postSection(thick, width));
  return roundedPillarAlong(sign, rails, thick, { open: cut?.side !== "gate", section });
}

/** The plank rear post's foot plate (+x side; sign -1 mirrors): one up-facing triangle from its bottom edge (`rb` to `fb`) out to `foot` on the shoulder. */
function rearFootPlate(sign: number, rb: V3, fb: V3, foot: V3): THREE.BufferGeometry {
  const corners = sign > 0 ? [rb, fb, foot] : [rb, foot, fb];
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(corners.flatMap(([x, y, z]) => [sign * x, y, z]), 3));
  geo.setAttribute("uv", new THREE.Float32BufferAttribute(new Float32Array(6), 2));
  geo.setIndex([0, 1, 2]);
  geo.computeVertexNormals();
  return geo;
}

/** A cab back panel laps this far (m) in over the rear glass's side edge, so no gap opens between the glass and a squared post. */
const CAB_BACK_LAP = 0.02;

/**
 * The cab back beside a squared rear post (`pillars.rearSquare`, +x side; sign -1 mirrors): one flat panel facing the tail in the post's
 * rear edge plane, from inside the post (half its `thick` in) to `CAB_BACK_LAP` over the rear glass's side edge, from its foot `rb` to its head `rt`.
 */
function cabBackPanel(sign: number, rb: V3, rt: V3, thick: number, rg: BodyStyle["rearGlass"]): THREE.BufferGeometry {
  const corners: V3[] = [
    [rb[0] - thick / 2, rb[1], rb[2]],
    [rg.wBase / 2 - CAB_BACK_LAP, rb[1], rb[2]],
    [rg.wTop / 2 - CAB_BACK_LAP, rt[1], rt[2]],
    [rt[0] - thick / 2, rt[1], rt[2]],
  ];
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(corners.flatMap(([x, y, z]) => [sign * x, y, z]), 3));
  geo.setAttribute("uv", new THREE.Float32BufferAttribute(new Float32Array(8), 2));
  geo.setIndex(sign > 0 ? [0, 1, 2, 0, 2, 3] : [0, 2, 1, 0, 3, 2]);
  geo.computeVertexNormals();
  return geo;
}

/** A glass bar stands this far (m) off the side glass's plane: clear of the pane, flat on it. */
const GLASS_BAR_PROUD = 0.002;
/** A glass bar's foot runs this far (m) under the belt, into the belt seal, like a post's. */
const GLASS_BAR_SINK = 0.02;

/** The drawn glass bar (`pillars.glassBar`, +x side; sign -1 mirrors): a flat strip on the side glass from under the belt to the glass's top, then up into the roof's side. */
function glassBar(sign: number, style: BodyStyle, { width: [wBelt, wTop], z: [zBelt, zTop] }: Required<PillarSpan>): THREE.BufferGeometry {
  const at = (z: number, y: number): V3 => [sign * underRoofSide(onGlassPlane(z, y, style, GLASS_BAR_PROUD), y, z, style), y, z];
  const row = (zc: number, w: number, y: (z: number) => number) => [at(zc - w / 2, y(zc - w / 2)), at(zc + w / 2, y(zc + w / 2))];
  const corners = [
    ...row(zBelt, wBelt, (z) => beltY(z, style) - GLASS_BAR_SINK),
    ...row(zTop, wTop, (z) => glassTopY(z, style)),
    ...row(zTop, wTop, (z) => cantY(z, style) + PILLAR_TOP_RISE),
  ];
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(corners.flat(), 3));
  geo.setAttribute("uv", new THREE.Float32BufferAttribute(new Float32Array(2 * corners.length), 2));
  // Rows rear/front: (a, b) under (c, d); the +x side's quads wound outward, the mirror's reversed.
  geo.setIndex([0, 2].flatMap((a) => (sign > 0 ? [a, a + 2, a + 3, a, a + 3, a + 1] : [a, a + 3, a + 2, a, a + 1, a + 3])));
  geo.computeVertexNormals();
  return geo;
}

/** The drawn A-post's depth inward (m): a slim post, not a slab. */
const A_POST_THICK = 0.03;
/** The drawn A-post's face crowns this share of its width (`pillars.aCrown` overrides): its normals fan ±30° across it, turning from the side glass to the windshield, not a flat plank. */
const A_POST_CROWN = 0.13;
const aPostCrown = (style: BodyStyle): number => style.pillars?.aCrown ?? A_POST_CROWN;
/**
 * The drawn A-post's stations, base to top, as shares of its run: sixths, the fifth left out. Its rails run straight up to the cant
 * line, so the lower five show under every style's roof side; the top runs up into the roof. The fifth stands past the cant on some
 * styles (held in the roof) and in the last few cm under it on the rest, where the chord to the top covers it.
 */
const A_POST_STATIONS = [0, 1, 2, 3, 4, 6].map((k) => k / 6);

/** Where `windshield.round` rounds the pane's top corner, the post's front rail follows its arc: a station at each of these turns (shares of its quarter turn) before the top, which is the arc's end. */
const A_POST_ARC_TURNS = [0.3, 0.55] as const;

/** The A-post's stations as shares of its run: `A_POST_STATIONS`, with the arc's `A_POST_ARC_TURNS` before the top where the pane's top corner rounds (the arc starts above the fifth station). */
function aPostStations(style: BodyStyle, edgeFoot: number): number[] {
  const { base, round } = style.windshield;
  if (round === undefined) return A_POST_STATIONS;
  const rT = round / hypot2(style.windshieldTop[0] - base[0], style.windshieldTop[1] - base[1]);
  return [...A_POST_STATIONS.slice(0, -1), ...A_POST_ARC_TURNS.map((turn) => (1 - rT + rT * detSin((turn * Math.PI) / 2) - edgeFoot) / (1 - edgeFoot)), 1];
}

/** The drawn A-post stands this far (m) off the windshield's edge and the side glass, outward, so neither glass shows through it. */
const A_POST_LIFT = 0.004;
/** A drawn pillar's top runs this far (m) up past the cant line, buried in the roof's side. */
const PILLAR_TOP_RISE = 0.03;
/** The sail (the panel between the A-post and the door glass) is this thick (m), on the side glass plane. */
const SAIL_THICK = 0.02;
/** A sail narrower than this (m) at every station is not drawn. */
const SAIL_MIN = 0.005;
/** Where the door glass runs under the post the sail thins to this (m), never to nothing, so its faces keep their normals. */
const SAIL_EDGE = 0.001;
/** Stations along the sail, as shares of its run from the base to its top (the glass's knee, else the post's top). */
const SAIL_STATIONS = [0, 0.5, 1] as const;

/**
 * The drawn A-post's rails and its sail's, base to top. The post's front rail runs along the windshield's edge (carried down the
 * edge's line to the belt when the belt lies under the windshield's base, so its foot lies level in the cowl); its rear rail runs
 * `aPostRearZ` behind it in side view, across the side glass's lean from the door glass's foot to its top-front corner; its depth runs
 * square to its face in plan. The sail fills from the post's rear edge to the door glass's front edge (`doorGlassFrontZ`) up to the
 * glass's knee (or the post's top; with `aPillarSailGlass` and no knee, also a station at the glass's top), so no glass layout leaves a hole or a sliver.
 */
function aPostRails(style: BodyStyle): { post: Rail[]; sail: Rail[] | null } {
  const base = windshieldSideBase(style);
  const [topY, topZ] = style.windshieldTop;
  const run = hypot2(topZ - base[1], topY - base[0]);
  const [uz, uy] = [(topZ - base[1]) / run, (topY - base[0]) / run];
  const [footZ, aTopZ] = [style.aPillarFoot, aPillarTopZ(style)];
  const [footY, aTopY] = [beltY(footZ, style), cantY(aTopZ, style) + PILLAR_TOP_RISE];
  const footEdge = (footY - base[0]) / (topY - base[0]);
  // A seated pane's side base follows the hood, so its edge line meets the belt above that base as often as below it: the post starts at the belt either way.
  const edgeFoot = style.windshield.seat === true ? footEdge : Math.min(0, footEdge);
  const glassTop = glassTopY(aTopZ, style);
  const cantTop = cantY(aTopZ, style);
  const glassPlaneX = (y: number) => lerp(beltX(footZ, style), cantX(aTopZ, style), THREE.MathUtils.clamp((y - footY) / (cantTop - footY), 0, 1));
  const glassFall = domeFall(style, topZ, style.windshield.domeFall);
  const railAt = (t: number): Rail => {
    const y = lerp(footY, aTopY, t);
    const edge = lerp(edgeFoot, 1, t);
    const [rearZ, edgeZ] = [aPostRearZ(y, style, base), lerp(base[1], topZ, edge) + A_POST_LIFT * uy + sideBowZ(style.windshield.sideBow ?? 0, edge)];
    const half = windshieldSideX(style, edge);
    // Under its top (which the roof holds), the station rides down with the windshield's edge as it falls with the dome (`domeFall`).
    const fall = t < 1 ? glassFall(half, Math.max(0, edge)) : 0;
    const frontY = lerp(base[0], topY, edge) - fall - A_POST_LIFT * uz;
    const [frontX, rearX] = [half + A_POST_LIFT, glassPlaneX(y - fall) + A_POST_LIFT];
    const place = (back: number): Rail => {
      const [postZ, frontZ] = [rearZ - back, edgeZ - back];
      const roofZ = THREE.MathUtils.clamp(postZ, style.roofZ[0], style.roofZ[1]);
      const rear: V3 = [underRoofSide(rearX, y - fall, roofZ, style), y - fall, postZ];
      const frontHalf = underRoofSide(frontX, frontY, frontZ, style);
      // The top station reaches the roof's skin: `back` moved it in under a roof that stands over the windshield's top, where its open end would show.
      const frontTopY = t === 1 ? Math.max(frontY, roofMeshY(frontHalf, frontZ, style) - ROOF_TUCK) : frontY;
      const front: V3 = [frontHalf, frontTopY, frontZ];
      // Square to the face after the roof's tuck: squaring it before shears the top stations' corners past 35°.
      const [dx, dz] = [front[0] - rear[0], front[2] - rear[2]];
      return { rear, front, inward: [dz / hypot2(dx, dz), dx / hypot2(dx, dz)] };
    };
    if (t < 1) return place(0);
    // The top station runs into the roof, its ring held where the roof's tuck holds all of it, not a blade past its end: the ring's front
    // goes right up to the roof's end less what its section reaches forward of it (its depth runs square to the face, its outer face crowns).
    const hold = (reach: number) => Math.max(0, Math.max(rearZ, edgeZ) - (style.roofZ[1] - ROOF_TUCK - reach));
    return place(hold(postForwardReach(place(hold(0)), aPostCrown(style))));
  };
  const post = aPostStations(style, edgeFoot).map(railAt);
  const sail: Rail[] = [];
  let sailWidth = 0;
  const sailYs = SAIL_STATIONS.map((share) => lerp(footY, style.aPillarKnee ?? aTopY, share));
  // A kneeless glass's front edge is straight only up to the glass's top (held above it): one more station there (`aPillarSailGlass`) keeps the sail's rear edge on it, not on a chord to the post's top.
  if (style.aPillarSailGlass === true && style.aPillarKnee === undefined) sailYs.push(glassTop);
  for (const y of sailYs.sort((a, b) => a - b)) {
    const front = postRearmost(railAt((y - footY) / (aTopY - footY)), A_POST_THICK);
    const sailZ = Math.min(doorGlassFrontZ(y, footY, glassTop, style, base), front[2] - SAIL_EDGE);
    const rear: V3 = [glassX(sailZ, y, style), y, sailZ];
    sail.push({ rear, front });
    sailWidth = Math.max(sailWidth, hypot2(front[0] - rear[0], front[2] - rear[2]));
  }
  return { post, sail: sailWidth > SAIL_MIN ? sail : null };
}

/** The point of `rail`'s drawn post section (`postSection`, +x side) on its rear side furthest back: where the sail behind the post meets it. */
function postRearmost({ rear, front, inward = [1, 0] }: Rail, thick: number): V3 {
  const width = hypot2(hypot2(front[0] - rear[0], front[1] - rear[1]), front[2] - rear[2]);
  let rearmost: V3 = [rear[0], rear[1], Infinity];
  for (const p of postSection(thick, width)) {
    const depth = (1 - p.x) * thick;
    if (p.y < 1e-6 && rear[2] + depth * inward[1] < rearmost[2]) rearmost = [rear[0] - depth * inward[0], rear[1], rear[2] + depth * inward[1]];
  }
  return rearmost;
}

/** How far (m) forward of its front rail `rail`'s drawn A-post section reaches: its depth runs square to the face in plan and its outer face crowns `crown` of its width. */
function postForwardReach({ rear, front, inward = [1, 0] }: Rail, crown: number): number {
  const width = hypot2(hypot2(front[0] - rear[0], front[1] - rear[1]), front[2] - rear[2]);
  return Math.max(0, ...postSection(A_POST_THICK, width, crown * width).map((p) => lerp(rear[2], front[2], p.y) + (1 - p.x) * A_POST_THICK * inward[1] - front[2]));
}

/** The cage roof's side lip runs from the cant line (`ROOF_LIP_OUT`) up to its knee [past the half-width, under the roof] (m), then in to the dome's edge; the drawn roof's roll runs out to the cant line plus `roofDrip`. */
const ROOF_LIP_KNEE = [0.07, 0.03] as const;
/** A pillar's top stops this far (m) inside the roof's surface, so the two never fight over a pixel. */
const ROOF_TUCK = 0.002;

/** The drawn roof's skin half-section (+x, crown to cant) at `z`, as `makeRoofGeometry` builds it: on a `roofSection` its arc, eased point for point into the dome's rolled side over a squared front (`roofSquareShare`); else the dome itself. */
function roofHalf(z: number, style: BodyStyle): Pt[] {
  const { y: roofY, x } = roofAt(z, style);
  const { drop, crown, reach } = roofDome(z, style);
  const y = roofY - drop;
  const side = roofRoll(x, y, cantDrop(style), roofDrip(style), ROOF_ROLL, reach).slice(0, -1);
  const shoulder = ROOF_SHOULDER[1] * (crown / ROOF_CROWN);
  // The dome's right half, crown to cant line: as many points as `ROOF_ARC_T`, so `roofSquareShare` eases an arc into it point for point.
  const dome = [{ x: 0, y: y + crown }, { x: x * ROOF_SHOULDER[0], y: y + shoulder }, { x, y }, ...[...side].reverse()];
  const arc = roofArc(z, style);
  if (!arc) return dome;
  const share = roofSquareShare(z, style);
  return ROOF_ARC_T.map((t, i) => {
    const p = arc(t);
    return share === 0 ? p : { x: lerp(p.x, dome[i]!.x, share), y: lerp(p.y, dome[i]!.y, share) };
  });
}

/** The drawn roof loft's skin height at (`x`, `z`): its section between the two rings round its station (`roofSourceZ`), lerped point for point as the loft joins them, never above the analytic skin. */
function roofMeshY(x: number, z: number, style: BodyStyle): number {
  const at = roofSourceZ(x, z, style);
  const skin = roofHalf(at, style);
  const zs = roofRingZs(style, "drawn");
  const k = THREE.MathUtils.clamp(zs.findIndex((r) => r >= at), 1, zs.length - 1);
  const [a, b] = [roofHalf(zs[k - 1]!, style), roofHalf(zs[k]!, style)];
  const u = (at - zs[k - 1]!) / (zs[k]! - zs[k - 1]!);
  const chord = a.map((p, i) => ({ x: lerp(p.x, b[i]!.x, u), y: lerp(p.y, b[i]!.y, u) }));
  // Past the lerped section's lip (a rolled end narrowing its reach between rings) the loft doesn't cover `x`: the analytic skin only, never the lip's foot.
  const onSkin = arcY(skin, x);
  return x <= chord[chord.length - 1]!.x ? Math.min(arcY(chord, x), onSkin) : onSkin;
}

/** The drawn roof section's half-width (m) at height `y` over a station at (`roofX`, `roofY`): along its rolled side (`reach` of its lip), the dome's edge over it, none under the cant line. */
function roofOutlineX(y: number, roofY: number, roofX: number, lip: number, drip: number, reach: number): number {
  if (y <= roofY - lip) return Infinity;
  const roll = roofRoll(roofX, roofY, lip, drip, ROOF_ROLL, reach);
  for (let k = 1; k < roll.length; k++) {
    const [a, b] = [roll[k - 1]!, roll[k]!];
    if (y <= b.y) return lerp(a.x, b.x, (y - a.y) / (b.y - a.y));
  }
  return roofX;
}

/** `x` held `ROOF_TUCK` in under the drawn roof's side at (`y`, `z`), read at its station (`roofSourceZ`); unchanged off the roof's z span or under its cant line. A curved roof
 *  (`roofSection`) holds it inside the cant line only: over its shallow top a point drops onto the skin (`insideRoof`), never slides in. */
function underRoofSide(x: number, y: number, z: number, style: BodyStyle): number {
  const at = roofSourceZ(x, z, style);
  if (at < style.roofZ[0] || at > style.roofZ[1]) return x;
  const cant = roofArc(at, style)?.(1);
  if (cant) return y <= cant.y ? x : Math.min(x, cant.x - ROOF_TUCK);
  const roof = roofAt(at, style);
  const { drop, reach } = roofDome(at, style);
  return Math.min(x, roofOutlineX(y, roof.y - drop, roof.x, cantDrop(style), roofDrip(style), reach) - ROOF_TUCK);
}

/** The side glass's plane at (`y`, `z`), its lean from the belt to the cant line carried on past both, `proud` (m) out off it. */
function onGlassPlane(z: number, y: number, style: BodyStyle, proud: number): number {
  const [belt, cant] = [beltY(z, style), cantY(z, style)];
  return lerp(beltX(z, style), cantX(z, style), (y - belt) / (cant - belt)) + proud;
}

/** Holds every vertex of `geo` over the roof's z span (at its station, `roofSourceZ`) inside the roof's section (in under its lip, under its skin as the loft draws it: its chords; its rolled side over a squared front too), so a pillar's top runs into the roof, not through it; names it `name`. */
function insideRoof(geo: THREE.BufferGeometry, style: BodyStyle, name: string): THREE.BufferGeometry {
  const pos = geo.getAttribute("position") as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const z = pos.getZ(i);
    const at = roofSourceZ(Math.abs(pos.getX(i)), z, style);
    if (at < style.roofZ[0] || at > style.roofZ[1]) continue;
    const x = pos.getX(i);
    const half = underRoofSide(Math.abs(x), pos.getY(i), z, style);
    pos.setXY(i, Math.sign(x) * half, Math.min(pos.getY(i), roofMeshY(half, z, style) - ROOF_TUCK));
  }
  geo.name = name;
  return geo;
}

export function makeBox(w: number, h: number, d: number, x: number, y: number, z: number): THREE.BufferGeometry {
  const geo = new THREE.BoxGeometry(w, h, d);
  geo.translate(x, y, z);
  return geo;
}

/** The cage's header bars are this tall (m). */
const HEADER_HALF_HEIGHT = 0.03;
/** The cage's header bars are this deep (m) along z. */
const HEADER_DEPTH = 0.08;

/** The painted fill between a side glass top dropped under the cant line and the cant line is this thick (m), like a pillar. */
const GLASS_FILL_THICK = 0.05;

/** A divider the style doesn't size: 8 cm wide at the belt, 7 at the top, upright at `midPillarZ`. */
const DIVIDER: PillarSpan = { width: [0.08, 0.07] };

/** Painted fill from the side glass top up to the cant line, C-pillar to A-pillar, on the glass plane (drawn only): a style's DLO that drops under its roof. */
function glassTopFill(sign: number, style: BodyStyle, aTopZ: number): THREE.BufferGeometry[] {
  const stations = style.glassTop;
  if (stations === undefined || typeof stations === "number") return [];
  const zRear = drawnQuarter(style).zRearTop;
  const zs = [zRear, ...stations.map(([z]) => z).filter((z) => z > zRear && z < aTopZ), aTopZ];
  const rings = zs.map((z): Pt[] => {
    const low = glassTopY(z, style);
    const lowX = glassX(z, low, style);
    const [high, highX] = [cantY(z, style), cantX(z, style)];
    return [
      { x: sign * lowX, y: low },
      { x: sign * highX, y: high },
      { x: sign * (highX - GLASS_FILL_THICK), y: high },
      { x: sign * (lowX - GLASS_FILL_THICK), y: low },
    ];
  });
  const fill = loftFromRings(rings, zs, 0, 1);
  ensureOutwardNormals(fill);
  return [fill];
}

/** The drawn belt rail stands this far (m) out of the side glass's plane, flush with the pillars' outer faces at the belt, and as far in. */
export const RAIL_PROUD = 0.01;
/** The drawn belt rail's top stands this far (m) over the quarter glass's belt edge, just covering it; its foot is buried `RAIL_FOOT` under it. */
export const RAIL_LIP = 0.005;
const RAIL_FOOT = 0.025;
/** A sill column off the straight line through its neighbours by less than this (m) is no bend: the rail spends no ring there. */
const RAIL_STRAIGHT = 1e-4;
/** Both builds' belt rail goes by this name (its rows pick it by it). */
const BELT_RAIL = "beltRail";

/**
 * The drawn belt rail: the quarter glass's sill seal on the glass plane, along the pane's own belt edge (column by column) on into
 * the B-pillar, so it never stands off the sill; its depth runs square to the sill in plan where the sill turns in. Its ends are
 * buried in the C- and B-pillars. Where the sill stands higher over the body's deck than its foot reaches, its foot goes down to the deck.
 * `cPillar.railRun` runs the rear ring on that far further back, flat, its depth direction kept.
 */
function drawnBeltRail(sign: number, style: BodyStyle): THREE.BufferGeometry {
  const sill = quarterSillZs(style);
  const columns = style.bPillar.front > sill.at(-1)! ? [...sill, style.bPillar.front] : sill;
  const zs = columns.filter((z, k) => {
    if (k === 0 || k === columns.length - 1) return true;
    const [behind, ahead] = [columns[k - 1]!, columns[k + 1]!];
    const t = (z - behind) / (ahead - behind);
    return [beltX, beltY].some((line) => Math.abs(line(z, style) - lerp(line(behind, style), line(ahead, style), t)) > RAIL_STRAIGHT);
  });
  const rails = zs.map((z, k): Rail => {
    const [outer, y] = [beltX(z, style) + RAIL_PROUD, beltY(z, style)];
    const [behind, ahead] = [zs[Math.max(k - 1, 0)]!, zs[Math.min(k + 1, zs.length - 1)]!];
    const [dx, dz] = [beltX(ahead, style) - beltX(behind, style), ahead - behind];
    const run = hypot2(dx, dz);
    return { rear: [outer, Math.min(y - RAIL_FOOT, sampleSlice(z, style.profile).yBelt), z], front: [outer, y + RAIL_LIP, z], inward: [dz / run, dx / run] };
  });
  // A copy of the first ring keeps its own `inward`: a recomputed one turns the ring and its lengthwise edges past the 50 degree row.
  const railRun = style.cPillar?.railRun ?? 0;
  const lead = rails[0]!;
  const runZ = lead.rear[2] - railRun;
  const runOn: Rail = { ...lead, rear: [lead.rear[0], lead.rear[1], runZ], front: [lead.front[0], lead.front[1], runZ] };
  const rail = roundedPillarAlong(sign, railRun > 0 ? [runOn, ...rails] : rails, 2 * RAIL_PROUD);
  rail.name = BELT_RAIL;
  return rail;
}

/** The sail is as deep (m) as the post it replaces; its two edges roll round at half that. */
const SAIL_DEPTH = 0.05;
/** Behind the side window's line the sail's foot sweeps out from the glass onto the haunch's shoulder over this run (m), in one chord, unless the style sets its own (`cPillar.sweep`). */
export const SAIL_SWEEP = 0.15;
/** The sail's stations along the haunch stand at most this far apart (m): the shoulder turns under 1 cm along it, so its foot keeps to it between them. */
const SAIL_STEP = 0.35;
/** The sail's foot sits this far (m) under the shoulder it leaves, so where the two touch they never fight over a pixel. */
const SAIL_SINK = 0.002;
/** The sail's rear end stands this far (m) ahead of a deck lid's front edge. */
const SAIL_LID_SHUT = 0.004;
/** A sail section's Bézier control point lies this share of the foot-to-head run out along the foot's tangent. */
const SAIL_CONTROL = 0.5;
/** A flat sail (`cPillar.flat`) eases into the roof end's rolled section over this run (m) behind it unless `cPillar.blend` says otherwise. */
const SAIL_ROLL_BLEND = 0.45;
/** Points along a sail section's outer face (foot to head) and its inner face, and the chords each of its rounded edges spends (30° each). */
const SAIL_OUTER = 6;
const SAIL_INNER = 4;
const SAIL_EDGE_CHORDS = 6;
/** At the roof's rear end the sail's outer face runs from its foot onto the roof's roll, the roll's first chord halved (where it turns hardest) so the section turns under 35° at every point; `SAIL_OUTER` - 1 long. */
const SAIL_ROOF_ROLL = [0, Math.PI / 12, Math.PI / 6, Math.PI / 3, Math.PI / 2] as const;
/** A flush sail's head (`cPillar.flush`) stands this far (m) on the rear glass, a chrome bead's height, and laps the glass's edge this far: half the bead, so the seam lies under it. */
const SAIL_FLUSH_STAND = 0.005;
const SAIL_FLUSH_LAP = 0.011;
/** A flush sail's roof-end head laps the rear glass's round top corner this share of the way round its arc unless `cPillar.corner` says otherwise: mid-arc, so the ring behind follows the arc's lower half. */
const SAIL_CORNER = 0.5;
/** The triangle behind the quarter glass laps this far (m) over the glass's rear edge and this far under the sail's foot. */
const TIP_LAP = 0.01;
/** The triangle stands this far (m) out of the side glass's plane, over the quarter glass it laps. */
const TIP_PROUD = 0.004;

/** Polyline `points` as `n` points on its own chords, keeping every vertex (so a section laid on it covers it exactly): its longest chords halved. */
function onChords(points: Pt[], n: number): Pt[] {
  if (points.length > n) throw new Error(`${points.length} polyline points past the ${n} a section takes`);
  const len = (j: number) => hypot2(points[j]!.x - points[j - 1]!.x, points[j]!.y - points[j - 1]!.y);
  while (points.length < n) {
    let k = 1;
    for (let j = 2; j < points.length; j++) if (len(j) > len(k)) k = j;
    points.splice(k, 0, { x: (points[k - 1]!.x + points[k]!.x) / 2, y: (points[k - 1]!.y + points[k]!.y) / 2 });
  }
  return points;
}

/**
 * The drawn C-pillar as a sail (`cPillar`): lofted along z through sections that each run as a quadratic Bézier from a foot to a head,
 * `SAIL_DEPTH` deep with rounded edges. The head follows the flat post's top edge (`rb` → `rt` → `ft`); the foot leaves the haunch's
 * shoulder along its tangent, then sweeps in onto the side window's line (`tip` up to the quarter glass's rear top corner), proud of the glass.
 */
function cPillarSail(sign: number, style: BodyStyle, { rb, rt, ft }: { rb: V3; rt: V3; ft: V3 }): THREE.BufferGeometry {
  const q = drawnQuarter(style);
  const [tipY, tipZ] = style.cPillar?.tip ?? [beltY(q.zRearBot, style), q.zRearBot];
  const [topY, topZ] = [glassTopY(q.zRearTop, style), q.zRearTop];
  // A rounded end (`cPillar.dEnd`): the window line's start leaves the belt on an arc of radius `dR` tangent to it, rearmost at `dRear`.
  const m = (topY - tipY) / (topZ - tipZ); // the window line's start slope (y per z)
  const slant = Math.sqrt(1 + m * m);
  const [dR, dRear] = style.cPillar?.dEnd ?? [0, tipZ];
  const dZ = dRear + dR; // the D end arc's centre z
  const dY = tipY + m * (dZ - tipZ) - dR * slant; // its centre y: the arc tangent to the line
  const dTangent = dZ - (dR * m) / slant; // where the arc meets the line
  // A pinched window (`cPillar.pinch`): its line rounds over from the tip into the glass's top line `pinch` ahead of the corner, one
  // quadratic Bézier (tip, corner, front), so the sail runs forward to its end and takes a ring at its middle.
  const pinch = style.cPillar?.pinch ?? 0;
  const frontZ = topZ + pinch;
  const bead = style.cPillar?.bead === true;
  const windowY = (z: number): number => {
    // At the tip itself too: an upright window edge (tip and top at one z) gives the front ring its whole run up from the belt.
    if (z <= tipZ) return tipY;
    if (dR > 0 && z < dTangent) return Math.max(tipY, dY + Math.sqrt(Math.max(0, dR * dR - (dZ - z) ** 2)));
    if (pinch === 0) return lerp(tipY, topY, (z - tipZ) / (topZ - tipZ));
    // z(u) = (1 - u)² tipZ + 2u(1 - u) topZ + u² frontZ, solved for u; y rises as 1 - (1 - u)² (the corner and front share topY).
    const [a, b, c] = [tipZ - 2 * topZ + frontZ, 2 * (topZ - tipZ), tipZ - Math.min(z, frontZ)];
    const u = Math.abs(a) < 1e-9 ? -c / b : (-b + Math.sqrt(b * b - 4 * a * c)) / (2 * a);
    return lerp(tipY, topY, 1 - (1 - u) ** 2);
  };
  const sweep = style.cPillar?.sweep ?? SAIL_SWEEP;
  const sweepZ = tipZ - sweep;
  // Its rear end stops a shut line ahead of a deck lid's front edge: lying on over the lid, or flush with its face, the two skins would cross.
  const rear = style.boot.kind === "lid" ? Math.max(rb[2], style.boot.z0 + SAIL_LID_SHUT) : rb[2];
  // The glass corner's ring stands just behind the roof's rear end (insideRoof never reaches it there), its section the roof end's own, so the sail covers the end's wing outboard of the rear glass.
  const roofEndZ = Math.max(rt[2], style.roofZ[0] - ROOF_TUCK);
  // A flat sail's haunch sections are straight up to the roof's end, so they space evenly up to it: a sweep station between them only folds the face.
  const haunchEnd = style.cPillar?.flat === true ? Math.max(sweepZ, roofEndZ) : sweepZ;
  const haunch = Math.max(1, Math.ceil((haunchEnd - rear) / SAIL_STEP));
  const roof = roofAt(style.roofZ[0], style);
  const flush = style.cPillar?.flush === true;
  // A curved roof's (`roofSection`) end section on its drawn chords, crown to cant.
  const endArc = roofArc(style.roofZ[0], style);
  const roofEnd = endArc ? ROOF_ARC_T.map(endArc) : null;
  const zs = [
    ...Array.from({ length: haunch }, (_, k) => lerp(rear, haunchEnd, k / haunch)),
    haunchEnd,
    tipZ,
    // The D end's arc takes rings at its rearmost point, mid-arc and its tangent point, so the loft follows the round, not one chord.
    ...(dR > 0 ? [dZ - dR, dZ - dR * detSin(Math.PI / 4 + detAtan2(m, 1) / 2), dTangent] : []),
    roofEndZ,
    ...(pinch > 0 ? [0.25 * tipZ + 0.5 * topZ + 0.25 * frontZ, frontZ] : [topZ]),
  ]
    .filter((z) => z >= rear && z <= frontZ)
    .sort((a, b) => a - b)
    .filter((z, k, all) => k === 0 || z - all[k - 1]! > 1e-6);
  const r = SAIL_DEPTH / 2;
  // A flush head stands on the drawn glass (fallen with the dome, round at its top corners), lapping its side edge.
  const glassHead = (z: number): readonly [number, number] => {
    const p = rearGlassInset(style, z, SAIL_FLUSH_LAP);
    return [p.x, p.y + SAIL_FLUSH_STAND];
  };
  // On a curved roof the roof end's head lies on that end's chords; lapping the glass, in over its top corner's arc at `cPillar.corner`
  // (mid-arc by default), so the chord from the ring behind follows the arc below it and the roof end meets it above (a ring of its own would cost 80 triangles).
  // A curved roof end square to its cant (a truck cab's: no roll outboard of the post's head) laps the glass corner the same way, so its
  // chords still cover the end's skin outboard of the glass.
  const lapsEnd = roofEnd !== null && (flush || roofEnd.every((p) => p.x <= roof.x));
  const endX = lapsEnd ? rearGlassInset(style, rearGlassCornerZ(style, style.cPillar?.corner ?? SAIL_CORNER) ?? roofEndZ, SAIL_FLUSH_LAP).x : roof.x;
  const endHead = [endX, roofEnd ? roofTopY(endX, style.roofZ[0], style) : roof.y] as const;
  const section = (z: number): Pt[] => {
    const atRoofEnd = z === roofEndZ && z < style.roofZ[0];
    const onGlass = flush && z < roofEndZ;
    // The head's rounded edge ends at the post's top corner (`r` over the section's end), buried in the roof's side like the post's top;
    // ahead of that corner (a pinched window's front ring) it holds the corner.
    const corner = z <= rt[2] ? [lerp(rb[0], rt[0], (z - rb[2]) / (rt[2] - rb[2])), lerp(rb[1], rt[1], (z - rb[2]) / (rt[2] - rb[2]))] : [lerp(rt[0], ft[0], Math.min(1, (z - rt[2]) / (ft[2] - rt[2]))), lerp(rt[1], ft[1], Math.min(1, (z - rt[2]) / (ft[2] - rt[2])))];
    const post = [corner[0]!, corner[1]! - r] as const;
    // A flat sail's head eases from the roof end's out to the post's top over the run ahead, so its rings never jump back out under the roof.
    const ahead = style.cPillar?.flat === true && roofEnd !== null && z > roofEndZ ? (z - roofEndZ) / (frontZ - roofEndZ) : 1;
    const head = atRoofEnd ? endHead : onGlass ? glassHead(z) : ([lerp(endHead[0], post[0], ahead), lerp(endHead[1], post[1], ahead)] as const);
    // The roof end's outer face from the cant line up to the head: the roof's roll, or a curved roof's chords outboard of the head.
    const endFace = !atRoofEnd
      ? null
      : roofEnd
        ? onChords([...roofEnd.filter((p) => p.x > head[0]!).reverse(), { x: head[0]!, y: head[1]! }], SAIL_ROOF_ROLL.length)
        : roofRoll(roof.x, roof.y, cantDrop(style), roofDrip(style), SAIL_ROOF_ROLL);
    // Over the glass (a curved roof's end head too) the head's edge stays a bead's: a post's would stand out over the pane. So does a beaded
    // window's (`cPillar.bead`) ahead of its corner, where its line has risen into the glass's top: a post's round would hang under that line.
    const headR = onGlass || (atRoofEnd && lapsEnd) || (bead && z > topZ) ? SAIL_FLUSH_STAND / 2 : r;
    // 0 on the window's line, 1 on the haunch: the foot's point and its tangent blend between the glass (its round edge's bottom on the line) and the shoulder.
    const f = THREE.MathUtils.smoothstep(tipZ - z, 0, sweep);
    // A pinched window's sail laps the glass with a bead's edge, a bead's height off it, so the window's point stays sharp; on the haunch its foot's edge is the full round.
    const [footR, footStand] = pinch > 0 ? [lerp(SAIL_FLUSH_STAND / 2, r, f), SAIL_FLUSH_STAND] : [r, ROOF_DRIP];
    // Where the window's line closes on the roof the section keeps a span of its depth (a pinched window's, of its two edges), never folding to a point.
    const lineY = Math.min(windowY(z), head[1]! - (pinch > 0 ? headR + 2 * footR : SAIL_DEPTH + r));
    const [upX, upY] = [cantX(z, style) - beltX(z, style), cantY(z, style) - beltY(z, style)];
    const up = [upX / hypot2(upX, upY), upY / hypot2(upX, upY)] as const;
    const shoulder = shoulderTop(z, style);
    const [tx, ty] = shoulder.tangent;
    // A flat sail (`cPillar.flat`) on the haunch runs straight from its head down to where that line touches the body's section: the
    // most outboard reach per drop, so no body point stands outside it and the panel leaves the body tangent, with no hump and no crease.
    const flat = style.cPillar?.flat === true && f === 1 && !atRoofEnd;
    const touch = flat
      ? sectionPoints(sampleSlice(z, style.profile), style, "drawn")
          .filter((p) => p.x > 0 && p.y < head[1]!)
          .reduce((a, b) => ((b.x - head[0]!) / (head[1]! - b.y) > (a.x - head[0]!) / (head[1]! - a.y) ? b : a))
      : null;
    const sink = touch ? SAIL_SINK / hypot2(head[0]! - touch.x, head[1]! - touch.y) : 0;
    const p0 = touch
      ? ([touch.x - sink * (head[1]! - touch.y), touch.y + sink * (head[0]! - touch.x)] as const)
      : ([lerp(onGlassPlane(z, lineY, style, footStand) + up[0] * footR, shoulder.x - SAIL_SINK * ty, f), lerp(lineY + up[1] * footR, shoulder.y + SAIL_SINK * tx, f)] as const);
    const [dx, dy] = [lerp(up[0], tx, f), lerp(up[1], ty, f)];
    const reach = (SAIL_CONTROL * hypot2(head[0]! - p0[0], head[1]! - p0[1])) / hypot2(dx, dy);
    // A flush head arrives level across the glass: its control point runs out along the foot's tangent to the head's height, never inboard of the head, so the foot keeps its tangent.
    const level = onGlass ? Math.min((head[1]! - p0[1]) / dy, dx < 0 ? (head[0]! - p0[0]) / dx : Infinity) : 0;
    const k = Number.isFinite(level) && level > 0 ? level : reach;
    // At the roof's end the head arrives as the roof does: level, its control point on the roll's outer corner, or along a curved roof's chord.
    const below = endFace?.[endFace.length - 2];
    const shrink = below ? hypot2(below.x - head[0]!, below.y - head[1]!) / (ROOF_LIP_OUT + roofDrip(style)) : 1;
    const c = endFace
      ? roofEnd
        ? ([head[0]! + (below!.x - head[0]!) / shrink, head[1]! + (below!.y - head[1]!) / shrink] as const)
        : ([roof.x + ROOF_LIP_OUT + roofDrip(style), roof.y] as const)
      : touch
        ? ([(p0[0] + head[0]!) / 2, (p0[1] + head[1]!) / 2] as const)
        : ([p0[0] + dx * k, p0[1] + dy * k] as const);
    // The section's point at `s` along its Bézier, `depth` in along its normal (+x side: the tangent turned down, into the body).
    const at = (s: number, depth: number, roll = 0): Pt => {
      const [ax, ay] = [2 * (1 - s) * (c[0] - p0[0]) + 2 * s * (head[0]! - c[0]), 2 * (1 - s) * (c[1] - p0[1]) + 2 * s * (head[1]! - c[1])];
      const run = hypot2(ax, ay);
      const [ux, uy] = [ax / run, ay / run];
      const [x, y] = [(1 - s) ** 2 * p0[0] + 2 * s * (1 - s) * c[0] + s * s * head[0]!, (1 - s) ** 2 * p0[1] + 2 * s * (1 - s) * c[1] + s * s * head[1]!];
      // A rounded edge: `roll` (0..π) turns from the outer face round past the end (forward at the head, back at the foot) to the inner face.
      const edgeR = s === 0 ? footR : headR;
      const [along, inward] = [edgeR * detSin(roll) * (s === 0 ? -1 : 1), roll === 0 ? depth : edgeR - edgeR * detCos(roll)];
      return { x: sign * (x + along * ux - inward * uy), y: y + along * uy + inward * ux };
    };
    const edge = (s: number) => Array.from({ length: SAIL_EDGE_CHORDS - 1 }, (_, j) => at(s, 0, (Math.PI * (j + 1)) / SAIL_EDGE_CHORDS));
    return [
      // A flush head's control point lies near it, so the section turns hardest there: its outer points crowd toward both ends (the foot keeps its tangent).
      ...(endFace
        ? [at(0, 0), ...endFace.map((p) => ({ x: sign * p.x, y: p.y }))]
        : Array.from({ length: SAIL_OUTER }, (_, k) => at(onGlass ? (1 - detCos((Math.PI * k) / (SAIL_OUTER - 1))) / 2 : k / (SAIL_OUTER - 1), 0))),
      ...edge(1),
      // The section thins from the foot's edge to the head's, so each rounded edge closes onto the inner face. A beaded sail holds the head's
      // depth to mid-face: thinning all the way, its inner face bowed out where the section turns into the roof's end.
      ...Array.from({ length: SAIL_INNER }, (_, k) => at(1 - k / (SAIL_INNER - 1), 2 * lerp(headR, footR, bead ? Math.max(0, (2 * k) / (SAIL_INNER - 1) - 1) : k / (SAIL_INNER - 1)))),
      ...edge(0).reverse(),
    ];
  };
  // A flat sail takes on the roof end's roll over the run behind it, and lets it go over the run ahead of it to its front ring (the post's
  // top): each outer point moves toward that section's own place off its chord, mapped onto the ring's chord, so no line stands where
  // the flat haunch meets the roll, nor where the roll meets the post.
  const rollEnd = style.cPillar?.flat === true && roofEndZ < style.roofZ[0] ? section(roofEndZ) : null;
  const front = zs[zs.length - 1]!;
  const reachLip = style.cPillar?.reachLip ?? 0;
  // Ahead of the roof end a pinched window's mid ring stands mid-run, where a smoothstep let-go turns fastest: that sail keeps the roll
  // level off the roof end and lets it go toward its front ring, where the section narrows to the post's sliver anyway.
  const rings = zs.map((z): Pt[] => {
    const ring = section(z);
    const letGo = pinch > 0 ? 1 - ((z - roofEndZ) / (front - roofEndZ)) ** 2 : 1 - THREE.MathUtils.smoothstep(z, roofEndZ, front);
    const w = !rollEnd || z === roofEndZ ? 0 : z < roofEndZ ? THREE.MathUtils.smoothstep(z, roofEndZ - (style.cPillar?.blend ?? SAIL_ROLL_BLEND), roofEndZ) * (style.cPillar?.rollShare ?? 1) : letGo;
    if (w === 0) return ring;
    const [a, b] = [rollEnd![0]!, rollEnd![SAIL_OUTER - 1]!];
    const endRun = hypot2(b.x - a.x, b.y - a.y);
    const [eu, ev] = [(b.x - a.x) / endRun, (b.y - a.y) / endRun];
    const [foot, head] = [ring[0]!, ring[SAIL_OUTER - 1]!];
    const run = hypot2(head.x - foot.x, head.y - foot.y);
    const [ux, uy] = [(head.x - foot.x) / run, (head.y - foot.y) / run];
    for (let k = 1; k < SAIL_OUTER - 1; k++) {
      const [p, q] = [rollEnd![k]!, ring[k]!];
      // The roll end's point as a share along its chord and an offset off it (+ turned left of the chord), and the ring's point's share along its own.
      const [t, n] = [((p.x - a.x) * eu + (p.y - a.y) * ev) / endRun, eu * (p.y - a.y) - ev * (p.x - a.x)];
      const s = lerp(((q.x - foot.x) * ux + (q.y - foot.y) * uy) / run, t, w);
      ring[k] = { x: foot.x + s * run * ux - w * n * uy, y: foot.y + s * run * uy + w * n * ux };
    }
    // `reachLip`: ahead of the roof end the face takes the roll end's own shape, carried from its foot, cant lip and head onto this ring's
    // foot, the roof's cant point at its z and its head: it reaches the lip at the cant line, not a chord to a head tucked under the roof.
    const roofLip = reachLip > 0 && z > roofEndZ ? roofArc(z, style)?.(1) : undefined;
    if (roofLip) {
      const l = rollEnd![1]!;
      const det = (l.x - a.x) * (b.y - a.y) - (l.y - a.y) * (b.x - a.x);
      const [lx, ly] = [sign * roofLip.x - foot.x, roofLip.y - foot.y];
      for (let k = 1; k < SAIL_OUTER - 1; k++) {
        const [px, py] = [rollEnd![k]!.x - a.x, rollEnd![k]!.y - a.y];
        const [m, n] = [(px * (b.y - a.y) - py * (b.x - a.x)) / det, ((l.x - a.x) * py - (l.y - a.y) * px) / det];
        ring[k] = { x: lerp(ring[k]!.x, foot.x + m * lx + n * (head.x - foot.x), reachLip), y: lerp(ring[k]!.y, foot.y + m * ly + n * (head.y - foot.y), reachLip) };
      }
    }
    return ring;
  });
  const sail = loftFromRings(rings, zs, 0, 1);
  // A curved roof's end head comes in over the glass, where the roof's end bows back with the glass top (`bowRoofEnds`, drawn on chords
  // between its end ring's points): that ring bows with those chords, a tuck behind them.
  const bow = roofEnd ? roofEndBows(style).find((end) => end.z === style.roofZ[0]) : undefined;
  const bowAt = (x: number) => (bow ? bow.bow * (1 - Math.min(1, x / bow.half) ** 2) : 0);
  const at = sail.getAttribute("position");
  for (let v = 0; bow && v < at.count; v++) {
    if (Math.abs(at.getZ(v) - roofEndZ) > 1e-6) continue;
    const x = Math.abs(at.getX(v));
    const k = roofEnd!.findIndex((p) => p.x >= x);
    const [a, b] = k <= 0 ? [roofEnd!.at(k)!, roofEnd!.at(k)!] : [roofEnd![k - 1]!, roofEnd![k]!];
    at.setZ(v, roofEndZ + (a === b ? bowAt(a.x) : lerp(bowAt(a.x), bowAt(b.x), (x - a.x) / (b.x - a.x))));
  }
  ensureOutwardNormals(sail);
  return sail;
}

/** The triangle behind the quarter glass goes by this name. */
const C_PILLAR_TIP = "cPillarTip";
/** The gloss-black triangle on the side glass's plane between the quarter glass's rear edge and the side window's line down to `tip` ([y, z]) (drawn only). */
function cPillarTip(sign: number, style: BodyStyle, [tipY, tipZ]: YZ): THREE.BufferGeometry {
  const q = drawnQuarter(style);
  const [topY, topZ] = [glassTopY(q.zRearTop, style), q.zRearTop];
  const front = Math.max(q.zRearBot, q.zRearTop) + TIP_LAP;
  // Its buried bottom edge runs straight between its ends: the belt bends under 1 cm over its run.
  const zs = [tipZ, front];
  const rings = zs.map((z): Pt[] => {
    const [low, high] = [beltY(z, style) - RAIL_FOOT, lerp(tipY, topY, Math.min((z - tipZ) / (topZ - tipZ), 1)) + TIP_LAP];
    const [lowX, highX] = [onGlassPlane(z, low, style, TIP_PROUD), onGlassPlane(z, high, style, TIP_PROUD)];
    return [
      { x: sign * lowX, y: low },
      { x: sign * highX, y: high },
      { x: sign * (highX - GLASS_FILL_THICK), y: high },
      { x: sign * (lowX - GLASS_FILL_THICK), y: low },
    ];
  });
  const tip = loftFromRings(rings, zs, 0, 1);
  ensureOutwardNormals(tip);
  tip.userData.blackout = true;
  return insideRoof(tip, style, C_PILLAR_TIP);
}

/** A drawn pillar's top corner sits on the side glass's plane, `proud` off it, in under the roof's side; the cage keeps `cageX`. */
function postTopX(style: BodyStyle, source: BodySource): (z: number, y: number, proud: number, cageX: number) => number {
  return (z, y, proud, cageX) => (source === "cage" ? cageX : underRoofSide(onGlassPlane(z, y, style, proud), y, z, style));
}

interface PostCorners {
  fb: V3;
  rb: V3;
  rt: V3;
  ft: V3;
}

/** A split post's head ends this far (m) up into the gate's slab (the spoiler's underside is its `y[0]`), so the post meets the slab and its end is hidden. */
const POST_SLAB_TUCK = 0.001;

/**
 * The rear (D) post's corners (right side): the glass-edge box `rearPillar`, `held` its drawn form (head held inside the roof's span, a squared post's rear edge on the side glass's plane),
 * and `share` the cut ([foot, head], shares of its width from its rear edge) when a roof-hinged gate carries part of it (drawn, not a sail or squared post), its head then ending
 * in the gate's slab; the cage keeps the box.
 */
function rearPostCorners(style: BodyStyle, source: BodySource) {
  const q = source === "drawn" ? drawnQuarter(style) : style.quarter;
  const rg = style.rearGlass;
  const topX = postTopX(style, source);
  const rearPillar = {
    fb: [beltX(q.zRearBot, style), beltY(q.zRearBot, style) - 0.02, q.zRearBot],
    rb: [rg.wBase / 2 + 0.02, rg.base[0], rg.base[1] - 0.01],
    rt: [rg.wTop / 2 + 0.02, rg.top[0] + 0.01, rg.top[1] - 0.01],
    ft: [topX(q.zRearTop, cantY(q.zRearTop, style) + PILLAR_TOP_RISE, ROOF_DRIP, cantX(q.zRearTop, style)), cantY(q.zRearTop, style) + PILLAR_TOP_RISE, q.zRearTop],
  } as const;
  // A drawn post's head follows the rear glass's top corner down the dome (`domeFall`), held inside the roof's span, where the
  // roof's clamp takes its whole top ring, not half of it.
  const [rtX, rtY, rtZ] = rearPillar.rt;
  const [heldY, heldZ] = [rtY - domeFall(style, rg.top[1])(rg.wTop / 2, 1), Math.max(rtZ, style.roofZ[0] + ROOF_TUCK)];
  const sail = source === "drawn" ? style.cPillar : undefined;
  // A squared post (`pillars.rearSquare`, a truck cab's back corner): its rear edge on the side glass's plane like its front, so its face never
  // turns to the tail; a flat cab back panel closes the cab from inside it over the rear glass's side edge.
  const squared = source === "drawn" && !sail && style.pillars?.rearSquare === true;
  const share = source === "drawn" && !sail && !squared && roofHinged(style.boot) ? style.boot.postShare : undefined;
  for (const s of share ?? []) if (!(s > 0 && s < 1)) throw new Error(`a post's share ${s} is not inside (0, 1)`);
  const slab = share === undefined ? undefined : style.roof?.spoiler?.y[0];
  const [rbX, rbY, rbZ] = rearPillar.rb;
  const held: PostCorners = squared
    ? { ...rearPillar, rb: [rearPillar.fb[0], rbY, rbZ], rt: [rearPillar.ft[0], heldY, heldZ] }
    : slab === undefined
      ? { ...rearPillar, rb: [rbX, rbY, rbZ], rt: [rtX, heldY, heldZ] }
      : { ...rearPillar, rb: [rbX, rbY, rbZ], rt: [rtX, slab + POST_SLAB_TUCK, heldZ], ft: [rearPillar.ft[0], slab + POST_SLAB_TUCK, rearPillar.ft[2]] };
  return { rearPillar, held, sail, squared, share };
}

/**
 * One piece of a split D-post (`side`: the gate's rear share, the body's front share; right side, `sign` -1 its mirror): the post's one section cut at its `share` per
 * station, so the pieces meet on the same cut points with a flat cut between them (a box section open) and no lap, groove or fight when shut. The gate's piece is
 * closed (its ends show when it opens), the cut and ends hard-edged. Its head ends in the slab, not under the roof's clamp.
 */
function postPiece(sign: number, style: BodyStyle, held: PostCorners, share: readonly [number, number], side: "gate" | "body"): THREE.BufferGeometry {
  const geo = roundedPillarFromCorners(sign, held, 0.05, true, { share, side });
  splitLoftOnLowDiagonals(geo);
  splitCreases(geo, CREASE_DEGREES.post);
  const tone = style.blackout?.rear;
  geo.userData.blackout = tone === true || tone === "matte";
  geo.userData.matte = tone === "matte";
  geo.name = "rear";
  return geo;
}

/** A roof-hinged gate's share of each D-post (drawn, car frame, both sides) beside its glass, toned as the body's rear post; none unless `boot.postShare` splits it. */
export function gatePosts(style: BodyStyle): THREE.BufferGeometry[] {
  const { held, share } = rearPostCorners(style, "drawn");
  return share ? [-1, 1].map((sign) => postPiece(sign, style, held, share, "gate")) : [];
}

export function makeGreenhouseFrame(style: BodyStyle, source: BodySource = "drawn"): THREE.BufferGeometry[] {
  const pillarFromCorners = source === "cage" ? boxFromCorners : roundedPillarFromCorners;
  const parts: THREE.BufferGeometry[] = [];
  const [wsY, wsZ] = style.windshieldTop;
  const ws = style.windshield;
  const beltXAt = (z: number) => beltX(z, style);
  const belt = (z: number) => beltY(z, style);
  const bp = style.bPillar;
  const rg = style.rearGlass;
  const q = source === "drawn" ? drawnQuarter(style) : style.quarter;
  const aTopZ = aPillarTopZ(style);
  const aPost = source === "drawn" ? aPostRails(style) : null;
  const bBands = bPillarBand(style, source);
  const m = style.midPillarZ;
  const divider = (source === "drawn" ? style.pillars?.divider : undefined) ?? DIVIDER;
  const black = (source === "drawn" ? style.blackout : undefined) ?? {};
  // A drawn pillar runs into the roof (never through it), named and toned by its `blackout` key; the cage keeps its boxes.
  const pillar = (geo: THREE.BufferGeometry, name: keyof NonNullable<BodyStyle["blackout"]>) => {
    if (source === "cage") return geo;
    geo.userData.blackout = black[name] === true || black[name] === "matte";
    geo.userData.matte = black[name] === "matte";
    return insideRoof(geo, style, name);
  };
  const topX = postTopX(style, source);
  for (const sign of [-1, 1]) {
    parts.push(
      aPost
        ? pillar(roundedPillarAlong(sign, aPost.post, A_POST_THICK, { open: true, section: (width) => postSection(A_POST_THICK, width, aPostCrown(style) * width) }), "a")
        : boxFromCorners(
            sign,
            {
              fb: [ws.wBase / 2 + 0.02, ws.base[0] + 0.01, ws.base[1] - 0.03],
              rb: [beltXAt(style.aPillarFoot), belt(style.aPillarFoot), style.aPillarFoot],
              rt: [cantX(aTopZ, style), cantY(aTopZ, style) + 0.03, aTopZ],
              ft: [ws.wTop / 2 + 0.02, wsY + 0.02, wsZ],
            },
            0.05,
            2,
          ),
    );
    const seatY = aPost ? style.pillars?.aSeat : undefined;
    if (seatY !== undefined) {
      // The post's foot stands at the belt; a lower deck under it shows the cabin through the gap. The skirt is the foot's crowned outer face carried straight down into the deck
      // (on down the post's own line it would run 10 cm forward, off the gap).
      const foot = aPost!.post[0]!;
      const low = { ...foot, rear: [foot.rear[0], seatY, foot.rear[2]] as V3, front: [foot.front[0], seatY, foot.front[2]] as V3 };
      const crown = aPostCrown(style) * hypot2(hypot2(foot.front[0] - foot.rear[0], foot.front[1] - foot.rear[1]), foot.front[2] - foot.rear[2]);
      const section = () => [{ x: 1, y: 0 }, { x: 1 + crown / A_POST_THICK, y: 0.5 }, { x: 1, y: 1 }];
      const seat = roundedPillarAlong(sign, [low, foot], A_POST_THICK, { open: true, section });
      // Its two outer quads only: the closing chord behind them would share their vertices and bend their normals into the panel.
      seat.setIndex(Array.from(seat.getIndex()!.array.subarray(0, 12)));
      seat.computeVertexNormals();
      parts.push(Object.assign(pillar(seat, "a"), { name: "aSeat" }));
    }
    const [bRear, bFront] = bBands.belt;
    const [bTopRear, bTopFront] = bBands.top;
    const bz = (bTopRear + bTopFront) * 0.5;
    const bTop = cantY(bz, style) + (source === "cage" ? 0.05 : PILLAR_TOP_RISE);
    parts.push(
      pillar(
        pillarFromCorners(
          sign,
          {
            fb: [beltXAt(bFront) + 0.01, belt(bFront) - 0.02, bFront],
            rb: [beltXAt(bRear) + 0.01, belt(bRear) - 0.02, bRear],
            rt: [topX(bTopRear, bTop, ROOF_DRIP, cantX(bz, style) + 0.01), bTop, bTopRear],
            ft: [topX(bTopFront, bTop, ROOF_DRIP, cantX(bz, style) + 0.01), bTop, bTopFront],
          },
          0.05,
        ),
        "b",
      ),
    );
    const { rearPillar, held, sail, squared, share } = rearPostCorners(style, source);
    const post = () => (source === "cage" ? boxFromCorners(sign, rearPillar, 0.05) : sail ? cPillarSail(sign, style, rearPillar) : roundedPillarFromCorners(sign, held, 0.05, true));
    parts.push(share ? postPiece(sign, style, held, share, "body") : pillar(post(), "rear"));
    if (squared) {
      const cabBack = pillar(cabBackPanel(sign, held.rb, held.rt, 0.05, style.rearGlass), "rear");
      cabBack.name = "cabBack";
      parts.push(cabBack);
    }
    const rearFoot = source === "drawn" && !sail ? style.pillars?.rearFoot : undefined;
    if (rearFoot) parts.push(rearFootPlate(sign, held.rb, rearPillar.fb, [rearFoot[0], rearFoot[1], rearPillar.rb[2]]));
    if (sail?.tip) parts.push(cPillarTip(sign, style, sail.tip));
    if (m !== null) {
      const topZ = divider.z?.[1] ?? m;
      const { belt: [dRear, dFront], top: [dTopRear, dTopFront] } = pillarBands(divider, m);
      const mTop = cantY(topZ, style) + PILLAR_TOP_RISE;
      parts.push(
        pillar(
          pillarFromCorners(
            sign,
            {
              fb: [beltXAt(dFront) + 0.012, belt(dFront) - 0.02, dFront],
              rb: [beltXAt(dRear) + 0.012, belt(dRear) - 0.02, dRear],
              rt: [topX(dTopRear, mTop, 0.012, cantX(topZ, style) + 0.012), mTop, dTopRear],
              ft: [topX(dTopFront, mTop, 0.012, cantX(topZ, style) + 0.012), mTop, dTopFront],
            },
            0.04,
          ),
          "divider",
        ),
      );
    }
    if (aPost?.sail) parts.push(pillar(roundedPillarAlong(sign, aPost.sail, SAIL_THICK), "sail"));
    const bar = source === "drawn" ? style.pillars?.glassBar : undefined;
    if (bar) parts.push(Object.assign(pillar(glassBar(sign, style, bar), "divider"), { name: "glassBar" }));
    // The belt rail runs from the C-pillar to the B-pillar along the sill: the cage's box pitched straight between its ends, the drawn seal along the quarter glass's sill.
    if (source === "drawn") {
      parts.push(drawnBeltRail(sign, style), ...glassTopFill(sign, style, aTopZ));
      continue;
    }
    const [railRear, railFront] = [belt(q.zRearBot), belt(bp.front)];
    const [railRearX, railFrontX] = [beltXAt(q.zRearBot), beltXAt(bp.front)];
    const railRun = bp.front - q.zRearBot;
    const railPlan = railFrontX === railRearX ? railRun : hypot2(railRun, railFrontX - railRearX);
    const rail = makeBox(0.03, 0.03, hypot2(railPlan, railFront - railRear), 0, 0, 0).rotateX(-detAtan2(railFront - railRear, railPlan));
    if (railFrontX !== railRearX) rail.rotateY(sign * detAtan2(railFrontX - railRearX, railRun));
    parts.push(rail.translate(sign * ((railRearX + railFrontX) / 2 + 0.015), (railRear + railFront) / 2 + 0.005, q.zRearBot + railRun * 0.5));
    rail.name = BELT_RAIL;
  }
  // The cage keeps its header boxes until the rig derives the cabin cage; the drawn roof covers both glass tops, so it draws none.
  if (source === "cage") {
    parts.push(makeBox(ws.wTop + 0.1, 2 * HEADER_HALF_HEIGHT, HEADER_DEPTH, 0, wsY + 0.03, wsZ - 0.02));
    parts.push(makeBox(rg.wTop + 0.12, 2 * HEADER_HALF_HEIGHT, HEADER_DEPTH, 0, rg.top[0] + 0.04, rg.top[1] - 0.02));
  }
  return parts;
}
