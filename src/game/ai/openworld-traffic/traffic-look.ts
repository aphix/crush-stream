import { hash01 } from "../../kernel/scalar.ts";
import { residentSpotAt, type ParkingSpots } from "../../world/openworld/openworld-parking.ts";
import type { CarStyleId } from "../../vehicle/car-variants.ts";
import { EVERYDAY_BODIES, RESIDENT_CAR_COLOURS, RESIDENT_CAR_SEED } from "./traffic-constants.ts";

/** The body resident `resident`'s car wears: a pure pick of the everyday bodies, the same wherever the car stands (kerb or road), so it never changes under him. */
export function residentBody(resident: number): CarStyleId {
  return EVERYDAY_BODIES[Math.floor(hash01(resident, RESIDENT_CAR_SEED) * EVERYDAY_BODIES.length)]!;
}

/** A resident's parked car as a standing pose reads it: where it stands, which way it faces, the ground there and its body. */
export type ResidentCarPose = { x: number; z: number; yaw: number; groundY: number; bodyStyle: CarStyleId };

/** Fills `out` with resident `resident`'s car standing in space `spot` (the ground there from `groundAt`). */
export function carPoseAtSpot(spots: ParkingSpots, spot: number, resident: number, groundAt: (x: number, z: number) => number, out: ResidentCarPose): void {
  out.x = spots.x[spot]!;
  out.z = spots.z[spot]!;
  out.yaw = spots.yaw[spot]!;
  out.groundY = groundAt(out.x, out.z);
  out.bodyStyle = residentBody(resident);
}

/**
 * Where resident `resident`'s car stands at a place whose door is at (doorX, doorZ), into `out`; false when the place has no empty space. A pure function of the resident, the door and the spot table (`residentSpotAt`),
 * so every peer's crowd stands him at the same car; the host's car is in that space when it is free.
 */
export function residentCarPose(spots: ParkingSpots, doorX: number, doorZ: number, resident: number, groundAt: (x: number, z: number) => number, out: ResidentCarPose): boolean {
  const spot = residentSpotAt(spots, doorX, doorZ, resident);
  if (spot < 0) return false;
  carPoseAtSpot(spots, spot, resident, groundAt, out);
  return true;
}

/** The paint of resident `resident`'s car (sRGB), pure like its body. */
export function residentColour(resident: number): number {
  return RESIDENT_CAR_COLOURS[Math.floor(hash01(resident, RESIDENT_CAR_SEED + 1) * RESIDENT_CAR_COLOURS.length)]!;
}
