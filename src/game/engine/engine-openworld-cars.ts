import { ACTIVITY } from "../ai/civilians/civilian-activity.ts";
import { CAR_DOOR, carDoorOpenness } from "../ai/civilians/civilian-car-door.ts";
import { RESIDENT_INT, RESIDENT_INT_STRIDE } from "../ai/civilians/civilian-constants.ts";
import type { CityState } from "../ai/civilians/civilian-state.ts";
import type { CrowdPoses } from "../ai/civilians/crowd-poses.ts";
import type { OpenWorldTraffic } from "../ai/openworld-traffic/openworld-traffic.ts";

/** What the doors read of the traffic: the driver's door of an owner's car. */
type CarDoorPorts = Pick<OpenWorldTraffic, "setCarDoor">;

/**
 * The cars' driver's doors swung in step with the clips of the residents getting in and out of them, for the open world's director. The door is the host's: it is a part of a sim car, so a client has none.
 * The car is the owner's (`carOwner`: a housemate may be the one at the door), and a door is shut whenever nobody is in a clip at it.
 */
export class OpenWorldCarDoors {
  private readonly state: Pick<CityState, "ints">;
  private readonly traffic: () => CarDoorPorts | null;
  /** The angle (rad) each owner's car door was last set to, so a still door is not set again, and the angle this step's clips want. */
  private readonly radians: Float64Array;
  private readonly wanted: Float64Array;

  constructor(residents: number, state: Pick<CityState, "ints">, traffic: () => CarDoorPorts | null) {
    this.state = state;
    this.traffic = traffic;
    this.radians = new Float64Array(residents);
    this.wanted = new Float64Array(residents);
  }

  /** Once a sim step on the host: each car whose owner or housemate is in her clip of getting in or out has its door at the clip's angle; one with nobody at it has it shut. */
  step(poses: CrowdPoses): void {
    const traffic = this.traffic();
    if (traffic === null) return;
    const limit = Math.min(poses.count, this.radians.length);
    this.wanted.fill(0, 0, limit);
    for (let resident = 0; resident < limit; resident++) {
      const code = poses.activity[resident]!;
      if (poses.shown[resident] === 0 || (code !== ACTIVITY.carIn && code !== ACTIVITY.carOut)) continue;
      const owner = this.state.ints[resident * RESIDENT_INT_STRIDE + RESIDENT_INT.carOwner]!;
      if (owner >= 0 && owner < limit) this.wanted[owner] = carDoorOpenness(code, poses.activityClock[resident]!) * CAR_DOOR.openRad;
    }
    for (let car = 0; car < limit; car++) {
      const want = this.wanted[car]!;
      if (want === this.radians[car]) continue;
      if (traffic.setCarDoor(car, want)) this.radians[car] = want;
    }
  }
}
