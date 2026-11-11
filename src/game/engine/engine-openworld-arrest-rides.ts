import { carDoorSpot, type DoorSpot } from "../ai/civilians/civilian-car-door.ts";
import { EVENT_KIND, EVENT_TRIPLE } from "../ai/civilians/civilian-constants.ts";
import { CRAWL } from "../ai/constants.ts";
import type { Arrests } from "../ai/openworld-crime/arrests.ts";
import { hypot2 } from "../kernel/physics-core.js";
import { CAR_STYLES } from "../vehicle/car-variants.ts";
import type { DeformableCar } from "../vehicle/car.ts";
import { DRIVER_SIDE } from "../vehicle/constants.ts";
import { groundUnderCars } from "./engine-openworld-doors.ts";

/** A client's law has no patrol car of its own to take an arrest in. */
const NO_CAR = -1;

/**
 * A client's patrol cars for the law's arrests: the host's cars are the engine's own, so a "slot" here is the car's index in the engine's list. `hear` seats and unseats the pairs the host's log says
 * boarded and left a car.
 */
export class ArrestRides {
  private readonly cars: () => readonly DeformableCar[];
  /** The newest crowd second a pair was handled at, and how many pairs of that second were. */
  private newestSeconds = -Infinity;
  private handledAtNewest = 0;

  constructor(cars: () => readonly DeformableCar[]) {
    this.cars = cars;
  }

  carForArrest(): number {
    return NO_CAR;
  }

  carIndexOf(car: number): number {
    return car;
  }

  doorSpot(car: number, out: DoorSpot): boolean {
    const live = this.cars()[car];
    if (live === undefined || live.stored) return false;
    const { x, z } = live.group.position;
    carDoorSpot(x, z, live.yaw, groundUnderCars(x, z), CAR_STYLES[live.style.id].seats.front, out);
    out.feetY = groundUnderCars(out.x, out.z);
    return true;
  }

  isStill(car: number): boolean {
    const live = this.cars()[car];
    return live !== undefined && hypot2(live.velocity.x, live.velocity.z) < CRAWL;
  }

  openDoor(car: number, radians: number): void {
    this.cars()[car]?.setDoorOpen(DRIVER_SIDE, radians);
  }

  /** The host's car drives itself: there is nothing to tell it. */
  convey(): boolean {
    return true;
  }

  finishRide(car: number): void {
    this.openDoor(car, 0);
  }

  /** Once a frame on a client, with the law's own crowd second `seconds`: the host's ride and alight pairs it has reached and not yet handled. A car this peer lacks, or the player's own arrest, seats nobody. */
  hear(log: Float64Array, arrests: Arrests, seconds: number): void {
    let sameSecond = 0;
    for (let at = 0; at + 2 * EVENT_TRIPLE <= log.length; at += EVENT_TRIPLE) {
      const kind = log[at]!;
      const when = log[at + 2]!;
      if ((kind !== EVENT_KIND.arrestRide && kind !== EVENT_KIND.arrestAlight) || log[at + EVENT_TRIPLE] !== kind || log[at + EVENT_TRIPLE + 2] !== when) continue;
      const resident = log[at + 1]!;
      const car = log[at + EVENT_TRIPLE + 1]!;
      at += EVENT_TRIPLE;
      if (when < this.newestSeconds) continue;
      if (when > seconds) return;
      if (when > this.newestSeconds) {
        this.newestSeconds = when;
        this.handledAtNewest = 0;
        sameSecond = 0;
      }
      sameSecond++;
      if (sameSecond <= this.handledAtNewest) continue;
      this.handledAtNewest = sameSecond;
      if (kind === EVENT_KIND.arrestRide) arrests.rideHeard(resident, car, seconds);
      else arrests.alight(car, seconds);
    }
  }
}
