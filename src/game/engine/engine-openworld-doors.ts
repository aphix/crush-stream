import { ACTIVITY } from "../ai/civilians/civilian-activity.ts";
import { CAR_DOOR } from "../ai/civilians/civilian-car-door.ts";
import { RESIDENT_INT, RESIDENT_INT_STRIDE } from "../ai/civilians/civilian-constants.ts";
import type { DriverDoors } from "../ai/civilians/civilian-crowd.ts";
import type { CityState } from "../ai/civilians/civilian-state.ts";
import { residentCarPose, type ResidentCarPose } from "../ai/openworld-traffic/traffic-look.ts";
import { detCos, detSin } from "../kernel/physics-core.js";
import { CAR_STYLES } from "../vehicle/car-variants.ts";
import { DRIVER_SIDE } from "../vehicle/constants.ts";
import { activeGround } from "../world/ground.ts";
import type { ParkingSpots } from "../world/openworld/openworld-parking.ts";
import type { Place } from "../world/openworld/walk-graph.ts";

/** The probe height (m) the traffic reads the ground from, so a floor above a ramp or a bridge is not taken for it. */
const GROUND_PROBE_HEIGHT = 0.5;
const QUARTER_TURN = Math.PI / 2;

/** The ground under (`x`, `z`) as the traffic's cars stand on it. */
export function groundUnderCars(x: number, z: number): number {
  return activeGround().heightAt(x, z, GROUND_PROBE_HEIGHT);
}

/**
 * Where the driver's door of a resident's car is, for the crowd's people getting in or out (`CAR_DOOR`): the car is its owner's (`carOwner`, who may be a housemate of the one at the door) standing in its parking space at the
 * kerb of the owner's `carPlace` before the trip leaves (getting in) or `carTo` once it is parked (getting out), the space and body being the traffic's own pure picks, so every peer puts her at the same spot.
 */
export function makeDriverDoors(places: readonly Pick<Place, "doorX" | "doorZ">[], state: Pick<CityState, "ints">, spots: ParkingSpots, groundAt: (x: number, z: number) => number): DriverDoors {
  const car: ResidentCarPose = { x: 0, z: 0, yaw: 0, groundY: 0, bodyStyle: "sedan" };
  return (resident, code, out) => {
    const owner = state.ints[resident * RESIDENT_INT_STRIDE + RESIDENT_INT.carOwner]!;
    if (owner < 0) return false;
    const place = state.ints[owner * RESIDENT_INT_STRIDE + (code === ACTIVITY.carIn ? RESIDENT_INT.carPlace : RESIDENT_INT.carTo)]!;
    if (place < 0) return false;
    const door = places[place]!;
    if (!residentCarPose(spots, door.doorX, door.doorZ, owner, groundAt, car)) return false;
    const seat = CAR_STYLES[car.bodyStyle].seats.front;
    const outward = DRIVER_SIDE * (seat[0] + CAR_DOOR.outFromSeat);
    const forward = seat[2] - CAR_DOOR.behindSeat;
    const sine = detSin(car.yaw);
    const cosine = detCos(car.yaw);
    out.x = car.x + outward * cosine + forward * sine;
    out.z = car.z - outward * sine + forward * cosine;
    out.yaw = car.yaw - DRIVER_SIDE * QUARTER_TURN;
    out.feetY = groundAt(out.x, out.z);
    out.surfaceY = car.groundY + seat[1] - CAR_DOOR.hipOverSeat;
    return true;
  };
}
