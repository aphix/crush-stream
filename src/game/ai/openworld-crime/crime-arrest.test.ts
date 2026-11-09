import { describe, expect, it } from "vitest";
import { ACTIVITY, ARREST } from "../civilians/civilian-activity.ts";
import { CASE_PHASE } from "./case-table.ts";
import { harness, runFor } from "./crime-fixture.test-util.ts";

const CRIMINAL = 1;

/** A crime at x = 60 with a cop standing on it: the cuffs go on at the first poll. */
function arrestRun() {
  const run = harness([60, 0, 0]);
  run.offences.x[CRIMINAL] = 60;
  run.offences.commitCrime(CRIMINAL);
  return run;
}

describe("an arrest is acted", () => {
  // mutation: in src/game/ai/openworld-crime/arrests.ts grip(), delete the lines `walkers.place(cop, walkers.x[walker]! - detSin(yaw) * ARREST.cuffBehind, ...);` and `walkers.yaw[cop] = yaw;`
  it("while the cuffs go on, the suspect has her back to the cop, who stands behind her facing her way, both acting it", () => {
    const run = arrestRun();
    runFor(run, 1);
    const cop = run.scene.foot.table.holder[0]!;
    const cops = run.scene.copPoses;
    const yaw = run.poses.yaw[CRIMINAL]!;
    expect(run.poses.activity[CRIMINAL], "she is being cuffed").toBe(ACTIVITY.cuffing);
    expect(run.poses.activityClock[CRIMINAL], "on the grip's clock").toBeGreaterThan(0);
    expect(cops.activity[cop], "he works the cuffs").toBe(ACTIVITY.arresting);
    expect(cops.yaw[cop], "facing her way").toBeCloseTo(yaw, 4);
    expect(cops.x[cop], "behind her across x").toBeCloseTo(run.poses.x[CRIMINAL]! - Math.sin(yaw) * ARREST.cuffBehind, 3);
    expect(cops.z[cop], "behind her across z").toBeCloseTo(run.poses.z[CRIMINAL]! - Math.cos(yaw) * ARREST.cuffBehind, 3);
  });

  // mutation: in src/game/ai/openworld-crime/crime-poses.ts writeArrestActivity(), change `activity === ACTIVITY.none ? 0 :` to `!gripping ? 0 :` (the clock check); or in src/game/ai/openworld-crime/foot-law.ts completeBust(), delete the block `if (this.table.tookDown[slot] === 0) { this.arrests.escort(caseIndex, slot, this.seconds); return; }`
  it("once cuffed, she is led away walking at the cop's right, then is gone from the street and the case closes", () => {
    const run = arrestRun();
    runFor(run, 3);
    const cop = run.scene.foot.table.holder[0]!;
    const cops = run.scene.copPoses;
    const yaw = cops.yaw[cop]!;
    expect(run.poses.shown[CRIMINAL], "still on the street").toBe(1);
    expect(run.poses.activity[CRIMINAL], "cuffed").toBe(ACTIVITY.cuffed);
    expect(cops.activity[cop], "he leads her").toBe(ACTIVITY.escorting);
    expect(cops.activityClock[cop], "his escort clip runs on the walk's clock").toBeGreaterThan(0.4);
    expect(run.poses.activityClock[CRIMINAL], "hers too").toBeCloseTo(cops.activityClock[cop]!, 4);
    expect(cops.speed[cop], "at a walk").toBeGreaterThan(0);
    expect(run.poses.speed[CRIMINAL], "beside him").toBeCloseTo(cops.speed[cop]!, 4);
    expect(run.poses.x[CRIMINAL], "at his right and a little ahead, across x").toBeCloseTo(cops.x[cop]! - ARREST.escortAcross * Math.cos(yaw) + ARREST.escortAhead * Math.sin(yaw), 3);
    expect(run.poses.z[CRIMINAL], "at his right and a little ahead, across z").toBeCloseTo(cops.z[cop]! + ARREST.escortAcross * Math.sin(yaw) + ARREST.escortAhead * Math.cos(yaw), 3);
    runFor(run, 7);
    expect(run.poses.shown[CRIMINAL], "gone from the street").toBe(0);
    expect(run.scene.foot.table.phase[0], "the case is closed").toBe(CASE_PHASE.free);
    expect(cops.activity[cop], "the cop is back to walking").toBe(ACTIVITY.none);
  });
});
