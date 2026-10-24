import { CAR_STYLES, type BodyStyle } from "./car-variants.ts";
import { doorAperture, lerp, sampleSlice } from "./car-mesh.ts";

/** Side-view rest profile — tests lock this so the body cannot become a van blob. */
export function restSideProfile(
  z: number,
  style: BodyStyle = CAR_STYLES.sedan,
): {
  hw: number;
  yBelt: number;
  ySideTop: number;
  yRoof: number;
  cabin: number;
  doorHole: number;
} {
  const s = sampleSlice(z, style.profile);
  const doorHole = doorAperture(z, style);
  return {
    hw: s.hw,
    yBelt: s.yBelt,
    ySideTop: lerp(s.yBelt, 0.22, doorHole),
    yRoof: lerp(s.yBelt, s.yRoof, s.cabin),
    cabin: s.cabin,
    doorHole,
  };
}
