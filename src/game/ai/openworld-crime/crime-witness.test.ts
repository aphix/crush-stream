import { describe, expect, it } from "vitest";
import { tickAt } from "../civilians/civilian-clock.ts";
import { NEVER_TICK } from "../civilians/civilian-constants.ts";
import { CASE_PHASE } from "./case-table.ts";
import { harness, runFor, type HarnessOptions } from "./crime-fixture.test-util.ts";

const CRIMINAL = 1;
const OTHER = 2;
/** A building between the cop at x = 40 and the crime at x = 60. */
const BUILDING = { minX: 45, maxX: 55 };
/** The seconds a witness's call takes in these rows (crowd seconds), and the tick it ends at: short enough that the patrolling cops, walking in at 1.4 m/s from the west end, have not come within sight of x = 60 (40 m) by then. */
const CALL_SECONDS = 10;
const CALL_ENDS = tickAt(CALL_SECONDS);

/** A crime at x = 60 that nobody has phoned in, with the cops at `copX` (the first at 40 unless said). */
function unreported(copX: readonly number[], options: HarnessOptions = {}) {
  const run = harness(copX, options);
  run.offences.x[CRIMINAL] = 60;
  run.offences.commitCrime(CRIMINAL, true);
  return run;
}

describe("the police come for what a cop saw or a call told them of", () => {
  // mutation: in src/game/ai/openworld-crime/foot-law.ts poll(), change `if (spell === table.handledSpell[resident] || !this.witnessed(resident, spell, tick)) continue;` to `if (spell === table.handledSpell[resident]) continue;`
  it("opens no case for a crime no cop saw and nobody reported", () => {
    const run = unreported([0, 0, 0]);
    runFor(run, CALL_SECONDS + 2);
    expect(run.scene.stats.cases, "no case").toBe(0);
    expect(run.scene.foot.table.phase[0], "none open").toBe(CASE_PHASE.free);
  });

  // mutation: in src/game/ai/openworld-crime/foot-law.ts witnessed(), change `return source.standing(resident, this.seconds, this.spot) && this.copSeesSpot(this.spot.x, this.spot.z);` to `return false;`
  it("opens the case at once when a cop sees the crime", () => {
    const run = unreported([40, 0, 0]);
    runFor(run, 1);
    expect(run.scene.stats.cases, "the cop saw it").toBe(1);
  });

  // mutation: in src/game/ai/openworld-crime/foot-law.ts sees(), change `this.lineOfSight === null || this.lineOfSight(` to `true || this.lineOfSight(`
  it("does not count a cop who has a building between him and the crime", () => {
    const run = unreported([40, 0, 0], { wall: BUILDING });
    runFor(run, 5);
    expect(run.scene.stats.cases, "the building hid it").toBe(0);
  });

  // mutation: in src/game/ai/openworld-crime/foot-law.ts witnessed(), change `tick >= table.reportDue[resident]!` to `true`
  it("opens the case when the witness's call ends, not before, and not for a call nobody made", () => {
    const run = unreported([0, 0, 0]);
    run.offences.reportedAt[CRIMINAL] = CALL_ENDS;
    runFor(run, CALL_SECONDS - 2);
    expect(run.scene.stats.cases, "the witness is still on the phone").toBe(0);
    runFor(run, 3);
    expect(run.scene.stats.cases, "the call ended").toBe(1);
  });

  // mutation: in src/game/ai/openworld-crime/foot-law.ts witnessed(), change `if (table.reportSpell[resident] !== spell) {` to `if (true) {`
  it("keeps a call it saw even after the witness has gone back to their day", () => {
    const run = unreported([0, 0, 0]);
    run.offences.reportedAt[CRIMINAL] = CALL_ENDS;
    runFor(run, 2);
    run.offences.reportedAt[CRIMINAL] = NEVER_TICK;
    runFor(run, CALL_SECONDS);
    expect(run.scene.stats.cases, "the call still brought the police").toBe(1);
  });

  // mutation: in src/game/ai/openworld-crime/foot-law.ts copSeesSpot(), change `return this.copSees(x, z, COP_SIGHT) || (this.otherCopsSee?.(x, z, COP_SIGHT) ?? false);` to `return false;`
  it("opens the case when a cop walks into sight of a wanted criminal nobody reported", () => {
    const run = unreported([0, 0, 0]);
    runFor(run, 4);
    expect(run.scene.stats.cases, "nobody has seen them yet").toBe(0);
    run.scene.foot.walkers.place(0, 40, 0);
    runFor(run, 1);
    expect(run.scene.stats.cases, "a cop came by").toBe(1);
  });

  // mutation: in src/game/ai/openworld-crime/foot-law.ts poll(), change `const brawling = source.fightTick(resident) !== NEVER_TICK && source.fightPartner(resident) >= 0;` to `const brawling = false;`
  it("holds a fight to the same rule: unreported and unseen, no case; a cop near it, a case", () => {
    const unseen = harness([0, 0, 0]);
    unseen.offences.x[CRIMINAL] = 60;
    unseen.offences.x[OTHER] = 60;
    unseen.offences.startFight(CRIMINAL, OTHER, true);
    runFor(unseen, 5);
    expect(unseen.scene.stats.cases, "nobody saw the fight").toBe(0);
    const seen = harness([40, 0, 0]);
    seen.offences.x[CRIMINAL] = 60;
    seen.offences.x[OTHER] = 60;
    seen.offences.startFight(CRIMINAL, OTHER, true);
    runFor(seen, 2);
    expect(seen.scene.stats.cases, "a cop saw the fight").toBe(1);
  });
});
