import type { Stoops } from "../../world/openworld/openworld-stoops.ts";
import { ACTIVITY, ACTIVITY_OPEN_ENDED } from "./civilian-activity.ts";
import type { DoorSpot } from "./civilian-car-door.ts";
import { DECISION_HZ, RESIDENT_FLOAT, RESIDENT_FLOAT_STRIDE, RESIDENT_INT, RESIDENT_INT_STRIDE, SPECIES } from "./civilian-constants.ts";
import { NOT_A_CIVILIAN, STRIDE_RADIANS_PER_METRE } from "./civilian-crowd-constants.ts";
import { LegPose, legPositionAt } from "./civilian-leg.ts";
import { placeAnimal } from "./animal-spot.ts";
import { lookOf } from "./civilian-look-word.ts";
import type { CrowdSeparation } from "./civilian-separation.ts";
import type { CityState } from "./civilian-state.ts";
import type { ActivityReading, readActivity } from "./society-activity.ts";
import type { CrowdPoses } from "./crowd-poses.ts";

/** Where the driver's door of resident `resident`'s car stands (the spot and facing of a person at it, her feet's height there and her seat top's), filled for activity `code` (`ACTIVITY.carIn` or `carOut`); false when she has no car to be at. */
export type DriverDoors = (resident: number, code: number, out: DoorSpot) => boolean;

/** Fills the crowd's poses from the brain's rows at a crowd time: each resident's spot, facing, walk and what she is doing. */
export class CrowdPlacing {
  /** 1 for a resident walking a leg that is not a door's spur: the ones `Stoops.keepOut` moves. */
  readonly laneWalking: Uint8Array;
  private readonly door: DoorSpot = { x: 0, z: 0, yaw: 0, feetY: 0, surfaceY: 0 };
  private readonly pose = new LegPose();
  private readonly reading: ActivityReading = { code: ACTIVITY.none, sinceSeconds: 0, leftSeconds: ACTIVITY_OPEN_ENDED, partner: NOT_A_CIVILIAN, surfaceY: 0, speed: 0, walked: 0, placed: false, fixed: false, x: 0, z: 0, yaw: 0 };

  constructor(capacity: number) {
    this.laneWalking = new Uint8Array(capacity);
  }

  /** `poses` and the brain spots of `separation` for crowd time `seconds`; `driverDoors`, `stoops` and `activityReader` are the crowd's. */
  fillPoses(seconds: number, state: CityState, poses: CrowdPoses, separation: CrowdSeparation, driverDoors: DriverDoors | null, stoops: Stoops | null, activityReader: typeof readActivity): void {
    const { ints, floats } = state;
    const { yaw, stride, speed, shown, feetY, surfaceY } = poses;
    const { present, fixed, brainX, brainZ, velocityX, velocityZ } = separation;
    const pose = this.pose;
    const reading = this.reading;
    const door = this.door;
    for (let resident = 0; resident < state.capacity; resident++) {
      const intBase = resident * RESIDENT_INT_STRIDE;
      shown[resident] = 0;
      present[resident] = 0;
      poses.onSpur[resident] = 0;
      this.laneWalking[resident] = 0;
      if (ints[intBase + RESIDENT_INT.species] !== SPECIES.person) {
        placeAnimal(state, resident, seconds, pose, poses, separation);
        continue;
      }
      activityReader(state, resident, seconds, reading);
      const walkSpeed = floats[resident * RESIDENT_FLOAT_STRIDE + RESIDENT_FLOAT.speed]!;
      const atCar = reading.code === ACTIVITY.carIn || reading.code === ACTIVITY.carOut;
      if (atCar) {
        if (driverDoors === null || !driverDoors(resident, reading.code, door)) continue;
        brainX[resident] = door.x;
        brainZ[resident] = door.z;
        velocityX[resident] = 0;
        velocityZ[resident] = 0;
        yaw[resident] = door.yaw;
        speed[resident] = 0;
        stride[resident] = 0;
        feetY[resident] = door.feetY;
        surfaceY[resident] = door.surfaceY;
      } else if (reading.placed) {
        brainX[resident] = reading.x;
        brainZ[resident] = reading.z;
        velocityX[resident] = 0;
        velocityZ[resident] = 0;
        yaw[resident] = reading.yaw;
        speed[resident] = reading.speed;
        stride[resident] = reading.walked * STRIDE_RADIANS_PER_METRE;
      } else {
        const onLeg = ints[intBase + RESIDENT_INT.pathCount]! > 0 && seconds >= ints[intBase + RESIDENT_INT.departTick]! / DECISION_HZ && seconds < ints[intBase + RESIDENT_INT.arriveTick]! / DECISION_HZ;
        if (!onLeg || !legPositionAt(state, resident, seconds, pose)) continue;
        poses.onSpur[resident] = stoops !== null && stoops.leadsToDoor(pose.from, pose.to) ? 1 : 0;
        this.laneWalking[resident] = poses.onSpur[resident] === 1 ? 0 : 1;
        brainX[resident] = pose.x;
        brainZ[resident] = pose.z;
        velocityX[resident] = pose.dirX * pose.speed;
        velocityZ[resident] = pose.dirZ * pose.speed;
        yaw[resident] = pose.yaw;
        speed[resident] = Math.abs(pose.speed);
        stride[resident] = walkSpeed * (seconds - ints[intBase + RESIDENT_INT.departTick]! / DECISION_HZ) * STRIDE_RADIANS_PER_METRE;
      }
      shown[resident] = 1;
      present[resident] = 1;
      fixed[resident] = reading.fixed || atCar ? 1 : 0;
      this.describe(resident, atCar, state, poses);
    }
  }

  /** Once she is placed: who she is and what she is doing, from the reading of her activity just taken. */
  private describe(resident: number, atCar: boolean, state: CityState, poses: CrowdPoses): void {
    const { look, activity, activityClock, activityLeft, partner, surfaceY, feetY } = poses;
    const reading = this.reading;
    look[resident] = lookOf(state.seed, state.ints, resident * RESIDENT_INT_STRIDE);
    activity[resident] = reading.code;
    activityClock[resident] = reading.sinceSeconds;
    activityLeft[resident] = reading.leftSeconds;
    partner[resident] = reading.partner;
    if (!atCar) {
      feetY[resident] = 0;
      surfaceY[resident] = reading.surfaceY;
    }
  }
}

/** Every civilian who walks a stoop's door spur stands at the step under her: she leaves her door at the sill's height, goes down to the street, and the reverse coming home. */
export function liftWalkers(stoops: Stoops | null, poses: CrowdPoses, separation: CrowdSeparation): void {
  if (stoops === null) return;
  const { x, z, feetY, shown } = poses;
  const { onSpur } = poses;
  for (let resident = 0; resident < separation.capacity; resident++) if (shown[resident] === 1 && onSpur[resident] === 1) stoops.liftFeet(x, z, feetY, resident);
}

/** The residents the overlay moved off the spot `separate` drew (the law's suspects, running or led) are kept out of the stoops like the lane's walkers, unless the overlay marked them `onSpur` (the law's walkers, on the graph: lifted, not moved): the rest still stand where `separate` left them and are not touched. */
export function keepOverlaidOut(stoops: Stoops | null, poses: CrowdPoses, separation: CrowdSeparation): void {
  if (stoops === null) return;
  const { x, z, shown, onSpur } = poses;
  const { drawX, drawZ } = separation;
  for (let resident = 0; resident < separation.capacity; resident++) {
    if (shown[resident] === 0 || onSpur[resident] === 1 || (x[resident] === drawX[resident] && z[resident] === drawZ[resident])) continue;
    stoops.keepOut(x, z, resident);
  }
}
