import { hash01 } from "../../kernel/scalar.ts";
import type { CarStyleId } from "../../vehicle/car-variants.ts";
import { EVERYDAY_BODIES, RESIDENT_CAR_COLOURS, RESIDENT_CAR_SEED } from "./traffic-constants.ts";

/** The body resident `resident`'s car wears: a pure pick of the everyday bodies, the same wherever the car stands (kerb or road), so it never changes under him. */
export function residentBody(resident: number): CarStyleId {
  return EVERYDAY_BODIES[Math.floor(hash01(resident, RESIDENT_CAR_SEED) * EVERYDAY_BODIES.length)]!;
}

/** The paint of resident `resident`'s car (sRGB), pure like its body. */
export function residentColour(resident: number): number {
  return RESIDENT_CAR_COLOURS[Math.floor(hash01(resident, RESIDENT_CAR_SEED + 1) * RESIDENT_CAR_COLOURS.length)]!;
}
