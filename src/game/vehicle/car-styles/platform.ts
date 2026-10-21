import { PLATFORM_TYRE } from "../../kernel/rig-spec.ts";
import type { BodyStyle, ProfileStation } from "../car-variants.ts";

export function st(z: number, hw: number, yBelt: number, yRoof = yBelt, cabinHw = 0.5, cabin = 0): ProfileStation {
  return { z, hw, yBelt, yRoof, cabinHw, cabin };
}

/** Cowl to nose: identical on every style (hood, fenders, lamps, windshield base). */
export const FRONT_CLIP: readonly ProfileStation[] = [
  st(0.82, 0.87, 0.8, 1.05, 0.52, 0.4),
  st(1.18, 0.86, 0.775),
  st(1.58, 0.83, 0.72),
  st(1.9, 0.75, 0.64),
  st(2.11, 0.62, 0.54),
];

/** The front clip's head lamp seat: outboard of the grille, under the header panel, above the bumper. */
export const HEAD_LAMP = [0.485, 0.485] as const;

/** The cabin's open floor [zRear, zFront, floorY] behind the glass. */
export const CABIN_TUB = [-0.7, 0.7, 0.3] as const;

/** Boot sensor (SENSORS[18]) follows the tail panel on hatch / tailgate bodies. */
export const BOOT_SENSOR = 18;

/** The one tyre the sim's hub contact is sized to today (`PLATFORM_TYRE`). */
export const PLATFORM_WHEEL = { radius: PLATFORM_TYRE.r, width: 2 * PLATFORM_TYRE.halfW } as const;

/** Bumper fascia section about its seat, top to bottom, [y, out] (m): rounded top, intake recess, splitter lip. */
const PLATFORM_FASCIA = [
  [0.1, -0.07],
  [0.1, 0.02],
  [0.088, 0.062],
  [0.05, 0.08],
  [0.018, 0.074],
  [-0.012, 0.062],
  [-0.05, 0.064],
  [-0.07, 0.088],
  [-0.1, 0.075],
  [-0.1, -0.07],
] as const;

/** The bumper both ends wear: seated 0.05 inside the end stations' 2.11. */
const PLATFORM_BUMPER = { seat: { y: 0.33, z: 2.06 }, fascia: PLATFORM_FASCIA, span: 0.77 } as const;

/** The hardpoints the first bodies shared on one platform: a table spreads these and overrides what its car changes. */
export const PLATFORM_HARDPOINTS = {
  windshield: { base: [0.78, 1.03], wBase: 1.3, wTop: 0.96 },
  bPillar: { rear: -0.13, front: -0.03 },
  belt: { x: 0.85, y: [[0, 0.83]] },
  rocker: { y: 0.2 },
  arch: { radius: 0.38 },
  hood: { z0: 0.76, z1: 1.98, origin: [0.7, 0.74] },
  bumpers: { front: PLATFORM_BUMPER, rear: PLATFORM_BUMPER },
} as const satisfies Pick<BodyStyle, "windshield" | "bPillar" | "belt" | "rocker" | "arch" | "hood" | "bumpers">;
