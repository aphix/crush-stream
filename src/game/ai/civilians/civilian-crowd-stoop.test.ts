import { describe, expect, it } from "vitest";
import { detCos, detSin } from "../../kernel/physics-core.js";
import { DOOR, type Frontage, STOOP, stoopStepRange } from "../../world/openworld/openworld-facade-solids.ts";
import { Stoops } from "../../world/openworld/openworld-stoops.ts";
import { ACTIVITY } from "./civilian-activity.ts";
import { PACE, people, sendAlong, streetEdge } from "./civilian-crowd-contact.test-util.ts";
import { newCrowd } from "./civilian-crowd.test-util.ts";
import type { CivilianCrowd } from "./civilian-crowd.ts";
import { buildFixtureMap } from "./civilian-graph.test-util.ts";
import { readActivity } from "./society-activity.ts";

const map = buildFixtureMap();
const EDGE = streetEdge(map, 20);
const START = { x: map.graph.nodeX[EDGE.from]!, z: map.graph.nodeZ[EDGE.from]! };
/** The house whose door is the edge's first node and whose front looks along it, so a resident sent along the edge walks out of the door and down the stoop. */
const HOUSE_YAW = Math.atan2(-EDGE.dirZ, EDGE.dirX);
const HOUSE: Frontage = { x: START.x - detSin(HOUSE_YAW) * DOOR.across, z: START.z - detCos(HOUSE_YAW) * DOOR.across, yaw: HOUSE_YAW, depth: 10, style: "federal", storeys: 3, variant: 0 };
const STEP_3 = stoopStepRange(3);

/** A crowd whose resident `person` walks along the edge at `PACE` from the first second, the stoops in place or not: out of her door at its first node, or (`coming`) home from the far end to it. */
function leaving(stoops: Stoops | null, coming = false): { crowd: CivilianCrowd; person: number } {
  const crowd = newCrowd(map);
  const [person] = people(crowd, 1, true) as [number];
  crowd.stoops = stoops;
  if (coming) sendAlong(crowd, person, EDGE, EDGE.to, EDGE.from);
  else sendAlong(crowd, person, EDGE, EDGE.from, EDGE.to);
  return { crowd, person };
}

/** Her height `metres` out from her door: the crowd stepped to the second she is there. */
function heightAfter(crowd: CivilianCrowd, person: number, metres: number): number {
  crowd.step(metres / PACE, [], true);
  expect(crowd.poses.shown[person], `shown ${metres} m out`).toBe(1);
  return crowd.poses.feetY[person]!;
}

describe("given a resident who walks out of a rowhome's door along the way its stoop runs", () => {
  // mutation: sed -i 's/^    this.liftWalkers();$/    void 0;/' src/game/ai/civilians/civilian-crowd.ts
  it("when she leaves, then she is at the sill's height at the door, on a tread's height on each step, and at the street's height past the bottom one", () => {
    const { crowd, person } = leaving(new Stoops([HOUSE], [EDGE.from]));
    expect(heightAfter(crowd, person, 0.1), "at the door").toBeCloseTo(STOOP.sill, 3);
    expect(heightAfter(crowd, person, (STEP_3.near + STEP_3.far) / 2), "on the third step").toBeCloseTo(STEP_3.top, 3);
    expect(heightAfter(crowd, person, STOOP.run - STOOP.tread / 2), "on the bottom step").toBeCloseTo(STOOP.rise, 3);
    expect(heightAfter(crowd, person, STOOP.run + STOOP.tread), "past it").toBe(0);
  });

  // mutation: sed -i 's/leadsToDoor(pose.from, pose.to) ? 1 : 0/leadsToDoor(pose.from, pose.to) ? 0 : 0/' src/game/ai/civilians/civilian-crowd.ts
  it("when she walks a stoop door's spur the drawing is told (onSpur is 1), and on a walk that is not its spur it is 0", () => {
    const spur = leaving(new Stoops([HOUSE], [EDGE.from]));
    heightAfter(spur.crowd, spur.person, (STEP_3.near + STEP_3.far) / 2);
    expect(spur.crowd.poses.onSpur[spur.person], "on the door's spur").toBe(1);
    const lane = leaving(new Stoops([HOUSE]));
    heightAfter(lane.crowd, lane.person, (STEP_3.near + STEP_3.far) / 2);
    expect(lane.crowd.poses.onSpur[lane.person], "on the sidewalk lane").toBe(0);
  });

  // mutation: sed -i 's/    if (stoops === null) return;/    if (stoops === null) { this.poses.feetY.fill(0.5); return; }/' src/game/ai/civilians/civilian-crowd.ts
  it("when there are no stoops, then she is at the street's height all the way", () => {
    const { crowd, person } = leaving(null);
    expect(heightAfter(crowd, person, 0.1)).toBe(0);
    expect(heightAfter(crowd, person, (STEP_3.near + STEP_3.far) / 2)).toBe(0);
  });

  // mutation: sed -i 's/return this.doors\[from\] === 1 || this.doors\[to\] === 1;/return true;/' src/game/world/openworld/openworld-stoops.ts
  it("when she walks over a stoop's steps on a walk that is not its door's spur (the sidewalk's lane in front of it), then she stays at the street's height", () => {
    const { crowd, person } = leaving(new Stoops([HOUSE]));
    expect(heightAfter(crowd, person, 0.1), "at the door's spot").toBe(0);
    expect(heightAfter(crowd, person, (STEP_3.near + STEP_3.far) / 2), "over the third step").toBe(0);
  });

  // mutation: sed -i 's/this.poses.onSpur\[resident\] = 0;/this.poses.onSpur[resident] = 1;/' src/game/ai/civilians/civilian-crowd.ts
  it("when the society stands her at a seat on the steps, then she is not lifted again: her seat's height is her own", () => {
    const { crowd, person } = leaving(new Stoops([HOUSE], [EDGE.from]));
    const onStep = (STEP_3.near + STEP_3.far) / 2;
    crowd.activityReader = (state, resident, seconds, out) => {
      readActivity(state, resident, seconds, out);
      if (resident !== person) return;
      out.code = ACTIVITY.sitSteps;
      out.placed = true;
      out.fixed = true;
      out.x = START.x + EDGE.dirX * onStep;
      out.z = START.z + EDGE.dirZ * onStep;
      out.yaw = HOUSE_YAW;
      out.surfaceY = STEP_3.top;
    };
    crowd.step(1, [], true);
    expect(crowd.poses.shown[person]).toBe(1);
    expect(crowd.poses.feetY[person], "feet at the street under the seat").toBe(0);
    expect(crowd.poses.surfaceY[person], "her seat is the step's top").toBeCloseTo(STEP_3.top, 5);
  });

  // mutation: sed -i 's/^    this.liftWalkers();$/    void 0;/' src/game/ai/civilians/civilian-crowd.ts
  it("when she comes home, then she is at the street's height at the foot, on a tread's height on each step going up, and at the sill's height at the door", () => {
    const { crowd, person } = leaving(new Stoops([HOUSE], [EDGE.from]), true);
    const fromDoor = (metres: number): number => EDGE.length - metres;
    expect(heightAfter(crowd, person, fromDoor(STOOP.run + STOOP.tread)), "at the street").toBe(0);
    expect(heightAfter(crowd, person, fromDoor(STOOP.run - STOOP.tread / 2)), "on the bottom step").toBeCloseTo(STOOP.rise, 3);
    expect(heightAfter(crowd, person, fromDoor((STEP_3.near + STEP_3.far) / 2)), "on the third step").toBeCloseTo(STEP_3.top, 3);
    expect(heightAfter(crowd, person, fromDoor(0.1)), "at the door").toBeCloseTo(STOOP.sill, 3);
  });
});
