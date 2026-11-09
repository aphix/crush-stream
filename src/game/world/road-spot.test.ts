import { describe, expect, it } from "vitest";
import { detAtan2, hypot2 } from "../kernel/physics-core.js";
import type { PropCollider } from "./placements.ts";
import { course, COURSE_IDS } from "./race-world.test-util.ts";
import { type RoadSpot, roadSpotNear } from "./road-spot.ts";
import { blankPoint, pointOn } from "./track.ts";

/** Where on the course's loop the rows stand (m of arc length). */
const AT_S = 120;
/** The search's step along the road (`roadSpotNear`'s one car and its gap), and the slack (m) a curve and a rounding give a measured distance. */
const STEP_M = 6;
const SLACK_M = 0.6;
const NOTHING = (): boolean => false;

const track = course(COURSE_IDS[0]!);
const point = pointOn(track.path, AT_S, blankPoint());
const heading = detAtan2(point.tx, point.tz);
const spot: RoadSpot = { x: 0, z: 0, y: 0, yaw: 0 };

/** A solid box 3 m square and tall, standing on the road at the row's point. */
const OBSTACLE: PropCollider = { index: 0, prefab: null, body: "solid", x: point.x, z: point.z, yaw: 0, kind: "box", r: 2.1, hx: 1.5, hz: 1.5, mass: 0, base: point.y, top: point.y + 3, ends: 3 };

/** The turn (rad) between two facings, in [0, π]. */
const turnBetween = (a: number, b: number): number => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));

describe("given a point on a course's road", () => {
  it("when the nearest spot is asked for with nothing in the way, then it is the road's point itself, facing the way asked", () => {
    expect(roadSpotNear(track, point.x, point.z, heading, [], NOTHING, spot), "a spot found").toBe(true);
    expect(hypot2(spot.x - point.x, spot.z - point.z), "on the point").toBeLessThan(SLACK_M);
    expect(turnBetween(spot.yaw, heading), "facing along the road").toBeLessThan(0.05);
  });

  // mutation: sed -i 's/const way = detSin(facing) \* _pt.tx + detCos(facing) \* _pt.tz >= 0 ? 1 : -1;/const way = 1;/' src/game/world/road-spot.ts
  it("when it is asked from the other way, then the spot faces back along the same road", () => {
    expect(roadSpotNear(track, point.x, point.z, heading + Math.PI, [], NOTHING, spot)).toBe(true);
    expect(turnBetween(spot.yaw, heading + Math.PI), "facing the way asked").toBeLessThan(0.05);
  });

  // mutation: sed -i 's/    if (occupied(_pt.x, _pt.z) || solidNear(colliders, _pt.x, _pt.y, _pt.z, CAR_REACH)) continue;/    if (occupied(_pt.x, _pt.z)) continue;/' src/game/world/road-spot.ts
  it("when a solid stands on that point, then the spot is a car's length and a gap along the road and clear of it", () => {
    expect(roadSpotNear(track, point.x, point.z, heading, [OBSTACLE], NOTHING, spot)).toBe(true);
    const gap = hypot2(spot.x - point.x, spot.z - point.z);
    expect(gap, `moved off the solid: ${gap.toFixed(2)} m`).toBeGreaterThan(STEP_M - SLACK_M);
    expect(gap, `by one step, not more: ${gap.toFixed(2)} m`).toBeLessThan(STEP_M + SLACK_M);
  });

  // mutation: sed -i 's/    if (occupied(_pt.x, _pt.z) || solidNear/    if (false || solidNear/' src/game/world/road-spot.ts
  it("when a car stands on that point, then the spot is a step along the road from it", () => {
    const taken = (x: number, z: number): boolean => hypot2(x - point.x, z - point.z) < STEP_M / 2;
    expect(roadSpotNear(track, point.x, point.z, heading, [], taken, spot)).toBe(true);
    expect(hypot2(spot.x - point.x, spot.z - point.z), "off the car").toBeGreaterThan(STEP_M / 2);
  });

  it("when every spot within reach is taken, then there is none and the spot is left as it was", () => {
    spot.x = 1;
    expect(roadSpotNear(track, point.x, point.z, heading, [], () => true, spot), "none found").toBe(false);
    expect(spot.x, "untouched").toBe(1);
  });
});
