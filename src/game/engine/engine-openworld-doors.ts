import { hypot2 } from "../kernel/physics-core.js";
import { ACTIVITY } from "../ai/civilians/civilian-activity.ts";
import { carDoorSpot } from "../ai/civilians/civilian-car-door.ts";
import { RESIDENT_INT, RESIDENT_INT_STRIDE } from "../ai/civilians/civilian-constants.ts";
import type { DriverDoors } from "../ai/civilians/civilian-crowd.ts";
import type { CityState } from "../ai/civilians/civilian-state.ts";
import { residentCarPose, type ResidentCarPose } from "../ai/openworld-traffic/traffic-look.ts";
import { CAR_STYLES } from "../vehicle/car-variants.ts";
import { activeGround } from "../world/ground.ts";
import type { ParkingSpots } from "../world/openworld/openworld-parking.ts";
import type { Place } from "../world/openworld/walk-graph.ts";

/** The probe height (m) the traffic reads the ground from, so a floor above a ramp or a bridge is not taken for it. */
const GROUND_PROBE_HEIGHT = 0.5;

/** The ground under (`x`, `z`) as the traffic's cars stand on it. */
export function groundUnderCars(x: number, z: number): number {
  return activeGround().heightAt(x, z, GROUND_PROBE_HEIGHT);
}

/** A car counts as standing at a kerb space when it is within this far (m) of the space's middle. */
const CAR_AT_SPOT_M = 2.5;

/** Whether one of `cars` stands at (x, z). A put-away car stands far off the map and never matches. A client, which has no traffic, asks this. */
export function carStandsNear(cars: readonly { group: { position: { x: number; z: number } } }[], x: number, z: number): boolean {
  for (let at = 0; at < cars.length; at++) {
    const spot = cars[at]!.group.position;
    if (hypot2(spot.x - x, spot.z - z) <= CAR_AT_SPOT_M) return true;
  }
  return false;
}

/**
 * Where the driver's door of a resident's car is, for the crowd's people getting in or out (`CAR_DOOR`): the car is its owner's (`carOwner`, who may be a housemate of the one at the door) standing in its parking space at the
 * kerb of the owner's `carPlace` before the trip leaves (getting in) or `carTo` once it is parked (getting out), the space and body being the traffic's own pure picks, so every peer puts her at the same spot.
 * No clip is placed where `carThere` says her car does not stand.
 */
export function makeDriverDoors(places: readonly Pick<Place, "doorX" | "doorZ">[], state: Pick<CityState, "ints">, spots: ParkingSpots, groundAt: (x: number, z: number) => number, carThere: (owner: number, x: number, z: number, yaw: number) => boolean): DriverDoors {
  const car: ResidentCarPose = { x: 0, z: 0, yaw: 0, groundY: 0, bodyStyle: "sedan" };
  return (resident, code, out) => {
    const owner = state.ints[resident * RESIDENT_INT_STRIDE + RESIDENT_INT.carOwner]!;
    if (owner < 0) return false;
    const place = state.ints[owner * RESIDENT_INT_STRIDE + (code === ACTIVITY.carIn ? RESIDENT_INT.carPlace : RESIDENT_INT.carTo)]!;
    if (place < 0) return false;
    const door = places[place]!;
    if (!residentCarPose(spots, door.doorX, door.doorZ, owner, groundAt, car)) return false;
    if (!carThere(owner, car.x, car.z, car.yaw)) return false;
    carDoorSpot(car.x, car.z, car.yaw, car.groundY, CAR_STYLES[car.bodyStyle].seats.front, out);
    out.feetY = groundAt(out.x, out.z);
    return true;
  };
}
