import type { BodyStyle } from "../car-variants.ts";
import { FRONT_CLIP, HEAD_LAMP, PLATFORM_HARDPOINTS, PLATFORM_WHEEL, st } from "./platform.ts";
import { LIFTGATE } from "../hinge-spec.ts";

export const WAGON: BodyStyle = {
  id: "wagon",
  dims: { wheelbase: 2.68, overhang: { front: 0.81, rear: 0.81 }, track: 1.48, width: 1.82, height: 1.375, rideHeight: 0.145, wheel: PLATFORM_WHEEL },
  ...PLATFORM_HARDPOINTS,
  profile: [
    st(-2.11, 0.76, 0.88),
    st(-1.96, 0.84, 0.89, 1.22, 0.55, 0.6),
    st(-1.66, 0.875, 0.86, 1.32, 0.58, 1),
    st(-1.18, 0.885, 0.84, 1.33, 0.59, 1),
    st(-0.78, 0.89, 0.825, 1.34, 0.6, 1),
    st(-0.18, 0.89, 0.82, 1.35, 0.62, 1),
    st(0.42, 0.88, 0.81, 1.31, 0.6, 1),
    ...FRONT_CLIP,
  ],
  roofZ: [-1.68, 0.58],
  windshieldTop: [1.27, 0.49],
  rearGlass: { base: [0.9, -1.99], top: [1.28, -1.7], wBase: 1.36, wTop: 1.12 },
  quarter: { zRearBot: -1.62, zRearTop: -1.52 },
  midPillarZ: -0.66,
  rearBulkhead: { z: -0.72, yTop: 0.8 },
  tubs: [[-1.96, 0.7, 0.3]],
  rearDoorSeam: -0.62,
  boot: { kind: "tailgate", y0: 0.46, origin: [0.87, -2.115], pivot: [1.28, -1.7], swing: LIFTGATE },
  lamps: { head: HEAD_LAMP, tail: [0.7, 0.68] },
};
