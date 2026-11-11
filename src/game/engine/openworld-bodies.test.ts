import { describe, expect, it } from "vitest";
import { ACTIVITY } from "../ai/civilians/civilian-activity.ts";
import { DOWNED_LIFE_SECONDS } from "../ai/civilians/civilian-crowd-constants.ts";
import { createCrowdPoses } from "../ai/civilians/crowd-poses.ts";
import type { FigureStrike } from "../scenes/figure-strike.ts";
import type { Place } from "../world/openworld/walk-graph.ts";
import { BODY_COUNT, OpenWorldBodies } from "./openworld-bodies.ts";
import { FakeBodyHost } from "./openworld-bodies.test-util.ts";

const STEP = 1 / 30;
/** Bodies are given out this often (s); a few steps past it every candidate has been looked at. */
const SETTLE_STEPS = 12;
const CAPACITY = 12;
const SIZE = 4;
/** The first pool slot a body takes: the ones before it are the thrown figures' and the player's. */
const FIRST_SLOT = 4;
const LAG_BEYOND_LEASH_M = 5;
/** A body this far (m) beside and behind her spot, and the most its heading may be off her own (rad): her way is 1.4 m/s and the pull 2.5 per metre, so about 0.2 rad. */
const SIDE_ERROR_M = 0.1;
const BEHIND_ERROR_M = 0.2;
const MOST_OFF_HER_WAY_RAD = 0.35;
/** How far (m) beside her spot a body is when the spot has swerved round a stoop. */
const SWERVE_M = 2;

/** A civilian at (x, z) walking along +z at 1.4 m/s, on the street, shown. */
function walker(poses: ReturnType<typeof createCrowdPoses>, civilian: number, x: number, z: number): void {
  poses.x[civilian] = x;
  poses.z[civilian] = z;
  poses.yaw[civilian] = 0;
  poses.speed[civilian] = 1.4;
  poses.shown[civilian] = 1;
  poses.activity[civilian] = ACTIVITY.none;
  poses.feetY[civilian] = 0;
}

function world(places: readonly Place[] = []) {
  const host = new FakeBodyHost();
  const poses = createCrowdPoses(CAPACITY);
  const bodies = new OpenWorldBodies(host, places, CAPACITY, SIZE);
  let seconds = 0;
  return {
    host,
    poses,
    bodies,
    /** \`steps\` steps of the crowd's poses as they stand, the eye at (eyeX, eyeZ), the fake world walking what was steered. */
    run(steps: number, eyeX = 0, eyeZ = 0): void {
      for (let step = 0; step < steps; step++) {
        seconds += STEP;
        bodies.step(poses, eyeX, eyeZ, seconds, STEP);
        host.advance(STEP);
      }
    },
    get seconds(): number {
      return seconds;
    },
  };
}

const strikeOn = (guard: number): FigureStrike => ({ guard, car: 0, x: 0, y: 0, z: 0, faceX: 0, faceZ: 1, vx: 0, vy: 0, vz: 8, wx: 0, wy: 0, wz: 0, loose: false });
/** A building at the origin, 10 m deep along x and 6 m wide along z, with a door. */
const HOUSE: Place = { kind: 0, name: "House", doorNode: 1, doorX: 0, doorZ: 3, yaw: 0, x: 0, z: 0, width: 6, depth: 10, storeys: 2, style: "rowbrick", sector: "" };

describe("given civilians around an eye, and a pool with room for three bodies", () => {
  // mutation: sed -i 's/^const NEAR_RADIUS = 14;/const NEAR_RADIUS = 140;/' src/game/engine/openworld-bodies.ts
  it("when the bodies are given out, then the four nearest within reach each have one (nearest first), in slots past the first four, and no one farther has", () => {
    const { host, poses, bodies, run } = world();
    walker(poses, 0, 9, 0);
    walker(poses, 1, 3, 0);
    walker(poses, 2, 6, 0);
    walker(poses, 3, 4, 0);
    walker(poses, 4, 40, 0);
    walker(poses, 5, 11, 0);
    run(SETTLE_STEPS);
    expect(host.started.map((start) => start.x), "who got a body, in order").toEqual([3, 4, 6, 9]);
    for (const start of host.started) expect(start.slot, "pool slot").toBeGreaterThanOrEqual(FIRST_SLOT);
    expect(bodies.slotOf(5), "the fifth nearest has none (the pool holds four)").toBe(-1);
    expect(bodies.slotOf(4), "the one 40 m off has none").toBe(-1);
    expect([bodies.held[1], bodies.held[3], bodies.held[2], bodies.held[0], bodies.held[4], bodies.held[5]], "held by a body").toEqual([1, 1, 1, 1, 0, 0]);
    expect(host.capacity, "the pool's capacity: the first slots, the bodies and the lying reserve").toBeGreaterThanOrEqual(FIRST_SLOT + SIZE);
    expect(BODY_COUNT.desktop, "the desktop tier's bodies").toBeGreaterThan(BODY_COUNT.phone);
  });

  // mutation: sed -i 's/    this.host.steer(slot, detAtan2(vx, vz), Math.min(FASTEST, hypot2(vx, vz)));/    this.host.steer(slot, 0, 0);/' src/game/engine/openworld-bodies.ts
  it("when her spot moves on, then her body is steered at it, and keeps up with her", () => {
    const { host, poses, bodies, run } = world();
    walker(poses, 0, 2, 0);
    run(SETTLE_STEPS);
    const slot = bodies.slotOf(0);
    expect(slot, "she has a body").toBeGreaterThanOrEqual(FIRST_SLOT);
    for (let step = 0; step < 60; step++) {
      poses.z[0] = poses.z[0]! + 1.4 * STEP;
      run(1);
    }
    const body = host.bodies.get(slot)!;
    expect(Math.abs(body.z - poses.z[0]!), "how far she is ahead of her body (m)").toBeLessThan(0.4);
    expect(bodies.slotOf(0), "still hers").toBe(slot);
  });

  // mutation: sed -i 's/    this.host.steer(slot, detAtan2(vx, vz), Math.min(FASTEST, hypot2(vx, vz)));/    this.host.steer(slot, detAtan2(dx, dz), Math.min(FASTEST, pace + CATCH_UP * lag));/' src/game/engine/openworld-bodies.ts
  it("when her body is a hand's breadth beside her spot and a step behind it, then it still faces where she goes (her way plus a small pull), never the bearing to her spot", () => {
    const { host, poses, bodies, run } = world();
    walker(poses, 0, 2, 0);
    run(SETTLE_STEPS);
    const slot = bodies.slotOf(0);
    const body = host.bodies.get(slot)!;
    body.x = poses.x[0]! + SIDE_ERROR_M;
    body.z = poses.z[0]! - BEHIND_ERROR_M;
    bodies.step(poses, 0, 0, 10, STEP);
    expect(Math.abs(body.heading - poses.yaw[0]!), "heading off her way (rad)").toBeLessThan(MOST_OFF_HER_WAY_RAD);
    body.x = poses.x[0]! - SIDE_ERROR_M;
    body.z = poses.z[0]! + BEHIND_ERROR_M / 4;
    bodies.step(poses, 0, 0, 10.1, STEP);
    expect(Math.abs(body.heading - poses.yaw[0]!), "ahead and to the other side: still facing her way").toBeLessThan(MOST_OFF_HER_WAY_RAD);
  });

  // mutation: sed -i 's/^const LEASH = 3;/const LEASH = 300;/' src/game/engine/openworld-bodies.ts
  it("when her body falls farther behind her than the leash (a car blocks it), then it is let go and she is drawn again", () => {
    const { host, poses, bodies, run } = world();
    walker(poses, 0, 2, 0);
    run(SETTLE_STEPS);
    const slot = bodies.slotOf(0);
    poses.z[0] = LAG_BEYOND_LEASH_M;
    run(2);
    expect(host.stopped, "the body went").toContain(slot);
    expect(bodies.slotOf(0), "she has none").toBe(-1);
    expect(bodies.held[0], "and is not held").toBe(0);
  });

  // mutation: sed -i 's/    if (poses.shown\[civilian\] === 0 || !BODY_ACTIVITY.has(poses.activity\[civilian\]!)) return false;/    if (poses.shown[civilian] === 0) return false;/' src/game/engine/openworld-bodies.ts
  it("when she buys at a counter, or stands on a stoop, or is shown no more, then she has no body, and one she had goes; and one flinching from a car keeps hers", () => {
    const { host, poses, bodies, run } = world();
    walker(poses, 0, 2, 0);
    walker(poses, 1, 3, 0);
    walker(poses, 2, 4, 0);
    walker(poses, 3, 5, 0);
    run(SETTLE_STEPS);
    expect([bodies.held[0], bodies.held[1], bodies.held[2], bodies.held[3]], "all four have one").toEqual([1, 1, 1, 1]);
    poses.activity[0] = ACTIVITY.buy;
    poses.feetY[1] = 0.5;
    poses.shown[2] = 0;
    poses.activity[3] = ACTIVITY.recoil;
    run(2);
    expect([bodies.held[0], bodies.held[1], bodies.held[2], bodies.held[3]], "the first three have none now; the flincher keeps hers").toEqual([0, 0, 0, 1]);
    expect(host.stopped.length, "three bodies went").toBe(3);
  });

  // mutation: sed -i 's/    return !this.insideBuilding(x, z);/    return true;/' src/game/engine/openworld-bodies.ts
  it("when she walks into a building's footprint, then she has no body there (the dummies' world has no floor inside)", () => {
    const { poses, bodies, run } = world([HOUSE]);
    walker(poses, 0, 1, 1);
    walker(poses, 1, 8, 1);
    run(SETTLE_STEPS);
    expect(bodies.held[0], "inside the house").toBe(0);
    expect(bodies.held[1], "outside it").toBe(1);
  });
});

describe("given a civilian a car runs down while her body stands for her", () => {
  // mutation: sed -i 's/    if (body === NOBODY) return false;/    return false;/' src/game/engine/openworld-bodies.ts
  it("when the crowd's strike lands, then it knocks her live body in its slot and says so; a civilian with no body is left to the throw", () => {
    const { host, poses, bodies, run } = world();
    walker(poses, 0, 2, 0);
    run(SETTLE_STEPS);
    const slot = bodies.slotOf(0);
    const strike = strikeOn(0);
    expect(bodies.knock(strike), "her body took it").toBe(true);
    expect(host.knocks.length, "the one knock").toBe(1);
    expect(host.knocks[0]!.slot, "in her slot").toBe(slot);
    expect(host.knocks[0]!.strike, "with the crowd's strike").toBe(strike);
    expect(bodies.knock(strikeOn(5)), "someone with no body: thrown as a figure").toBe(false);
    expect(host.knocks.length, "no second knock").toBe(1);
  });

  // mutation: sed -i 's/      if (this.seconds - this.struckAt\[body\]! >= LIES_SECONDS) this.release(body);/      this.release(body);/' src/game/engine/openworld-bodies.ts
  it("when she has been run down, then her body lies where it fell for the time a figure does, not let go because the crowd hides her", () => {
    const { host, poses, bodies, run } = world();
    walker(poses, 0, 2, 0);
    run(SETTLE_STEPS);
    const slot = bodies.slotOf(0);
    bodies.knock(strikeOn(0));
    poses.shown[0] = 0;
    run(Math.round((DOWNED_LIFE_SECONDS - 5) / STEP), 0, 0);
    expect(host.stopped, "still lying").not.toContain(slot);
    expect(bodies.held[0], "and still hers").toBe(1);
    run(Math.round(10 / STEP));
    expect(host.stopped, "gone after its time").toContain(slot);
    expect(bodies.held[0], "let go").toBe(0);
  });

  // mutation: sed -i 's/      if (this.downFor\[body\]! > GET_UP_AFTER) this.host.getUp(slot);/      \/\/ never/' src/game/engine/openworld-bodies.ts
  it("when her body is knocked down by a bump the crowd did not judge a knockdown, then it is asked to get up, and let go if it does not", () => {
    const { host, poses, bodies, run } = world();
    walker(poses, 0, 2, 0);
    run(SETTLE_STEPS);
    const slot = bodies.slotOf(0);
    host.bodies.get(slot)!.standing = false;
    run(Math.round(1 / STEP));
    expect(host.gotUp, "not yet").toEqual([]);
    run(Math.round(1 / STEP));
    expect(host.gotUp.length, "asked to get up, once").toBe(1);
    expect(host.gotUp[0], "in her slot").toBe(slot);
    host.stubborn = true;
    host.bodies.get(slot)!.standing = false;
    run(Math.round(9 / STEP));
    expect(host.stopped, "let go after staying down").toContain(slot);
  });
});

/** The body steered for civilian 0 after her body was put `beside` m to the side of her spot, her spot marked kept (swerved round a stoop). */
function steeredBeside(beside: number): { heading: number; speed: number; yaw: number } {
  const { host, poses, bodies, run } = world();
  walker(poses, 0, 2, 0);
  run(SETTLE_STEPS);
  const body = host.bodies.get(bodies.slotOf(0))!;
  poses.kept[0] = 1;
  body.x = poses.x[0]! - beside;
  bodies.step(poses, 0, 0, 10, STEP);
  return { heading: body.heading, speed: body.speed, yaw: poses.yaw[0]! };
}

describe("given a civilian whose drawn spot the crowd swerved round a stoop", () => {
  // mutation: sed -i 's/    const vx = detSin(yaw) \* pace + CATCH_UP \* dx;/    const vx = detSin(yaw) * pace;/' src/game/engine/openworld-bodies.ts
  it("when her body is 2 m to the side of that spot, then it is steered round toward it: well off her heading, and faster than she walks, so it walks round the steps", () => {
    const steered = steeredBeside(SWERVE_M);
    expect(Math.abs(steered.heading - steered.yaw), "heading off hers (rad)").toBeGreaterThan(MOST_OFF_HER_WAY_RAD);
    expect(steered.speed, "speed (m/s)").toBeGreaterThan(1.4);
  });

  // mutation: sed -i 's/    const vz = detCos(yaw) \* pace + CATCH_UP \* dz;/    const vz = detCos(yaw) * pace + 1;/' src/game/engine/openworld-bodies.ts
  it("when her body is on that spot, then it walks with her: her heading and her pace", () => {
    const steered = steeredBeside(0);
    expect(steered.heading, "heading").toBeCloseTo(steered.yaw, 5);
    expect(steered.speed, "pace (m/s)").toBeCloseTo(1.4, 5);
  });
});

describe("given bodies and the scene is left", () => {
  // mutation: sed -i 's/  dispose(): void {/  dispose(): void {\n    return;/' src/game/engine/openworld-bodies.ts
  it("when the bodies are disposed, then every body goes and no civilian is held", () => {
    const { host, poses, bodies, run } = world();
    walker(poses, 0, 2, 0);
    walker(poses, 1, 3, 0);
    run(SETTLE_STEPS);
    expect(bodies.count(), "bodies out").toBe(2);
    bodies.dispose();
    expect(bodies.count(), "bodies out after").toBe(0);
    expect(host.stopped.length, "bodies stopped").toBe(2);
    expect([bodies.held[0], bodies.held[1]], "held").toEqual([0, 0]);
  });
});
