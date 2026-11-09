import { describe, expect, it } from "vitest";
import { CASE_KIND, CASE_PHASE, SUBJECT_MODE } from "./case-table.ts";
import { CRIME_STREAM, RESIST_CHANCE } from "./crime-constants.ts";
import { crimeDraw } from "./crime-draw.ts";
import { bustedResidents, FAR_TICK, harness, runFor, type Harness } from "./crime-fixture.test-util.ts";

const FIRST_FIGHTER = 0;
const SECOND_FIGHTER = 1;

function keepsAttacking(seed: number, resident: number): boolean {
  return crimeDraw(seed, CRIME_STREAM.resist, resident, FAR_TICK) < RESIST_CHANCE;
}

/** The first seed in 1..400 under which the fighters keep attacking as `first` and `second` say. */
function seedFor(first: boolean, second: boolean): number {
  for (let seed = 1; seed <= 400; seed++) if (keepsAttacking(seed, FIRST_FIGHTER) === first && keepsAttacking(seed, SECOND_FIGHTER) === second) return seed;
  throw new Error("no seed in 1..400 draws that way");
}

/** Two residents brawling at x = 60 with a cop ten metres west of them. */
function fightRun(seed: number): Harness {
  const run = harness([50, 0, 0], { seed });
  run.offences.x[FIRST_FIGHTER] = 60;
  run.offences.x[SECOND_FIGHTER] = 60;
  run.offences.startFight(FIRST_FIGHTER, SECOND_FIGHTER);
  return run;
}

describe("a fight brings a cop who ends it", () => {
  it("warns the fighters and arrests only the one who began it when neither keeps attacking", () => {
    const run = fightRun(seedFor(false, false));
    runFor(run, 10);
    expect(bustedResidents(run), "the instigator, the lower resident of a tie").toBe(String(FIRST_FIGHTER));
    expect(run.busts[0]!.seconds, "after the warning and the cuffs").toBeGreaterThan(4);
    expect(run.busts[0]!.seconds).toBeLessThan(6.5);
    expect(run.scene.takeStrikes(), "nobody thrown down").toHaveLength(0);
    expect(run.offences.fightAt[SECOND_FIGHTER], "the fight is over for the other fighter too").not.toBe(0);
    expect(run.scene.foot.table.phase[0]).toBe(CASE_PHASE.free);
  });

  it("takes down the fighter who keeps attacking, and arrests both", () => {
    const run = fightRun(seedFor(false, true));
    runFor(run, 10);
    expect(bustedResidents(run)).toBe(`${FIRST_FIGHTER},${SECOND_FIGHTER}`);
    const strikes = run.scene.takeStrikes();
    expect(strikes, "one takedown").toHaveLength(1);
    expect(strikes[0]!.guard, "of the one who kept attacking").toBe(SECOND_FIGHTER);
    expect(strikes[0]!.car, "by a cop, not a car").toBe(-1);
    expect(run.scene.stats.takedowns).toBe(1);
  });

  it("does not move on a fight until a cop is near, and lets it run to the warning", () => {
    const run = harness([0, 0, 0]);
    run.offences.x[FIRST_FIGHTER] = 60;
    run.offences.x[SECOND_FIGHTER] = 60;
    run.offences.startFight(FIRST_FIGHTER, SECOND_FIGHTER);
    runFor(run, 2);
    expect(run.scene.foot.table.kind[0]).toBe(CASE_KIND.fight);
    expect(run.scene.foot.table.phase[0], "no cop within the warning reach yet").toBe(CASE_PHASE.open);
    expect(run.busts).toHaveLength(0);
  });

  it("goes on after the fighters as suspects when the fight ends before the cops come", () => {
    const run = harness([0, 0, 0]);
    run.offences.x[FIRST_FIGHTER] = 60;
    run.offences.x[SECOND_FIGHTER] = 60;
    run.offences.startFight(FIRST_FIGHTER, SECOND_FIGHTER);
    runFor(run, 1);
    run.offences.endFight(FIRST_FIGHTER, SECOND_FIGHTER);
    runFor(run, 1);
    const { table } = run.scene.foot;
    expect(table.kind[0], "no fight, but they are still wanted").toBe(CASE_KIND.crime);
    expect(table.mode[0]).toBe(SUBJECT_MODE.atLarge);
    expect(table.mode[1]).toBe(SUBJECT_MODE.atLarge);
  });
});
