import type { BodyStyle } from "../car-variants.ts";
import { BOOT_SENSOR, HEAD_LAMP, PLATFORM_HARDPOINTS, st } from "./platform.ts";

const { bumpers } = PLATFORM_HARDPOINTS;

/** The truck family as a crew cab, squatter and longer than the pickup; the monster class lifts it onto its big wheels. */
export const MONSTER: BodyStyle = {
  id: "monster",
  dims: { wheelbase: 2.77, overhang: { front: 0.81, rear: 0.81 }, track: 2.39, width: 1.801, height: 1.365, rideHeight: 0.34, wheel: { radius: 0.355, width: 0.364 } },
  ...PLATFORM_HARDPOINTS,
  windshield: { base: [1.1, 0.99], wBase: 1.46, wTop: 1.3 },
  belt: { x: 0.8, y: [[0, 1.0]] },
  rocker: { y: 0.4 },
  arch: { radius: 0.47 },
  hood: { z0: 0.93, z1: 2.08, origin: [0.96, 0.91] },
  bumpers: {
    front: { ...bumpers.front, seat: { y: 0.42, z: 2.05 }, span: 0.82 },
    rear: { ...bumpers.rear, seat: { y: 0.5, z: 2.35 }, span: 0.82 },
  },
  profile: [
    st(-2.4, 0.8, 1.02),
    st(-1.6, 0.835, 1.03),
    st(-0.95, 0.835, 1.03),
    st(-0.8, 0.835, 1.03),
    st(-0.74, 0.835, 1.0, 1.47, 0.62, 1),
    st(-0.2, 0.835, 0.99, 1.495, 0.64, 1),
    st(0.36, 0.83, 0.99, 1.48, 0.62, 1),
    st(0.97, 0.83, 1.06, 1.08, 0.6, 0.3),
    st(1.3, 0.83, 1.04),
    st(1.6, 0.825, 1.01),
    st(1.9, 0.81, 0.96),
    st(2.1, 0.78, 0.88),
  ],
  roofZ: [-0.72, 0.36],
  windshieldTop: [1.47, 0.38],
  rearGlass: { base: [1.02, -0.76], top: [1.45, -0.73], wBase: 1.36, wTop: 1.18 },
  quarter: { zRearBot: -0.64, zRearTop: -0.64 },
  midPillarZ: null,
  rearBulkhead: { z: -0.77, yTop: 1.03 },
  tubs: [[-0.74, 0.93, 0.5], [-2.36, -0.82, 0.62]],
  rearDoorSeam: -0.15,
  boot: { kind: "tailgate", y0: 0.45, origin: [1.02, -2.4] },
  lamps: { head: HEAD_LAMP, tail: [0.7, 0.8] },
  rig: {
    cages: {
      roof: { min: [-0.62, 1.12, -0.76], max: [0.62, 1.52, 0.4] },
      glassRear: { min: [-0.66, 0.97, -0.82], max: [0.66, 1.48, -0.68] },
      boot: { min: [-0.8, 0.42, -2.46], max: [0.8, 1.05, -2.06] },
    },
    sensors: { [BOOT_SENSOR]: [0, 0.7, -2.28] },
  },
};
