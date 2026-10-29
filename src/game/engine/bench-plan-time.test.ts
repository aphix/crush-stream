import { describe, expect, it } from "vitest";
import { BETWEEN_STEPS_S, extendedPlanS, planText, quickPlanS } from "./bench-plan-time.ts";
import { QUICK } from "./bench-measure.ts";
import { ULTRA_AVAILABLE } from "./bench-loop.ts";

/** The bound the owner set for the default bench: a game's built-in benchmark, 2-4 minutes. */
const QUICK_BOUND_S = 240;
/** One extended cycle as the owner's desktop loop took it on 2026-10-18 (build c83d90c9, eight pages, `.bench/durations.mjs`: 2542 s of page time, before the quality A/Bs): the extended bench may not be longer, but for what they add. */
const EXTENDED_BEFORE_S = 2542;
/** What the extended bench's three quality A/Bs and their three full-sweep stops add to a cycle, as planned: 8 pages × 3 knobs × 2 arms × 1 round (`BENCH.qualityCycles`) × (5 s block + 3.5 s typical settle) = 408 s, plus 3 stops × 3 s (`BENCH.sweepS`) = 9 s. */
const QUALITY_ABS_S = 417;
const EXTENDED_BOUND_S = EXTENDED_BEFORE_S + QUALITY_ABS_S;

describe("given the planned lengths of the benches the start screen shows", () => {
  it("when the quick bench is planned, with or without Ultra, then it is under the 4 minute bound and over 2 minutes of measuring", () => {
    for (const ultra of [false, true]) {
      const planned = quickPlanS(ultra);
      expect(planned, `${planned} s planned (ultra ${ultra})`).toBeLessThan(QUICK_BOUND_S);
      expect(planned, `${planned} s is more than its four windows`).toBeGreaterThan(4 * QUICK.windowS);
    }
  });

  it("when Ultra is on, then the quick bench's one sweep holds one more setting, and nothing else grows", () => {
    expect(quickPlanS(true) - quickPlanS(false)).toBe(ULTRA_AVAILABLE ? QUICK.sweepStopS : 0);
  });

  it("when the quick bench has its pauses between pages, then they are the loop's own: three of them for four pages", () => {
    const pages = 4 * (QUICK.loadS + QUICK.countdownS + QUICK.windowS);
    expect(quickPlanS(false) - pages - 5 * QUICK.sweepStopS).toBe(3 * BETWEEN_STEPS_S);
  });

  it("when the extended bench is planned, then a cycle is no longer than the measured one it replaces plus its quality A/Bs, and much longer than the quick bench", () => {
    for (const ultra of [false, true]) {
      expect(extendedPlanS(ultra), `${extendedPlanS(ultra)} s planned against ${EXTENDED_BOUND_S} s (${EXTENDED_BEFORE_S} s measured plus the quality A/Bs, ultra ${ultra})`).toBeLessThan(EXTENDED_BOUND_S);
      expect(extendedPlanS(ultra), "the extended bench is the long one").toBeGreaterThan(5 * quickPlanS(ultra));
    }
  });

  it("when a length is written for the start screen, then it is whole minutes with at least one", () => {
    expect(planText(150)).toBe("about 3 min");
    expect(planText(10)).toBe("about 1 min");
  });
});
