import { describe, expect, it } from "vitest";
import { firstMismatch } from "../../kernel/compare-arrays.test-util.ts";
import { hypot2 } from "../../kernel/physics-core.js";
import { ACTIVITY, ACTIVITY_SECONDS } from "./civilian-activity.ts";
import { DECISION_HZ, RESIDENT_INT, RESIDENT_INT_STRIDE } from "./civilian-constants.ts";
import { BODY_GAP } from "./civilian-crowd-constants.ts";
import { PACE, people, sendAlong, streetEdge } from "./civilian-crowd-contact.test-util.ts";
import { FRAME_SECONDS, newCrowd } from "./civilian-crowd.test-util.ts";
import type { CivilianCrowd } from "./civilian-crowd.ts";
import { buildFixtureMap } from "./civilian-graph.test-util.ts";
import { readActivity } from "./society-activity.ts";

const map = buildFixtureMap();
const EDGE = streetEdge(map, 20);
const MIDDLE = Math.min(EDGE.length / 2, 10);
const DOOR_X = map.graph.nodeX[EDGE.from]! + EDGE.dirX * MIDDLE;
const DOOR_Z = map.graph.nodeZ[EDGE.from]! + EDGE.dirZ * MIDDLE;
const DOOR_YAW = 1.3;
/** A kerb a hand's breadth over the road and a seat top over it: what the port gives, kept apart so a swap shows. */
const FEET_Y = 0.12;
const SEAT_Y = 0.62;
/** Seconds into the clip the society reads. */
const CLIP_CLOCK = 0.5;
/** What the relaxation leaves of an overlap (m). */
const RESIDUAL = 0.005;
const NO_PARTNER = -1;

/** A crowd whose society says resident `driver` is doing `code` (none: the real brain's word for everyone), and whose cars' doors are at `DOOR_X`, `DOOR_Z`. */
function crowdWithDriver(code: number | null, port: boolean) {
  const crowd = newCrowd(map);
  const [driver] = people(crowd, 1, true) as [number];
  const asked: number[] = [];
  crowd.activityReader = (state, resident, seconds, out) => {
    readActivity(state, resident, seconds, out);
    if (resident !== driver || code === null) return;
    out.code = code;
    out.sinceSeconds = CLIP_CLOCK;
    out.leftSeconds = ACTIVITY_SECONDS[code === ACTIVITY.carIn ? "carIn" : "carOut"] - CLIP_CLOCK;
    out.partner = NO_PARTNER;
    out.placed = false;
  };
  if (port) {
    crowd.driverDoors = (resident, asking, door) => {
      asked.push(resident, asking);
      door.x = DOOR_X;
      door.z = DOOR_Z;
      door.yaw = DOOR_YAW;
      door.feetY = FEET_Y;
      door.surfaceY = SEAT_Y;
      return true;
    };
  }
  return { crowd, driver, asked };
}

function stepOnce(crowd: CivilianCrowd, seconds = FRAME_SECONDS): void {
  crowd.step(seconds, [], true);
}

describe.each([ACTIVITY.carIn, ACTIVITY.carOut])("given a resident the society has at her car's door (activity %i) and a port that says where it is", (code) => {
  const { crowd, driver, asked } = crowdWithDriver(code, true);
  stepOnce(crowd);

  it("when the crowd is stepped, then she is shown at the door spot, facing the car, her feet and seat top where the port says, in the activity's clip", () => {
    const { shown, x, z, yaw, feetY, surfaceY, activity, activityClock, activityLeft } = crowd.poses;
    expect(shown[driver], "shown").toBe(1);
    expect(hypot2(x[driver]! - DOOR_X, z[driver]! - DOOR_Z), "metres from the door spot").toBeLessThan(RESIDUAL);
    expect(yaw[driver], "yaw").toBeCloseTo(DOOR_YAW, 5);
    expect(feetY[driver], "feet").toBeCloseTo(FEET_Y, 5);
    expect(surfaceY[driver], "seat top").toBeCloseTo(SEAT_Y, 5);
    expect(activity[driver], "activity").toBe(code);
    expect(activityClock[driver], "clock").toBeCloseTo(CLIP_CLOCK, 5);
    expect(activityLeft[driver], "left").toBeGreaterThan(0);
    expect(firstMismatch(asked.slice(0, 2), [driver, code]), "what the port was asked: her, and the activity").toBeUndefined();
  });

  it("when someone walks through her spot, then she stays on it and the one walking is drawn a body's width round her", () => {
    const [walker] = people(crowd, 1) as [number];
    sendAlong(crowd, walker, EDGE, EDGE.from, EDGE.to);
    let closest = Infinity;
    let farthestFromDoor = 0;
    for (let seconds = FRAME_SECONDS * 2; seconds < EDGE.length / PACE; seconds += FRAME_SECONDS) {
      stepOnce(crowd, seconds);
      if (crowd.poses.shown[walker] === 0) continue;
      closest = Math.min(closest, hypot2(crowd.poses.x[walker]! - crowd.poses.x[driver]!, crowd.poses.z[walker]! - crowd.poses.z[driver]!));
      farthestFromDoor = Math.max(farthestFromDoor, hypot2(crowd.poses.x[driver]! - DOOR_X, crowd.poses.z[driver]! - DOOR_Z));
    }
    expect(closest, "closest the walker is drawn to her").toBeGreaterThanOrEqual(BODY_GAP - RESIDUAL);
    expect(farthestFromDoor, "furthest she is drawn from the door spot").toBeLessThan(RESIDUAL);
  });
});

describe("given a resident at her car's door and no port, or a port that finds no car", () => {
  it("when the crowd is stepped, then she is not drawn", () => {
    const none = crowdWithDriver(ACTIVITY.carIn, false);
    stepOnce(none.crowd);
    expect(none.crowd.poses.shown[none.driver], "shown without a port").toBe(0);
    const carless = crowdWithDriver(ACTIVITY.carOut, true);
    carless.crowd.driverDoors = () => false;
    stepOnce(carless.crowd);
    expect(carless.crowd.poses.shown[carless.driver], "shown without a car").toBe(0);
  });
});

describe("given a resident whose leg goes by car: to it, in it, along the road, out of it, and on", () => {
  /** The leg runs 15 s or more; the car leaves at 4 s (getting in is the 2.6 s before) and is parked at 8 s (getting out is the 2.4 s after). */
  const LEAVE_TICK = 4 * DECISION_HZ;
  const PARK_TICK = 8 * DECISION_HZ;
  const WALKING_TO_CAR = 0.5;
  const GETTING_IN = 2;
  const ON_THE_ROAD = 6;
  const GETTING_OUT = 8.5;
  const WALKING_ON = 12;
  const FIRST_NODE = 0;
  const LAST_NODE = 1;

  function byCar() {
    const { crowd, driver } = crowdWithDriver(null, true);
    sendAlong(crowd, driver, EDGE, EDGE.from, EDGE.to);
    const base = driver * RESIDENT_INT_STRIDE;
    crowd.state.ints[base + RESIDENT_INT.driveFirst] = FIRST_NODE;
    crowd.state.ints[base + RESIDENT_INT.driveLast] = LAST_NODE;
    crowd.state.ints[base + RESIDENT_INT.driveLeaveTick] = LEAVE_TICK;
    crowd.state.ints[base + RESIDENT_INT.driveParkTick] = PARK_TICK;
    return { crowd, driver };
  }

  it("when the leg is walked, then she is at the car's door while she gets in and out, not drawn while the car is on the road, and on the street on foot before and after, her feet on the ground", () => {
    const { crowd, driver } = byCar();
    const at = (seconds: number) => {
      stepOnce(crowd, seconds);
      return { shown: crowd.poses.shown[driver], activity: crowd.poses.activity[driver], feetY: crowd.poses.feetY[driver], x: crowd.poses.x[driver] };
    };
    const beforeCar = at(WALKING_TO_CAR);
    expect(firstMismatch([beforeCar.shown, beforeCar.activity, beforeCar.feetY], [1, ACTIVITY.none, 0]), "shown, in no clip, her feet on the ground, on the way to the car").toBeUndefined();
    const gettingIn = at(GETTING_IN);
    expect(firstMismatch([gettingIn.shown, gettingIn.activity, gettingIn.x], [1, ACTIVITY.carIn, Math.fround(DOOR_X)]), "getting in: at the door spot").toBeUndefined();
    expect(gettingIn.feetY, "feet at the door").toBeCloseTo(FEET_Y, 5);
    expect(at(ON_THE_ROAD).shown, "shown on the road, in her car").toBe(0);
    const gettingOut = at(GETTING_OUT);
    expect(firstMismatch([gettingOut.shown, gettingOut.activity, gettingOut.x], [1, ACTIVITY.carOut, Math.fround(DOOR_X)]), "getting out: at the door spot").toBeUndefined();
    const walkingOn = at(WALKING_ON);
    expect(firstMismatch([walkingOn.shown, walkingOn.activity, walkingOn.feetY], [1, ACTIVITY.none, 0]), "walking on, in no clip, her feet on the ground again").toBeUndefined();
  });
});
