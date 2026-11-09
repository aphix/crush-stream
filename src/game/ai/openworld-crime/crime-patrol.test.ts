import { describe, expect, it } from "vitest";
import { CAR_AVOID_GAP, CAR_LINGER_SECONDS, CAR_LOST_DISTANCE, CAR_LOST_SECONDS, CAREFUL_PURSUIT_SPEED, CHASE_LEAD_SECONDS, CHASE_RESUME_DISTANCE, CLOSE_PURSUIT_DISTANCE, CRIME_STEP_SECONDS, CRIME_STREAM, HOTHEAD_RUN_SHARE, REDIRECT_SECONDS } from "./crime-constants.ts";
import { crimeDraw } from "./crime-draw.ts";
import { harness, runFor, seedWhere } from "./crime-fixture.test-util.ts";
import { PatrolCars } from "./patrol-cars.ts";
import { FakeStreet } from "./crime-street.test-util.ts";

const RUNS = 200;
const EAST = Math.PI / 2;
const RUNNER_X = 90;
/** The chased car's pace (m/s): slow enough for the patrol car to close the gap in the rows' time. */
const RUNNER_SPEED = 1;
/** A stopped car standing on the patrol car's line, between its start and the scene. */
const BLOCKER_X = 30;
/** The patrol car's place in the fake street's list: after the car already standing there. */
const PATROL_CAR_INDEX = 1;
/** The share of hothead runs over `RUNS` seeded runs lands within this of `HOTHEAD_RUN_SHARE`: the binomial spread of 200 draws at 0.2 is 0.028, so this is more than three spreads. */
const SHARE_BAND = 0.1;
/** The race brake's latch lets a car run this far (m/s) over the speed it wants before it bites (`BRAKE_ON` in race-ai.ts). */
const BRAKE_LATCH = 1.5;
const NO_HOOKS = { arrived: () => {}, busted: () => {} };
/** The first run of a seed is a careful one under this seed, a hothead's under the other. */
const CAREFUL_SEED = seedWhere((seed) => crimeDraw(seed, CRIME_STREAM.hothead, 0, 0), HOTHEAD_RUN_SHARE, false);
const HOTHEAD_SEED = seedWhere((seed) => crimeDraw(seed, CRIME_STREAM.hothead, 0, 0), HOTHEAD_RUN_SHARE, true);

describe("patrol cars mostly drive like city police", () => {
  // mutation: in src/game/ai/openworld-crime/crime-constants.ts, change `HOTHEAD_RUN_SHARE = 0.2` to `HOTHEAD_RUN_SHARE = 1`
  it("make a hothead's run straight at the scene about one time in five, seeded, and hand every other run to the traffic's trip along the streets", () => {
    const street = new FakeStreet();
    const patrol = new PatrolCars(street, NO_HOOKS, null, 12, CAREFUL_SEED);
    let hotheads = 0;
    let time = 0;
    for (let run = 0; run < RUNS; run++) {
      expect(patrol.dispatchToScene(0, 60, 0, time), `run ${run} leased`).toBe(true);
      const handle = street.leases - 1;
      const hothead = patrol.hothead[0] === 1;
      if (hothead) hotheads++;
      expect(street.drivers[handle] !== null, `run ${run}: the law drives a hothead's run only`).toBe(hothead);
      patrol.finishCase(0, time);
      time += CAR_LINGER_SECONDS + 1;
      patrol.step(time, CRIME_STEP_SECONDS);
    }
    expect(Math.abs(hotheads / RUNS - HOTHEAD_RUN_SHARE), "the hothead share").toBeLessThan(SHARE_BAND);
    expect(hotheads, "some runs are a hothead's").toBeGreaterThan(0);
    expect(hotheads, "not all").toBeLessThan(RUNS);
  });

  // mutation: in src/game/ai/openworld-crime/patrol-cars.ts stepToScene(), change `this.ports.arrived(this.handle[slot]!) ||` to `false &&`
  it("on a careful run, drive the traffic's trip to the kerb nearest the scene, and the cop steps out there", () => {
    const run = harness([0, 0, 0], { withCars: true, seed: CAREFUL_SEED });
    run.street!.leaseAt = { x: 20, z: -40, yaw: 0 };
    run.offences.x[1] = 60;
    run.offences.commitCrime(1);
    runFor(run, 15);
    expect(run.street!.drivers[0], "the traffic drove it").toBeNull();
    expect(run.street!.tripDone[0], "at its kerb space").toBe(true);
    expect(run.scene.foot.table.copAt(0, 2), "its cop joined the case").toBeGreaterThanOrEqual(0);
  });
});

describe("closing on a car it chases", () => {
  /** A patrol car chasing a stopped car 90 m east of where it starts, on the given seed: the fastest it goes within `CLOSE_PURSUIT_DISTANCE` m of it. */
  function closeChase(seed: number): number {
    const run = harness([40, 0, 0], { withCars: true, seed });
    const street = run.street!;
    street.leaseAt = { x: 0, z: 0, yaw: EAST };
    const runner = street.addCar(RUNNER_X, 0, EAST, 0, 2, true);
    run.scene.reportRedLight(runner, RUNNER_X, 0);
    let fastestClose = 0;
    for (let step = 0; step < 200; step++) {
      runFor(run, CRIME_STEP_SECONDS);
      const patrolCar = street.snaps[1]!;
      if (Math.hypot(patrolCar.x - RUNNER_X, patrolCar.z) <= CLOSE_PURSUIT_DISTANCE) fastestClose = Math.max(fastestClose, Math.hypot(patrolCar.vx, patrolCar.vz));
    }
    return fastestClose;
  }

  // mutation: in src/game/ai/openworld-crime/patrol-cars.ts driveSlot(), change `const cap = this.hothead[slot] === 0 ? Math.sqrt(CAREFUL_PURSUIT_SPEED * CAREFUL_PURSUIT_SPEED + 2 * CAR_STOP_DECEL * beyond) : Infinity;` to `const cap = Infinity;`
  it("a careful car slows to a city street's pace within the last metres, a hothead does not", () => {
    expect(closeChase(CAREFUL_SEED), "careful").toBeLessThanOrEqual(CAREFUL_PURSUIT_SPEED + BRAKE_LATCH);
    expect(closeChase(HOTHEAD_SEED), "hothead").toBeGreaterThan(CAREFUL_PURSUIT_SPEED + BRAKE_LATCH);
  });
});

describe("a careful chase follows the streets", () => {
  /** A car 90 m east cruising east at `RUNNER_SPEED`, seen by the foot cop at x = 40, the patrol car's lease starting at the west end; careful runs under `CAREFUL_SEED`. */
  function chase() {
    const run = harness([40, 0, 0], { withCars: true, seed: CAREFUL_SEED });
    const street = run.street!;
    street.leaseAt = { x: 0, z: 0, yaw: EAST };
    const runner = street.addCar(RUNNER_X, 0, EAST, RUNNER_SPEED, 2, false);
    expect(run.scene.reportRedLight(runner, RUNNER_X, 0), "a patrol car was sent").toBe(true);
    return { run, street, runner };
  }

  // mutation: in src/game/ai/openworld-crime/patrol-cars.ts followStreets(), delete the line `if (seconds < this.redirectAt[slot]! && !this.ports.arrived(handle)) return;`
  it("re-aims its street trip every few seconds at the kerb nearest where the offender will be", () => {
    const { run, street } = chase();
    expect(street.drivers[PATROL_CAR_INDEX], "the traffic drives it").toBeNull();
    runFor(run, REDIRECT_SECONDS - 0.5);
    expect(street.redirects, "not yet").toHaveLength(0);
    runFor(run, 1);
    expect(street.redirects.length, "re-aimed once").toBe(1);
    const first = street.redirects[0]!;
    expect(first.x, "ahead of the offender by what it covers in the lead time, at the second it was aimed").toBeCloseTo(RUNNER_X + RUNNER_SPEED * (REDIRECT_SECONDS + CHASE_LEAD_SECONDS), 0);
    runFor(run, REDIRECT_SECONDS);
    expect(street.redirects.length, "and again").toBe(2);
    expect(street.redirects[1]!.x, "further on with the offender").toBeGreaterThan(first.x);
    expect(street.drivers[PATROL_CAR_INDEX], "still the traffic's trip").toBeNull();
  });

  // mutation: in src/game/ai/openworld-crime/patrol-cars.ts followStreets(), change `gap <= CLOSE_PURSUIT_DISTANCE) {` to `gap <= 0) {`
  it("takes the wheel within the close-in distance, and hands it back to the traffic once the offender is far off again", () => {
    const { run, street, runner } = chase();
    runFor(run, 12);
    expect(street.drivers[PATROL_CAR_INDEX], "this driver has the wheel close in").not.toBeNull();
    street.snaps[runner]!.x += CHASE_RESUME_DISTANCE + 60;
    street.snaps[runner]!.vx = 0;
    street.snaps[runner]!.vz = 0;
    runFor(run, REDIRECT_SECONDS + 1);
    expect(street.drivers[PATROL_CAR_INDEX], "the traffic drives the trip again").toBeNull();
  });
});

describe("a chased traffic car runs from the patrol car", () => {
  // mutation: in src/game/ai/openworld-crime/patrol-cars.ts stepPursuit(), delete the line `if (this.yieldState[slot] === YIELD.none) this.ports.evade(this.targetCar[slot]!, this.handle[slot]!);`
  it("is told which patrol car chases it from the start of the chase", () => {
    const run = harness([40, 0, 0], { withCars: true, seed: CAREFUL_SEED });
    const street = run.street!;
    street.leaseAt = { x: 0, z: 0, yaw: EAST };
    const runner = street.addCar(RUNNER_X, 0, EAST, RUNNER_SPEED, 2, true);
    expect(run.scene.reportRedLight(runner, RUNNER_X, 0), "a patrol car was sent").toBe(true);
    runFor(run, 1);
    expect(street.evading[runner], "chased by the patrol car").toBe(PATROL_CAR_INDEX);
  });

  // mutation: in src/game/ai/openworld-crime/patrol-cars.ts linger(), delete the line `if (this.targetCar[slot]! >= 0) this.ports.endEvade(this.targetCar[slot]!);`
  it("is let go to drive as traffic when the chase is given up", () => {
    const run = harness([40, 0, 0], { withCars: true, seed: CAREFUL_SEED });
    const street = run.street!;
    street.leaseAt = { x: 0, z: 0, yaw: EAST };
    const runner = street.addCar(RUNNER_X, 0, EAST, RUNNER_SPEED, 2, true);
    run.scene.reportRedLight(runner, RUNNER_X, 0);
    runFor(run, 1);
    street.snaps[runner]!.x += CAR_LOST_DISTANCE + 100;
    street.snaps[runner]!.vx = 0;
    street.snaps[runner]!.vz = 0;
    runFor(run, CAR_LOST_SECONDS + 2);
    expect(street.evading[runner], "the chase is over").toBe(-1);
  });
});

describe("a patrol car brakes for a car in its way", () => {
  // mutation: in src/game/ai/openworld-crime/pursuit-driver.ts drive(), change `Math.min(turnSpeed, stopSpeed, maxSpeed, this.carLimit(self, others, targetId))` to `Math.min(turnSpeed, stopSpeed, maxSpeed)`
  it("stops short of a car standing on its line instead of driving into it", () => {
    const run = harness([0, 0, 0], { withCars: true, seed: HOTHEAD_SEED });
    const street = run.street!;
    street.leaseAt = { x: 0, z: 0, yaw: EAST };
    const blocker = street.addCar(BLOCKER_X, 0, EAST, 0, 3, true);
    run.offences.x[1] = 60;
    run.offences.commitCrime(1);
    runFor(run, 1);
    let closest = Infinity;
    for (let step = 0; step < 400; step++) {
      runFor(run, CRIME_STEP_SECONDS);
      const patrolCar = street.snaps[PATROL_CAR_INDEX]!;
      closest = Math.min(closest, Math.hypot(street.snaps[blocker]!.x - patrolCar.x, street.snaps[blocker]!.z - patrolCar.z));
    }
    expect(closest, "nearest it came to the car in its way").toBeGreaterThan(CAR_AVOID_GAP - 2);
  });
});
