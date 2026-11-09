import { ACTIVITY } from "../ai/civilians/civilian-activity.ts";
import { CAR_DOOR, carDoorOpenness, carDoorSpot, type DoorSpot } from "../ai/civilians/civilian-car-door.ts";
import type { CrowdPoses } from "../ai/civilians/crowd-poses.ts";
import type { OpenWorldTraffic } from "../ai/openworld-traffic/openworld-traffic.ts";
import { FEET_Y } from "../present/civilian-art-constants.ts";
import { CAR_STYLES } from "../vehicle/car-variants.ts";

/** What the doors read of the traffic: where a resident's parked car stands, and its driver's door. */
type CarDoorPorts = Pick<OpenWorldTraffic, "carPoseOf" | "setCarDoor">;

/** The seat every civilian's car is taken to have (a sedan's): the door spot and the seat's height follow it. */
const CAR_SEAT_FRONT = CAR_STYLES.sedan.seats.front;

/**
 * Getting into and out of a parked car, for the open world's director: where the resident stands at her car's driver's door (the crowd draws her there), and the car's
 * door swung in step with her clip. The spot is the parking space's pose and the body's door, so it is the same on every peer that has the traffic (the host and solo);
 * the door is the host's: it is a part of a sim car.
 */
export class OpenWorldCarDoors {
  private readonly traffic: () => CarDoorPorts | null;
  private readonly pose = { x: 0, z: 0, yaw: 0 };
  /** The angle (rad) each resident's car door was last set to, so a still door is not set again. */
  private readonly radians: Float64Array;

  constructor(residents: number, traffic: () => CarDoorPorts | null) {
    this.traffic = traffic;
    this.radians = new Float64Array(residents);
  }

  /** Into `out` the door spot of resident `resident`'s car; false when there is no traffic (a client) or his car is not at a space. */
  spot(resident: number, out: DoorSpot): boolean {
    const traffic = this.traffic();
    if (traffic === null || !traffic.carPoseOf(resident, this.pose)) return false;
    carDoorSpot(this.pose.x, this.pose.z, this.pose.yaw, FEET_Y, CAR_SEAT_FRONT, out);
    return true;
  }

  /** Once a sim step on the host: each resident in her clip of getting in or out has her car's door at the clip's angle; one whose clip is over has it shut. */
  step(poses: CrowdPoses): void {
    const traffic = this.traffic();
    if (traffic === null) return;
    const limit = Math.min(poses.count, this.radians.length);
    for (let resident = 0; resident < limit; resident++) {
      const code = poses.activity[resident]!;
      const acting = poses.shown[resident] === 1 && (code === ACTIVITY.carIn || code === ACTIVITY.carOut);
      const want = acting ? carDoorOpenness(code, poses.activityClock[resident]!) * CAR_DOOR.openRad : 0;
      if (want === this.radians[resident]) continue;
      if (traffic.setCarDoor(resident, want)) this.radians[resident] = want;
    }
  }
}
