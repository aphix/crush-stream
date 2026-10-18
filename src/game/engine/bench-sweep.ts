import type { FxTier } from "../present/engine-post.ts";
import type { SkyMode } from "../present/sky-dome.ts";
import type { KnobId } from "../hud/knobs.ts";
import { BENCH, type BenchParts, type Tap } from "./bench-measure.ts";
import { frame, pinSky, type Beat, type FrameEngine } from "./bench-frame.ts";
import { FRAME } from "./bench-hitch.ts";
import { DETAIL_ARMS } from "./engine-bench-report.ts";
import type { BenchPlan } from "./engine-bench-plan.ts";

/** What the sweep puts in force: every setting the bench's window and A/Bs will later switch. */
export interface SweepEngine extends FrameEngine {
  /** The page's adaptive quality as it booted (a step starts from it). */
  resetAdaptiveQuality(): void;
  readonly pace: { readonly steps: number; pin: boolean | null };
  setFxTier(tier: FxTier): void;
  setSky(mode: SkyMode): void;
  setKnob(id: KnobId, value: number): void;
}

/** One setting the sweep visits: its name for the console and what puts it in force. */
interface SweepStop {
  name: string;
  set(): unknown;
}

/** The distance detail rung of an A/B arm (`DETAIL_ARMS`): no cuts at all (`null`), or the ladder's rung. */
export function setDetailArm(parts: BenchParts, level: number | null): void {
  if (level === null) parts.detail.setDistances(Infinity, Infinity);
  else parts.detail.setLevel(level);
}

/**
 * The settings a page visits before it measures, so the code each of them runs is compiled and optimised, and each one's first draw on this page's scene
 * (its programs linked, its targets allocated) is behind it, when the window and the A/Bs reach them. Every FX tier (Ultra when the page loaded it), then,
 * with `full` (a page's first step: the JIT stays warm across the steps of one page), the pacer's pins, every detail rung, and the Sky setting `off` then `full` (the strip is loaded and stays in, as the bench pins it);
 * on a race, `epi.on` on and off (the freeze and thaw paths run, on both arms' pages alike: neither starts colder). The caller puts the page back as a
 * fresh step (`enterBenchScene`, `resetAdaptiveQuality`) afterwards, so a wreck frozen here is not in the arm it warmed.
 */
function sweepStops(engine: SweepEngine, parts: BenchParts, plan: BenchPlan, tiers: readonly FxTier[], full: boolean, beat: Beat, t: Tap): SweepStop[] {
  const stops: SweepStop[] = tiers.map((tier) => ({ name: `fx ${tier}`, set: () => engine.setFxTier(tier) }));
  if (full) {
    stops.push({ name: "pacer 1/80 s", set: () => void (engine.pace.pin = true) }, { name: "pacer 1/240 s", set: () => void (engine.pace.pin = false) });
    for (const a of DETAIL_ARMS) stops.push({ name: `detail ${a.key}`, set: () => setDetailArm(parts, a.level) });
    if (!plan.lab) stops.push({ name: "sky off", set: () => pinSky(engine, parts, t, beat, "off") }, { name: "sky full", set: () => pinSky(engine, parts, t, beat, "full") });
  }
  if (plan.race) stops.push({ name: "epicenter on", set: () => engine.setKnob("epi.on", 1) }, { name: "epicenter off", set: () => engine.setKnob("epi.on", 0) });
  return stops;
}

/**
 * Visits every stop (`sweepStops`) for `BENCH.sweepS` wall seconds (the frames' real intervals: a hang is the seconds it took, not the engine's capped step) (`sweepShortS` on a page's later steps) and at least `BENCH.sweepMinFrames` frames (a phone at 10 fps
 * needs the frames, not just the seconds), but never past `BENCH.sweepCapS`. Nothing is scored; the frames are the hitch log's `sweep` stretch, every one of them
 * marked a setting switch. The page is left in the last stop's state: the caller resets it.
 */
export async function sweep(engine: SweepEngine, parts: BenchParts, plan: BenchPlan, tiers: readonly FxTier[], full: boolean, t: Tap, beat: Beat, ui: { set(text: string): void }): Promise<void> {
  const seconds = full ? BENCH.sweepS : BENCH.sweepShortS;
  const stops = sweepStops(engine, parts, plan, tiers, full, beat, t);
  beat.switching = true;
  for (const [i, stop] of stops.entries()) {
    ui.set(`CRUSH BENCH: warming up, ${stop.name} (${i + 1} / ${stops.length})`);
    await stop.set();
    t.timing = false;
    let wall = 0;
    for (let frames = 0; wall < BENCH.sweepCapS && (wall < seconds || frames < BENCH.sweepMinFrames); frames++) {
      await frame(engine, parts.renderer, t, beat);
      wall += beat.frame[FRAME.interval]! / 1000;
    }
  }
  beat.switching = false;
}

/** The page after the sweep, as the step starts from it: the pacer unpinned, the bench's Sky pin in force (`skyPinOf`; the player's own setting comes back when the run ends), the adaptive quality as the page booted (the caller then enters the scene afresh). */
export function endSweep(engine: SweepEngine, sky: SkyMode): void {
  engine.pace.pin = null;
  engine.setSky(sky);
  engine.resetAdaptiveQuality();
}
