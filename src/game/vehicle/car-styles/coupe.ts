import type { BodyStyle } from "../car-variants.ts";
import { HEAD_LAMP, PLATFORM_HARDPOINTS, st } from "./platform.ts";

const { bumpers } = PLATFORM_HARDPOINTS;

/** Late-70s notchback muscle coupe (Celica Supra A40 proportions): long flat hood, flat roof, sloped rear glass, short ducktail deck. */
export const COUPE: BodyStyle = {
  id: "coupe",
  dims: { wheelbase: 2.38, overhang: { front: 0.81, rear: 0.81 }, track: 1.32, width: 1.852, height: 1.276, rideHeight: 0.2, wheel: { radius: 0.3, width: 0.2 } },
  ...PLATFORM_HARDPOINTS,
  windshield: { base: [0.93, 0.7], wBase: 1.32, wTop: 1.08 },
  belt: { x: 0.73, y: [[0, 0.89]] },
  rocker: { y: 0.22 },
  underside: [[-2.05, 0.3], [-1.75, 0.26], [-1.5, 0.2], [1.56, 0.2], [1.83, 0.24], [1.99, 0.27]],
  door: { hingeX: 0.77, hingeY: 0.555, hingeZ: 0.61, length: 1.1, halfHeight: 0.335, mirrorY: 0.365, mirrorReach: 0.21, mirrorHalfDepth: 0.08, aperture: [-0.49, 0.6] },
  bPillar: { rear: -0.56, front: -0.48 },
  arch: { radius: 0.36 },
  hood: { z0: 0.64, z1: 1.97, origin: [0.8, 0.62] },
  bumpers: {
    front: { ...bumpers.front, seat: { y: 0.35, z: 1.94 }, span: 0.74 },
    rear: { ...bumpers.rear, seat: { y: 0.36, z: 2.0 }, span: 0.72 },
  },
  profile: [
    st(-2.05, 0.63, 0.86),
    st(-1.9, 0.69, 0.9),
    st(-1.62, 0.745, 0.94),
    st(-1.42, 0.77, 0.97, 1.0, 0.5, 0.1),
    st(-0.98, 0.78, 0.89, 1.235, 0.6, 1),
    st(-0.4, 0.765, 0.89, 1.26, 0.62, 1),
    st(0.08, 0.77, 0.89, 1.245, 0.6, 1),
    st(0.7, 0.785, 0.9, 0.93, 0.55, 0.3),
    st(1.0, 0.79, 0.885),
    st(1.4, 0.785, 0.86),
    st(1.75, 0.755, 0.805),
    st(1.99, 0.67, 0.78),
  ],
  roofZ: [-0.96, 0.06],
  windshieldTop: [1.235, 0.1],
  rearGlass: { base: [0.99, -1.42], top: [1.225, -0.98], wBase: 1.24, wTop: 1.06 },
  quarter: { zRearBot: -1.02, zRearTop: -0.9 },
  midPillarZ: null,
  rearBulkhead: { z: -0.9, yTop: 0.89 },
  tubs: [[-0.9, 0.7, 0.3]],
  rearDoorSeam: null,
  boot: { kind: "lid", z0: -1.42, z1: -2.0, origin: [0.97, -1.42] },
  lamps: { head: HEAD_LAMP, tail: [0.5, 0.66] },
  rig: {},
};
