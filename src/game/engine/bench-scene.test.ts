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
import { skyPinOf, tap, watchWork } from "./bench-measure.ts";
import { PHASE_SWEEP } from "./engine-bench-report.ts";
import { endSweep, sweep } from "./bench-sweep.ts";
import type { CrashEngine } from "./engine.ts";

/** Sim seconds each step runs past the staged head-on: the pair meets in 0.2 s, so the wrecks, their contacts and a thrown driver are in it. */
const CRASH_S = 2;
/** Frames the grid may take to go green on the 1/240 s floor (a 3 s countdown with the course loaded): a guard, not a wait. */
const GRID_FRAMES = 4000;

describe("given one page that runs the bench's steps in turn, as the loop does (a second CrashEngine never resolves ready, so one engine for the file)", () => {
  let engine: CrashEngine;
  /** The sim digest of each step of the sequence, whether its head-on pair was staged, and its wrecks at the end, by step name. */
  const digests: Record<string, string> = {};
  const staged: Record<string, boolean> = {};
  const wrecks: Record<string, number> = {};
  /** What entering each step left the page: the activation's knob, the Debug knobs but that one off their defaults, and the card's arm label. */
  const entered: Record<string, { epicenter: boolean; strayKnobs: string[]; armLabel: string | null }> = {};
  const armElement = { textContent: "" as string | null, style: { cssText: "" } };
  const badge = new ArmBadge(armElement, epicenterOn);
  /**
   * One step as `runBench` begins it (its adaptive quality reset, its scene entered), the grid run to green on the 1/240 s floor, the quick bench's head-on
   * staged at the start line, then `CRASH_S` of sim; `watched`: with the window's phase clock, counters and per-second series recording (`watchWork`, ticked every frame).
   */
  const step = (name: string, query: string, watched = false): void => {
    engine.resetAdaptiveQuality();
    const since = simCounters(engine);
    enterBenchScene(engine, engine.benchParts(), benchPlan(query)!);
    badge.sync();
    entered[name] = {
      epicenter: epicenterOn(),
      strayKnobs: KNOBS.filter((knob) => knob.id !== "epi.on" && knob.get() !== KNOB_DEFAULTS[knob.id]).map((knob) => knob.id),
      armLabel: armElement.textContent,
    };
    engine.pace.pin = false;
    const work = watched ? watchWork(engine.benchParts(), engine.pace) : null;
    const { race } = engine.benchParts();
    let i = 0;
    const frame = (): void => {
      runFrames(engine, 1);
      i++;
      work?.tick(i * FRAME_S, i * FRAME_S);
    };
    while (race.phase !== "racing" && i < GRID_FRAMES) frame();
    staged[name] = race.crashAtStart(CRASH_GAP, CRASH_SPEED);
    for (const end = i + CRASH_S * FINE_HZ; i < end; ) frame();
    work?.end();
    digests[name] = simDigest(engine, since);
    wrecks[name] = engine.benchParts().live().filter((car) => car.crashed).length;
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

  it("when the page enters the next step, then every Debug knob but the activation is at its default, and the activation is off unless that step asks for it (the default is on)", () => {
    assert.equal(entered["city with the activation"]!.epicenter, true, "the control: the activation is on in its own arm");
    for (const [name, page] of Object.entries(entered)) {
      if (name !== "city with the activation") assert.equal(page.epicenter, false, `${name}: off in the next step`);
      assert.deepEqual(page.strayKnobs, [], `${name}: every other knob at its default`);
    }
  });

  it("when the loop's steps are entered in turn (city, city with the activation, strip, city), then the card's arm label follows the knob each time: off, ON, off, off", () => {
    const labels = ["city first", "city with the activation", "strip", "city again"].map((name) => entered[name]!.armLabel);
    assert.deepEqual(labels, ["epicenter off", "EPICENTER ON", "epicenter off", "epicenter off"]);
  });

  it("when the quick bench's start is made on the city in two steps, then the head-on pair is staged both times and crashes (the bit-for-bit window is the first row's)", () => {
    for (const name of ["city first", "city again"]) {
      assert.equal(staged[name], true, `${name}: the pair is staged at green`);
      assert.ok(wrecks[name]! >= 2, `${name}: ${wrecks[name]} wrecks ${CRASH_S} s on: the staged pair crashed`);
    }
  });

  it("when the quick bench starts on the strip, then the pair is staged there too", () => {
    assert.equal(staged["strip"], true);
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
      assert.equal(parts.sky.drawn, SKY_DRAWN.procedural, "the sweep ends on the sky a race pins: the procedural sky drawn");
      assert.equal(parts.sky.textureBytes, 0, "the strip it loaded is let go");
      assert.ok(beat.hitches.frames > 3 * 180, `the sweep ran its frames (${beat.hitches.frames})`);
      endSweep(engine, skyPinOf(plan));
      step("city after the sweep", "?bench=city", true);
      assert.equal(digests["city after the sweep"], digests["city first"]);
      // A load the step began is still in flight (its decode is a promise chain): let it land on the stand-in.
      await new Promise<void>((resolve) => setImmediate(resolve));
    } finally {
      Object.assign(globalThis, real);
      if (real.createImageBitmap === undefined) Reflect.deleteProperty(globalThis, "createImageBitmap");
    }
  });

  /** A wall-clock reading (ms) 11.6 days into a page's life, where frame stamps on the wall clock round `now - last` off by up to 1.2e-7 ms. */
  const LATE_MS = 1e9;
  it("when the probe frames start at a page's first millisecond and 11 days into it, then every frame runs its own wall time to the bit: the sim never reads the time of day", () => {
    const poll = engine["pollInput"];
    const seen: number[] = [];
    engine["pollInput"] = (wallDt: number): void => {
      seen.push(wallDt);
      poll.call(engine, wallDt);
    };
    try {
      for (const at of [0, LATE_MS]) {
        engine["last"] = at;
        runFrames(engine, 1);
      }
    } finally {
      engine["pollInput"] = poll;
    }
    assert.equal(seen.length, 2, "two frames ran");
    for (const [k, wallDt] of seen.entries()) assert.equal(wallDt, FRAME_S, `frame ${k}`);
  });
});
