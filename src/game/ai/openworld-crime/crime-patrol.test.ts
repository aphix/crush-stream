import { hypot2 } from "../../kernel/physics-core.js";
import { describe, expect, it } from "vitest";
import { CAR_AVOID_GAP, CAR_LINGER_SECONDS, CAR_LOST_DISTANCE, CAR_LOST_SECONDS, CAREFUL_PURSUIT_SPEED, CHASE_LEAD_SECONDS, CHASE_RESUME_DISTANCE, CLOSE_PURSUIT_DISTANCE, CRIME_STEP_SECONDS, CRIME_STREAM, HOTHEAD_RUN_SHARE, REDIRECT_SECONDS } from "./crime-constants.ts";
import { crimeDraw } from "./crime-draw.ts";
import { harness, runFor, runUntil, seedWhere } from "./crime-fixture.test-util.ts";
import { PatrolCars } from "./patrol-cars.ts";
import { FakeStreet } from "./crime-street.test-util.ts";

const RUNS = 200;
const EAST = Math.PI / 2;
const RUNNER_X = 90;
/** An offender's street trip ends this far (m) off the car: between the bust range and the close-in distance, so the car comes to a stop short of it. */
const OFF_ROAD_GAP = 26;
/** The chased car's pace (m/s): slow enough for the patrol car to close the gap in the rows' time. */
const RUNNER_SPEED = 1;
/** The chased car is put this far (m) off: the patrol car, closing at the urgent pace, is still more than `CAR_LOST_DISTANCE` away for `CAR_LOST_SECONDS`. */
const RUNAWAY_JUMP = 5 * CAR_LOST_DISTANCE;
/** The chased car for the chase rows stands this far (m) east, with the foot cop who saw it 50 m before it: the patrol car's trip from the west end is long enough to read. */
const FAR_RUNNER_X = 190;
const FAR_COP_X = 140;
/** A stopped car standing on the patrol car's line, between its start and the scene. */
const BLOCKER_X = 30;
/** The patrol car's place in the fake street's list: after the car already standing there. */
const PATROL_CAR_INDEX = 1;
/** The share of hothead runs over `RUNS` seeded runs lands within this of `HOTHEAD_RUN_SHARE`: the binomial spread of 200 draws at 0.2 is 0.028, so this is more than three spreads. */
const SHARE_BAND = 0.1;
/** The race brake's latch lets a car run this far (m/s) over the speed it wants before it bites (`BRAKE_ON` in race-ai.ts). */
const BRAKE_LATCH = 1.5;
const NO_HOOKS = { arrived: () => {}, busted: () => {}, delivered: () => {} };
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
    runUntil(run, 15, () => run.scene.foot.table.copAt(0, 2) >= 0);
    expect(run.street!.drivers[0], "the traffic drove it").toBeNull();
    expect(run.street!.tripDone[0], "at its kerb space").toBe(true);
    expect(run.scene.foot.table.copAt(0, 2), "its cop joined the case").toBeGreaterThanOrEqual(0);
  });
});

describe("closing on a car it chases", () => {
  /** The chased car drives off east at this pace (m/s) over open ground, and a careful patrol car's street trip ends this far (m) from it, off the road. */
  const FLEEING_SPEED = 2;
  const KERB_GAP = 28;

  /** A patrol car chasing a car that is driving off, on the given seed: the fastest it goes with the police driver at the wheel within `CLOSE_PURSUIT_DISTANCE` m of it. */
  function closeChase(seed: number): number {
    const run = harness([40, 0, 0], { withCars: true, seed });
    const street = run.street!;
    street.leaseAt = { x: 0, z: 0, yaw: EAST };
    street.kerbOffset = KERB_GAP;
    const runner = street.addCar(RUNNER_X, 0, EAST, FLEEING_SPEED, 2, false);
    run.scene.reportRedLight(runner, RUNNER_X, 0);
    let fastestClose = 0;
    for (let step = 0; step < 300; step++) {
      runFor(run, CRIME_STEP_SECONDS);
      const patrolCar = street.snaps[PATROL_CAR_INDEX]!;
      const close = hypot2(patrolCar.x - street.snaps[runner]!.x, patrolCar.z - street.snaps[runner]!.z) <= CLOSE_PURSUIT_DISTANCE;
      if (close && street.drivers[PATROL_CAR_INDEX] !== null) fastestClose = Math.max(fastestClose, hypot2(patrolCar.vx, patrolCar.vz));
    }
    return fastestClose;
  }

  // mutation: in src/game/ai/openworld-crime/patrol-cars.ts driveSlot(), change `const cap = this.hothead[slot] === 0 ? Math.sqrt(CAREFUL_PURSUIT_SPEED * CAREFUL_PURSUIT_SPEED + 2 * CAR_STOP_DECEL * beyond) : Infinity;` to `const cap = Infinity;`
  it("a careful car takes the wheel at a street's pace for the last metres, a hothead is at it at full speed", () => {
    expect(closeChase(CAREFUL_SEED), "careful").toBeLessThanOrEqual(CAREFUL_PURSUIT_SPEED + BRAKE_LATCH);
    expect(closeChase(HOTHEAD_SEED), "hothead").toBeGreaterThan(CAREFUL_PURSUIT_SPEED + BRAKE_LATCH);
  });
});

describe("a careful chase follows the streets", () => {
  /** A car 90 m east cruising east at `RUNNER_SPEED`, seen by the foot cop at x = 40, the patrol car's lease starting at the west end; careful runs under `CAREFUL_SEED`. */
  function chase() {
    const run = harness([FAR_COP_X, 0, 0], { withCars: true, seed: CAREFUL_SEED });
    const street = run.street!;
    street.leaseAt = { x: 0, z: 0, yaw: EAST };
    const runner = street.addCar(FAR_RUNNER_X, 0, EAST, RUNNER_SPEED, 2, false);
    expect(run.scene.reportRedLight(runner, FAR_RUNNER_X, 0), "a patrol car was sent").toBe(true);
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
    expect(first.x, "ahead of the offender by what it covers in the lead time, at the second it was aimed").toBeCloseTo(FAR_RUNNER_X + RUNNER_SPEED * (REDIRECT_SECONDS + CHASE_LEAD_SECONDS), 0);
    runFor(run, REDIRECT_SECONDS);
    expect(street.redirects.length, "and again").toBe(2);
    expect(street.redirects[1]!.x, "further on with the offender").toBeGreaterThan(first.x);
    expect(street.drivers[PATROL_CAR_INDEX], "still the traffic's trip").toBeNull();
  });

  // mutation: in src/game/ai/openworld-crime/patrol-cars.ts followStreets(), change `if (arrived && gap <= CLOSE_PURSUIT_DISTANCE && gap > BUST.near) {` to `if (arrived && gap <= 0) {`
  it("takes the wheel for the last metres once its street trip has stopped short of an offender that left the road, and hands it back to the traffic once the offender is far off again", () => {
    const { run, street, runner } = chase();
    street.kerbOffset = OFF_ROAD_GAP;
    runFor(run, 14);
    expect(street.drivers[PATROL_CAR_INDEX], "this driver has the wheel close in").not.toBeNull();
    street.snaps[runner]!.x += CHASE_RESUME_DISTANCE + 60;
    street.snaps[runner]!.vx = 0;
    street.snaps[runner]!.vz = 0;
    runFor(run, REDIRECT_SECONDS + 1);
    expect(street.drivers[PATROL_CAR_INDEX], "the traffic drives the trip again").toBeNull();
  });

  // mutation: in src/game/ai/openworld-crime/patrol-cars.ts followStreets(), delete the line `if (arrived && gap <= BUST.near) return;`
  it("stays parked at its kerb while it is within bust range of the offender, the hold running, and does not take the wheel", () => {
    const { run, street } = chase();
    runFor(run, 25);
    expect(street.drivers[PATROL_CAR_INDEX], "the traffic's trip still").toBeNull();
    expect(street.redirects.length, "re-aimed on its way and not once it stood beside it").toBeLessThan(8);
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
    street.snaps[runner]!.x += RUNAWAY_JUMP;
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
      closest = Math.min(closest, hypot2(street.snaps[blocker]!.x - patrolCar.x, street.snaps[blocker]!.z - patrolCar.z));
    }
    expect(closest, "nearest it came to the car in its way").toBeGreaterThan(CAR_AVOID_GAP - 2);
  });
});

describe("the pursuit strip counts what chases the player's car", () => {
  /** The player's car standing 20 m past the foot cop who saw it run a red light, a patrol car sent from the west end. */
  function playerChase() {
    const run = harness([40, 0, 0], { withCars: true, seed: CAREFUL_SEED });
    const street = run.street!;
    street.leaseAt = { x: 0, z: 0, yaw: EAST };
    const player = street.addCar(60, 0, EAST, 0, -1, false);
    expect(run.scene.reportRedLight(player, 60, 0), "a patrol car was sent").toBe(true);
    return { run, street, player };
  }
  const BUST_HOLD_SECONDS = 12;

  // mutation: in src/game/ai/openworld-crime/patrol-cars.ts chaseOf(), change `cops++;` to `cops += 0;`
  it("says nothing while no patrol car chases it and counts the cars once one does", () => {
    const { run, player } = playerChase();
    const strip = { cops: 0, hold: 0, left: 0 };
    expect(run.scene.chaseOf(player + 1, strip), "another car").toBe(false);
    expect(run.scene.chaseOf(player, strip), "the chased car").toBe(true);
    expect(strip.cops).toBe(1);
    expect(strip.hold, "no hold yet: the patrol car is far").toBe(0);
    expect(strip.left, "all of Survival's hold ahead").toBe(BUST_HOLD_SECONDS);
  });

  // mutation: in src/game/ai/openworld-crime/patrol-cars.ts holdSlow(), change `slow && gap <= BUST.near ? this.heldFor[slot]! + dt : 0` to `slow && gap <= BUST.near ? this.heldFor[slot]! + dt : this.heldFor[slot]!`
  it("fills the hold while a patrol car has it held slow beside it, and drains it the moment it drives off", () => {
    const { run, street, player } = playerChase();
    const strip = { cops: 0, hold: 0, left: 0 };
    runFor(run, 10);
    expect(run.scene.chaseOf(player, strip), "still chased").toBe(true);
    expect(strip.hold, "a hold has run").toBeGreaterThan(0);
    expect(strip.hold * BUST_HOLD_SECONDS + strip.left, "the meter and the countdown are one hold").toBeCloseTo(BUST_HOLD_SECONDS, 6);
    street.snaps[player]!.vx = 12;
    runFor(run, CRIME_STEP_SECONDS * 2);
    expect(run.scene.chaseOf(player, strip), "chased still").toBe(true);
    expect(strip.hold, "the hold is over with the speed").toBe(0);
    expect(strip.left, "and starts again from all of it").toBe(BUST_HOLD_SECONDS);
  });

  // mutation: in src/game/ai/openworld-crime/patrol-cars.ts bust(), delete the line `this.linger(slot, seconds, IMPOUND_SECONDS);`
  it("ends with the bust: no strip once the player is busted, and the engine was told", () => {
    const { run, player } = playerChase();
    const strip = { cops: 0, hold: 0, left: 0 };
    runFor(run, 30);
    expect(run.playerBusts.join(","), "the player's car busted").toBe(String(player));
    expect(run.scene.chaseOf(player, strip), "the chase is over").toBe(false);
  });
});
