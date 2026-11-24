import { hypot2 } from "../kernel/physics-core.js";
import { ACTIVITY } from "../ai/civilians/civilian-activity.ts";
import { carDoorSpot } from "../ai/civilians/civilian-car-door.ts";
import { RESIDENT_INT, RESIDENT_INT_STRIDE } from "../ai/civilians/civilian-constants.ts";
import type { DriverDoors } from "../ai/civilians/civilian-crowd.ts";
import type { CityState } from "../ai/civilians/civilian-state.ts";
import { residentBody, residentCarPose, type ResidentCarPose } from "../ai/openworld-traffic/traffic-look.ts";
import { CAR_STYLES, type CarStyleId } from "../vehicle/car-variants.ts";
import { activeGround } from "../world/ground.ts";
import { KERB_CANDIDATES, kerbSpotsNear, spotAt, type ParkingSpots } from "../world/openworld/openworld-parking.ts";
import type { Place } from "../world/openworld/walk-graph.ts";

/** The probe height (m) the traffic reads the ground from, so a floor above a ramp or a bridge is not taken for it. */
const GROUND_PROBE_HEIGHT = 0.5;

/** The ground under (`x`, `z`) as the traffic's cars stand on it. */
export function groundUnderCars(x: number, z: number): number {
  return activeGround().heightAt(x, z, GROUND_PROBE_HEIGHT);
}

/** A car counts as standing at a kerb space when it is within this far (m) of the space's middle. */
const CAR_AT_SPOT_M = 2.5;

/** Whether one of `cars` (those of body `body`, with none named: any) stands at (x, z). A put-away car stands far off the map and never matches. */
export function carStandsNear(cars: readonly { group: { position: { x: number; z: number } }; style?: { id: CarStyleId } }[], x: number, z: number, body: CarStyleId | null = null): boolean {
  for (let at = 0; at < cars.length; at++) {
    if (body !== null && cars[at]!.style?.id !== body) continue;
    const spot = cars[at]!.group.position;
    if (hypot2(spot.x - x, spot.z - z) <= CAR_AT_SPOT_M) return true;
  }
  return false;
}

/** The spaces by a door a client looks through: the host's cars choose among the same four (`KerbCars`' and the traffic's `spotFor`). */
const DOOR_SPACES = new Int32Array(KERB_CANDIDATES);

/**
 * The kerb space a client draws resident `owner` getting in or out at, -1 for none. A client has no traffic, so it reads the host's cars (which carry their body style, not their paint). Her car is the one of her body standing in the
 * space the brain puts it in (`pose`), else in another of the four spaces nearest her door: the host puts her car there when her pick was a car's, and draws her beside it.
 */
export function clientCarSpot(cars: readonly { group: { position: { x: number; z: number } }; style: { id: CarStyleId } }[], spots: ParkingSpots, owner: number, door: Pick<Place, "doorX" | "doorZ">, pose: ResidentCarPose): number {
  const body = residentBody(owner);
  if (carStandsNear(cars, pose.x, pose.z, body)) return spotAt(spots, pose.x, pose.z, pose.yaw);
  const count = kerbSpotsNear(spots, door.doorX, door.doorZ, DOOR_SPACES);
  for (let at = 0; at < count; at++) {
    const spot = DOOR_SPACES[at]!;
    if (carStandsNear(cars, spots.x[spot]!, spots.z[spot]!, body)) return spot;
  }
  return -1;
}

/**
 * Where the driver's door of a resident's car is, for the crowd's people getting in or out (`CAR_DOOR`): the car is its owner's (`carOwner`, who may be a housemate of the one at the door) standing in a space near the kerb of the owner's
 * `carPlace` before the trip leaves (getting in) or `carTo` once it is parked (getting out). `pose` starts as the brain's own pick of the space (`residentSpotAt`, a pure function); `carThere` may write the space her car stands in
 * instead. No clip is placed where `carThere` says her car does not stand.
 */
export function makeDriverDoors(places: readonly Pick<Place, "doorX" | "doorZ">[], state: Pick<CityState, "ints">, spots: ParkingSpots, groundAt: (x: number, z: number) => number, carThere: (owner: number, pose: ResidentCarPose, door: Pick<Place, "doorX" | "doorZ">) => boolean): DriverDoors {
  const car: ResidentCarPose = { x: 0, z: 0, yaw: 0, groundY: 0, bodyStyle: "sedan" };
  return (resident, code, out) => {
    const owner = state.ints[resident * RESIDENT_INT_STRIDE + RESIDENT_INT.carOwner]!;
    if (owner < 0) return false;
    const place = state.ints[owner * RESIDENT_INT_STRIDE + (code === ACTIVITY.carIn ? RESIDENT_INT.carPlace : RESIDENT_INT.carTo)]!;
    if (place < 0) return false;
    const door = places[place]!;
    if (!residentCarPose(spots, door.doorX, door.doorZ, owner, groundAt, car)) return false;
    if (!carThere(owner, car, door)) return false;
    carDoorSpot(car.x, car.z, car.yaw, car.groundY, CAR_STYLES[car.bodyStyle].seats.front, out);
    out.feetY = groundAt(out.x, out.z);
    return true;
  };
}
