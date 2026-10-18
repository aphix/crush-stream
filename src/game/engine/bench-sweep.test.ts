import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { BENCH, type BenchParts } from "./bench-measure.ts";
import { display, restoreFrame, rig, STEADY_MS } from "./bench-frame.test-util.ts";
import { CAUSE_NAMES } from "./bench-hitch.ts";
import { sweep, type SweepEngine } from "./bench-sweep.ts";
import type { BenchPlan } from "./engine-bench-plan.ts";
import type { FxTier } from "../present/engine-post.ts";

afterEach(restoreFrame);

const TIERS: readonly FxTier[] = ["minimal", "low", "high", "ultra"];
const ui = { set() {} };

/** A sweep's engine that logs each setting put in force with the frame count it came at. */
function sweepRig(): { engine: SweepEngine; parts: BenchParts; beat: ReturnType<typeof rig>["beat"]; t: ReturnType<typeof rig>["t"]; log: { what: string; frame: number }[]; frames: () => number } {
  const base = rig();
  const log: { what: string; frame: number }[] = [];
  const pace = { steps: 1, set pin(value: boolean | null) { log.push({ what: `pace ${value}`, frame: display.shown }); }, get pin(): boolean | null { return null; } };
  const engine: SweepEngine = {
    ...base.engine,
    resetAdaptiveQuality() {},
    pace,
    setFxTier: (tier) => void log.push({ what: `fx ${tier}`, frame: display.shown }),
    setSky: (mode) => void log.push({ what: `sky ${mode}`, frame: display.shown }),
    setKnob: (id, value) => void log.push({ what: `${id} ${value}`, frame: display.shown }),
  };
  const parts = {
    ...base.parts,
    detail: { setLevel: (level: number) => void log.push({ what: `rung ${level}`, frame: display.shown }), setDistances: () => void log.push({ what: "rung off", frame: display.shown }) },
    sky: { textureBytes: 1 },
  } as unknown as BenchParts;
  return { engine, parts, beat: base.beat, t: base.t, log, frames: () => display.shown };
}

const RACE = { lab: null, race: {} } as unknown as BenchPlan;
const LAB = { lab: {}, race: null } as unknown as BenchPlan;

describe("given a sweep over every setting at a page's first step, on a race", () => {
  it("when it runs, then each FX tier, both pacer pins, every detail rung, the sky full and off and the epicenter on and off are put in force once, in that order", async () => {
    const { engine, parts, beat, t, log } = sweepRig();
    await sweep(engine, parts, RACE, TIERS, true, t, beat, ui);
    assert.deepEqual(
      log.map((l) => l.what),
      ["fx minimal", "fx low", "fx high", "fx ultra", "pace true", "pace false", "rung off", "rung 2", "rung 4", "sky full", "sky off", "epi.on 1", "epi.on 0"],
    );
  });

  it("when each setting is put in force, then it runs at least the sweep's seconds and the sweep's minimum frames, and the frames are the hitch log's setting switches", async () => {
    const { engine, parts, beat, t, log, frames } = sweepRig();
    await sweep(engine, parts, RACE, TIERS, true, t, beat, ui);
    for (let i = 1; i < log.length; i++) {
      const ran = log[i]!.frame - log[i - 1]!.frame;
      assert.ok(ran >= BENCH.sweepS / (STEADY_MS / 1000) - 1, `${log[i - 1]!.what} ran ${ran} frames`);
    }
    assert.ok(frames() > 0, "frames ran");
    assert.equal(beat.switching, false, "the sweep leaves no switch open");
  });

  it("when a frame hangs inside the sweep, then the hitch log holds it, with the setting-switch cause", async () => {
    const { engine, parts, beat, t } = sweepRig();
    display.use((since) => (since === 700 ? 400 : STEADY_MS));
    await sweep(engine, parts, RACE, TIERS, true, t, beat, ui);
    const table = beat.hitches.table();
    assert.equal(table.count, 1, "the one hang in the sweep");
    assert.ok(table.rows[0]!.causes.includes(CAUSE_NAMES[0]), "it is a setting switch");
  });
});

describe("given the same sweep on a slow display and at a page's later step", () => {
  it("when frames take 100 ms, then each setting runs the minimum frames rather than the seconds", async () => {
    const { engine, parts, beat, t, log } = sweepRig();
    display.use(() => 100);
    await sweep(engine, parts, RACE, TIERS, true, t, beat, ui);
    const ran = log[1]!.frame - log[0]!.frame;
    assert.ok(ran >= BENCH.sweepMinFrames && ran <= BENCH.sweepMinFrames + 1, `${ran} frames at 100 ms`);
  });

  it("when frames take 600 ms, then a setting runs the cap's seconds, not the minimum frames", async () => {
    const { engine, parts, beat, t, log } = sweepRig();
    display.use(() => 600);
    await sweep(engine, parts, RACE, TIERS, true, t, beat, ui);
    const ran = log[1]!.frame - log[0]!.frame;
    assert.ok(Math.abs(ran - Math.ceil(BENCH.sweepCapS / 0.6)) <= 1, `${ran} frames at 600 ms`);
  });

  it("when it is a page's later step, then only the FX tiers and the epicenter are visited, for the short seconds", async () => {
    const { engine, parts, beat, t, log } = sweepRig();
    await sweep(engine, parts, RACE, TIERS, false, t, beat, ui);
    assert.deepEqual(
      log.map((l) => l.what),
      ["fx minimal", "fx low", "fx high", "fx ultra", "epi.on 1", "epi.on 0"],
    );
    const ran = log[1]!.frame - log[0]!.frame;
    assert.ok(ran >= BENCH.sweepMinFrames && ran < BENCH.sweepS / (STEADY_MS / 1000), `${ran} frames: the minimum, not the full sweep's seconds`);
  });

  it("when the bench is the lab, then there is no sky and no epicenter stop", async () => {
    const { engine, parts, beat, t, log } = sweepRig();
    await sweep(engine, parts, LAB, TIERS.slice(0, 3), true, t, beat, ui);
    assert.deepEqual(
      log.map((l) => l.what),
      ["fx minimal", "fx low", "fx high", "pace true", "pace false", "rung off", "rung 2", "rung 4"],
    );
  });
});
