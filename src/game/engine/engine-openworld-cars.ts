import { ACTIVITY } from "../ai/civilians/civilian-activity.ts";
import { CAR_DOOR, carDoorOpenness, carDoorSpot, type DoorSpot } from "../ai/civilians/civilian-car-door.ts";
import { RESIDENT_INT, RESIDENT_INT_STRIDE } from "../ai/civilians/civilian-constants.ts";
import type { CityState } from "../ai/civilians/civilian-state.ts";
import type { CrowdPoses } from "../ai/civilians/crowd-poses.ts";
import type { OpenWorldTraffic } from "../ai/openworld-traffic/openworld-traffic.ts";
import { residentCarPose, type ResidentCarPose } from "../ai/openworld-traffic/traffic-look.ts";
import { FEET_Y } from "../present/civilian-art-constants.ts";
import { CAR_STYLES } from "../vehicle/car-variants.ts";
import type { ParkingSpots } from "../world/openworld/openworld-parking.ts";
import type { Place } from "../world/openworld/walk-graph.ts";

/** What the doors read of the traffic: where a resident's parked car stands, and its driver's door. */
type CarDoorPorts = Pick<OpenWorldTraffic, "carPoseOf" | "setCarDoor">;

/** What the doors read of the world on every peer: the traffic (the host's, null on a client), the kerb spaces, the society's rows and the places. */
type CarDoorSources = {
  traffic: () => CarDoorPorts | null;
  kerb: () => ParkingSpots | null;
  state: () => Pick<CityState, "ints">;
  places: readonly Place[];
};

/** The open world's ground is flat. */
const flatGround = (): number => FEET_Y;

/**
 * Getting into and out of a parked car, for the open world's director: where the resident stands at her car's driver's door (the crowd draws her there), and the car's
 * door swung in step with her clip. The spot is the parking space's pose and the body's door: the host reads the car from the traffic, any other peer the same space by
 * the pure `residentCarPose`, so every peer stands her at the same car; the door is the host's: it is a part of a sim car.
 */
export class OpenWorldCarDoors {
  private readonly sources: CarDoorSources;
  private readonly pose: ResidentCarPose = { x: 0, z: 0, yaw: 0, groundY: 0, bodyStyle: "sedan" };
  /** The angle (rad) each resident's car door was last set to, so a still door is not set again. */
  private readonly radians: Float64Array;

  constructor(residents: number, sources: CarDoorSources) {
    this.sources = sources;
    this.radians = new Float64Array(residents);
  }

  /** Into `out` the door spot of resident `resident`'s car for her clip `code` (`carIn`, `carOut`); false when no space holds her car. */
  spot(resident: number, code: number, out: DoorSpot): boolean {
    const traffic = this.sources.traffic();
    const standing = traffic !== null && traffic.carPoseOf(resident, this.pose);
    if (!standing && !this.carPoseAtPlace(resident, code)) return false;
    const { pose } = this;
    carDoorSpot(pose.x, pose.z, pose.yaw, pose.groundY, CAR_STYLES[pose.bodyStyle].seats.front, out);
    return true;
  }

  /** Once a sim step on the host: each resident in her clip of getting in or out has her car's door at the clip's angle; one whose clip is over has it shut. */
  step(poses: CrowdPoses): void {
    const traffic = this.sources.traffic();
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

  /** Her car as the space nearest the door of the place she gets in at (where the trip begins) or out at (where it ends): the same on every peer, and the host's car is there when the space is free. */
  private carPoseAtPlace(resident: number, code: number): boolean {
    const kerb = this.sources.kerb();
    if (kerb === null) return false;
    const field = code === ACTIVITY.carIn ? RESIDENT_INT.fromPlace : RESIDENT_INT.place;
    const place = this.sources.places[this.sources.state().ints[resident * RESIDENT_INT_STRIDE + field]!];
    return place !== undefined && residentCarPose(kerb, place.doorX, place.doorZ, resident, flatGround, this.pose);
  }
}
