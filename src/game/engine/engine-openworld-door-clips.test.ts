import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { ACTIVITY } from "../ai/civilians/civilian-activity.ts";
import { CAR_DOOR, carDoorOpenness } from "../ai/civilians/civilian-car-door.ts";
import { createCrowdPoses } from "../ai/civilians/crowd-poses.ts";
import { launch, pooledCar } from "../contact/crash-scenarios.test-util.ts";
import { OpenWorldClientDoors } from "./engine-openworld-door-clips.ts";
import { doorSpot } from "./onfoot-doors.ts";
import { DRIVER_SIDE } from "../vehicle/constants.ts";

/** The clip's clock (s) a quarter of the way into the door's opening and a moment past its shutting. */
const HALF_OPEN_S = 0.5;
const SHUT_S = 3;
const RESIDENTS = 4;
const ELSEWHERE_M = 40;

/** A car at the origin facing +z, its driver's door's spot and a crowd of `RESIDENTS` with resident 0 in `activity` `clock` seconds in, standing at that spot. */
function atTheDoor(activity: number, clock: number, at = new THREE.Vector3()) {
  const car = pooledCar(0);
  launch(car, 0, 0, 0, 0, 0);
  car.group.updateMatrixWorld(true);
  const spot = doorSpot(car, new THREE.Vector3());
  const poses = createCrowdPoses(RESIDENTS);
  poses.shown[0] = 1;
  poses.activity[0] = activity;
  poses.activityClock[0] = clock;
  poses.x[0] = spot.x + at.x;
  poses.z[0] = spot.z + at.z;
  return { car, poses };
}

describe("given a client whose civilian is getting into or out of a car", () => {
  it("when she is half way through getting out, then the car's driver door stands open at the angle that poses her hand, and when the clip is over it is shut", () => {
    const { car, poses } = atTheDoor(ACTIVITY.carOut, HALF_OPEN_S);
    const doors = new OpenWorldClientDoors();
    doors.frame(poses, [car]);
    expect(car.doorHinge(DRIVER_SIDE).theta, "door angle mid-clip (rad)").toBeCloseTo(carDoorOpenness(ACTIVITY.carOut, HALF_OPEN_S) * CAR_DOOR.openRad, 6);
    expect(car.doorHinge(DRIVER_SIDE).theta, "open at all").toBeGreaterThan(0.1);
    poses.activityClock[0] = SHUT_S;
    doors.frame(poses, [car]);
    expect(car.doorHinge(DRIVER_SIDE).theta, "door angle after the clip").toBe(0);
  });

  it("when she gets into a car, then the same door follows her clip's clock", () => {
    const { car, poses } = atTheDoor(ACTIVITY.carIn, HALF_OPEN_S);
    new OpenWorldClientDoors().frame(poses, [car]);
    expect(car.doorHinge(DRIVER_SIDE).theta, "door angle mid-clip (rad)").toBeCloseTo(carDoorOpenness(ACTIVITY.carIn, HALF_OPEN_S) * CAR_DOOR.openRad, 6);
  });

  it("when she walks a street away from every car, then no car's door opens", () => {
    const { car, poses } = atTheDoor(ACTIVITY.carOut, HALF_OPEN_S, new THREE.Vector3(ELSEWHERE_M, 0, 0));
    new OpenWorldClientDoors().frame(poses, [car]);
    expect(car.doorHinge(DRIVER_SIDE).theta, "door angle with nobody at it (rad)").toBe(0);
  });

  it("when she is not shown or is doing something else, then the door stays shut", () => {
    const hidden = atTheDoor(ACTIVITY.carOut, HALF_OPEN_S);
    hidden.poses.shown[0] = 0;
    new OpenWorldClientDoors().frame(hidden.poses, [hidden.car]);
    expect(hidden.car.doorHinge(DRIVER_SIDE).theta, "door angle, civilian hidden (rad)").toBe(0);
    const talking = atTheDoor(ACTIVITY.talk, HALF_OPEN_S);
    new OpenWorldClientDoors().frame(talking.poses, [talking.car]);
    expect(talking.car.doorHinge(DRIVER_SIDE).theta, "door angle, civilian talking (rad)").toBe(0);
  });

  it("when the open world is left with a door open, then it is shut", () => {
    const { car, poses } = atTheDoor(ACTIVITY.carOut, HALF_OPEN_S);
    const doors = new OpenWorldClientDoors();
    doors.frame(poses, [car]);
    doors.release([car]);
    expect(car.doorHinge(DRIVER_SIDE).theta, "door angle after release (rad)").toBe(0);
  });
});
