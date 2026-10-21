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

/** Floor pan height at `z`: the style's underside stations, or flat at the ride height. */
export function floorY(z: number, style: BodyStyle): number {
  return style.underside ? piecewise(style.underside, z) : style.dims.rideHeight;
}

/** The body side's lowest line at `z`: the rocker rides up with the floor pan. */
export function rockerAt(z: number, style: BodyStyle): number {
  return style.rocker.y + (floorY(z, style) - style.dims.rideHeight);
}
