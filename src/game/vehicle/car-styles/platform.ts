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

/** Rear door shut line (z, m) of the four-door bodies: their doors share one aperture. */
export const REAR_DOOR_SEAM = -0.62;

/** Seat-back bulkhead of the tailgate bodies that carry their roof past the rear seats (hatchback, wagon). */
export const TAILGATE_BULKHEAD = { z: -0.72, yTop: 0.8 } as const;

/** Rear glass base widths (m): the coupe's and pickup's back lights (narrow), the sedan's and wagon's (wide). */
export const REAR_GLASS_W = { narrow: 1.3, wide: 1.36 } as const;
