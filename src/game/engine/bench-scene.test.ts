import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { epicenterOn } from "../deform/epicenter.ts";
import { KNOB_DEFAULTS, KNOBS } from "../hud/knobs.ts";
import { FINE_HZ } from "../kernel/constants.ts";
import { enterBenchScene } from "./bench-scene.ts";
import { benchPlan } from "./engine-bench-plan.ts";
import { CRASH_GAP, CRASH_SPEED } from "./engine-bench-replay.ts";
import { benchPlanEngine, disposeBenchEngine, FRAME_S, runFrames, simCounters, simDigest } from "./engine-bench-headless.test-util.ts";
import { SKY_DRAWN } from "../present/sky-dome.ts";
import { newBeat } from "./bench-frame.ts";
import { ArmBadge } from "./bench-badge.ts";
import { tap, watchWork } from "./bench-measure.ts";
import { PHASE_SWEEP } from "./engine-bench-report.ts";
import { endSweep, sweep } from "./bench-sweep.ts";
import type { CrashEngine } from "./engine.ts";

/** Sim seconds each step of the sequence runs: the grid, the start, the first crash and the pile-up that follows it (a wreck phase of about 260 ms a second at 7-11 s). */
const STEP_S = 14;
/** Sim seconds the staged window is run for in the quick-start rows: the pair meets in the first seconds, so the wrecks and their contacts are in it. */
const QUICK_CHECK_S = 6;

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

  it("when the loop's steps are entered in turn (city, city with the activation, strip, city), then the card's arm label follows the knob each time: off, ON, off, off", () => {
    const element = { textContent: "" as string | null, style: { cssText: "" } };
    const badge = new ArmBadge(element, epicenterOn);
    const labels: (string | null)[] = [];
    for (const query of ["?bench=city", "?bench=city&epi=1", "?bench=strip", "?bench=city"]) {
      enterBenchScene(engine, engine.benchParts(), benchPlan(query)!);
      badge.sync();
      labels.push(element.textContent);
    }
    assert.deepEqual(labels, ["epicenter off", "EPICENTER ON", "epicenter off", "epicenter off"]);
  });

  /** Frames the grid may take to go green on the 1/240 s floor (a 3 s countdown with the course loaded): a guard, not a wait. */
  const GRID_FRAMES = 4000;
  /** The quick bench's start as `runBench` makes it: the scene entered, the grid run to green, the head-on pair staged at the start line, then `seconds` of sim. */
  const quickStart = (query: string, seconds: number): { staged: boolean; digest: string; wrecks: number } => {
    engine.resetAdaptiveQuality();
    enterBenchScene(engine, engine.benchParts(), benchPlan(query)!);
    engine.pace.pin = false;
    const { race } = engine.benchParts();
    for (let guard = 0; race.phase !== "racing" && guard < GRID_FRAMES; guard++) runFrames(engine, 1);
    const since = simCounters(engine);
    const staged = race.crashAtStart(CRASH_GAP, CRASH_SPEED);
    runFrames(engine, seconds * FINE_HZ);
    return { staged, digest: simDigest(engine, since), wrecks: engine.benchParts().live().filter((car) => car.crashed).length };
  };

  it("when the quick bench's start is made twice on the city, then the head-on pair is staged both times and the window that follows is bit for bit the same: the arms of a map do identical work", () => {
    const first = quickStart("?bench=city", QUICK_CHECK_S);
    const second = quickStart("?bench=city", QUICK_CHECK_S);
    assert.equal(first.staged, true, "the pair is staged at green");
    assert.ok(first.wrecks >= 2, `${first.wrecks} wrecks after ${QUICK_CHECK_S} s: the staged pair crashed`);
    assert.equal(second.digest, first.digest);
  });

  it("when the quick bench starts on the strip, then the pair is staged there too", () => {
    assert.equal(quickStart("?bench=strip", 1).staged, true);
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
    // The sky's strip is a picture the page decodes (`loadUprightBitmap`: fetch, then createImageBitmap); node has neither for a relative url, so the row hands it a one-pixel stand-in and the sweep's `sky full` stop is a real load that finishes.
    const real = { fetch: globalThis.fetch, createImageBitmap: (globalThis as { createImageBitmap?: unknown }).createImageBitmap };
    Object.assign(globalThis, {
      fetch: async () => ({ ok: true, status: 200, blob: async () => new Blob([]) }),
      createImageBitmap: async () => ({ width: 1, height: 1, close() {} }),
    });
    try {
      // A page without `ultra=1` (its FX tiers are the three; Ultra's look is fetched by the page before the bench, not by the sweep).
      await sweep(engine, parts, plan, ["minimal", "low", "high"], "full", t, beat, { set() {} });
      assert.equal(parts.sky.drawn, SKY_DRAWN.full, "the sweep ends on the sky the bench pins: the strip drawn");
      assert.ok(parts.sky.textureBytes > 0, "the strip is held");
      assert.ok(beat.hitches.frames > 3 * 180, `the sweep ran its frames (${beat.hitches.frames})`);
      endSweep(engine, "full");
      step("city after the sweep", "?bench=city", true);
      assert.equal(digests["city after the sweep"], digests["city first"]);
      // A load the step began is still in flight (its decode is a promise chain): let it land on the stand-in.
      await new Promise<void>((resolve) => setImmediate(resolve));
    } finally {
      Object.assign(globalThis, real);
      if (real.createImageBitmap === undefined) Reflect.deleteProperty(globalThis, "createImageBitmap");
    }
  });
});
