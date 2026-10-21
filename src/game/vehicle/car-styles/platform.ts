import { TYRE_HALF_W } from "../../deform/deform-contact.ts";
import { TYRE_R } from "../../deform/deform-state.ts";
import type { ProfileStation } from "../car-variants.ts";

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

/** The one tyre the sim's hub contact is sized to today (`TYRE_R`, `TYRE_HALF_W`). */
export const PLATFORM_WHEEL = { radius: TYRE_R, width: 2 * TYRE_HALF_W } as const;
