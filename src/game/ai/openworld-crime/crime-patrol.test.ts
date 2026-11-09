import { describe, expect, it } from "vitest";
import { CAR_LINGER_SECONDS, CAREFUL_PURSUIT_SPEED, CLOSE_PURSUIT_DISTANCE, CRIME_STEP_SECONDS, CRIME_STREAM, HOTHEAD_RUN_SHARE } from "./crime-constants.ts";
import { crimeDraw } from "./crime-draw.ts";
import { harness, runFor, seedWhere } from "./crime-fixture.test-util.ts";
import { PatrolCars } from "./patrol-cars.ts";
import { FakeStreet } from "./crime-street.test-util.ts";

const RUNS = 200;
const EAST = Math.PI / 2;
const RUNNER_X = 90;
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
