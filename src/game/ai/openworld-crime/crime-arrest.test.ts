import { describe, expect, it } from "vitest";
import { ACTIVITY, ARREST } from "../civilians/civilian-activity.ts";
import { CASE_PHASE, isHeldMode } from "./case-table.ts";
import { harness, runFor } from "./crime-fixture.test-util.ts";
import { detCos, detSin } from "../../kernel/physics-core.js";

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
    expect(cops.x[cop], "behind her across x").toBeCloseTo(run.poses.x[CRIMINAL]! - detSin(yaw) * ARREST.cuffBehind, 3);
    expect(cops.z[cop], "behind her across z").toBeCloseTo(run.poses.z[CRIMINAL]! - detCos(yaw) * ARREST.cuffBehind, 3);
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
    expect(run.poses.x[CRIMINAL], "at his right and a little ahead, across x").toBeCloseTo(cops.x[cop]! - ARREST.escortAcross * detCos(yaw) + ARREST.escortAhead * detSin(yaw), 3);
    expect(run.poses.z[CRIMINAL], "at his right and a little ahead, across z").toBeCloseTo(cops.z[cop]! + ARREST.escortAcross * detSin(yaw) + ARREST.escortAhead * detCos(yaw), 3);
    runFor(run, 7);
    expect(run.poses.shown[CRIMINAL], "gone from the street").toBe(0);
    expect(run.scene.foot.table.phase[0], "the case is closed").toBe(CASE_PHASE.free);
    expect(cops.activity[cop], "the cop is back to walking").toBe(ACTIVITY.none);
  });
});

describe("the hook takes a cop making an arrest, and then the suspect he held", () => {
  /** An arrest begun (cuffs going on): the cop holding case 0. */
  function cuffing() {
    const run = arrestRun();
    runFor(run, 1);
    return { run, cop: run.scene.foot.table.holder[0]! };
  }

  /** Whether the suspect is in a cop's hands (gripped, led, boarding, driven). */
  function inHands(run: ReturnType<typeof arrestRun>): boolean {
    const { table } = run.scene.foot;
    const slot = table.subjectOf[CRIMINAL]!;
    return slot >= 0 && isHeldMode(table.mode[slot]!);
  }

  // mutation: sed -i 's/    this.downCop(cop, stood(-1, cop,/    this.copStrikes.push(stood(-1, cop,/' src/game/ai/openworld-crime/crime-scene.ts
  it("when the hook takes the cop, then he is down where he stood with no speed, every peer hears it, and the suspect he held is let go", () => {
    const { run, cop } = cuffing();
    const spot = { x: run.scene.copPoses.x[cop]!, z: run.scene.copPoses.z[cop]! };
    const lost = run.scene.stats.lost;
    expect(inHands(run), "control: she is in his hands").toBe(true);
    expect(run.scene.hookCop(cop, run.now), "taken").toBe(true);
    expect(run.copDowns.length, "knocks raised for the wire").toBe(1);
    expect(run.copDowns[0]!.resident, "for this cop").toBe(cop);
    const strikes = run.scene.takeCopStrikes();
    expect(strikes.length, "one figure to throw").toBe(1);
    expect(strikes[0]!.car, "no car struck him").toBe(-1);
    expect(strikes[0]!.x, "thrown from his x").toBeCloseTo(spot.x, 5);
    expect(strikes[0]!.z, "thrown from his z").toBeCloseTo(spot.z, 5);
    expect(Math.abs(strikes[0]!.vx) + Math.abs(strikes[0]!.vy) + Math.abs(strikes[0]!.vz), "his speed (m/s)").toBe(0);
    expect(run.scene.copPoses.shown[cop], "no longer drawn standing").toBe(0);
    expect(run.scene.stats.lost - lost, "the suspect he held was let go").toBe(1);
    expect(inHands(run), "she is in no hands now").toBe(false);
    runFor(run, 1);
    expect(inHands(run), "nor a second later: the cop who held her is down").toBe(false);
  });

  // mutation: sed -i '/^  hookCop(cop: number, seconds: number): boolean {/,/^  }/{/fightKnown/d}' src/game/ai/openworld-crime/crime-scene.ts
  it("when the hook takes a cop who is only walking his beat, then the player has fought the law: a chase of him opens", () => {
    const run = harness([59]);
    run.scene.setFoot(true, 58, 0, 1, 0, 0);
    runFor(run, 1);
    expect(run.scene.footChaseOf({ cops: 0, hold: 0, left: 0 }), "control: no chase before the hook").toBe(false);
    expect(run.scene.hookCop(0, run.now), "taken").toBe(true);
    expect(run.scene.footChaseOf({ cops: 0, hold: 0, left: 0 }), "the chase is open").toBe(true);
  });

  // mutation: sed -i 's/^    if (!this.authority || poses.shown\[cop\] === 0) return false;/    if (poses.shown[cop] === 0) return false;/' src/game/ai/openworld-crime/crime-scene.ts
  it("when a client's scene is asked to hook a cop, then nothing happens", () => {
    const run = harness([59], { authority: false });
    runFor(run, 1);
    expect(run.scene.hookCop(0, run.now), "refused").toBe(false);
    expect(run.copDowns.length, "no knock raised").toBe(0);
  });

  it("when the law lets the suspect out of his hands (the hook took her), then the cuffs are off, and the offence still held against her has a cop go after her again", () => {
    const { run } = cuffing();
    expect(inHands(run), "control: she is in his hands").toBe(true);
    const lost = run.scene.stats.lost;
    run.scene.foot.spare(CRIMINAL);
    expect(run.scene.stats.lost - lost, "let go").toBe(1);
    expect(inHands(run), "out of his hands").toBe(false);
    runFor(run, 5);
    const { table } = run.scene.foot;
    expect(table.active(table.subjectOf[CRIMINAL]!), "a case after her again").toBe(true);
  });
});
