import { describe, expect, it } from "vitest";
import { firstMismatch } from "../../kernel/compare-arrays.test-util.ts";
import { hypot2 } from "../../kernel/physics-core.js";
import { ACTIVITY, ACTIVITY_SECONDS } from "./civilian-activity.ts";
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

describe("given a resident who got out of her car and then walks on, or is in her car on the road", () => {
  it("when the society says nothing of her and she is on no leg, then she is not drawn, and when she walks, then she is drawn on the ground", () => {
    const { crowd, driver } = crowdWithDriver(ACTIVITY.carOut, true);
    stepOnce(crowd);
    expect(crowd.poses.feetY[driver], "feet at the car").toBeCloseTo(FEET_Y, 5);
    crowd.activityReader = readActivity;
    stepOnce(crowd, 2 * FRAME_SECONDS);
    expect(crowd.poses.shown[driver], "shown on the road, in her car").toBe(0);
    sendAlong(crowd, driver, EDGE, EDGE.from, EDGE.to);
    stepOnce(crowd, 3 * FRAME_SECONDS);
    expect(crowd.poses.shown[driver], "shown walking").toBe(1);
    expect(crowd.poses.feetY[driver], "feet on the ground again").toBe(0);
  });
});
