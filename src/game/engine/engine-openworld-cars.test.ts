import { describe, expect, it } from "vitest";
import { ACTIVITY } from "../ai/civilians/civilian-activity.ts";
import { CAR_DOOR, carDoorOpenness } from "../ai/civilians/civilian-car-door.ts";
import { NO_PLACE, RESIDENT_INT, RESIDENT_INT_STRIDE } from "../ai/civilians/civilian-constants.ts";
import { firstMismatch } from "../kernel/compare-arrays.test-util.ts";
import { emptyPoses } from "../present/civilian-art.test-util.ts";
import { OpenWorldCarDoors } from "./engine-openworld-cars.ts";

const DRIVER = 3;
const HOUSEMATE = 4;
const RESIDENTS = 6;
const CLOCK_WIDE_OPEN = 1.5;

type Call = { resident: number; radians: number };

/** A traffic that has a car for `DRIVER` only, and writes every door it is told to set. */
function traffic(calls: Call[]) {
  return {
    setCarDoor(resident: number, radians: number): boolean {
      calls.push({ resident, radians });
      return resident === DRIVER;
    },
  };
}

/** Residents who each drive the car of their own number, but `HOUSEMATE`, who rides in `DRIVER`'s. */
function brain() {
  const ints = new Int32Array(RESIDENTS * RESIDENT_INT_STRIDE).fill(NO_PLACE);
  for (let resident = 0; resident < RESIDENTS; resident++) ints[resident * RESIDENT_INT_STRIDE + RESIDENT_INT.carOwner] = resident;
  ints[HOUSEMATE * RESIDENT_INT_STRIDE + RESIDENT_INT.carOwner] = DRIVER;
  return { ints };
}

describe("given a driver whose car stands in a space", () => {
  it("when her clip of getting in runs, then her car's door is set to the clip's angle, and shut once the clip is over", () => {
    const calls: Call[] = [];
    const doors = new OpenWorldCarDoors(RESIDENTS, brain(), () => traffic(calls));
    const poses = emptyPoses(RESIDENTS);
    poses.activity[DRIVER] = ACTIVITY.carIn;
    poses.activityClock[DRIVER] = CLOCK_WIDE_OPEN;
    doors.step(poses);
    expect(calls, "one door set").toHaveLength(1);
    expect(calls[0]!.radians, "the door open as the clip has it").toBeCloseTo(carDoorOpenness(ACTIVITY.carIn, CLOCK_WIDE_OPEN) * CAR_DOOR.openRad, 6);
    expect(calls[0]!.radians, "wide open").toBeCloseTo(CAR_DOOR.openRad, 6);
    doors.step(poses);
    expect(calls, "a door that has not moved is not set again").toHaveLength(1);
    poses.activity[DRIVER] = ACTIVITY.none;
    doors.step(poses);
    expect(calls.at(-1)?.resident, "the driver's door").toBe(DRIVER);
    expect(calls.at(-1)?.radians, "shut").toBe(0);
    doors.step(poses);
    expect(calls, "shut once").toHaveLength(2);
  });

  it("when the one in the clip is a housemate, then it is the owner's car whose door swings, and it stays open while the owner herself is in no clip", () => {
    const calls: Call[] = [];
    const doors = new OpenWorldCarDoors(RESIDENTS, brain(), () => traffic(calls));
    const poses = emptyPoses(RESIDENTS);
    poses.activity[HOUSEMATE] = ACTIVITY.carOut;
    poses.activityClock[HOUSEMATE] = 1;
    doors.step(poses);
    expect(firstMismatch(calls.map((call) => call.resident), [DRIVER]), "the doors set: the owner's car only").toBeUndefined();
    expect(calls[0]!.radians, "open").toBeGreaterThan(0);
    doors.step(poses);
    expect(calls, "the owner's own step does not shut the door the housemate holds open").toHaveLength(1);
  });

  it("when she is not drawn or her activity is no car clip, or there is no traffic (a client), then no door is set", () => {
    const calls: Call[] = [];
    const doors = new OpenWorldCarDoors(RESIDENTS, brain(), () => traffic(calls));
    const poses = emptyPoses(RESIDENTS);
    poses.activity[DRIVER] = ACTIVITY.carOut;
    poses.activityClock[DRIVER] = 1;
    poses.shown[DRIVER] = 0;
    doors.step(poses);
    poses.shown[DRIVER] = 1;
    poses.activity[DRIVER] = ACTIVITY.door;
    doors.step(poses);
    poses.activity[DRIVER] = ACTIVITY.carOut;
    new OpenWorldCarDoors(RESIDENTS, brain(), () => null).step(poses);
    expect(calls).toHaveLength(0);
  });

  // mutation: sed -i 's/^      if (traffic.setCarDoor(car, want)) this.radians\[car\] = want;/      this.radians[car] = want;/' src/game/engine/engine-openworld-cars.ts
  it("when the traffic refuses a car's door (no car stands at her space), then the host asks again the next step (guard)", () => {
    const calls: Call[] = [];
    const doors = new OpenWorldCarDoors(RESIDENTS, brain(), () => traffic(calls));
    const poses = emptyPoses(RESIDENTS);
    poses.activity[1] = ACTIVITY.carOut;
    poses.activityClock[1] = 1;
    poses.shown[1] = 1;
    doors.step(poses);
    doors.step(poses);
    expect(calls.filter((call) => call.resident === 1), "asked again after the refusal").toHaveLength(2);
  });
});
