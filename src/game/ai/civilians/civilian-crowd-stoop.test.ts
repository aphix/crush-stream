import { describe, expect, it } from "vitest";
import { detCos, detSin } from "../../kernel/physics-core.js";
import { DOOR, type Frontage, STOOP, stoopStepRange } from "../../world/openworld/openworld-facade-solids.ts";
import { Stoops } from "../../world/openworld/openworld-stoops.ts";
import { ACTIVITY } from "./civilian-activity.ts";
import { LATERAL_MAX, RESIDENT_FLOAT, RESIDENT_FLOAT_STRIDE } from "./civilian-constants.ts";
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

/** A rowhome whose front faces the edge's lane, 1.5 m out from its facade, its door line meeting the leg's middle. */
function houseOnTheLane(): Frontage {
  const mid = EDGE.length / 2;
  const mx = START.x + EDGE.dirX * mid;
  const mz = START.z + EDGE.dirZ * mid;
  return { ...HOUSE, yaw: HOUSE_YAW + Math.PI / 2, x: mx - 1.5 * EDGE.dirZ - DOOR.across * EDGE.dirX, z: mz + 1.5 * EDGE.dirX - DOOR.across * EDGE.dirZ };
}

/** Her distances out from `house`'s facade at each step while she is level with its stoop, walking the lane at its house side. */
function outsWhileLevel(house: Frontage, stoops: Stoops | null): number[] {
  const mid = EDGE.length / 2;
  const { crowd, person } = leaving(stoops);
  crowd.state.floats[person * RESIDENT_FLOAT_STRIDE + RESIDENT_FLOAT.lateral] = -LATERAL_MAX;
  const outs: number[] = [];
  for (let t = (mid - 1.5) / PACE; t <= (mid + 1.5) / PACE; t += 0.1) {
    crowd.step(t, [], true);
    const dx = crowd.poses.x[person]! - house.x;
    const dz = crowd.poses.z[person]! - house.z;
    const across = dx * EDGE.dirX + dz * EDGE.dirZ - DOOR.across;
    if (Math.abs(across) <= STOOP.width / 2) outs.push(dx * EDGE.dirZ - dz * EDGE.dirX);
  }
  return outs;
}

describe("given a rowhome whose stoop runs out across the sidewalk a resident walks", () => {
  // mutation: sed -i '/^      if (this.laneWalking\[resident\] === 1 \&\& this.stoops !== null) this.stoops.keepOut(x, z, resident);/d' src/game/ai/civilians/civilian-crowd.ts
  it("when she walks past it on the side of the lane nearest the houses, then she is drawn at least the stoop's run and 0.6 m out from the facade while level with it", () => {
    const outs = outsWhileLevel(houseOnTheLane(), new Stoops([houseOnTheLane()]));
    expect(outs.length, "steps at which she was level with the stoop").toBeGreaterThan(3);
    for (const out of outs) expect(out, "out from the facade").toBeGreaterThanOrEqual(STOOP.run + 0.6 - 1e-4);
  });

  // mutation: sed -i 's/^      x\[resident\] = separation.drawX\[resident\]!;/      x[resident] = separation.drawX[resident]! + 9;/' src/game/ai/civilians/civilian-crowd.ts
  it("when the same walk is drawn with no stoops, then she is drawn on the stoop: under its run out from the facade while level with it", () => {
    const outs = outsWhileLevel(houseOnTheLane(), null);
    expect(outs.length, "steps at which she was level with the stoop").toBeGreaterThan(3);
    expect(Math.max(...outs), "her farthest out from the facade").toBeLessThan(STOOP.run);
  });

  // mutation: sed -i 's/^      const need = STOOP.run + KEEP_CLEAR - Math.max(0, across - STOOP.width \/ 2);/      const need = 0;/' src/game/world/openworld/openworld-stoops.ts
  it("when a point on a stoop's middle is kept out, then it lands the stoop's run and 0.6 m out from the facade on the same line across; a point 3 m to the side is not moved", () => {
    const stoops = new Stoops([HOUSE]);
    const cos = detCos(HOUSE.yaw);
    const sin = detSin(HOUSE.yaw);
    const place = (out: number, across: number): [Float32Array, Float32Array] => [Float32Array.of(HOUSE.x + cos * out + sin * across), Float32Array.of(HOUSE.z - sin * out + cos * across)];
    const read = (xs: Float32Array, zs: Float32Array) => ({ out: (xs[0]! - HOUSE.x) * cos - (zs[0]! - HOUSE.z) * sin, across: (xs[0]! - HOUSE.x) * sin + (zs[0]! - HOUSE.z) * cos });
    const [x, z] = place(STOOP.run / 2, DOOR.across);
    stoops.keepOut(x, z, 0);
    expect(read(x, z).out, "out from the facade").toBeCloseTo(STOOP.run + 0.6, 3);
    expect(read(x, z).across, "the same line across").toBeCloseTo(DOOR.across, 3);
    const [sx, sz] = place(STOOP.run / 2, DOOR.across + 3);
    stoops.keepOut(sx, sz, 0);
    expect(read(sx, sz).out, "3 m to the side: not moved").toBeCloseTo(STOOP.run / 2, 3);
  });
});

/** Her drawn distance out from HOUSE's facade after one step in which the law's overlay draws her at the middle of its stoop. */
function outAfterOverlayOnStoop(stoops: Stoops | null): number {
  const { crowd, person } = leaving(stoops);
  const out = STOOP.run / 2;
  crowd.overlay = (poses) => {
    poses.x[person] = HOUSE.x + detCos(HOUSE.yaw) * out + detSin(HOUSE.yaw) * DOOR.across;
    poses.z[person] = HOUSE.z - detSin(HOUSE.yaw) * out + detCos(HOUSE.yaw) * DOOR.across;
  };
  crowd.step(1, [], true);
  expect(crowd.poses.shown[person], "she is drawn").toBe(1);
  return (crowd.poses.x[person]! - HOUSE.x) * detCos(HOUSE.yaw) - (crowd.poses.z[person]! - HOUSE.z) * detSin(HOUSE.yaw);
}

describe("given a resident the law's overlay draws at the middle of a rowhome's stoop", () => {
  // mutation: sed -i '/^      this.keepOverlaidOut();/d' src/game/ai/civilians/civilian-crowd.ts
  it("when the crowd takes the overlay, then she is drawn the stoop's run and 0.6 m out from the facade", () => {
    expect(outAfterOverlayOnStoop(new Stoops([HOUSE]))).toBeCloseTo(STOOP.run + 0.6, 3);
  });

  // mutation: sed -i 's/^    if (stoops === null) return;$/    if (false as boolean) return;/' src/game/ai/civilians/civilian-crowd.ts
  it("when the same overlay is drawn with no stoops, then she is drawn where the law put her: half the stoop's run out", () => {
    expect(outAfterOverlayOnStoop(null)).toBeCloseTo(STOOP.run / 2, 3);
  });
});

/** How many steps she is marked kept while level with the stoop of `houseOnTheLane()`, walking the house side of the lane. */
function keptStepsLevel(stoops: Stoops | null): number {
  const house = houseOnTheLane();
  const mid = EDGE.length / 2;
  const { crowd, person } = leaving(stoops);
  crowd.state.floats[person * RESIDENT_FLOAT_STRIDE + RESIDENT_FLOAT.lateral] = -LATERAL_MAX;
  let kept = 0;
  for (let t = (mid - 1.5) / PACE; t <= (mid + 1.5) / PACE; t += 0.1) {
    crowd.step(t, [], true);
    const dx = crowd.poses.x[person]! - house.x;
    const dz = crowd.poses.z[person]! - house.z;
    const across = dx * EDGE.dirX + dz * EDGE.dirZ - DOOR.across;
    if (Math.abs(across) <= STOOP.width / 2) kept += crowd.poses.kept[person]!;
  }
  return kept;
}

describe("given a resident whose drawn spot the crowd moves to clear a stoop", () => {
  // mutation: sed -i '/^        if (x\[resident\] !== separation.drawX\[resident\] || z\[resident\] !== separation.drawZ\[resident\]) this.poses.kept\[resident\] = 1;/d' src/game/ai/civilians/civilian-crowd.ts
  it("when she walks level with the stoop, then the crowd marks her kept at those steps", () => {
    expect(keptStepsLevel(new Stoops([houseOnTheLane()]))).toBeGreaterThan(3);
  });

  // mutation: sed -i 's/^      this.poses.kept\[resident\] = 0;$/      this.poses.kept[resident] = 1;/' src/game/ai/civilians/civilian-crowd.ts
  it("when the same walk has no stoops, then she is never marked kept", () => {
    expect(keptStepsLevel(null)).toBe(0);
  });
});
