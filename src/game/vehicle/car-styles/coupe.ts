import type { BodyStyle } from "../car-variants.ts";
import { CABIN_TUB, HEAD_LAMP, PLATFORM_WHEEL, st } from "./platform.ts";

/** Late-70s notchback muscle coupe (Celica Supra A40 proportions): long flat hood, flat roof, sloped rear glass, short ducktail deck. */
export const COUPE: BodyStyle = {
  id: "coupe",
  dims: { wheelbase: 2.68, overhang: { front: 0.81, rear: 0.81 }, track: 1.48, width: 1.852, height: 1.276, rideHeight: 0.145, wheel: PLATFORM_WHEEL },
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
  tubs: [CABIN_TUB],
  rearDoorSeam: null,
  boot: { kind: "lid", z0: -1.42, z1: -2.0, origin: [0.97, -1.42] },
  lamps: { head: HEAD_LAMP, tail: [0.5, 0.66] },
  rig: {},
};
