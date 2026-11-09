import { describe, expect, it } from "vitest";
import { CASE_PHASE } from "./case-table.ts";
import { harness, runFor, type HarnessOptions } from "./crime-fixture.test-util.ts";

const WALKER = 2;
const CRIMINAL = 1;
/** The middle of the crossing between x = 60 and x = 70, and a step off its west kerb. */
const ON_CROSSING_X = 65;
const AT_KERB_X = 60.5;

/** A walker at `x` heading east along the line city, a cop at x = 40, the signals against crossings or for them. */
function crossingRun(x: number, against: boolean, options: HarnessOptions = {}) {
  const run = harness([40, 0, 0], options);
  run.offences.x[WALKER] = x;
  run.signals.against = against;
  return run;
}

describe("a walker crossing against the signal", () => {
  // mutation: in src/game/ai/openworld-crime/foot-law.ts poll(), delete the line `if (this.signals !== null) this.watchCrossings(this.signals);`
  it("is stopped by the cop who sees it and taken off the street, and the host raises the jaywalk arrest, not a bust", () => {
    const run = crossingRun(ON_CROSSING_X, true);
    runFor(run, 10);
    expect(run.jaywalks.map((arrest) => arrest.resident).join(","), "the jaywalker").toBe(String(WALKER));
    expect(run.busts, "no bust").toHaveLength(0);
    expect(run.scene.stats.jaywalkers).toBe(1);
    expect(run.poses.shown[WALKER], "off the street until their next walk").toBe(0);
    expect(run.scene.foot.table.phase[0], "the case is closed").toBe(CASE_PHASE.free);
  });

  // mutation: in src/game/ai/openworld-crime/foot-law.ts watchCrossings(), change `if (crossing < 0 || !signals.againstSignal(` to `if (crossing < 0 || !!signals.againstSignal(`
  it("is left alone when the signal is for them", () => {
    const run = crossingRun(ON_CROSSING_X, false);
    runFor(run, 10);
    expect(run.scene.stats.cases, "no case").toBe(0);
    expect(run.jaywalks).toHaveLength(0);
  });

  // mutation: in src/game/ai/openworld-crime/foot-law.ts freeCopSeeing(), delete ` || !this.sees(cop, x, z)`
  it("is left alone when the only cop near stands behind a building", () => {
    const run = crossingRun(ON_CROSSING_X, true, { wall: { minX: 45, maxX: 55 } });
    runFor(run, 10);
    expect(run.scene.stats.cases, "no case").toBe(0);
  });

  // mutation: in src/game/ai/openworld-crime/crime-constants.ts, change `CROSSING_KERB_SHARE = 0.15` to `CROSSING_KERB_SHARE = 0`
  it("is not a jaywalker while still waiting at the kerb", () => {
    const run = crossingRun(AT_KERB_X, true);
    runFor(run, 10);
    expect(run.scene.stats.cases, "no case").toBe(0);
  });
});

describe("a walker a car runs down is not arrested for it", () => {
  // mutation: in src/game/ai/openworld-crime/foot-law.ts, delete the line `this.spareKnocked(caseIndex);` in stepCase() and ` || !this.source.onStreet(table.resident[slot]!, this.walk)` in stepAtLarge()
  it("lets a jaywalker go whom a car hits before the cop comes", () => {
    const run = crossingRun(ON_CROSSING_X, true);
    runFor(run, 2);
    expect(run.scene.stats.cases, "the cop saw them").toBe(1);
    run.offences.knockDown(WALKER);
    runFor(run, 10);
    expect(run.jaywalks, "no arrest").toHaveLength(0);
    expect(run.scene.foot.table.phase[0], "the case is closed").toBe(CASE_PHASE.free);
  });

  // mutation: in src/game/ai/openworld-crime/foot-law.ts stepCase(), delete the line `this.spareKnocked(caseIndex);`
  it("does not bust a criminal a car ran down while the cops were on their way", () => {
    const run = harness([0, 0, 0]);
    run.offences.x[CRIMINAL] = 60;
    run.offences.commitCrime(CRIMINAL);
    runFor(run, 1);
    run.offences.knockDown(CRIMINAL);
    runFor(run, 1);
    expect(run.scene.foot.table.subjectOf[CRIMINAL], "let go at once").toBe(-1);
    expect(run.scene.foot.table.phase[0], "the case is closed").toBe(CASE_PHASE.free);
    runFor(run, 30);
    expect(run.busts, "no bust of someone in hospital").toHaveLength(0);
  });
});
