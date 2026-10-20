import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { setGround } from "../world/ground.ts";
import { CAGE_STEP } from "../vehicle/car-cage.ts";
import type { CrashEngine } from "./engine.ts";
import { FROM, makeEngine, replay, SETTLED, TO } from "./fleet-rest.test-util.ts";

/**
 * The owner's fleet capture replayed on the real engine (`fleet-rest.test-util.ts`): the hatchback must rise out of the road without the 21 Hz hop, and no two
 * cars may rest inside each other. Its sleep is read over eight seeds (`fleet-rest-sleep.test.ts`).
 */
/** Jitter seeds, in turn on one engine: the crash after the first contact depends on the frame schedule. */
const SEEDS = [1, 3];
/** The rise out of the road is monotone: at most this many turns of its height. */
const MAX_TURNS = 2;
/** The most (m) two settled cars overlap: the resolution of the cage outlines. */
const MAX_OVERLAP = CAGE_STEP;

let shared: CrashEngine | undefined;

describe("given the owner's fleet capture replayed on the engine", () => {
  after(() => {
    setGround(null);
    shared?.dispose();
  });
  for (const seed of SEEDS) {
    it(`when the frames' jitter is seed ${seed}, then the hatchback rises out of the road without a hop, and no two cars rest more than ${MAX_OVERLAP * 100} cm into each other`, async () => {
      shared ??= await makeEngine();
      const { turns, overlap } = await replay(shared, seed);
      assert.ok(turns <= MAX_TURNS, `the hatchback's height turned ${turns} times in ${FROM}-${TO} s`);
      assert.ok(overlap <= MAX_OVERLAP, `two cars stood ${(overlap * 100).toFixed(1)} cm into each other after ${SETTLED} s`);
    });
  }
});
