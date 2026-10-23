import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { detSin } from "../kernel/physics-core.js";
import { markSkinDynamic } from "../deform/fast-normals.ts";
import type { BodyStyle } from "./car-variants.ts";
import { FITTING_ATTRIBUTE, FITTING_TONE, PRIMER_ATTRIBUTE, WELL_PANEL } from "./constants.ts";
import { splitCreases } from "./car-crease.ts";
import { CREASE_DEGREES, deckTopY, ensureOutwardNormals, lerp, loftFromRings, makeBumperGeometry, type Pt } from "./car-mesh.ts";
import { drawnRoofTopY } from "./car-roof-end.ts";

/**
 * A style's drawn add-ons: never in a cage build, so the sim never sees them. Each is merged into the mesh it stands on and moves with
 * it: the hood bulge with the bonnet's skin, the roof parts with the body's, the exhaust tips and hitch with the rear bumper when it tears.
 */

type HoodBulge = NonNullable<BodyStyle["hood"]["bulge"]>;
type HoodScoop = NonNullable<HoodBulge["scoop"]>;
type RoofParts = NonNullable<BodyStyle["roof"]>;

/** An add-on's foot sinks this far (m) under the skin it stands on, so no seam opens where that skin domes. */
const SINK = 0.005;
/** Rings along a hood bulge; its ends ease in over `BULGE_RAMP` (m); its flanks lean in `BULGE_FLANK` (m) from foot to top unless it is rolled (`round`). */
const BULGE_STATIONS = 16;
const BULGE_RAMP = 0.15;
/** Each ramp (the cowl end's, and the nose end's unless it is a `mouth`) takes this many ring intervals: the flank's slope rises 30° over it, so six keep each ring's turn under 9° (two intervals twisted its cells 14-17°, four 11°). */
const BULGE_RAMP_RINGS = 6;
const BULGE_FLANK = 0.05;
/** Chords per flank of a rolled bulge (`round`): the fewest whose turns stay under the fitting crease angle, so it shades round. */
const POD_STEPS = 2;
/** A scoop rises over `SCOOP_LENGTH` (m) behind its mouth in `SCOOP_STATIONS` rings; a twin scoop's inlets stand `SCOOP_RIB` (m) apart, a razor groove so the pair reads as one raised piece. */
const SCOOP_LENGTH = 0.32;
const SCOOP_STATIONS = 4;
const SCOOP_RIB = 0.006;
/** Rings along a roof rail, its ends easing into the roof over `RAIL_RAMP` (m). */
const RAIL_STATIONS = 12;
const RAIL_RAMP = 0.08;
/** Rings along the roof's glass panel, standing `PANEL_PROUD` (m) off the roof skin so it never fights it for depth. */
const PANEL_STATIONS = 8;
const PANEL_PROUD = 0.004;
/** The spoiler's top at its tip stands this share of its height over its underside. */
const SPOILER_TIP = 0.35;
/** A rounded spoiler tip's corner turns in this many chords: four turn the quarter 22.5° each, under the fitting crease so the corner shades round. */
const SPOILER_ROUND_RINGS = 4;
/** A crowned spoiler top's points across, as shares of its half-run: four chords carry the parabola, each turning under the fitting crease. */
const SPOILER_CROWN_SHARES = [-1, -0.5, 0, 0.5, 1] as const;
/** Exhaust tip: tube `length` (m), its end `recess` (m) inside the bumper's rearmost face (tips sit in the lower band; nothing stands past the tail), a dark throat `throat` of its size standing `throatProud` (m) off its end. */
const TIP = { length: 0.14, recess: 0.004, throat: 0.72, throatProud: 0.002, segments: 14 } as const;
/** Tow-hitch receiver: `size` (m) square, `length` long, reaching `reach` (m) past the bumper face, its top `tuck` (m) up into the bumper. */
const HITCH = { size: 0.06, length: 0.3, reach: 0.09, tuck: 0.01 } as const;
/** A fascia band's inlay stands this far (m) out of the face: just proud so it never z-fights it, thin enough to read as paint. */
const BAND_PROUD = 0.0015;
/** Slack (m) when matching fascia rows to a band's heights: rows are authored on the band's edges. */
const BAND_EPS = 1e-6;

/** `geo` with a per-vertex `name` attribute: `value` from vertex `from` on, 0 before it. */
function withTone(geo: THREE.BufferGeometry, name: string, value: number, from = 0): THREE.BufferGeometry {
  const tone = new Float32Array(geo.getAttribute("position").count);
  tone.fill(value, from);
  geo.setAttribute(name, new THREE.BufferAttribute(tone, 1));
  return geo;
}

/** An add-on's loft, faced outward with hard edges. */
function hardEdged(geo: THREE.BufferGeometry): THREE.BufferGeometry {
  ensureOutwardNormals(geo);
  return splitCreases(geo, CREASE_DEGREES.fitting);
}

function merged(parts: THREE.BufferGeometry[], what: string): THREE.BufferGeometry {
  const geo = mergeGeometries(parts, false);
  for (const g of parts) g.dispose();
  if (!geo) throw new Error(`Failed to merge the ${what}`);
  geo.computeBoundingBox();
  return geo;
}

/** Height (car frame, m) of a bulge's top at `z`: its rise eased in at both ends from just under the lid, at the cowl end over `cowlRamp`; a `mouth` nose stands at full rise. */
function bulgeTopY(b: HoodBulge, z: number, style: BodyStyle): number {
  const nose = b.mouth ? 1 : THREE.MathUtils.smoothstep(b.z1 - z, 0, BULGE_RAMP);
  const ease = Math.min(THREE.MathUtils.smoothstep(z - b.z0, 0, b.cowlRamp ?? BULGE_RAMP), nose);
  return deckTopY(0, z, style, true) - SINK + (b.rise + SINK) * ease;
}

/** A rolled bulge's ring, in the wedge's order: the left foot, up an S-curve over `round` to the crest, across, and down the right flank to its foot. */
function podRing(half: number, round: number, foot: number, top: number): Pt[] {
  const left: Pt[] = [];
  for (let k = 0; k <= POD_STEPS; k++) {
    const t = k / POD_STEPS;
    left.push({ x: -(half - round * t), y: lerp(foot, top, THREE.MathUtils.smoothstep(t, 0, 1)) });
  }
  const right: Pt[] = [];
  for (let k = left.length - 1; k >= 0; k--) right.push({ x: -left[k]!.x, y: left[k]!.y });
  return [...left, ...right];
}

/** A ramp station this close (m) to an even one is that one: no sliver of a gap. */
const BULGE_STATION_MERGE = 0.004;

/** The z of a bulge's rings: `BULGE_STATIONS` even ones, plus each ramp (the cowl end's, the nose end's unless it is a `mouth`) split in `BULGE_RAMP_RINGS`. */
function bulgeStations(b: HoodBulge): number[] {
  const zs = Array.from({ length: BULGE_STATIONS + 1 }, (_, s) => lerp(b.z0, b.z1, s / BULGE_STATIONS));
  const ramps = [{ from: b.z0, run: b.cowlRamp ?? BULGE_RAMP }, ...(b.mouth ? [] : [{ from: b.z1 - BULGE_RAMP, run: BULGE_RAMP }])];
  for (const { from, run } of ramps) {
    for (let k = 1; k < BULGE_RAMP_RINGS; k++) {
      const z = from + (run * k) / BULGE_RAMP_RINGS;
      if (zs.every((other) => Math.abs(other - z) > BULGE_STATION_MERGE)) zs.push(z);
    }
  }
  return zs.sort((a, c) => a - c);
}

function bulgeGeometry(b: HoodBulge, style: BodyStyle): THREE.BufferGeometry {
  const [oy, oz] = style.hood.origin;
  const [rearHalf, frontHalf] = [(b.cowlWidth ?? b.width) / 2, b.width / 2];
  const rings: Pt[][] = [];
  const zs: number[] = [];
  for (const z of bulgeStations(b)) {
    const half = lerp(rearHalf, frontHalf, (z - b.z0) / (b.z1 - b.z0));
    const top = bulgeTopY(b, z, style) - oy;
    const foot = deckTopY(half, z, style, true) - SINK - oy;
    const ring = b.round
      ? podRing(half, b.round, foot, top)
      : [
          { x: -half, y: foot },
          { x: BULGE_FLANK - half, y: top },
          { x: half - BULGE_FLANK, y: top },
          { x: half, y: foot },
        ];
    if (b.groove) ring.splice(ring.length / 2, 0, { x: -SCOOP_RIB / 2, y: top }, { x: 0, y: top - b.groove }, { x: SCOOP_RIB / 2, y: top });
    rings.push(ring);
    zs.push(z - oz);
  }
  return withTone(hardEdged(loftFromRings(rings, zs, 0, 1)), PRIMER_ATTRIBUTE, 0);
}

/** One wedge per inlet rising off the bulge to its mouth at `scoop.z`; the mouth (the loft's front cap, its last ring + 1 vertices) is a near-black opening (`WELL_PANEL`). */
function scoopGeometries(b: HoodBulge, scoop: HoodScoop, style: BodyStyle): THREE.BufferGeometry[] {
  const [oy, oz] = style.hood.origin;
  const twin = scoop.inlets === 2;
  const half = twin ? (scoop.width - SCOOP_RIB) / 4 : scoop.width / 2;
  const inlets: THREE.BufferGeometry[] = [];
  for (const side of twin ? [-1, 1] : [0]) {
    const cx = side * (half + SCOOP_RIB / 2);
    const rings: Pt[][] = [];
    const zs: number[] = [];
    for (let s = 0; s <= SCOOP_STATIONS; s++) {
      const t = s / SCOOP_STATIONS;
      const z = lerp(scoop.z - SCOOP_LENGTH, scoop.z, t);
      const base = bulgeTopY(b, z, style) - SINK - oy;
      const top = base + SINK + scoop.height * t;
      rings.push([
        { x: cx - half, y: base },
        { x: cx - half, y: top },
        { x: cx + half, y: top },
        { x: cx + half, y: base },
      ]);
      zs.push(z - oz);
    }
    const loft = loftFromRings(rings, zs, 0, 1);
    const count = loft.getAttribute("position").count;
    inlets.push(hardEdged(withTone(loft, PRIMER_ATTRIBUTE, WELL_PANEL, count - rings[0]!.length - 1)));
  }
  return inlets;
}

/** `hood` (the drawn lid, `makeHoodGeometry`) with `style.hood.bulge` and its scoop merged in, so the bonnet's skin crushes them with it. Without a bulge, `hood` itself. */
export function withHoodBulge(hood: THREE.BufferGeometry, style: BodyStyle): THREE.BufferGeometry {
  const b = style.hood.bulge;
  if (!b) return hood;
  // The lid keeps its own tones (its underside is an unpainted inner panel); only a lid built without them is painted through.
  const parts = [hood.hasAttribute(PRIMER_ATTRIBUTE) ? hood : withTone(hood, PRIMER_ATTRIBUTE, 0), bulgeGeometry(b, style)];
  if (b.scoop) parts.push(...scoopGeometries(b, b.scoop, style));
  return markSkinDynamic(merged(parts, "hood bulge"));
}

/** The black inlay just proud of `front`'s bumper face over its fascia rows within `band` (a diffuser band, a truck's valance), in bumper space. */
function bandInlay(front: boolean, style: BodyStyle, band: readonly [number, number]): THREE.BufferGeometry {
  const { seat, fascia, bandHalfWidth } = front ? style.bumpers.front : style.bumpers.rear;
  const rows = fascia.flatMap(([y], i) => (seat.y + y >= band[0] - BAND_EPS && seat.y + y <= band[1] + BAND_EPS ? [i] : []));
  if (rows.length < 2) throw new Error(`${style.id}: ${front ? "front" : "rear"} bumper band [${band[0]}, ${band[1]}] covers fewer than 2 fascia rows`);
  return withTone(makeBumperGeometry(front, style, [rows[0]!, rows[rows.length - 1]!], BAND_PROUD, bandHalfWidth), FITTING_ATTRIBUTE, FITTING_TONE.black);
}

/** `bumper` (the drawn front bumper, in bumper space) with its `band` inlay merged in; without one, `bumper` itself. */
export function withFrontBand(bumper: THREE.BufferGeometry, style: BodyStyle): THREE.BufferGeometry {
  const { band } = style.bumpers.front;
  return band ? merged([withTone(bumper, FITTING_ATTRIBUTE, 0), bandInlay(true, style, band)], "front bumper band") : bumper;
}

/** `bumper` (the drawn rear bumper, `makeBumperGeometry`, in bumper space) with `style`'s exhaust tips, tow hitch and diffuser band (a black inlay over its fascia rows) merged in, so they tear off with it. Without any, `bumper` itself. */
export function withRearFittings(bumper: THREE.BufferGeometry, style: BodyStyle): THREE.BufferGeometry {
  const { exhaust } = style;
  const { seat, hitch, band } = style.bumpers.rear;
  if (!exhaust && !hitch && !band) return bumper;
  bumper.computeBoundingBox();
  const { min } = bumper.boundingBox!;
  const parts = [withTone(bumper, FITTING_ATTRIBUTE, 0)];
  if (exhaust) {
    const [w, h] = exhaust.size;
    const round = exhaust.shape === "round";
    // A tip in the bumper ends at its face behind it (a wrapped corner sits centimetres forward of the rearmost point); one hung under
    // the bumper, in the diffuser, ends level with the rearmost point.
    const face = new THREE.Mesh(bumper, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
    const ray = new THREE.Raycaster();
    for (const x of exhaust.tips === 2 ? [-exhaust.x, exhaust.x] : [exhaust.x]) {
      const y = exhaust.y - seat.y;
      ray.set(new THREE.Vector3(x, y, min.z - 1), new THREE.Vector3(0, 0, 1));
      const hit = ray.intersectObject(face, false)[0];
      const end = (hit ? hit.point.z : min.z) + TIP.recess;
      const tube = round ? new THREE.CylinderGeometry(0.5, 0.5, TIP.length, TIP.segments).rotateX(Math.PI / 2).scale(w, h, 1) : new THREE.BoxGeometry(w, h, TIP.length);
      const throat = (round ? new THREE.CircleGeometry(0.5, TIP.segments) : new THREE.PlaneGeometry(1, 1)).scale(w * TIP.throat, h * TIP.throat, 1).rotateY(Math.PI);
      parts.push(withTone(tube.translate(x, y, end + TIP.length / 2), FITTING_ATTRIBUTE, FITTING_TONE.chrome));
      parts.push(withTone(throat.translate(x, y, end - TIP.throatProud), FITTING_ATTRIBUTE, FITTING_TONE.black));
    }
  }
  if (hitch) {
    const receiver = new THREE.BoxGeometry(HITCH.size, HITCH.size, HITCH.length).translate(0, min.y + HITCH.tuck - HITCH.size / 2, min.z - HITCH.reach + HITCH.length / 2);
    parts.push(withTone(receiver, FITTING_ATTRIBUTE, FITTING_TONE.black));
  }
  if (band) parts.push(bandInlay(false, style, band));
  return merged(parts, "rear bumper fittings");
}

/** A rail on the roof at |x| `rail.x`, its top `rail.rise` over the roof at its inner edge, easing into the roof at both ends. */
function railGeometry(rail: NonNullable<RoofParts["rails"]>, side: number, style: BodyStyle): THREE.BufferGeometry {
  const [inner, outer] = rail.x;
  const [rear, front] = rail.z;
  const rings: Pt[][] = [];
  const zs: number[] = [];
  for (let s = 0; s <= RAIL_STATIONS; s++) {
    const z = lerp(rear, front, s / RAIL_STATIONS);
    const ease = THREE.MathUtils.smoothstep(Math.min(z - rear, front - z), 0, RAIL_RAMP);
    const top = drawnRoofTopY(inner, z, style) - SINK + (rail.rise + SINK) * ease;
    rings.push([
      { x: side * inner, y: drawnRoofTopY(inner, z, style) - SINK },
      { x: side * inner, y: top },
      { x: side * outer, y: top },
      { x: side * outer, y: drawnRoofTopY(outer, z, style) - SINK },
    ]);
    zs.push(z);
  }
  return hardEdged(loftFromRings(rings, zs, 0, 1));
}

/** A thin panel following the roof's dome, `panel.width` across; its underside, sunk in the crowned roof, one chord edge to edge. */
function glassPanelGeometry(panel: NonNullable<RoofParts["glassPanel"]>, style: BodyStyle): THREE.BufferGeometry {
  const half = panel.width / 2;
  const xs = [-half, -half / 2, 0, half / 2, half];
  const rings: Pt[][] = [];
  const zs: number[] = [];
  for (let s = 0; s <= PANEL_STATIONS; s++) {
    const z = lerp(panel.z[0], panel.z[1], s / PANEL_STATIONS);
    const top = xs.map((x) => ({ x, y: drawnRoofTopY(x, z, style) + PANEL_PROUD }));
    const under = [half, -half].map((x) => ({ x, y: drawnRoofTopY(x, z, style) - SINK }));
    rings.push([...top, ...under]);
    zs.push(z);
  }
  return hardEdged(loftFromRings(rings, zs, 0, 1));
}

/** `geo` (a spoiler's loft) with its front edge bowed back in plan by `spoiler.bow` at its middle, a parabola across its half-width, easing to none at the tip. */
function bowSpoilerFront(geo: THREE.BufferGeometry, spoiler: NonNullable<RoofParts["spoiler"]>): THREE.BufferGeometry {
  const bow = spoiler.bow ?? 0;
  if (!bow) return geo;
  const [tip, front] = spoiler.z;
  const pos = geo.getAttribute("position");
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i) / spoiler.halfWidth;
    const z = pos.getZ(i);
    pos.setZ(i, z - bow * (1 - x * x) * ((z - tip) / (front - tip)));
  }
  return geo;
}

/**
 * A wedge off the roof's rear end: flat underside, its top falling from the front edge to the tip, its side ends sloped and tapered by `ends`;
 * `round` turns the tip's corners on a quarter ellipse in plan, `crown` bows the top across, `bow` sweeps the front edge back in plan.
 */
function spoilerGeometry(spoiler: NonNullable<RoofParts["spoiler"]>): THREE.BufferGeometry {
  const [under, top] = spoiler.y;
  const [slope, taper] = spoiler.ends ?? [0, 0];
  const hw = spoiler.halfWidth;
  if (!spoiler.round && !spoiler.crown) {
    const ring = (y: number, half: number): Pt[] => [
      { x: -half, y: under },
      { x: -(half - slope), y },
      { x: half - slope, y },
      { x: half, y: under },
    ];
    return hardEdged(bowSpoilerFront(loftFromRings([ring(lerp(under, top, SPOILER_TIP), hw - taper), ring(top, hw)], [...spoiler.z], 0, 1), spoiler));
  }
  const crown = spoiler.crown ?? 0;
  const shares: readonly number[] = crown ? SPOILER_CROWN_SHARES : [-1, 1];
  // `u` runs 0 at the front edge to 1 at the tip.
  const ringAt = (u: number): Pt[] => {
    const half = hw - (spoiler.round ? taper * (1 - Math.sqrt(1 - u * u)) : taper * u);
    const reach = half - slope;
    const topAt = (share: number): number => {
      const front = top - crown * share * share;
      return lerp(front, lerp(under, front, SPOILER_TIP), u);
    };
    return [{ x: -half, y: under }, ...shares.map((share) => ({ x: share * reach, y: topAt(share) })), { x: half, y: under }];
  };
  const us = spoiler.round ? Array.from({ length: SPOILER_ROUND_RINGS + 1 }, (_, k) => detSin((Math.PI / 2) * ((SPOILER_ROUND_RINGS - k) / SPOILER_ROUND_RINGS))) : [1, 0];
  return hardEdged(bowSpoilerFront(loftFromRings(us.map(ringAt), us.map((u) => lerp(spoiler.z[1], spoiler.z[0], u)), 0, 1), spoiler));
}

/** `style.roof`'s rails, glass panel and spoiler as one geometry (car frame) for the drawn body, its first `dark` vertices (rails, panel) drawn primer-dark; null without roof parts. */
export function makeRoofFittings(style: BodyStyle): { geometry: THREE.BufferGeometry; dark: number } | null {
  const roof = style.roof;
  if (!roof) return null;
  const dark: THREE.BufferGeometry[] = [];
  if (roof.rails) for (const side of [-1, 1]) dark.push(railGeometry(roof.rails, side, style));
  if (roof.glassPanel) dark.push(glassPanelGeometry(roof.glassPanel, style));
  let darkCount = 0;
  for (const g of dark) darkCount += g.getAttribute("position").count;
  const paint = roof.spoiler ? [spoilerGeometry(roof.spoiler)] : [];
  return { geometry: merged([...dark, ...paint], "roof fittings"), dark: darkCount };
}
