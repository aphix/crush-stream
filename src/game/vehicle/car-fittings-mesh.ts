import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { markSkinDynamic } from "../deform/fast-normals.ts";
import type { BodyStyle } from "./car-variants.ts";
import { FITTING_ATTRIBUTE, FITTING_TONE, PRIMER_ATTRIBUTE } from "./constants.ts";
import { splitCreases } from "./car-crease.ts";
import { CREASE_DEGREES, deckTopY, ensureOutwardNormals, lerp, loftFromRings, roofTopY, type Pt } from "./car-mesh.ts";

/**
 * A style's drawn add-ons: never in a cage build, so the sim never sees them. Each is merged into the mesh it stands on and moves with
 * it: the hood bulge with the bonnet's skin, the roof parts with the body's, the exhaust tips and hitch with the rear bumper when it tears.
 */

type HoodBulge = NonNullable<BodyStyle["hood"]["bulge"]>;
type HoodScoop = NonNullable<HoodBulge["scoop"]>;
type RoofParts = NonNullable<BodyStyle["roof"]>;

/** An add-on's foot sinks this far (m) under the skin it stands on, so no seam opens where that skin domes. */
const SINK = 0.005;
/** Rings along a hood bulge; its ends ease in over `BULGE_RAMP` (m); its flanks lean in `BULGE_FLANK` (m) from foot to top. */
const BULGE_STATIONS = 16;
const BULGE_RAMP = 0.15;
const BULGE_FLANK = 0.05;
/** A scoop rises over `SCOOP_LENGTH` (m) behind its mouth in `SCOOP_STATIONS` rings; a twin scoop's inlets stand `SCOOP_RIB` (m) apart. */
const SCOOP_LENGTH = 0.32;
const SCOOP_STATIONS = 4;
const SCOOP_RIB = 0.04;
/** Rings along a roof rail, its ends easing into the roof over `RAIL_RAMP` (m). */
const RAIL_STATIONS = 12;
const RAIL_RAMP = 0.08;
/** Rings along the roof's glass panel, standing `PANEL_PROUD` (m) off the roof skin so it never fights it for depth. */
const PANEL_STATIONS = 8;
const PANEL_PROUD = 0.004;
/** The spoiler's top at its tip stands this share of its height over its underside. */
const SPOILER_TIP = 0.35;
/** Exhaust tip: tube `length` (m), its end `recess` (m) inside the bumper's rearmost face (tips sit in the lower band; nothing stands past the tail), a dark throat `throat` of its size standing `throatProud` (m) off its end. */
const TIP = { length: 0.14, recess: 0.004, throat: 0.72, throatProud: 0.002, segments: 14 } as const;
/** Tow-hitch receiver: `size` (m) square, `length` long, reaching `reach` (m) past the bumper face, its top `tuck` (m) up into the bumper. */
const HITCH = { size: 0.06, length: 0.3, reach: 0.09, tuck: 0.01 } as const;

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

/** Height (car frame, m) of a bulge's top at `z`: its rise eased in at both ends from just under the lid. */
function bulgeTopY(b: HoodBulge, z: number, style: BodyStyle): number {
  const ease = THREE.MathUtils.smoothstep(Math.min(z - b.z0, b.z1 - z), 0, BULGE_RAMP);
  return deckTopY(0, z, style, true) - SINK + (b.rise + SINK) * ease;
}

function bulgeGeometry(b: HoodBulge, style: BodyStyle): THREE.BufferGeometry {
  const [oy, oz] = style.hood.origin;
  const half = b.width / 2;
  const rings: Pt[][] = [];
  const zs: number[] = [];
  for (let s = 0; s <= BULGE_STATIONS; s++) {
    const z = lerp(b.z0, b.z1, s / BULGE_STATIONS);
    const top = bulgeTopY(b, z, style) - oy;
    const foot = deckTopY(half, z, style, true) - SINK - oy;
    rings.push([
      { x: -half, y: foot },
      { x: BULGE_FLANK - half, y: top },
      { x: half - BULGE_FLANK, y: top },
      { x: half, y: foot },
    ]);
    zs.push(z - oz);
  }
  return withTone(hardEdged(loftFromRings(rings, zs, 0, 1)), PRIMER_ATTRIBUTE, 0);
}

/** One wedge per inlet rising off the bulge to its mouth at `scoop.z`; the mouth (the loft's front cap, its last ring + 1 vertices) is primer-dark. */
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
    inlets.push(hardEdged(withTone(loft, PRIMER_ATTRIBUTE, 1, count - rings[0]!.length - 1)));
  }
  return inlets;
}

/** `hood` (the drawn lid, `makeHoodGeometry`) with `style.hood.bulge` and its scoop merged in, so the bonnet's skin crushes them with it. Without a bulge, `hood` itself. */
export function withHoodBulge(hood: THREE.BufferGeometry, style: BodyStyle): THREE.BufferGeometry {
  const b = style.hood.bulge;
  if (!b) return hood;
  const parts = [withTone(hood, PRIMER_ATTRIBUTE, 0), bulgeGeometry(b, style)];
  if (b.scoop) parts.push(...scoopGeometries(b, b.scoop, style));
  return markSkinDynamic(merged(parts, "hood bulge"));
}

/** `bumper` (the drawn rear bumper, `makeBumperGeometry`, in bumper space) with `style`'s exhaust tips and tow hitch merged in, so they tear off with it. Without either, `bumper` itself. */
export function withRearFittings(bumper: THREE.BufferGeometry, style: BodyStyle): THREE.BufferGeometry {
  const { exhaust } = style;
  const { seat, hitch } = style.bumpers.rear;
  if (!exhaust && !hitch) return bumper;
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
    const top = roofTopY(inner, z, style) - SINK + (rail.rise + SINK) * ease;
    rings.push([
      { x: side * inner, y: roofTopY(inner, z, style) - SINK },
      { x: side * inner, y: top },
      { x: side * outer, y: top },
      { x: side * outer, y: roofTopY(outer, z, style) - SINK },
    ]);
    zs.push(z);
  }
  return hardEdged(loftFromRings(rings, zs, 0, 1));
}

/** A thin panel following the roof's dome, `panel.width` across. */
function glassPanelGeometry(panel: NonNullable<RoofParts["glassPanel"]>, style: BodyStyle): THREE.BufferGeometry {
  const half = panel.width / 2;
  const xs = [-half, -half / 2, 0, half / 2, half];
  const rings: Pt[][] = [];
  const zs: number[] = [];
  for (let s = 0; s <= PANEL_STATIONS; s++) {
    const z = lerp(panel.z[0], panel.z[1], s / PANEL_STATIONS);
    const top = xs.map((x) => ({ x, y: roofTopY(x, z, style) + PANEL_PROUD }));
    const under = [...xs].reverse().map((x) => ({ x, y: roofTopY(x, z, style) - SINK }));
    rings.push([...top, ...under]);
    zs.push(z);
  }
  return hardEdged(loftFromRings(rings, zs, 0, 1));
}

/** A wedge off the roof's rear end: flat underside, its top falling from the front edge to the tip. */
function spoilerGeometry(spoiler: NonNullable<RoofParts["spoiler"]>): THREE.BufferGeometry {
  const [under, top] = spoiler.y;
  const hw = spoiler.halfWidth;
  const ring = (y: number): Pt[] => [
    { x: -hw, y: under },
    { x: -hw, y },
    { x: hw, y },
    { x: hw, y: under },
  ];
  return hardEdged(loftFromRings([ring(lerp(under, top, SPOILER_TIP)), ring(top)], [...spoiler.z], 0, 1));
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
