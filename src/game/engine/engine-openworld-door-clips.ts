import * as THREE from "three";
import { ACTIVITY } from "../ai/civilians/civilian-activity.ts";
import { CAR_DOOR, carDoorOpenness } from "../ai/civilians/civilian-car-door.ts";
import type { CrowdPoses } from "../ai/civilians/crowd-poses.ts";
import { hypot2 } from "../kernel/physics-core.js";
import { MAX_CARS } from "../scenes/fleet.ts";
import type { DeformableCar } from "../vehicle/car.ts";
import { DRIVER_SIDE } from "../vehicle/constants.ts";
import { doorSpot, inPlay } from "./onfoot-doors.ts";

/** A civilian in a clip at a car stands within this far (m) of its driver door's spot; the nearest car's door within it is hers. */
const DOOR_MATCH_M = 1.8;
/** Cars farther than this (m) from a civilian cannot have her door in reach: they are not asked for their door's spot. */
const CAR_PRECHECK_M = 5;
/** A door angle (rad) closer than this to what it was set to is not set again. */
const ANGLE_STEP_RAD = 0.005;

const _spot = new THREE.Vector3();

/**
 * The driver's doors of the cars that civilians get into and out of, swung on a client: a door is a part of a sim car, and the host's swing of it (`OpenWorldCarDoors`) is not in the snapshot of a car that is not
 * crashed, so a client's civilian reached for a door that stayed shut. Here the door is opened by the clip the client sees: the car whose driver door the civilian stands at, at the clip's angle
 * (`carDoorOpenness`, the same one that poses her hand), and shut once nobody is at it. Local drawing; nothing the sim reads.
 */
export class OpenWorldClientDoors {
  private readonly set = new Float64Array(MAX_CARS);
  private readonly wanted = new Float64Array(MAX_CARS);

  /** Once a frame on a client: `cars` are the live cars, `poses` the crowd as drawn. */
  frame(poses: CrowdPoses, cars: readonly DeformableCar[]): void {
    const known = Math.min(cars.length, MAX_CARS);
    this.wanted.fill(0, 0, known);
    for (let resident = 0; resident < poses.count; resident++) {
      const code = poses.activity[resident]!;
      if (poses.shown[resident] === 0 || (code !== ACTIVITY.carIn && code !== ACTIVITY.carOut)) continue;
      const car = this.carAt(poses.x[resident]!, poses.z[resident]!, cars, known);
      if (car >= 0) this.wanted[car] = carDoorOpenness(code, poses.activityClock[resident]!) * CAR_DOOR.openRad;
    }
    for (let car = 0; car < known; car++) {
      const want = this.wanted[car]!;
      if (Math.abs(want - this.set[car]!) < ANGLE_STEP_RAD && !(want === 0 && this.set[car] !== 0)) continue;
      cars[car]!.setDoorOpen(DRIVER_SIDE, want);
      this.set[car] = want;
    }
  }

  /** The car in play whose driver door's spot is nearest (x, z) and within `DOOR_MATCH_M`; -1 for none. */
  private carAt(x: number, z: number, cars: readonly DeformableCar[], known: number): number {
    let best = -1;
    let bestGap = DOOR_MATCH_M;
    for (let at = 0; at < known; at++) {
      const car = cars[at]!;
      if (!inPlay(car) || hypot2(car.group.position.x - x, car.group.position.z - z) > CAR_PRECHECK_M) continue;
      doorSpot(car, _spot);
      const gap = hypot2(_spot.x - x, _spot.z - z);
      if (gap >= bestGap) continue;
      bestGap = gap;
      best = at;
    }
    return best;
  }

  /** The open world is left: the doors this opened are shut. */
  release(cars: readonly DeformableCar[]): void {
    const known = Math.min(cars.length, MAX_CARS);
    for (let car = 0; car < known; car++) {
      if (this.set[car] === 0) continue;
      cars[car]!.setDoorOpen(DRIVER_SIDE, 0);
      this.set[car] = 0;
    }
  }
}
