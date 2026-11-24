import { detCos, detSin, hypot2 } from "../../kernel/physics-core.js";
import { FLEET_HALF } from "../../vehicle/car-rig.ts";
import type { ParkingSpots } from "../../world/openworld/openworld-parking.ts";
import type { Seat } from "../../world/openworld/openworld-spawn.ts";
import { KERB_JITTER_SIDE, KERB_JITTER_YAW } from "./traffic-constants.ts";

/** Where a seat's driver exits stand (`SPOT_OUT`, `SPOT_ALONG` in engine/onfoot-doors.ts, which the AI layer cannot import) and the room a door needs from another car's middle (`CAR_CLEARANCE` there). */
const DOOR_OUT = 1.75;
const DOOR_ALONG = 0.15;
const DOOR_CLEARANCE = 2.6;

/** How far (m) a kerb car's middle may sit off its space's: its sideways nudge and its yaw nudge over the car's half length. */
const KERB_SLACK = KERB_JITTER_SIDE + KERB_JITTER_YAW * FLEET_HALF.footHalfL;

/** Whether axis-aligned boxes at (ax, az) and (bx, bz) with half sizes (ahx, ahz) and (bhx, bhz) overlap. */
function boxesMeet(ax: number, az: number, ahx: number, ahz: number, bx: number, bz: number, bhx: number, bhz: number): boolean {
  return Math.abs(ax - bx) < ahx + bhx && Math.abs(az - bz) < ahz + bhz;
}

/**
 * The parking spaces no kerb car may stand in: one whose car, wherever its nudge puts it, would stand within a door's clearance of either front door's exit of any of `seats`, or would touch a seat's car.
 * `masks[space]` is set to 1 for such a space; the count is returned. Built once from the layout. A seat and a space face along an axis, so boxes stand for the cars.
 */
export function maskSeatSpaces(spots: ParkingSpots, seats: readonly Seat[], masks: Uint8Array): number {
  let count = 0;
  for (let space = 0; space < spots.count; space++) {
    const alongX = Math.abs(detSin(spots.yaw[space]!)) > 0.5;
    const halfX = (alongX ? FLEET_HALF.footHalfL : FLEET_HALF.x) + KERB_SLACK;
    const halfZ = (alongX ? FLEET_HALF.x : FLEET_HALF.footHalfL) + KERB_SLACK;
    for (let at = 0; at < seats.length && masks[space] === 0; at++) {
      const seat = seats[at]!;
      const forwardX = detSin(seat.yaw);
      const forwardZ = detCos(seat.yaw);
      for (let side = -1; side <= 1; side += 2) {
        const doorX = seat.x + side * DOOR_OUT * forwardZ + DOOR_ALONG * forwardX;
        const doorZ = seat.z - side * DOOR_OUT * forwardX + DOOR_ALONG * forwardZ;
        if (hypot2(spots.x[space]! - doorX, spots.z[space]! - doorZ) < DOOR_CLEARANCE + KERB_SLACK) masks[space] = 1;
      }
      const seatAlongX = Math.abs(forwardX) > 0.5;
      if (boxesMeet(spots.x[space]!, spots.z[space]!, halfX, halfZ, seat.x, seat.z, seatAlongX ? FLEET_HALF.footHalfL : FLEET_HALF.x, seatAlongX ? FLEET_HALF.x : FLEET_HALF.footHalfL)) masks[space] = 1;
    }
    count += masks[space]!;
  }
  return count;
}
