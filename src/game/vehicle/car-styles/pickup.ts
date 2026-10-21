import type { BodyStyle } from "../car-variants.ts";
import { BOOT_SENSOR, HEAD_LAMP, PLATFORM_HARDPOINTS, st } from "./platform.ts";

const { bumpers } = PLATFORM_HARDPOINTS;

/** 80s regular/extended-cab long-bed pickup (Toyota Pickup proportions): boxy cab, flat hood, open bed; the trunk part is the tailgate. */
export const PICKUP: BodyStyle = {
  id: "pickup",
  dims: { wheelbase: 2.51, overhang: { front: 0.81, rear: 0.81 }, track: 1.3, width: 1.801, height: 1.365, rideHeight: 0.34, wheel: { radius: 0.355, width: 0.22 } },
  ...PLATFORM_HARDPOINTS,
  windshield: { base: [1.19, 0.91], wBase: 1.36, wTop: 1.18 },
  belt: { x: 0.73, y: [[0, 1.18]] },
  rocker: { y: 0.4 },
  underside: [[-2.18, 0.44], [-1.75, 0.36], [-1.5, 0.34], [1.6, 0.34], [1.76, 0.35], [1.93, 0.38]],
  door: { hingeX: 0.76, hingeY: 0.79, hingeZ: 0.7, length: 0.93, halfHeight: 0.39, mirrorY: 0.42, mirrorReach: 0.23, mirrorHalfDepth: 0.08, aperture: [-0.22, 0.69] },
  bPillar: { rear: -0.29, front: -0.23 },
  arch: { radius: 0.43 },
  hood: { z0: 0.85, z1: 1.92, origin: [1.07, 0.83] },
  bumpers: {
    front: { ...bumpers.front, seat: { y: 0.42, z: 1.88 }, span: 0.76 },
    rear: { ...bumpers.rear, seat: { y: 0.5, z: 2.13 }, span: 0.76 },
  },
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
  tubs: [[-0.55, 0.85, 0.5], [-2.12, -0.62, 0.8]],
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
