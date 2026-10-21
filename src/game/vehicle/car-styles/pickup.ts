import type { BodyStyle } from "../car-variants.ts";
import { BOOT_SENSOR, CABIN_TUB, HEAD_LAMP, PLATFORM_WHEEL, st } from "./platform.ts";

/** 80s regular/extended-cab long-bed pickup (Toyota Pickup proportions): boxy cab, flat hood, open bed; the trunk part is the tailgate. */
export const PICKUP: BodyStyle = {
  id: "pickup",
  dims: { wheelbase: 2.68, overhang: { front: 0.81, rear: 0.81 }, track: 1.48, width: 1.801, height: 1.365, rideHeight: 0.145, wheel: PLATFORM_WHEEL },
  profile: [
    st(-2.18, 0.76, 1.19),
    st(-1.6, 0.775, 1.2),
    st(-0.95, 0.775, 1.2),
    st(-0.6, 0.775, 1.2),
    st(-0.55, 0.775, 1.18, 1.62, 0.58, 1),
    st(-0.1, 0.77, 1.18, 1.68, 0.6, 1),
    st(0.38, 0.77, 1.18, 1.665, 0.58, 1),
    st(0.91, 0.775, 1.17, 1.2, 0.58, 0.3),
    st(1.2, 0.78, 1.16),
    st(1.5, 0.78, 1.13),
    st(1.75, 0.765, 1.09),
    st(1.93, 0.71, 1.03),
  ],
  roofZ: [-0.52, 0.38],
  windshieldTop: [1.64, 0.4],
  rearGlass: { base: [1.2, -0.56], top: [1.62, -0.53], wBase: 1.3, wTop: 1.12 },
  quarter: { zRearBot: -0.47, zRearTop: -0.47 },
  midPillarZ: null,
  rearBulkhead: { z: -0.58, yTop: 1.2 },
  tubs: [CABIN_TUB, [-2.12, -0.62, 0.8]],
  rearDoorSeam: null,
  boot: { kind: "tailgate", y0: 0.58, origin: [1.19, -2.18] },
  lamps: { head: HEAD_LAMP, tail: [0.7, 0.86] },
  rig: {
    cages: {
      roof: { min: [-0.6, 1.3, -0.56], max: [0.6, 1.72, 0.42] },
      glassRear: { min: [-0.66, 1.15, -0.62], max: [0.66, 1.66, -0.48] },
      boot: { min: [-0.78, 0.55, -2.24], max: [0.78, 1.22, -1.86] },
    },
    sensors: { [BOOT_SENSOR]: [0, 0.85, -2.05] },
  },
};
