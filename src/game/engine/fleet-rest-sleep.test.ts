import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { setGround } from "../world/ground.ts";
import type { CrashEngine } from "./engine.ts";
import { makeEngine, replay } from "./fleet-rest.test-util.ts";

/**
 * The owner's fleet capture replayed on a fresh engine (`fleet-rest.test-util.ts`) over eight jitter seeds in turn: the hatchback, risen out of the road, sleeps.
 * One seed's sleep is a race with a neighbour's last rock: a stir that lands after the hatchback's rest is done restarts its whole second of rest.
 */
/** Jitter seeds, in turn on one fresh engine. */
const SEEDS = [1, 2, 3, 4, 5, 6, 7, 8];
/** The hatchback sleeps by this sim second at the median seed (the hop kept it awake past 2.9 s). */
const SLEEPS_BY = 2.7;
/** Seeds that sleep after this sim second or never are late: one rest restarted by a stir, or a sleeper held on two contacts to the end. */
const LATE_BY = 3.0;
/** At most this many of the eight seeds are late: before the skin read a kept dent once, the sill rule's tree had two (seed 6 at 3.31 s, seed 7 never), main before it one (seed 2 never). */
const LATE_SEEDS = 2;

/** Seeds on which the hatchback sleeps at 2.3-2.6 s and the pickup beside it, still tipping at about rest speed, wakes it by `stirNear` 0.1-0.3 s later: its rest began again, and it was still awake at 3.5 s. */
const STIRRED_SEEDS = [6, 7];
/** A stir that leaves the wreck at rest costs it none of its rest: it sleeps again as soon as the neighbour is under rest speed (the pickup's tip ends at about 2.9 s). */
const SLEEPS_AGAIN_BY = 3.2;

let engine: CrashEngine | undefined;

describe("given the owner's fleet capture replayed on a fresh engine over jitter seeds 1 to 8 in turn", () => {
  after(() => {
    setGround(null);
    engine?.dispose();
  });
  it(`when the hatchback's sleep is read on each, then it sleeps by ${SLEEPS_BY} s at the median seed and no more than ${LATE_SEEDS} seeds sleep after ${LATE_BY} s or never`, async () => {
    const fresh = (engine = await makeEngine());
    const sleeps: number[] = [];
    for (const seed of SEEDS) {
      const { asleepAt } = await replay(fresh, seed);
      sleeps.push(asleepAt < 0 ? Infinity : asleepAt);
    }
    const read = sleeps.map((s, k) => `${SEEDS[k]}: ${s.toFixed(2)}`).join(", ");
    const late = sleeps.filter((s) => s > LATE_BY).length;
    sleeps.sort((a, b) => a - b);
    const half = sleeps.length / 2;
    const median = (sleeps[half - 1]! + sleeps[half]!) / 2;
    assert.ok(median <= SLEEPS_BY, `the median seed slept at ${median.toFixed(2)} s (${read})`);
    assert.ok(late <= LATE_SEEDS, `${late} seeds slept after ${LATE_BY} s or never (${read})`);
  });

  it(`when the pickup beside it tips slowly across rest speed after the hatchback has slept (seeds ${STIRRED_SEEDS.join(" and ")}), then the hatchback sleeps again by ${SLEEPS_AGAIN_BY} s`, async () => {
    const fresh = (engine ??= await makeEngine());
    const late: string[] = [];
    for (const seed of STIRRED_SEEDS) {
      const { asleepAt } = await replay(fresh, seed);
      if (asleepAt < 0 || asleepAt > SLEEPS_AGAIN_BY) late.push(`${seed}: ${asleepAt < 0 ? "never" : asleepAt.toFixed(2)}`);
    }
    assert.equal(late.length, 0, `slept late or never (${late.join(", ")})`);
  });
});
