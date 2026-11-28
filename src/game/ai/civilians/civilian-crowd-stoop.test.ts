import { describe, expect, it } from "vitest";
import { detAtan2, detCos, detSin } from "../../kernel/physics-core.js";
import { DOOR, type Frontage, STOOP, stoopStepRange } from "../../world/openworld/openworld-facade-solids.ts";
import { Stoops } from "../../world/openworld/openworld-stoops.ts";
import { ACTIVITY } from "./civilian-activity.ts";
import { pooledCar } from "../../contact/crash-scenarios.test-util.ts";
import { EVENT_KIND, LATERAL_MAX, RESIDENT_FLOAT, RESIDENT_FLOAT_STRIDE } from "./civilian-constants.ts";
import { PACE, people, sendAlong, streetEdge } from "./civilian-crowd-contact.test-util.ts";
import { FRAME_SECONDS, newCrowd } from "./civilian-crowd.test-util.ts";
import type { CivilianCrowd } from "./civilian-crowd.ts";
import { buildFixtureMap } from "./civilian-graph.test-util.ts";
import { readActivity } from "./society-activity.ts";

const map = buildFixtureMap();
const EDGE = streetEdge(map, 20);
const START = { x: map.graph.nodeX[EDGE.from]!, z: map.graph.nodeZ[EDGE.from]! };
/** The house whose door is the edge's first node and whose front looks along it, so a resident sent along the edge walks out of the door and down the stoop. */
const HOUSE_YAW = detAtan2(-EDGE.dirZ, EDGE.dirX);
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
  it("when she leaves, then she is at the sill's height at the door, on a tread's height on each step, and at the street's height past the bottom one", () => {
    const { crowd, person } = leaving(new Stoops([HOUSE], [EDGE.from]));
    expect(heightAfter(crowd, person, 0.1), "at the door").toBeCloseTo(STOOP.sill, 3);
    expect(heightAfter(crowd, person, (STEP_3.near + STEP_3.far) / 2), "on the third step").toBeCloseTo(STEP_3.top, 3);
    expect(heightAfter(crowd, person, STOOP.run - STOOP.tread / 2), "on the bottom step").toBeCloseTo(STOOP.rise, 3);
    expect(heightAfter(crowd, person, STOOP.run + STOOP.tread), "past it").toBe(0);
  });

  it("when she walks a stoop door's spur the drawing is told (onSpur is 1), and on a walk that is not its spur it is 0", () => {
    const spur = leaving(new Stoops([HOUSE], [EDGE.from]));
    heightAfter(spur.crowd, spur.person, (STEP_3.near + STEP_3.far) / 2);
    expect(spur.crowd.poses.onSpur[spur.person], "on the door's spur").toBe(1);
    const lane = leaving(new Stoops([HOUSE]));
    heightAfter(lane.crowd, lane.person, (STEP_3.near + STEP_3.far) / 2);
    expect(lane.crowd.poses.onSpur[lane.person], "on the sidewalk lane").toBe(0);
  });

  it("when there are no stoops, then she is at the street's height all the way", () => {
    const { crowd, person } = leaving(null);
    expect(heightAfter(crowd, person, 0.1)).toBe(0);
    expect(heightAfter(crowd, person, (STEP_3.near + STEP_3.far) / 2)).toBe(0);
  });

  it("when she walks over a stoop's steps on a walk that is not its door's spur (the sidewalk's lane in front of it), then she stays at the street's height", () => {
    const { crowd, person } = leaving(new Stoops([HOUSE]));
    expect(heightAfter(crowd, person, 0.1), "at the door's spot").toBe(0);
    expect(heightAfter(crowd, person, (STEP_3.near + STEP_3.far) / 2), "over the third step").toBe(0);
  });

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

  it("when she comes home, then she is at the street's height at the foot, on a tread's height on each step going up, and at the sill's height at the door", () => {
    const { crowd, person } = leaving(new Stoops([HOUSE], [EDGE.from]), true);
    const fromDoor = (metres: number): number => EDGE.length - metres;
    expect(heightAfter(crowd, person, fromDoor(STOOP.run + STOOP.tread)), "at the street").toBe(0);
    expect(heightAfter(crowd, person, fromDoor(STOOP.run - STOOP.tread / 2)), "on the bottom step").toBeCloseTo(STOOP.rise, 3);
    expect(heightAfter(crowd, person, fromDoor((STEP_3.near + STEP_3.far) / 2)), "on the third step").toBeCloseTo(STEP_3.top, 3);
    expect(heightAfter(crowd, person, fromDoor(0.1)), "at the door").toBeCloseTo(STOOP.sill, 3);
  });
});

describe("given a rowhome whose stoop runs out across the sidewalk a resident walks", () => {
  it("when she walks past it on the side of the lane nearest the houses, then she is drawn at least the stoop's run and 0.6 m out from the facade while level with it", () => {
    const yaw = HOUSE_YAW + Math.PI / 2;
    const mid = EDGE.length / 2;
    const mx = START.x + EDGE.dirX * mid;
    const mz = START.z + EDGE.dirZ * mid;
    // A house that faces the lane: the lane's centre runs 1.5 m out from its facade, and its door line meets the leg's middle.
    const house: Frontage = { ...HOUSE, yaw, x: mx - 1.5 * EDGE.dirZ - DOOR.across * EDGE.dirX, z: mz + 1.5 * EDGE.dirX - DOOR.across * EDGE.dirZ };
    const { crowd, person } = leaving(new Stoops([house]));
    crowd.state.floats[person * RESIDENT_FLOAT_STRIDE + RESIDENT_FLOAT.lateral] = -LATERAL_MAX;
    let level = 0;
    for (let t = (mid - 1.5) / PACE; t <= (mid + 1.5) / PACE; t += 0.1) {
      crowd.step(t, [], true);
      const dx = crowd.poses.x[person]! - house.x;
      const dz = crowd.poses.z[person]! - house.z;
      const out = dx * EDGE.dirZ - dz * EDGE.dirX;
      const across = dx * EDGE.dirX + dz * EDGE.dirZ - DOOR.across;
      if (Math.abs(across) > STOOP.width / 2) continue;
      level++;
      expect(out, `out from the facade, ${across.toFixed(2)} m across the door line`).toBeGreaterThanOrEqual(STOOP.run + 0.6 - 1e-4);
    }
    expect(level, "steps at which she was level with the stoop").toBeGreaterThan(3);
  });

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
function outAfterOverlayOnStoop(stoops: Stoops | null, marked = false): { out: number; lift: number } {
  const { crowd, person } = leaving(stoops);
  const out = STOOP.run / 2;
  crowd.overlay = (poses) => {
    poses.x[person] = HOUSE.x + detCos(HOUSE.yaw) * out + detSin(HOUSE.yaw) * DOOR.across;
    poses.z[person] = HOUSE.z - detSin(HOUSE.yaw) * out + detCos(HOUSE.yaw) * DOOR.across;
    poses.onSpur[person] = marked ? 1 : 0;
  };
  crowd.step(1, [], true);
  expect(crowd.poses.shown[person], "she is drawn").toBe(1);
  return { out: (crowd.poses.x[person]! - HOUSE.x) * detCos(HOUSE.yaw) - (crowd.poses.z[person]! - HOUSE.z) * detSin(HOUSE.yaw), lift: crowd.poses.feetY[person]! };
}

describe("given a resident the law's overlay draws at the middle of a rowhome's stoop", () => {
  it("when the crowd takes the overlay, then she is drawn the stoop's run and 0.6 m out from the facade", () => {
    expect(outAfterOverlayOnStoop(new Stoops([HOUSE])).out).toBeCloseTo(STOOP.run + 0.6, 3);
  });

  it("when the overlay marks her on the spur (the law's walker on the graph), then she stays where it drew her, on the step under her", () => {
    const drawn = outAfterOverlayOnStoop(new Stoops([HOUSE]), true);
    expect(drawn.out, "out from the facade (m)").toBeCloseTo(STOOP.run / 2, 3);
    expect(drawn.lift, "her height (m)").toBeGreaterThan(0);
  });
});

/** A crowd whose overlay draws her `out` m out from HOUSE's facade on the door's line, marked on the spur as the law's suspects are, stepped once (she is drawn). */
function drawnAt(out: number): { crowd: CivilianCrowd; person: number } {
  const { crowd, person } = leaving(new Stoops([HOUSE]));
  crowd.overlay = (poses) => {
    poses.x[person] = HOUSE.x + detCos(HOUSE.yaw) * out + detSin(HOUSE.yaw) * DOOR.across;
    poses.z[person] = HOUSE.z - detSin(HOUSE.yaw) * out + detCos(HOUSE.yaw) * DOOR.across;
    poses.onSpur[person] = 1;
  };
  crowd.step(1, [], true);
  expect(crowd.poses.shown[person], "she is drawn").toBe(1);
  return { crowd, person };
}

describe("given a resident the law draws on a rowhome's landing or on the sidewalk in front of it", () => {
  it("when a punch knocks her out on the landing, then her throw starts at the sill's height; on the sidewalk, at the street's", () => {
    for (const [out, height] of [[0.2, STOOP.sill], [STOOP.run + 2, 0]] as const) {
      const { crowd, person } = drawnAt(out);
      crowd.takeStrikes();
      crowd.knockOut(person, 1, 1, 0);
      const strikes = crowd.takeStrikes();
      expect(strikes.length, `one throw at ${out} m`).toBe(1);
      expect(strikes[0]!.y, `where she starts at ${out} m out (m)`).toBeCloseTo(height, 2);
    }
  });

  it("when a bullet takes her on the landing, then her throw starts at the sill's height", () => {
    const { crowd, person } = drawnAt(0.2);
    crowd.takeStrikes();
    crowd.shoot(person, 1, 1, 0, 9);
    expect(crowd.takeStrikes()[0]!.y, "where she starts (m)").toBeCloseTo(STOOP.sill, 2);
  });
});

describe("given a client that hears a knock of a resident walking out of a rowhome's door", () => {
  it("when it throws her from the car nearest, then she starts at the height she was drawn at on the landing", () => {
    const { crowd, person } = leaving(new Stoops([HOUSE], [EDGE.from]));
    const at = 0.1 / PACE;
    crowd.step(at, [], false);
    expect(crowd.poses.feetY[person], "control: she is on the landing (m)").toBeCloseTo(STOOP.sill, 2);
    const car = pooledCar(0);
    car.group.position.set(START.x + 10, 0, START.z);
    crowd.hear(Float64Array.of(EVENT_KIND.knock, person, at, EVENT_KIND.push, person, at));
    crowd.step(at + FRAME_SECONDS, [car], false);
    const strikes = crowd.takeStrikes();
    expect(strikes.length, "one throw").toBe(1);
    expect(strikes[0]!.y, "where she starts (m)").toBeCloseTo(STOOP.sill, 2);
  });
});
