import { describe, expect, it } from "vitest";
import { ACTIVITY } from "../ai/civilians/civilian-activity.ts";
import { CAR_DOOR, carDoorOpenness, type DoorSpot } from "../ai/civilians/civilian-car-door.ts";
import { emptyPoses } from "../present/civilian-art.test-util.ts";
import { CAR_STYLES } from "../vehicle/car-variants.ts";
import { OpenWorldCarDoors } from "./engine-openworld-cars.ts";

const DRIVER = 3;
const RESIDENTS = 6;
/** The driver's sedan stands at (10, 20) facing +z; its seat's H-point across, up and along. */
const CAR_AT = { x: 10, z: 20, yaw: 0 } as const;
const [SEAT_ACROSS, SEAT_UP, SEAT_ALONG] = CAR_STYLES.sedan.seats.front;

type Call = { resident: number; radians: number };

/** A traffic that has a car for `DRIVER` only, and writes every door it is told to set. */
function traffic(calls: Call[]) {
  return {
    carPoseOf(resident: number, out: { x: number; z: number; yaw: number }): boolean {
      if (resident !== DRIVER) return false;
      Object.assign(out, CAR_AT);
      return true;
    },
    setCarDoor(resident: number, radians: number): boolean {
      calls.push({ resident, radians });
      return resident === DRIVER;
    },
  };
}

const nobody = (): DoorSpot => ({ x: 0, z: 0, yaw: 0, feetY: 0, surfaceY: 0 });

describe("given a driver whose car stands in a space", () => {
  it("when she gets in, then her spot is out from her car's seat on the street side, at the ground, her seat top the sedan's H-point less the hip", () => {
    const doors = new OpenWorldCarDoors(RESIDENTS, () => traffic([]));
    const out = nobody();
    expect(doors.spot(DRIVER, out)).toBe(true);
    expect(out.x, "out from the seat").toBeCloseTo(CAR_AT.x + SEAT_ACROSS + CAR_DOOR.outFromSeat, 6);
    expect(out.z, "behind the seat").toBeCloseTo(CAR_AT.z + SEAT_ALONG - CAR_DOOR.behindSeat, 6);
    expect(out.surfaceY, "seat top").toBeCloseTo(SEAT_UP - CAR_DOOR.hipOverSeat, 6);
  });

  it("when a resident has no car, or there is no traffic (a client), then she has no spot", () => {
    const doors = new OpenWorldCarDoors(RESIDENTS, () => traffic([]));
    expect(doors.spot(DRIVER + 1, nobody()), "no car").toBe(false);
    const client = new OpenWorldCarDoors(RESIDENTS, () => null);
    expect(client.spot(DRIVER, nobody()), "no traffic").toBe(false);
  });

  it("when her clip of getting in runs, then her car's door is set to the clip's angle, and shut once the clip is over", () => {
    const calls: Call[] = [];
    const doors = new OpenWorldCarDoors(RESIDENTS, () => traffic(calls));
    const poses = emptyPoses(RESIDENTS);
    poses.activity[DRIVER] = ACTIVITY.carIn;
    poses.activityClock[DRIVER] = 1.5;
    doors.step(poses);
    expect(calls, "one door set").toHaveLength(1);
    expect(calls[0]!.radians, "the door open as the clip has it").toBeCloseTo(carDoorOpenness(ACTIVITY.carIn, 1.5) * CAR_DOOR.openRad, 6);
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

  it("when she is not drawn or her activity is no car clip, then no door is set", () => {
    const calls: Call[] = [];
    const doors = new OpenWorldCarDoors(RESIDENTS, () => traffic(calls));
    const poses = emptyPoses(RESIDENTS);
    poses.activity[DRIVER] = ACTIVITY.carOut;
    poses.activityClock[DRIVER] = 1;
    poses.shown[DRIVER] = 0;
    doors.step(poses);
    poses.shown[DRIVER] = 1;
    poses.activity[DRIVER] = ACTIVITY.door;
    doors.step(poses);
    expect(calls).toHaveLength(0);
  });
});
