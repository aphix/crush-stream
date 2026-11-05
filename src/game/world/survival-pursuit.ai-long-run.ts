import { describe, expect, it, type TestContext } from "vitest";
import { RAMP } from "../ai/hunter.ts";
import { fullAggression } from "../ai/ramp.test-util.ts";
import { chase, ORBIT_SPEED } from "./survival-players.test-util.ts";
import { ARENA } from "./survival-arena.test-util.ts";
import { miss, release } from "./survival-pack.test-util.ts";

/**
 * Survival's promise (docs/SURVIVAL.md): a player who keeps running is caught; a real player rarely lasts 2 minutes on Havana. In the
 * closed arena the `evade` player runs from the nearest cop, bends round solids and cops and never stops; the run counts when it ends
 * wrecked within the window with a powered cop touching in the last 2 s (a wall the player hit itself does not count), or busted by the bust's own hold.
 *
 * Re-staged onto the aggression ramp (`RAMP`): the claim was today's pack, at full aggression from the release, ending the run within 30 s of it. That claim stands as
 * the second row, with a window of its own in the staged scene below; the pack now reaches full aggression `RAMP.hold + RAMP.full` s after its release, so the row on the ramp has
 * that long plus the 30 s, and a catch earlier on the ramp counts. The ramp's runs outlast the old ones, and two of the five end in a bust, which a ring of cops
 * holds without touching: the touch is asked of a wreck only, in the controls too.
 */
const ARENA_GAP = 100;
/** The staged chases: seed 13 (released at 10.2 s) and four more across the release spread (5, 20, 9, 17), chosen before they were run. */
const SEEDS = [13, 5, 20, 9, 17] as const;
/** Seconds after full aggression the pack is given to end a run, and the window from the release on the ramp: the pack ends a run within it, hunters with no aim do not. */
const CATCH_T = 30;
const WINDOW = RAMP.hold + RAMP.full + CATCH_T;
/**
 * The full-aggression claim (a full pack can finish a runner) is staged as one deterministic scene, not five evading seeds: the `orbit` runner laps a square of the arena at `ORBIT_SPEED` m/s, a moving target (over the 6 m/s the
 * pack's settle ring and bust rules start at), on the fixed release of `SCENE_SEED`. The pack wrecks it 8.9 s after the release (main's pack, which reads a knocked-out mate as pulling out: 10.4 s, so the scene does not separate the two; the unit row pins that
 * fix); a margin of 11 s to the window. With the lethal choices off (`LETHAL_FROM` above 1) it is not wrecked within 20 s (32.4 s), so the row is red. Hunters with no aim never touch it. One run of the evader is chaotic (one contact between two cops sends the whole run
 * elsewhere), and "all five seeds within 40 s" was false for the shipped pack on 3 of 24 seeds (it ended 21 of arena seeds 1-24 within 40 s, 4 of the old five; 22 of 24 with a knocked-out mate read as stopped: mean 19.2 s
 * against 22.6 s, 236 cops wrecked against 269, 79 of them by another cop against 98).
 */
const SCENE_SEED = 3;
const SCENE_T = 20;

/** The staged chases, each watched for `window` s after its release (hunters with no aim when `aimless`): why each is not a run the pack ended (null: it is). */
function staged(t: TestContext, window: number, aimless: boolean): (string | null)[] {
  return SEEDS.map((seed) => {
    const rel = release(seed);
    const c = chase("evade", seed, rel + window, ARENA, aimless ? { release: rel, aimless: true, tamper: (input) => void (input.steer = 0) } : { release: rel });
    const why = miss(c, true, window, null, true);
    t.annotate(`seed ${seed}${aimless ? " (no aim)" : ""}: ended ${c.cause} ${(c.time - rel).toFixed(1)} s after the release, ${c.touches} cop contacts, the last ${(c.lastTouch - rel).toFixed(1)} s after it${why === null ? "" : `: ${why}`}`);
    return why;
  });
}

/** Why the pack did not wreck the orbiting runner in `SCENE_T` s from the release of `SCENE_SEED` (null: it did), hunters with no aim when `aimless`. */
function orbitMiss(t: TestContext, aimless: boolean): string | null {
  const rel = release(SCENE_SEED);
  const c = chase("orbit", SCENE_SEED, rel + SCENE_T, ARENA, aimless ? { release: rel, aimless: true, tamper: (input) => void (input.steer = 0) } : { release: rel });
  const why = miss(c, true, SCENE_T, "wrecked");
  t.annotate(`orbit seed ${SCENE_SEED}${aimless ? " (no aim)" : ""}: ended ${c.cause} ${(c.time - rel).toFixed(1)} s after the release, ${c.touches} cop contacts, the last ${(c.lastTouch - rel).toFixed(1)} s after it${why === null ? "" : `: ${why}`}`);
  return why;
}

/** Why the pack did not end the run of each seed it missed, one string. */
function missed(why: readonly (string | null)[]): string[] {
  return SEEDS.map((seed, k) => (why[k] === null ? "" : `seed ${seed}: ${why[k]}`)).filter(Boolean);
}

/** The seeds whose run the pack did end. */
function endedSeeds(why: readonly (string | null)[]): number[] {
  return SEEDS.filter((_, k) => why[k] === null);
}

describe(`given the closed arena (Havana's plaza inside a square of its own stucco, 160 m across) with the formation held until a release second`, () => {
  it(`when the chase starts at the earliest release, then the nearest cop is ${ARENA_GAP} m or more off, whereas with no hold the formation is on the player's tail`, (t) => {
    const held = chase("evade", 1, release(1) + 5, ARENA, { release: release(1) });
    const open = chase("evade", 1, 5, ARENA);
    t.annotate(`nearest cop at the release: ${held.gap.toFixed(0)} m held to ${release(1).toFixed(1)} s, ${open.gap.toFixed(0)} m held only to the green`);
    expect(held.gap, `the nearest cop is ${held.gap.toFixed(0)} m off at the release`).toBeGreaterThanOrEqual(ARENA_GAP);
    expect(open.gap > 0 && open.gap < ARENA_GAP / 2, `held only to the green the nearest cop is ${open.gap.toFixed(1)} m off (−1: no cop up by 5 s): the control cannot tell a hold from none`).toBeTruthy();
  });
  it(`when an evading player flees from the pack released at seeds ${SEEDS.join(", ")}'s seconds, then the pack ends each run within ${WINDOW} s of its release, wrecked with a cop in contact or busted by its hold`, (t) => {
    const lost = missed(staged(t, WINDOW, false));
    expect(lost.length, lost.join("; ")).toBe(0);
  });
  it("when the same chases run with hunters that have no aim (they never steer, and each drop-in faces along its road away from the player), then the pack ends none of them", (t) => {
    const ended = endedSeeds(staged(t, WINDOW, true));
    expect(ended.length, `hunters that never steer ended the runs of seeds ${ended.join(", ")}: the row above is met without steering`).toBe(0);
  });
  it(`when a runner laps the arena on a fixed path at ${ORBIT_SPEED} m/s from the release, then the pack at full aggression wrecks it within ${SCENE_T} s of the release, with a cop in contact`, (t) => {
    fullAggression(t);
    const why = orbitMiss(t, false);
    expect(why, `the pack did not wreck the run: ${why}`).toBeNull();
  });
  it("when the same runner is chased at full aggression by hunters that have no aim, then the pack does not end the run", (t) => {
    fullAggression(t);
    const why = orbitMiss(t, true);
    expect(why === null, `hunters that never steer ended the run: the row above is met without steering`).toBe(false);
  });
});
