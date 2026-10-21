import type { BodyStyle } from "./car-variants.ts";

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

/** The side glass top's drop under the roof (m) unless the style sets its own: today's cant lip. */
const GLASS_DROP = 0.075;
/** The A-pillar's rear top corner stands this far (m) behind the windshield's top unless the style seats it. */
const A_PILLAR_TOP_BACK = 0.05;

/** How far under the roof (m) its cant line runs: the side lip's bottom, where the pillars end. */
export function cantDrop(style: BodyStyle): number {
  return typeof style.glassTop === "number" ? style.glassTop : GLASS_DROP;
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
