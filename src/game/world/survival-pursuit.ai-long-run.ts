import { describe, expect, it } from "vitest";
import { chase } from "./survival-players.test-util.ts";
import { ARENA } from "./survival-arena.test-util.ts";
import { miss, release } from "./survival-pack.test-util.ts";

/**
 * Survival's promise (docs/SURVIVAL.md): a player who keeps running is caught; a real player rarely lasts 2 minutes on Havana. In the
 * closed arena the `evade` player runs from the nearest cop, bends round solids and cops and never stops; the run counts when it ends
 * busted or wrecked within `CATCH_T` s of the release with a powered cop touching in the last 2 s (a wall the player hit itself does not count).
 */
const ARENA_GAP = 100;
/** The staged chases: seed 13 (released at 10.2 s) and four more across the release spread (5, 20, 9, 17), chosen before they were run. */
const SEEDS = [13, 5, 20, 9, 17] as const;
/**
 * Seconds after the release each chase is watched for: the pack ends a run within it, hunters with no aim do not. The pack queues behind an
 * evader over `PIT_MAX` (20 m/s) until it slows, so the catches land 13.2 / 18.6 / 26.8 / 25.9 / 13.7 s after the release (seeds as listed).
 */
const CATCH_T = 30;

describe(`given the closed arena (Havana's plaza inside a square of its own stucco, 160 m across) with the formation held until a release second`, () => {
  it(`when the chase starts at the earliest release, then the nearest cop is ${ARENA_GAP} m or more off, whereas with no hold the formation is on the player's tail`, (t) => {
    const held = chase("evade", 1, release(1) + 5, ARENA, { release: release(1) });
    const open = chase("evade", 1, 5, ARENA);
    t.annotate(`nearest cop at the release: ${held.gap.toFixed(0)} m held to ${release(1).toFixed(1)} s, ${open.gap.toFixed(0)} m held only to the green`);
    expect(held.gap, `the nearest cop is ${held.gap.toFixed(0)} m off at the release`).toBeGreaterThanOrEqual(ARENA_GAP);
    expect(open.gap > 0 && open.gap < ARENA_GAP / 2, `held only to the green the nearest cop is ${open.gap.toFixed(1)} m off (−1: no cop up by 5 s): the control cannot tell a hold from none`).toBeTruthy();
  });
  it(`when an evading player flees from the pack released at seeds ${SEEDS.join(", ")}'s seconds, then the pack ends each run within ${CATCH_T} s, busted or wrecked, with a cop in contact`, (t) => {
    const why = SEEDS.map((seed) => {
      const c = chase("evade", seed, release(seed) + CATCH_T, ARENA, { release: release(seed) });
      t.annotate(`seed ${seed}: ended ${c.cause} at ${c.time.toFixed(1)} s, ${c.touches} cop contacts, the last at ${c.lastTouch.toFixed(1)} s`);
      return miss(c, true, CATCH_T);
    });
    const missed = SEEDS.map((seed, k) => (why[k] === null ? "" : `seed ${seed}: ${why[k]}`)).filter(Boolean);
    expect(missed.length, missed.join("; ")).toBe(0);
  });
  it("when the same chases run with hunters that have no aim (they never steer, and each drop-in faces along its road away from the player), then the pack ends none of them", (t) => {
    for (const seed of SEEDS) {
      const c = chase("evade", seed, release(seed) + CATCH_T, ARENA, { release: release(seed), aimless: true, tamper: (input) => void (input.steer = 0) });
      const why = miss(c, true, CATCH_T);
      t.annotate(`seed ${seed}, not ended by the pack: ${why}`);
      expect(why, `seed ${seed}: hunters that never steer ended the run (${c.cause} at ${c.time.toFixed(1)} s): the row above is met without steering`).not.toBe(null);
    }
  });
});