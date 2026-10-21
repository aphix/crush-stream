import type { BodyStyle } from "../car-variants.ts";
import { CABIN_TUB, FRONT_CLIP, HEAD_LAMP, PLATFORM_HARDPOINTS, PLATFORM_WHEEL, st } from "./platform.ts";

export const SEDAN: BodyStyle = {
  id: "sedan",
  dims: { wheelbase: 2.68, overhang: { front: 0.81, rear: 0.81 }, track: 1.48, width: 1.813, height: 1.366, rideHeight: 0.145, wheel: PLATFORM_WHEEL },
  ...PLATFORM_HARDPOINTS,
  profile: [
    st(-2.11, 0.64, 0.66),
    st(-1.92, 0.79, 0.76),
    st(-1.58, 0.86, 0.8),
    st(-1.18, 0.88, 0.81, 0.88, 0.56, 0.2),
    st(-0.78, 0.89, 0.815, 1.28, 0.6, 1),
    st(-0.18, 0.89, 0.82, 1.34, 0.62, 1),
    st(0.42, 0.88, 0.81, 1.3, 0.6, 1),
    ...FRONT_CLIP,
  ],
  roofZ: [-0.82, 0.58],
  windshieldTop: [1.26, 0.49],
  rearGlass: { base: [0.81, -1.16], top: [1.23, -0.76], wBase: 1.36, wTop: 0.98 },
  quarter: { zRearBot: -0.86, zRearTop: -0.7 },
  midPillarZ: null,
  rearBulkhead: { z: -0.72, yTop: 0.84 },
  tubs: [CABIN_TUB],
  rearDoorSeam: -0.62,
  boot: { kind: "lid", z0: -0.66, z1: -1.98, origin: [0.74, -0.72] },
  lamps: { head: HEAD_LAMP, tail: [0.47, 0.56] },
  rig: {},
};
