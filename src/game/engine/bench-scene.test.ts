import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { epicenterOn } from "../deform/epicenter.ts";
import { KNOB_DEFAULTS, KNOBS } from "../hud/knobs.ts";
import { FINE_HZ } from "../kernel/constants.ts";
import { enterBenchScene } from "./bench-scene.ts";
import { benchPlan } from "./engine-bench-plan.ts";
import { benchPlanEngine, disposeBenchEngine, FRAME_S, runFrames, simCounters, simDigest } from "./engine-bench-headless.test-util.ts";
import { newBeat } from "./bench-frame.ts";
import { tap, watchWork } from "./bench-measure.ts";
import { PHASE_SWEEP } from "./engine-bench-report.ts";
import { endSweep, sweep } from "./bench-sweep.ts";
import type { CrashEngine } from "./engine.ts";

/** Sim seconds each step of the sequence runs: the grid, the start, the first crash and the pile-up that follows it (a wreck phase of about 260 ms a second at 7-11 s). */
const STEP_S = 14;

describe("given one page that runs the bench's steps in turn, as the loop does (a second CrashEngine never resolves ready, so one engine for the file)", () => {
  let engine: CrashEngine;
  /** The sim digest of each step of the sequence, by step name. */
  const digests: Record<string, string> = {};
  /** One step as `runBench` begins it (its adaptive quality reset, its scene entered), then `STEP_S` sim seconds on the 1/240 s floor; `watched`: with the window's phase clock, counters and per-second series recording (`watchWork`, ticked every frame). */
  const step = (name: string, query: string, watched = false): void => {
    engine.resetAdaptiveQuality();
    const since = simCounters(engine);
    enterBenchScene(engine, engine.benchParts(), benchPlan(query)!);
    engine.pace.pin = false;
    const work = watched ? watchWork(engine.benchParts(), engine.pace) : null;
    for (let i = 1; i <= STEP_S * FINE_HZ; i++) {
      runFrames(engine, 1);
      work?.tick(i * FRAME_S, i * FRAME_S);
    }
    work?.end();
    digests[name] = simDigest(engine, since);
  };

  before(async () => {
    engine = await benchPlanEngine("?bench=city");
    step("city first", "?bench=city");
    step("city with the activation", "?bench=city&epi=1");
    step("strip", "?bench=strip");
    step("city again", "?bench=city", true);
  });
  after(() => disposeBenchEngine(engine));

  it("when the city bench is entered again after the epicenter arm and the strip, this time with the window's recording on (phase clock, counters, per-second series), then its sim is bit for bit the first one's, which ran unrecorded: nothing a step leaves behind reaches the next, and recording changes nothing", () => {
    assert.equal(digests["city again"], digests["city first"]);
  });

  it("when the steps ran, then each is a different sim (the control: the strip's field is not the city's)", () => {
    assert.notEqual(digests["strip"], digests["city first"]);
  });

  it("when the page enters the next step, then every Debug knob is at its default and the epicenter activation is off unless that step asks for it", () => {
    enterBenchScene(engine, engine.benchParts(), benchPlan("?bench=city&epi=1")!);
    assert.equal(epicenterOn(), true, "the control: the activation is on in its own arm");
    enterBenchScene(engine, engine.benchParts(), benchPlan("?bench=city")!);
    assert.equal(epicenterOn(), false, "off in the next step");
    for (const knob of KNOBS) assert.equal(knob.get(), KNOB_DEFAULTS[knob.id], `${knob.id} at its default`);
  });

  it("when a full warm-up sweep (every FX tier, both pacer pins, every detail rung, the sky, the epicenter on and off) runs on the city and the page is reset as a step does, then the city's sim after it is bit for bit the first one's", async () => {
    const parts = engine.benchParts();
    const plan = benchPlan("?bench=city")!;
    enterBenchScene(engine, parts, plan);
    // A display of 1/60 s frames, each a real engine frame through `advance`.
    let clock = 1000;
    Object.assign(globalThis, { requestAnimationFrame: (callback: (stamp: number) => void) => void setImmediate(() => callback((clock += 1000 / 60))) });
    const t = tap(engine.pace, parts);
    const beat = newBeat(parts, clock, null, PHASE_SWEEP);
    await sweep(engine, parts, plan, ["minimal", "low", "high", "ultra"], true, t, beat, { set() {} });
    assert.ok(beat.hitches.frames > 4 * 180, `the sweep ran its frames (${beat.hitches.frames})`);
    endSweep(engine, "auto");
    step("city after the sweep", "?bench=city", true);
    assert.equal(digests["city after the sweep"], digests["city first"]);
  });
});
