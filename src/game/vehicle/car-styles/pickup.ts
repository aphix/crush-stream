import type { BodyStyle } from "../car-variants.ts";
import { BOOT_SENSOR, CABIN_TUB, FRONT_CLIP, HEAD_LAMP, PLATFORM_HARDPOINTS, PLATFORM_WHEEL, st } from "./platform.ts";

/** Single cab + open bed; the trunk part is the tailgate. */
export const PICKUP: BodyStyle = {
  id: "pickup",
  dims: { wheelbase: 2.68, overhang: { front: 0.81, rear: 0.81 }, track: 1.48, width: 1.801, height: 1.365, rideHeight: 0.145, wheel: PLATFORM_WHEEL },
  ...PLATFORM_HARDPOINTS,
  profile: [
    st(-2.11, 0.86, 0.92),
    st(-1.58, 0.885, 0.92),
    st(-0.9, 0.89, 0.92),
    st(-0.68, 0.89, 0.835, 1.25, 0.6, 1),
    st(-0.18, 0.89, 0.82, 1.34, 0.62, 1),
    st(0.42, 0.88, 0.81, 1.3, 0.6, 1),
    ...FRONT_CLIP,
  ],
  roofZ: [-0.7, 0.58],
  windshieldTop: [1.26, 0.49],
  rearGlass: { base: [0.91, -0.71], top: [1.24, -0.67], wBase: 1.3, wTop: 1.1 },
  quarter: { zRearBot: -0.56, zRearTop: -0.54 },
  midPillarZ: null,
  rearBulkhead: { z: -0.735, yTop: 0.91 },
  tubs: [CABIN_TUB, [-2.05, -0.8, 0.52]],
  rearDoorSeam: null,
  boot: { kind: "tailgate", y0: 0.44, origin: [0.915, -2.12], pivot: [0.44, -2.12] },
  lamps: { head: HEAD_LAMP, tail: [0.79, 0.72] },
  rig: {
    cages: {
      roof: { min: [-0.58, 1.02, -0.72], max: [0.58, 1.36, 0.56] },
      glassRear: { min: [-0.66, 0.84, -0.8], max: [0.66, 1.3, -0.6] },
      boot: { min: [-0.78, 0.38, -2.18], max: [0.78, 0.96, -1.8] },
    },
    sensors: { [BOOT_SENSOR]: [0, 0.7, -1.98] },
  },
};
