import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { chase } from "./survival-players.test-util.ts";
import { ARENA } from "./survival-arena.test-util.ts";
import { miss, release } from "./survival-pack.test-util.ts";

/**
 * Survival's promise (docs/SURVIVAL.md): a player who keeps running is caught; a real player rarely lasts 2 minutes on Havana. In the
 * closed arena the `evade` player runs from the nearest cop, bends round solids and cops and never stops; the run counts when it ends
 * busted or wrecked within `CATCH_T` s of the release with a powered cop touching in the last 2 s (a wall the player hit itself does not count).
 */
const ARENA_GAP = 100;
/** The staged chase: its pack, released at 10.2 s, wrecks the evader 5.9 s later with a cop in contact. */
const SEED = 13;
/** Five times the staged catch: the window the hunters that never steer are watched for. */
const CATCH_T = 30;

describe(`given the closed arena (Havana's plaza inside a square of its own stucco, 160 m across) with the formation held until a release second`, () => {
  it(`when the chase starts at the earliest release, then the nearest cop is ${ARENA_GAP} m or more off, whereas with no hold the formation is on the player's tail`, (t) => {
    const held = chase("evade", 1, release(1) + 5, ARENA, { release: release(1) });
    const open = chase("evade", 1, 5, ARENA);
    t.annotate(`nearest cop at the release: ${held.gap.toFixed(0)} m held to ${release(1).toFixed(1)} s, ${open.gap.toFixed(0)} m held only to the green`);
    assert.ok(held.gap >= ARENA_GAP, `the nearest cop is ${held.gap.toFixed(0)} m off at the release`);
    assert.ok(open.gap > 0 && open.gap < ARENA_GAP / 2, `held only to the green the nearest cop is ${open.gap.toFixed(1)} m off (−1: no cop up by 5 s): the control cannot tell a hold from none`);
  });
  it(`when an evading player flees from the pack released at ${release(SEED).toFixed(1)} s, then the pack ends the run within ${CATCH_T} s, busted or wrecked, with a cop in contact`, (t) => {
    const c = chase("evade", SEED, release(SEED) + CATCH_T, ARENA, { release: release(SEED) });
    t.annotate(`ended ${c.cause} at ${c.time.toFixed(1)} s, ${c.touches} cop contacts, the last at ${c.lastTouch.toFixed(1)} s`);
    assert.equal(miss(c, true, CATCH_T), null);
  });
  it("when the same chase runs with hunters that never steer, then the pack does not end it", (t) => {
    const c = chase("evade", SEED, release(SEED) + CATCH_T, ARENA, { release: release(SEED), tamper: (input) => void (input.steer = 0) });
    const why = miss(c, true, CATCH_T);
    t.annotate(`not ended by the pack: ${why}`);
    assert.notEqual(why, null, `hunters that never steer ended the run (${c.cause} at ${c.time.toFixed(1)} s): the row above is met without steering`);
  });
});