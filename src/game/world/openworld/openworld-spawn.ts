import { QUARTER_TURN } from "./openworld-fabric-constants.ts";
import { SPAWN_ABREAST, SPAWN_BEHIND_CENTRE, SPAWN_LATERAL_SHIFT, SPAWN_ROW_STEP, SPAWN_SEAT_GAP, SPAWN_SEATS } from "./openworld-constants.ts";
import type { Geometry } from "./openworld-layout.ts";

/** A start pose: ground position and yaw (0 faces +z). */
export type Seat = { x: number; z: number; yaw: number };

/** The start formation: seat 0 on the anchor, `SPAWN_ABREAST` to a row heading east, rows back down the first interior east-west street from its first intersection. */
export function spawnSeats(geometry: Geometry): Seat[] {
  const z = geometry.streetZ[1]! + SPAWN_LATERAL_SHIFT;
  const startX = geometry.streetX[1]! - SPAWN_BEHIND_CENTRE;
  return Array.from({ length: SPAWN_SEATS }, (_, seat) => ({
    x: startX - Math.floor(seat / SPAWN_ABREAST) * SPAWN_ROW_STEP,
    z: z - (seat % SPAWN_ABREAST) * SPAWN_SEAT_GAP,
    yaw: QUARTER_TURN,
  }));
}
