import { describe, expect, it } from "vitest";
import { SUBJECT_MODE } from "./case-table.ts";
import { harness, runFor, type Wall } from "./crime-fixture.test-util.ts";

const CRIMINAL = 1;
const RUNNER_RESIDENT = 2;
const EAST = Math.PI / 2;
/** A building across the street between the cop at x = 40 and the scene at x = 60. */
const BUILDING: Wall = { minX: 45, maxX: 55 };

/** A crime at x = 60 with a cop at x = 40 and, when given, a building between them. */
function crimeRun(wall?: Wall) {
  const run = harness([40, 0, 0], wall === undefined ? {} : { wall });
  run.offences.x[CRIMINAL] = 60;
  run.offences.commitCrime(CRIMINAL);
  return run;
}

describe("a cop does not see through buildings", () => {
  // mutation: in src/game/ai/openworld-crime/foot-law.ts stepAtLarge(), change `this.caseCopSees(caseIndex, table.spotX[slot]!, table.spotZ[slot]!)` to `this.nearestGap <= COP_SIGHT`
  it("does not send a criminal running while a building stands between them, and does once it comes round it", () => {
    const hidden = crimeRun(BUILDING);
    runFor(hidden, 1.2);
    expect(hidden.scene.foot.table.mode[0], "behind the building: still about their day").toBe(SUBJECT_MODE.atLarge);
    const open = crimeRun();
    runFor(open, 1.2);
    expect(open.scene.foot.table.mode[0], "the same cop in the open").toBe(SUBJECT_MODE.fleeing);
    runFor(hidden, 5);
    expect(hidden.scene.foot.table.mode[0], "the cop has come round the building").not.toBe(SUBJECT_MODE.atLarge);
  });

  // mutation: in src/game/ai/openworld-crime/foot-law.ts copSees(), delete ` && this.sees(cop, x, z)`
  it("sends no patrol car after a red light the only cop in range could not see past a building", () => {
    const run = harness([40, 0, 0], { withCars: true, wall: BUILDING });
    const runner = run.street!.addCar(60, 0, EAST, 12, RUNNER_RESIDENT, true);
    expect(run.scene.reportRedLight(runner, 60, 0)).toBe(false);
    expect(run.street!.leases, "no car left the pool").toBe(0);
  });
});
