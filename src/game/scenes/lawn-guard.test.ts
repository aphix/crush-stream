import { describe, expect, it } from "vitest";
import { launch, makeCar } from "../contact/crash-scenarios.test-util.ts";
import { parseTrack } from "../world/track-schema.ts";
import { TRACKS } from "../world/tracks/index.ts";
import { TRACK_ID } from "../world/constants.ts";
import { FIRE_EVERY, GUARD_AT_POST, GUARD_DEPLOY_S, GUARD_DOWN, GUARD_IN, KILL_HITS_MIN, KILL_HITS_SPREAD, LawnGuard, NO_TARGET, SHOT_RING } from "./lawn-guard.ts";
import { KILL_WINDOW_S } from "./lawn-guard.test-util.ts";
import { FINE_HZ } from "../kernel/constants.ts";

/** The National Mall's White House grounds (`TrackJson.guards`). */
const spec = TRACKS.map((j) => parseTrack(j)).find((t) => t.id === TRACK_ID.nationalMall)!.guards!;
/** A fixed step at the race's finest slice. */
const STEP = 1 / FINE_HZ;
/** A spot on the North Lawn, between the house and Pennsylvania Avenue, and one out on the Ellipse's road past the south fence. */
const NORTH_LAWN = { x: -1000, z: -1090 };
const OFF_GROUNDS = { x: -1000, z: -760 };

/** A guard post on the grounds and one car standing at `at`; the post stepped `seconds` s (the car parked). */
function run(at: { x: number; z: number }, seconds: number, standDown = false) {
  const guard = new LawnGuard(spec, 4);
  guard.reset(7);
  guard.standDown = standDown;
  const car = makeCar();
  launch(car, at.x, at.z, 0, 0, 0);
  const cars = [car];
  let firstShotAt = -1;
  let diedAt = -1;
  let hitsToKill = 0;
  for (let t = 0; t < seconds; t += STEP) {
    const before = guard.shots;
    guard.step(cars, STEP);
    for (let k = before; k < guard.shots; k++) {
      if (firstShotAt < 0) firstShotAt = t;
      if (diedAt < 0) hitsToKill += guard.shotHit[k % SHOT_RING]!;
    }
    if (diedAt < 0 && !car.deform.drivetrainAlive) diedAt = t;
  }
  return { guard, car, firstShotAt, diedAt, hitsToKill };
}

describe("given the White House grounds' guard post (owner, 2026-10-14: drive onto the lawn and the guards come out and shoot the car)", () => {
  it(`when a car parks on the North Lawn, then the squad opens fire once it is out of the doors, and the car's engine dies at a hit from ${KILL_HITS_MIN} to ${KILL_HITS_MIN + KILL_HITS_SPREAD - 1}, keyed for the replay`, () => {
    const { guard, car, firstShotAt, diedAt, hitsToKill } = run(NORTH_LAWN, 12);
    expect(firstShotAt >= GUARD_DEPLOY_S - STEP && firstShotAt < GUARD_DEPLOY_S + FIRE_EVERY, `first shot at ${firstShotAt.toFixed(2)} s`).toBeTruthy();
    expect(diedAt > firstShotAt && diedAt < firstShotAt + KILL_WINDOW_S, `the engine died at ${diedAt.toFixed(2)} s`).toBeTruthy();
    expect(hitsToKill >= KILL_HITS_MIN && hitsToKill < KILL_HITS_MIN + KILL_HITS_SPREAD, `${hitsToKill} hits killed it`).toBeTruthy();
    expect(car.placements, "the spawn only: the guards' kill is no placement").toBe(1);
    expect(car.kills, "the kill: the recorder keys the step the guards killed it in").toBe(1);
    expect(guard.target, "a dead car is no target").toBe(NO_TARGET);
  });

  it("when the course's secret is out (the VIP comes out instead), then a car on the lawn draws no fire and keeps its engine", () => {
    const { guard, car } = run(NORTH_LAWN, 12, true);
    expect(guard.shots, "no shot").toBe(0);
    expect(guard.alarm, "no alarm").toBe(-1);
    expect(car.deform.drivetrainAlive, "the engine runs").toBe(true);
  });

  it("when a car stays off the grounds, then no alarm goes up and nobody fires, though the same car on the lawn is fired on", () => {
    const off = run(OFF_GROUNDS, 8);
    expect(off.guard.alarm, "no alarm").toBe(-1);
    expect(off.guard.shots, "no shot").toBe(0);
    expect(run(NORTH_LAWN, 8).guard.shots, "on the lawn they fire").toBeGreaterThan(0);
  });
});

/** Metres a car starts from guard 0's post, driving at it: short, so a creeping one still reaches him while the squad is out. */
const RUN_UP = 5;

/** The squad out at its posts round a parked car; a second car then driven at guard 0's post at `mps` m/s until it is well past him. */
function runAtGuard(mps: number) {
  const guard = new LawnGuard(spec, 4);
  guard.reset(7);
  const parked = makeCar();
  launch(parked, NORTH_LAWN.x, NORTH_LAWN.z, 0, 0, 0);
  const bullet = makeCar();
  launch(bullet, OFF_GROUNDS.x, OFF_GROUNDS.z, 0, 0, 0);
  const cars = [parked, bullet];
  for (let t = 0; t < 3; t += STEP) guard.step(cars, STEP);
  const post = { x: guard.guardX[0]!, z: guard.guardZ[0]! };
  launch(bullet, post.x, post.z - RUN_UP, 0, 0, mps);
  const strikes = [];
  for (let t = 0; t < (2 * RUN_UP) / mps; t += STEP) {
    bullet.group.position.z += mps * STEP;
    guard.step(cars, STEP);
    strikes.push(...guard.takeStrikes());
  }
  return { guard, strikes, post };
}

/** A run-down guard is kicked off the car's centre line at more than this share of its speed. */
const KICK_SHARE = 0.25;

// One knock law (`knocksDown`): a sedan (858 kg) runs a guard down from 1.12 m/s.
const runDownCases = [
  { it: "when a car drives through his post at 15 m/s, then he is run down", mps: 15 },
  { it: "when a car drives through his post at 5 m/s, then he is run down", mps: 5 },
  { it: "when a car rolls through his post at 3 m/s, then he is run down", mps: 3 },
] as const;

const standingCases = [{ it: "when a car creeps through his post at 1 m/s, then he stays standing", mps: 1 }] as const;

describe("given the squad out at its posts, firing on a parked car (owner, 2026-10-15: guards ragdoll once a vehicle hits them)", () => {
  for (const testCase of runDownCases) {
    it(testCase.it, () => {
      const { guard, strikes, post } = runAtGuard(testCase.mps);
      expect(guard.mode[0] === GUARD_DOWN, "guard 0 down").toBe(true);
      expect(strikes.length > 0, "guards struck").toBe(true);
      expect(strikes.length, "each guard down was struck once, and no other").toBe(Array.from(guard.mode).filter((mode) => mode === GUARD_DOWN).length);
      const strike = strikes.find((s) => s.guard === 0)!;
      expect(strike, "the guard struck").toBeTruthy();
      expect(strike.car, "the car that struck him").toBe(1);
      expect(Math.abs(strike.x - post.x) < 1e-3 && Math.abs(strike.z - post.z) < 1e-3, "where his feet stood").toBeTruthy();
      expect(Math.abs(strike.vz - testCase.mps), "launched at the car's speed along its way").toBeLessThan(1e-3);
      expect(Math.abs(strike.vx), "and kicked clear of its centre line").toBeGreaterThan(KICK_SHARE * testCase.mps);
      expect(strike.vy, "with a lift").toBeGreaterThan(0);
      expect(Math.abs(strike.faceX * strike.faceX + strike.faceZ * strike.faceZ - 1), "facing a unit vector").toBeLessThan(1e-6);
    });
  }

  for (const testCase of standingCases) {
    it(testCase.it, () => {
      const { guard, strikes } = runAtGuard(testCase.mps);
      expect(guard.mode[0] === GUARD_DOWN, "guard 0 down").toBe(false);
      expect(strikes.length > 0, "guards struck").toBe(false);
      expect(strikes.length, "each guard down was struck once, and no other").toBe(Array.from(guard.mode).filter((mode) => mode === GUARD_DOWN).length);
    });
  }

  it("when a guard has been run down, then no shot is fired from his gun and the squad fires slower than at full strength", () => {
    const fired = (down: boolean) => {
      const guard = new LawnGuard(spec, 4);
      guard.reset(7);
      if (down) guard.mode[0] = GUARD_DOWN;
      const car = makeCar();
      launch(car, NORTH_LAWN.x, NORTH_LAWN.z, 0, 0, 0);
      const shooters = new Set<number>();
      for (let t = 0; t < GUARD_DEPLOY_S + 1; t += STEP) {
        const before = guard.shots;
        guard.step([car], STEP);
        for (let k = before; k < guard.shots; k++) shooters.add(guard.shotGuard[k % SHOT_RING]!);
      }
      return { shots: guard.shots, shooters };
    };
    const full = fired(false);
    const short = fired(true);
    expect(full.shooters.has(0), "at full strength guard 0 fires").toBeTruthy();
    expect(!short.shooters.has(0), "a guard run down never fires").toBe(true);
    expect(short.shots > 0 && short.shots < full.shots, `${short.shots} shots a second with a guard down against ${full.shots}`).toBeTruthy();
  });

  it("when the race restarts after a guard was run down, then every guard is back inside and comes out standing at his post", () => {
    const { guard } = runAtGuard(15);
    expect(guard.mode[0], "run down").toBe(GUARD_DOWN);
    guard.reset(7);
    for (let i = 0; i < spec.count; i++) expect(guard.mode[i], `guard ${i} inside`).toBe(GUARD_IN);
    expect(guard.takeStrikes().length, "no strike pending").toBe(0);
    const car = makeCar();
    launch(car, NORTH_LAWN.x, NORTH_LAWN.z, 0, 0, 0);
    for (let t = 0; t < 3; t += STEP) guard.step([car], STEP);
    expect(guard.mode[0], "guard 0 at his post again").toBe(GUARD_AT_POST);
  });
});
