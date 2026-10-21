import type { BodyStyle } from "../car-variants.ts";
import { FRONT_CLIP, HEAD_LAMP, PLATFORM_HARDPOINTS, PLATFORM_WHEEL, st } from "./platform.ts";

export const HATCHBACK: BodyStyle = {
  id: "hatchback",
  dims: { wheelbase: 2.68, overhang: { front: 0.81, rear: 0.81 }, track: 1.48, width: 1.82, height: 1.385, rideHeight: 0.145, wheel: PLATFORM_WHEEL },
  ...PLATFORM_HARDPOINTS,
  profile: [
    st(-2.11, 0.74, 0.84),
    st(-1.92, 0.83, 0.855),
    st(-1.62, 0.875, 0.845, 1.0, 0.52, 0.3),
    st(-1.36, 0.88, 0.835, 1.29, 0.58, 1),
    st(-0.78, 0.89, 0.82, 1.34, 0.6, 1),
    st(-0.18, 0.89, 0.82, 1.36, 0.62, 1),
    st(0.42, 0.88, 0.81, 1.31, 0.6, 1),
    ...FRONT_CLIP,
  ],
  roofZ: [-1.32, 0.58],
  windshieldTop: [1.27, 0.49],
  rearGlass: { base: [0.87, -1.84], top: [1.27, -1.33], wBase: 1.34, wTop: 1.04 },
  quarter: { zRearBot: -1.36, zRearTop: -1.12 },
  midPillarZ: null,
  rearBulkhead: { z: -0.72, yTop: 0.8 },
  tubs: [[-1.82, 0.7, 0.3]],
  rearDoorSeam: -0.62,
  boot: { kind: "tailgate", y0: 0.46, origin: [0.83, -2.115], pivot: [1.27, -1.33] },
  lamps: { head: HEAD_LAMP, tail: [0.675, 0.645] },
};
