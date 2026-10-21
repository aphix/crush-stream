import type { BodyStyle } from "../car-variants.ts";
import { CABIN_TUB, FRONT_CLIP, HEAD_LAMP, REAR_GLASS_W, st } from "./platform.ts";

/** Fastback two-door: lower roof, long sail, short deck. Fits the sedan rig as is. */
export const COUPE: BodyStyle = {
  id: "coupe",
  profile: [
    st(-2.11, 0.66, 0.7),
    st(-1.92, 0.81, 0.78),
    st(-1.58, 0.89, 0.8),
    st(-1.3, 0.9, 0.81, 0.86, 0.5, 0.1),
    st(-0.78, 0.9, 0.82, 1.15, 0.57, 1),
    st(-0.18, 0.89, 0.81, 1.25, 0.6, 1),
    st(0.42, 0.88, 0.81, 1.22, 0.58, 1),
    ...FRONT_CLIP,
  ],
  roofZ: [-0.66, 0.5],
  windshieldTop: [1.19, 0.44],
  rearGlass: { base: [0.84, -1.34], top: [1.17, -0.68], wBase: REAR_GLASS_W.narrow, wTop: 0.92 },
  quarter: { zRearBot: -0.66, zRearTop: -0.5 },
  midPillarZ: null,
  rearBulkhead: { z: -0.72, yTop: 0.82 },
  tubs: [CABIN_TUB],
  rearDoorSeam: null,
  boot: { kind: "lid", z0: -1.34, z1: -1.98, origin: [0.8, -1.34] },
  lamps: { head: HEAD_LAMP, tail: [0.5, 0.58] },
  rig: {},
};
