import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { chase, type CopTamper } from "./survival-players.test-util.ts";
import { ARENA } from "./survival-arena.test-util.ts";
import { miss, release } from "./survival-pack.test-util.ts";

/**
 * The bust under the real rule (under 20 km/h within 20 m of a chasing cop for `SURVIVAL.bustTime`): the `corner` player runs for the
 * far corner of the closed arena and creeps there at 3 m/s, boxed in with nowhere left to run, and the released pack has to close, hold it
 * and bust it. Control: cops that never move bust nobody (they never come within 20 m).
 */
/** The staged run: its pack, released at 9.7 s, busts the creeping player at race second 28.7. */
const SEED = 10;
/** Twice the staged bust's 19 s from the release, plus the grid and countdown: the window the frozen cops are watched for. */
const BUST_T = 45;
const FROZEN: CopTamper = (input) => Object.assign(input, { throttle: 0, steer: 0, brake: 1, ebrake: false, boost: false });

describe("given the closed arena with a player that runs for the far corner and creeps there at 3 m/s", () => {
  it(`when the pack is released at ${release(SEED).toFixed(1)} s, then it busts the player`, (t) => {
    const c = chase("corner", SEED, release(SEED) + BUST_T, ARENA, { release: release(SEED) });
    t.annotate(`ended ${c.cause} at ${c.time.toFixed(1)} s, ${c.touches} cop contacts`);
    assert.equal(miss(c, false, BUST_T, "busted"), null);
  });
  it("when the cops never move, then they never bust it", (t) => {
    const c = chase("corner", SEED, release(SEED) + BUST_T, ARENA, { release: release(SEED), tamper: FROZEN });
    const why = miss(c, false, BUST_T, "busted");
    t.annotate(`not busted: ${why}`);
    assert.notEqual(why, null, `cops that never move busted the player at ${c.time.toFixed(1)} s`);
  });
});
