import { describe, expect, it } from "vitest";
import { FIGHT_PLAYER } from "../civilians/civilian-constants.ts";
import { FOOT_HOLD_SPEED, PLAYER_CHASE_GIVE_UP_SECONDS } from "./crime-constants.ts";
import { harness, runFor, type HarnessOptions } from "./crime-fixture.test-util.ts";

const PLAYER_X = 65;
/** The player's chase of the engine's seconds (Survival's hold for a human), the harness's `playerBustSeconds`. */
const BUST_SECONDS = 12;
const BUILDING = { minX: 45, maxX: 55 };
const RESIDENT = 1;

/** The player on the middle of the crossing between x = 60 and x = 70, facing east, a cop at x = 40 who sees him; the signals against him unless said, standing still unless `speed` says. */
function onCrossing(options: HarnessOptions & { speed?: number; against?: boolean } = {}) {
  const run = harness([40, 0, 0], options);
  run.signals.against = options.against ?? true;
  run.scene.setFoot(true, PLAYER_X, 0, 1, 0, options.speed ?? 0);
  return run;
}

const strip = () => ({ cops: 0, hold: 0, left: 0 });

describe("the player on foot is a subject of the law", () => {
  // mutation: in src/game/ai/openworld-crime/foot-law.ts poll(), delete the line `this.player.poll(this.seconds);`
  it("crossing against the signal where a cop sees him, a chase of him opens and the cops run at him", () => {
    const run = onCrossing();
    runFor(run, 1);
    const out = strip();
    expect(run.scene.footChaseOf(out), "a chase is open").toBe(true);
    expect(out.cops, "a cop after him").toBeGreaterThanOrEqual(1);
    const before = Math.abs(run.scene.foot.walkers.x[0]! - PLAYER_X);
    runFor(run, 2);
    expect(before - Math.abs(run.scene.foot.walkers.x[0]! - PLAYER_X), "metres the cop closed on him in two seconds").toBeGreaterThan(5);
  });

  // mutation: sed -i 's/ || this.table.allCaught(caseIndex)) return;/ || true) return;/' src/game/ai/openworld-crime/foot-law.ts
  it("the nearest free cop joins the first in his chase", () => {
    const run = onCrossing();
    runFor(run, 2);
    const out = strip();
    expect(run.scene.footChaseOf(out), "a chase is open").toBe(true);
    expect(out.cops, "cops after him").toBe(2);
  });

  // mutation: in src/game/ai/openworld-crime/player-law.ts poll(), change `if (!this.signals.againstSignal(` to `if (this.signals.againstSignal(`
  it("is left alone when the signal is for him, when a building hides him from the cop, and when he is not on foot", () => {
    const green = onCrossing({ against: false });
    runFor(green, 3);
    expect(green.scene.footChaseOf(strip()), "the light was his").toBe(false);
    const hidden = onCrossing({ wall: BUILDING });
    runFor(hidden, 3);
    expect(hidden.scene.footChaseOf(strip()), "no cop sees him").toBe(false);
    const driving = onCrossing();
    driving.scene.setFoot(false, PLAYER_X, 0, 1, 0, 0);
    runFor(driving, 3);
    expect(driving.scene.footChaseOf(strip()), "he is in a car").toBe(false);
  });

  // mutation: in src/game/ai/openworld-crime/crime-scene.ts step(), delete the line `if (!authority) this.law.player.body.present = false;`
  it("a client judges nobody's walker: only the host and the solo player do", () => {
    const run = onCrossing({ authority: false });
    runFor(run, 3);
    expect(run.scene.footChaseOf(strip()), "no chase on a client").toBe(false);
  });

  // mutation: in src/game/ai/openworld-crime/player-law.ts step(), change `nearest <= FOOT_HOLD_REACH && body.speed < FOOT_HOLD_SPEED ? this.heldFor + CRIME_STEP_SECONDS : 0` to `this.heldFor + CRIME_STEP_SECONDS`
  it("a cop beside him while he stands fills the bust hold as a car's, and it empties the moment he moves off", () => {
    const run = onCrossing();
    runFor(run, 8);
    const out = strip();
    expect(run.scene.footChaseOf(out), "still chased").toBe(true);
    expect(out.hold, "a hold has run").toBeGreaterThan(0);
    expect(out.hold * BUST_SECONDS + out.left, "the meter and the countdown are one hold").toBeCloseTo(BUST_SECONDS, 6);
    run.scene.setFoot(true, PLAYER_X, 0, 1, 0, FOOT_HOLD_SPEED + 1);
    runFor(run, 0.5);
    expect(run.scene.footChaseOf(out), "chased still").toBe(true);
    expect(out.hold, "the hold is over with his pace").toBe(0);
    expect(out.left, "and starts again from all of it").toBe(BUST_SECONDS);
  });

  // mutation: in src/game/ai/openworld-crime/player-law.ts step(), change `if (this.heldFor < this.bustSeconds) return;` to `return;`
  it("held the whole hold, he is busted once: the engine is told, and the chase is over", () => {
    const run = onCrossing();
    runFor(run, 30);
    expect(run.footBusts, "the arrest of the walker").toHaveLength(1);
    expect(run.footBusts[0]!, "after the cops came and held him").toBeGreaterThan(BUST_SECONDS);
    expect(run.scene.footChaseOf(strip()), "the chase is over").toBe(false);
  });

  // mutation: in src/game/ai/openworld-crime/player-law.ts step(), change `seconds - this.since > PLAYER_CHASE_GIVE_UP_SECONDS` to `false`
  it("keeps moving, he is never held and the cops give him up", () => {
    const run = onCrossing({ speed: 3 });
    runFor(run, PLAYER_CHASE_GIVE_UP_SECONDS + 5);
    expect(run.footBusts, "never busted").toHaveLength(0);
    expect(run.scene.footChaseOf(strip()), "the chase is given up").toBe(false);
  });

  // mutation: in src/game/ai/openworld-crime/player-law.ts step(), change `if (!body.present || seconds - this.since > PLAYER_CHASE_GIVE_UP_SECONDS) {` to `if (seconds - this.since > PLAYER_CHASE_GIVE_UP_SECONDS) {`
  it("getting into a car ends the chase of him on foot", () => {
    const run = onCrossing();
    runFor(run, 2);
    expect(run.scene.footChaseOf(strip())).toBe(true);
    run.scene.setFoot(false, PLAYER_X, 0, 1, 0, 0);
    runFor(run, 0.5);
    expect(run.scene.footChaseOf(strip())).toBe(false);
  });

  // mutation: in src/game/ai/openworld-crime/player-law.ts shoved(), delete `|| !this.law.copSeesSpot(body.x, body.z)`
  it("shoving someone a cop sees brings the cops; a shove no cop sees brings none", () => {
    const seen = harness([40, 0, 0]);
    seen.scene.setFoot(true, 50, 0, 1, 0, 0);
    seen.scene.playerShoved(0);
    expect(seen.scene.footChaseOf(strip()), "a cop saw the shove").toBe(true);
    const unseen = harness([0, 0, 0]);
    unseen.scene.setFoot(true, 100, 0, 1, 0, 0);
    unseen.scene.playerShoved(0);
    expect(unseen.scene.footChaseOf(strip()), "no cop was near").toBe(false);
  });

  // mutation: in src/game/ai/openworld-crime/foot-law.ts openCrime(), delete the line `if (this.source.fightPartner(resident) === FIGHT_PLAYER) this.player.fightKnown(this.seconds);`
  it("a fight he started, once the police are told of it, is a chase of him as of the civilian who turned on him", () => {
    const run = harness([0, 0, 0]);
    run.offences.x[RESIDENT] = 60;
    run.offences.startFight(RESIDENT, FIGHT_PLAYER);
    run.scene.setFoot(true, 58, 0, 1, 0, 0);
    runFor(run, 1);
    expect(run.scene.stats.cases, "the police were told").toBeGreaterThanOrEqual(1);
    expect(run.scene.footChaseOf(strip()), "and come for the player too").toBe(true);
  });

  // mutation: sed -i 's/^export const COP_KO_BLOWS = 3;/export const COP_KO_BLOWS = 99;/' src/game/ai/civilians/civilian-constants.ts
  it("when the player punches a foot cop, then the chase opens at once, and the third punch puts the cop down", () => {
    const run = harness([59]);
    run.scene.setFoot(true, 58, 0, 1, 0, 0);
    runFor(run, 1);
    expect(run.scene.punchCop(58, 0, 1, 0, run.now), "the first punch lands on the cop").toBe(true);
    expect(run.scene.footChaseOf(strip()), "the chase is open").toBe(true);
    for (let blow = 1; blow < 3; blow++) {
      runFor(run, 0.2);
      run.scene.punchCop(58, 0, 1, 0, run.now);
    }
    expect(run.copDowns, "cops down").toHaveLength(1);
    expect(run.scene.takeCopStrikes(), "his throw").toHaveLength(1);
  });
});
