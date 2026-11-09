import { describe, expect, it } from "vitest";
import { ACTIVITY } from "../ai/civilians/civilian-activity.ts";
import { CAR_DOOR, carDoorOpenness, type DoorSpot } from "../ai/civilians/civilian-car-door.ts";
import { RESIDENT_INT, RESIDENT_INT_STRIDE } from "../ai/civilians/civilian-constants.ts";
import { residentCarPose, type ResidentCarPose } from "../ai/openworld-traffic/traffic-look.ts";
import { emptyPoses } from "../present/civilian-art.test-util.ts";
import { CAR_STYLES } from "../vehicle/car-variants.ts";
import { LAYOUT } from "../world/openworld/openworld-constants.ts";
import { openWorldGeometry } from "../world/openworld/openworld-layout.ts";
import { buildParkingSpots } from "../world/openworld/openworld-parking.ts";
import { buildRoadNetwork } from "../world/openworld/openworld-roads.ts";
import type { Place } from "../world/openworld/walk-graph.ts";
import { OpenWorldCarDoors } from "./engine-openworld-cars.ts";

const DRIVER = 3;
const RESIDENTS = 6;
/** The driver's car, as the host's traffic has it parked: at (10, 20) facing +z, on ground 0.25 m high, a pickup (its H-point stands higher than a sedan's). */
const HOST_CAR: ResidentCarPose = { x: 10, z: 20, yaw: 0, groundY: 0.25, bodyStyle: "pickup" };
const KERB = buildParkingSpots(buildRoadNetwork(openWorldGeometry(LAYOUT)));
/** Two places, far apart, a trip leaves from and goes to. */
const PLACES = [
  { doorX: KERB.x[0]!, doorZ: KERB.z[0]! },
  { doorX: KERB.x[KERB.x.length - 1]!, doorZ: KERB.z[KERB.z.length - 1]! },
] as Place[];

type Call = { resident: number; radians: number };

/** A traffic that has a car for `DRIVER` only, and writes every door it is told to set. */
function traffic(calls: Call[], holding = DRIVER) {
  return {
    carPoseOf(resident: number, out: ResidentCarPose): boolean {
      if (resident !== holding) return false;
      Object.assign(out, HOST_CAR);
      return true;
    },
    setCarDoor(resident: number, radians: number): boolean {
      calls.push({ resident, radians });
      return resident === DRIVER;
    },
  };
}

/** The society's rows with `DRIVER` leaving place 0 for place 1. */
function rows(): { ints: Int32Array } {
  const ints = new Int32Array(RESIDENTS * RESIDENT_INT_STRIDE).fill(-1);
  ints[DRIVER * RESIDENT_INT_STRIDE + RESIDENT_INT.fromPlace] = 0;
  ints[DRIVER * RESIDENT_INT_STRIDE + RESIDENT_INT.place] = 1;
  return { ints };
}

const hostDoors = (calls: Call[] = [], holding = DRIVER): OpenWorldCarDoors => new OpenWorldCarDoors(RESIDENTS, { traffic: () => traffic(calls, holding), kerb: () => KERB, state: rows, places: PLACES });
const clientDoors = (): OpenWorldCarDoors => new OpenWorldCarDoors(RESIDENTS, { traffic: () => null, kerb: () => KERB, state: rows, places: PLACES });
const nobody = (): DoorSpot => ({ x: 0, z: 0, yaw: 0, feetY: 0, surfaceY: 0 });

describe("given a driver whose car stands in a space", () => {
  it("when she gets in on the host, then her spot is out from her car's seat on the street side, at the ground there, her seat top the car's own H-point less the hip", () => {
    const [across, up, along] = CAR_STYLES.pickup.seats.front;
    const out = nobody();
    expect(hostDoors().spot(DRIVER, ACTIVITY.carIn, out)).toBe(true);
    expect(out.x, "out from the seat").toBeCloseTo(HOST_CAR.x + across + CAR_DOOR.outFromSeat, 6);
    expect(out.z, "behind the seat").toBeCloseTo(HOST_CAR.z + along - CAR_DOOR.behindSeat, 6);
    expect(out.feetY, "the ground").toBeCloseTo(HOST_CAR.groundY, 6);
    expect(out.surfaceY, "seat top").toBeCloseTo(HOST_CAR.groundY + up - CAR_DOOR.hipOverSeat, 6);
  });

  it("when a client has no traffic, then she stands at the space the place's door gives her car by the pure pose: getting in at the place she leaves, getting out at the place she goes to", () => {
    const doors = clientDoors();
    for (const [code, place] of [[ACTIVITY.carIn, 0], [ACTIVITY.carOut, 1]] as const) {
      const car: ResidentCarPose = { x: 0, z: 0, yaw: 0, groundY: 0, bodyStyle: "sedan" };
      expect(residentCarPose(KERB, PLACES[place]!.doorX, PLACES[place]!.doorZ, DRIVER, () => 0, car), "a space there").toBe(true);
      const [across, , along] = CAR_STYLES[car.bodyStyle].seats.front;
      const out = nobody();
      expect(doors.spot(DRIVER, code, out), `code ${code}`).toBe(true);
      const sine = Math.sin(car.yaw);
      const cosine = Math.cos(car.yaw);
      const sideways = across + CAR_DOOR.outFromSeat;
      const forward = along - CAR_DOOR.behindSeat;
      expect(out.x, `code ${code} x`).toBeCloseTo(car.x + sideways * cosine + forward * sine, 5);
      expect(out.z, `code ${code} z`).toBeCloseTo(car.z - sideways * sine + forward * cosine, 5);
    }
  });

  it("when the host's traffic does not hold her car yet, then she stands where a client would, and when no place is known she has no spot", () => {
    const hosted = nobody();
    const client = nobody();
    expect(hostDoors([], -1).spot(DRIVER, ACTIVITY.carIn, hosted), "the host without her car").toBe(true);
    expect(clientDoors().spot(DRIVER, ACTIVITY.carIn, client), "a client").toBe(true);
    expect(hosted.x, "same x").toBe(client.x);
    expect(hosted.z, "same z").toBe(client.z);
    const out = nobody();
    expect(hostDoors().spot(DRIVER + 1, ACTIVITY.carIn, out), "no car and no place").toBe(false);
    const placeless = new OpenWorldCarDoors(RESIDENTS, { traffic: () => null, kerb: () => KERB, state: rows, places: [] });
    expect(placeless.spot(DRIVER, ACTIVITY.carIn, out), "no places").toBe(false);
    const kerbless = new OpenWorldCarDoors(RESIDENTS, { traffic: () => null, kerb: () => null, state: rows, places: PLACES });
    expect(kerbless.spot(DRIVER, ACTIVITY.carIn, out), "no kerb").toBe(false);
  });

  it("when her clip of getting in runs, then her car's door is set to the clip's angle, and shut once the clip is over", () => {
    const calls: Call[] = [];
    const doors = hostDoors(calls);
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

  it("when she is not drawn or her activity is no car clip, then no door is set, and a client sets none", () => {
    const calls: Call[] = [];
    const doors = hostDoors(calls);
    const poses = emptyPoses(RESIDENTS);
    poses.activity[DRIVER] = ACTIVITY.carOut;
    poses.activityClock[DRIVER] = 1;
    poses.shown[DRIVER] = 0;
    doors.step(poses);
    poses.shown[DRIVER] = 1;
    poses.activity[DRIVER] = ACTIVITY.door;
    doors.step(poses);
    poses.activity[DRIVER] = ACTIVITY.carOut;
    clientDoors().step(poses);
    expect(calls).toHaveLength(0);
  });
});
