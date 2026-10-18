import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { BETWEEN_STEPS_S, extendedPlanS, planText, quickPlanS } from "./bench-plan-time.ts";
import { QUICK } from "./bench-measure.ts";
import { ULTRA_AVAILABLE } from "./bench-loop.ts";

/** The bound the owner set for the default bench: a game's built-in benchmark, 2-4 minutes. */
const QUICK_BOUND_S = 240;
/** One extended cycle as the owner's desktop loop took it on 2026-10-18 (build c83d90c9, eight pages, `.bench/durations.mjs`: 2542 s of page time): the extended bench may not be longer. */
const EXTENDED_BEFORE_S = 2542;

describe("given the planned lengths of the benches the start screen shows", () => {
  it("when the quick bench is planned, with or without Ultra, then it is under the 4 minute bound and over 2 minutes of measuring", () => {
    for (const ultra of [false, true]) {
      const planned = quickPlanS(ultra);
      assert.ok(planned < QUICK_BOUND_S, `${planned} s planned (ultra ${ultra})`);
      assert.ok(planned > 4 * QUICK.windowS, `${planned} s is more than its four windows`);
    }
  });

  it("when Ultra is on, then the quick bench's one sweep holds one more setting, and nothing else grows", () => {
    assert.equal(quickPlanS(true) - quickPlanS(false), ULTRA_AVAILABLE ? QUICK.sweepStopS : 0);
  });

  it("when the quick bench has its pauses between pages, then they are the loop's own: three of them for four pages", () => {
    const pages = 4 * (QUICK.loadS + QUICK.countdownS + QUICK.windowS);
    assert.equal(quickPlanS(false) - pages - 5 * QUICK.sweepStopS, 3 * BETWEEN_STEPS_S);
  });

  it("when the extended bench is planned, then a cycle is no longer than the measured one it replaces, and much longer than the quick bench", () => {
    for (const ultra of [false, true]) {
      assert.ok(extendedPlanS(ultra) < EXTENDED_BEFORE_S, `${extendedPlanS(ultra)} s planned against ${EXTENDED_BEFORE_S} s measured (ultra ${ultra})`);
      assert.ok(extendedPlanS(ultra) > 5 * quickPlanS(ultra), "the extended bench is the long one");
    }
  });

  it("when a length is written for the start screen, then it is whole minutes with at least one", () => {
    assert.equal(planText(150), "about 3 min");
    assert.equal(planText(10), "about 1 min");
  });
});
