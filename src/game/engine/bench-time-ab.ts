import { TIME_OF_DAY, type TimeOfDay } from "../match/types.ts";
import { alternate, enterPhase, type Beat, type FrameEngine } from "./bench-frame.ts";
import { BENCH, type BenchParts, type Tap } from "./bench-measure.ts";
import type { PageWatch } from "./engine-bench-page.ts";
import type { BenchPlan } from "./engine-bench-plan.ts";
import { PHASE_AB_TIME } from "./engine-bench-report.ts";

/** What the time-of-day A/B drives on the engine: the frame loop and the race's light (`null`: the race's own). */
export interface TimeEngine extends FrameEngine {
  setBenchTime(time: TimeOfDay | null): void;
}

/**
 * The time-of-day A/B: the race's light pinned day, sunset, night in turn at the window's tier and sky pin, then the race's own back. It runs last of the A/Bs: the first sunset and night build their lighting (environment, lamp pools), so that hitch lands in no other block.
 * The Lab has no race and no time of day (null): its stage keeps its own Night setting, so nothing is set or put back there.
 */
export async function timeAb(engine: TimeEngine, parts: BenchParts, plan: BenchPlan, t: Tap, beat: Beat, page: PageWatch, ui: { set(text: string): void }) {
  enterPhase(beat, page, PHASE_AB_TIME);
  if (plan.lab) return null;
  const run = await alternate(engine, parts, t, beat, ui, "time", Object.entries(TIME_OF_DAY).map(([key, light]) => ({ key, set: () => engine.setBenchTime(light) })), BENCH.timeCycles);
  engine.setBenchTime(null);
  return run;
}
