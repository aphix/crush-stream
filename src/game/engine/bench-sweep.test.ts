import { afterEach, describe, expect, it } from "vitest";
import { BENCH, QUICK, type BenchParts } from "./bench-measure.ts";
import { display, restoreFrame, rig, STEADY_MS } from "./bench-frame.test-util.ts";
import { CAUSE_NAMES } from "./bench-hitch.ts";
import { sweep, type SweepEngine } from "./bench-sweep.ts";
import type { BenchPlan } from "./engine-bench-plan.ts";
import type { FxTier } from "../present/engine-post.ts";
import type { QualityPicks } from "../present/player-quality.ts";
import { firstMismatch } from "../kernel/compare-arrays.test-util.ts";

afterEach(restoreFrame);

const TIERS: readonly FxTier[] = ["minimal", "low", "high", "ultra"];
const ui = { set() {} };

/** A sweep's engine that logs each setting put in force with the frame count it came at. */
function sweepRig(): { engine: SweepEngine; parts: BenchParts; beat: ReturnType<typeof rig>["beat"]; t: ReturnType<typeof rig>["t"]; log: { what: string; frame: number }[]; restores: string[]; frames: () => number } {
  const base = rig();
  const log: { what: string; frame: number }[] = [];
  /** The Sky setting and cover in force: the stand-in dome draws them (0 off, 3 the strip, 5 procedural) as soon as they are asked. */
  let skyMode = "auto";
  let cover: number | null = null;
  const pace = { steps: 1, set pin(value: boolean | null) { log.push({ what: `pace ${value}`, frame: display.shown }); }, get pin(): boolean | null { return null; } };
  const engine: SweepEngine = {
    ...base.engine,
    resetAdaptiveQuality() {},
    pace,
    setFxTier: (tier) => void log.push({ what: `fx ${tier}`, frame: display.shown }),
    setSky: (mode) => {
      skyMode = mode;
      log.push({ what: `sky ${mode !== "off" && cover !== null ? "procedural" : mode}`, frame: display.shown });
    },
    setProceduralSky: (value) => void (cover = value),
    setKnob: (id, value) => void log.push({ what: `${id} ${value}`, frame: display.shown }),
  };
  /** Each `restore` call's knobs as `draw scale shadow`; a knob put at a non-Auto value also logs as the stop that does it. */
  const restores: string[] = [];
  const quality = {
    picks: (): QualityPicks => ({ draw: "auto", scale: "auto", shadow: "auto" }),
    restore(picks: QualityPicks): void {
      restores.push(`${picks.draw} ${picks.scale} ${picks.shadow}`);
      if (picks.draw !== "auto") log.push({ what: `draw ${picks.draw}`, frame: display.shown });
      if (picks.scale !== "auto") log.push({ what: `scale ${picks.scale}`, frame: display.shown });
      if (picks.shadow !== "auto") log.push({ what: `shadows ${picks.shadow}`, frame: display.shown });
    },
  };
  const parts = {
    ...base.parts,
    detail: { setLevel: (level: number) => void log.push({ what: `rung ${level}`, frame: display.shown }), setDistances: () => void log.push({ what: "rung off", frame: display.shown }) },
    sky: { textureBytes: 1, get drawn() { return skyMode === "off" ? 0 : cover === null ? 3 : 5; } },
    quality,
  } as unknown as BenchParts;
  return { engine, parts, beat: base.beat, t: base.t, log, restores, frames: () => display.shown };
}

const RACE = { lab: null, race: {} } as unknown as BenchPlan;
const RACE_EPI = { lab: null, race: {}, epicenter: true } as unknown as BenchPlan;
const LAB = { lab: {}, race: null } as unknown as BenchPlan;

describe("given a sweep over every setting at a page's first step, on a race", () => {
  it("when it runs, then each FX tier, both pacer pins, every detail rung, the sky off, the strip, then the procedural sky, the epicenter on and off, and last each quality knob at its top value are put in force once, in that order", async () => {
    const { engine, parts, beat, t, log } = sweepRig();
    await sweep(engine, parts, RACE, TIERS, "full", t, beat, ui);
    expect(firstMismatch(log.map((l) => l.what), ["fx minimal", "fx low", "fx high", "fx ultra", "pace true", "pace false", "rung off", "rung 2", "rung 4", "sky off", "sky full", "sky procedural", "epi.on 1", "epi.on 0", "draw max", "scale 2", "shadows max"])).toBeUndefined();
  });

  it("when each setting is put in force, then it runs at least the sweep's seconds and the sweep's minimum frames, and the frames are the hitch log's setting switches", async () => {
    const { engine, parts, beat, t, log, frames } = sweepRig();
    await sweep(engine, parts, RACE, TIERS, "full", t, beat, ui);
    for (let i = 1; i < log.length; i++) {
      const ran = log[i]!.frame - log[i - 1]!.frame;
      expect(ran, `${log[i - 1]!.what} ran ${ran} frames`).toBeGreaterThanOrEqual(BENCH.sweepS / (STEADY_MS / 1000) - 1);
    }
    expect(frames(), "frames ran").toBeGreaterThan(0);
    expect(beat.switching, "the sweep leaves no switch open").toBe(false);
  });

  it("when a frame hangs inside the sweep, then the hitch log holds it, with the setting-switch cause", async () => {
    const { engine, parts, beat, t } = sweepRig();
    display.use((since) => (since === 700 ? 400 : STEADY_MS));
    await sweep(engine, parts, RACE, TIERS, "full", t, beat, ui);
    const table = beat.hitches.table();
    expect(table.count, "the one hang in the sweep").toBe(1);
    expect(table.rows[0]!.causes.includes(CAUSE_NAMES[0]), "it is a setting switch").toBeTruthy();
  });
});

describe("given the same sweep on a slow display and at a page's later step", () => {
  it("when frames take 100 ms, then each setting runs the minimum frames rather than the seconds", async () => {
    const { engine, parts, beat, t, log } = sweepRig();
    display.use(() => 100);
    await sweep(engine, parts, RACE, TIERS, "full", t, beat, ui);
    const ran = log[1]!.frame - log[0]!.frame;
    expect(ran >= BENCH.sweepMinFrames && ran <= BENCH.sweepMinFrames + 1, `${ran} frames at 100 ms`).toBeTruthy();
  });

  it("when frames take 600 ms, then a setting runs the cap's seconds, not the minimum frames", async () => {
    const { engine, parts, beat, t, log } = sweepRig();
    display.use(() => 600);
    await sweep(engine, parts, RACE, TIERS, "full", t, beat, ui);
    const ran = log[1]!.frame - log[0]!.frame;
    expect(Math.abs(ran - Math.ceil(BENCH.sweepCapS / 0.6)), `${ran} frames at 600 ms`).toBeLessThanOrEqual(1);
  });

  it("when it is a page's later step, then only the FX tiers and the epicenter are visited, for the short seconds", async () => {
    const { engine, parts, beat, t, log } = sweepRig();
    await sweep(engine, parts, RACE, TIERS, "short", t, beat, ui);
    expect(firstMismatch(log.map((l) => l.what), ["fx minimal", "fx low", "fx high", "fx ultra", "epi.on 1", "epi.on 0"])).toBeUndefined();
    const ran = log[1]!.frame - log[0]!.frame;
    expect(ran >= BENCH.sweepMinFrames && ran < BENCH.sweepS / (STEADY_MS / 1000), `${ran} frames: the minimum, not the full sweep's seconds`).toBeTruthy();
  });

  it("when the bench is the lab, then there is no sky and no epicenter stop", async () => {
    const { engine, parts, beat, t, log } = sweepRig();
    await sweep(engine, parts, LAB, TIERS.slice(0, 3), "full", t, beat, ui);
    expect(firstMismatch(log.map((l) => l.what), ["fx minimal", "fx low", "fx high", "pace true", "pace false", "rung off", "rung 2", "rung 4", "draw max", "scale 2", "shadows max"])).toBeUndefined();
  });
});

describe("given the quick bench's one sweep, on the epicenter arm's page and on the other arm's", () => {
  it("when the epicenter page is swept, then the activation is turned off, then on, and the sweep ends with it on: the state the window runs in", async () => {
    const { engine, parts, beat, t, log } = sweepRig();
    await sweep(engine, parts, RACE_EPI, TIERS, "quick", t, beat, ui);
    expect(firstMismatch(log.map((l) => l.what).slice(-2), ["epi.on 0", "epi.on 1"])).toBeUndefined();
  });

  it("when the other arm's page is swept, then the activation is turned on, then off, and the sweep ends with it off", async () => {
    const { engine, parts, beat, t, log } = sweepRig();
    await sweep(engine, parts, RACE, TIERS, "quick", t, beat, ui);
    expect(firstMismatch(log.map((l) => l.what).slice(-2), ["epi.on 1", "epi.on 0"])).toBeUndefined();
  });

  it("when the quick sweep runs, then it visits the FX tiers and the epicenter only, each held the quick seconds and at least the quick frames", async () => {
    const { engine, parts, beat, t, log } = sweepRig();
    await sweep(engine, parts, RACE_EPI, TIERS.slice(0, 3), "quick", t, beat, ui);
    expect(firstMismatch(log.map((l) => l.what), ["fx minimal", "fx low", "fx high", "epi.on 0", "epi.on 1"])).toBeUndefined();
    const ran = log[1]!.frame - log[0]!.frame;
    expect(ran >= QUICK.sweepStopS / (STEADY_MS / 1000) - 1 && ran <= QUICK.sweepStopS / (STEADY_MS / 1000) + 2, `${ran} frames at 6 ms`).toBeTruthy();
  });
});

describe("given the run's own quality knobs at Auto and a sweep of each kind", () => {
  // The short and quick rows are the full row's controls: only the full sweep warms the knobs at their top values.
  const testCases = [
    { it: "when the full sweep ends, then each knob went to its top value, one at a time, and the run's own came back last", how: "full", expected: "max auto auto,auto 2 auto,auto auto max,auto auto auto" },
    { it: "when the short sweep ends, then it only put the run's own back", how: "short", expected: "auto auto auto" },
    { it: "when the quick sweep ends, then it only put the run's own back", how: "quick", expected: "auto auto auto" },
  ] as const;
  for (const testCase of testCases) {
    it(testCase.it, async () => {
      const { engine, parts, beat, t, restores } = sweepRig();
      await sweep(engine, parts, RACE, TIERS, testCase.how, t, beat, ui);
      expect(restores.join(",")).toBe(testCase.expected);
    });
  }
});
