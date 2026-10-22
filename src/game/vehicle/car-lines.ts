import { hypot2 } from "../kernel/physics-core.js";
import type { BodySource } from "./car-mesh.ts";
import type { BodyStyle, GlassBow, PillarSpan } from "./car-variants.ts";

/** A windshield's plan bow where its style sets none: 2 cm forward at the centre, base to top. */
export const WINDSHIELD_BOW: GlassBow = { base: 0.02, top: 0.02 };
/** A rear glass's plan bow where its style sets none: 1.5 cm back at the centre, base to top. */
export const REAR_GLASS_BOW: GlassBow = { base: -0.015, top: -0.015 };

/** Height at `z` along [z, y] stations in ascending z: linear between them, held past the ends. */
function piecewise(stations: readonly (readonly [number, number])[], z: number): number {
  const ys = stations;
  if (z <= ys[0]![0]) return ys[0]![1];
  for (let i = 1; i < ys.length; i++) {
    const [z1, y1] = ys[i]!;
    if (z > z1) continue;
    const [z0, y0] = ys[i - 1]!;
    return y0 + (y1 - y0) * ((z - z0) / (z1 - z0));
  }
  return ys[ys.length - 1]![1];
}

/** Side glass sill height at `z`: linear between the style's belt stations, held past the end ones. */
export function beltY(z: number, style: BodyStyle): number {
  return piecewise(style.belt.y, z);
}

/** Side glass sill half-width at `z`: the style's one belt x, or its [z, x] stations (linear, held past the end ones). */
export function beltX(z: number, style: BodyStyle): number {
  const x = style.belt.x;
  return typeof x === "number" ? x : piecewise(x, z);
}

/** Floor pan height at `z`: the style's underside stations, or flat at the ride height. */
export function floorY(z: number, style: BodyStyle): number {
  return style.underside ? piecewise(style.underside, z) : style.dims.rideHeight;
}

/** The body side's lowest line at `z`: the rocker rides up with the floor pan. */
export function rockerAt(z: number, style: BodyStyle): number {
  return style.rocker.y + (floorY(z, style) - style.dims.rideHeight);
}

/** A tub's rim width (m) unless the style sets its own: its foot's inset. */
const TUB_WALL = 0.06;

/** How far (m) a tub's side wall's top edge stands in from the body side: the style's `tubWall`, else `TUB_WALL`. */
export function tubWall(style: BodyStyle): number {
  return style.tubWall ?? TUB_WALL;
}

/** The side glass top's drop under the roof (m) unless the style sets its own: today's cant lip. */
const GLASS_DROP = 0.075;
/** The A-pillar's rear top corner stands this far (m) behind the windshield's top unless the style seats it. */
const A_PILLAR_TOP_BACK = 0.05;

/** How far under the roof (m) its cant line runs: the side lip's bottom, where the pillars end. */
export function cantDrop(style: BodyStyle): number {
  return typeof style.glassTop === "number" ? style.glassTop : GLASS_DROP;
}

/** The drawn roof's side runs this far (m) past the cant line unless the style sets its own `roofDrip`; the pillars and the sail's foot stand this far proud of the side glass, meeting that drip flush. */
export const ROOF_DRIP = 0.01;

/** How far (m) the drawn roof's side rolls out past the cant line at its bottom: the style's `roofDrip`, else `ROOF_DRIP`. */
export function roofDrip(style: BodyStyle): number {
  return style.roofDrip ?? ROOF_DRIP;
}

/** The side glass top's own height at `z` from the style's stations, or null where it follows the cant line. */
export function glassTopStation(z: number, style: BodyStyle): number | null {
  const g = style.glassTop;
  return g === undefined || typeof g === "number" ? null : piecewise(g, z);
}

/** Where the A-pillar's rear edge meets the cant line (z): the door glass's top-front corner. */
export function aPillarTopZ(style: BodyStyle): number {
  return style.aPillarTop ?? style.windshieldTop[1] - A_PILLAR_TOP_BACK;
}

/** The drawn A-post is this wide (m) in side view behind the windshield's edge line, so it never thins to a sliver. */
const A_POST_WIDTH = 0.06;
/** A door glass kneed onto the A-post runs this far (m) in under the post's rear edge. */
const KNEE_TUCK = 0.01;

/** How far (z, m) a pane bulging `amount` at mid-height stands forward of its straight edge `t` (0 base, 1 top) up it; none outside. */
export function sideBowZ(amount: number, t: number): number {
  return t <= 0 || t >= 1 ? 0 : amount * 4 * t * (1 - t);
}

/** The drawn A-post's rear edge at height `y` (z, m): `pillars.a` (else `A_POST_WIDTH`) behind the windshield's edge line in side view. */
export function aPostRearZ(y: number, style: BodyStyle): number {
  const { base } = style.windshield;
  const [topY, topZ] = style.windshieldTop;
  const [dz, dy] = [topZ - base[1], topY - base[0]];
  return base[1] + (dz * (y - base[0]) - (style.pillars?.a ?? A_POST_WIDTH) * hypot2(dz, dy)) / dy + sideBowZ(style.windshield.sideBow ?? 0, (y - base[0]) / dy);
}

/**
 * The door glass's front edge at height `y` (z, m), its foot at `footY` on the belt and its top at `topY` (held over it): straight from
 * `aPillarFoot` to `aPillarTopZ`, or kneed at `aPillarKnee` onto the A-post's rear edge (`KNEE_TUCK` under it), the sail's black triangle
 * under the knee.
 */
export function doorGlassFrontZ(y: number, footY: number, topY: number, style: BodyStyle): number {
  const [foot, top, knee] = [style.aPillarFoot, aPillarTopZ(style), style.aPillarKnee];
  if (knee === undefined) return foot + (top - foot) * Math.min((y - footY) / (topY - footY), 1);
  const kneeZ = aPostRearZ(knee, style) + KNEE_TUCK;
  return y <= knee ? foot + (kneeZ - foot) * ((y - footY) / (knee - footY)) : kneeZ + (top - kneeZ) * Math.min((y - knee) / (topY - knee), 1);
}

/** A drawn pillar's z bands [rear, front] at the belt and at the top. */
type PillarBands = { belt: readonly [number, number]; top: readonly [number, number] };

/** `span`'s bands about its centre line, upright at `mid` unless it leans. */
export function pillarBands(span: PillarSpan, mid: number): PillarBands {
  const [beltZ, topZ] = span.z ?? [mid, mid];
  const [beltWidth, topWidth] = span.width;
  return { belt: [beltZ - beltWidth / 2, beltZ + beltWidth / 2], top: [topZ - topWidth / 2, topZ + topWidth / 2] };
}

/** A B-pillar the style doesn't size narrows this far (m) on each edge from the belt to its top. */
const B_TOP_NARROW = 0.015;

/** The B-pillar's bands: the drawn one's from the style's `pillars.b` (about the `bPillar` band's middle) when it sets them, else the `bPillar` band, its top `B_TOP_NARROW` in on each edge. */
export function bPillarBand(style: BodyStyle, source: BodySource = "drawn"): PillarBands {
  const { rear, front } = style.bPillar;
  const b = source === "drawn" ? style.pillars?.b : undefined;
  return b === undefined ? { belt: [rear, front], top: [rear + B_TOP_NARROW, front - B_TOP_NARROW] } : pillarBands(b, (rear + front) / 2);
}
