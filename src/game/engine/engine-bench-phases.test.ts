import { afterAll, afterEach, beforeAll, describe, it, vi } from "vitest";
import assert from "node:assert/strict";
import { COUNTER_NAMES, phaseCard, readBattery, watchLongTasks, watchWork, type WorkSeries } from "./bench-measure.ts";
import { benchRaceEngine, disposeBenchEngine, FRAME_S, runFrames } from "./engine-bench-headless.test-util.ts";
import type { CrashEngine } from "./engine.ts";
import { PHASE_NAMES, WORK_NAMES } from "./sim-phases.ts";

/** Frames the race runs unmeasured first (10 s of sim: the grid's first crashes are in), then the measured stretch (4 s: the skin kernel's calls come in bursts when a car deforms, and a 2 s window can read none). */
const WARM_FRAMES = 2400;
const WINDOW_FRAMES = 960;

/** The clock reads the window leaves outside a phase, per step: the pacer's own read after each step and the wrapper's that sums `simMs` (the clock the test runs counts reads, one tick each). */
const MAX_UNATTRIBUTED_READS_PER_STEP = 2;

/** The head-on sent into the window: the second racer's speed (m/s) and its distance (m) ahead of the first, who comes on at his race speed: contact within a quarter of a second, too soon for a driver to dodge. */
const STAGED_SPEED = 20;
const STAGED_AHEAD = 12;

const emptySeries = (): WorkSeries => ({ seconds: 0, wallS: new Float64Array(0), clockS: new Float64Array(0), phaseMs: new Float64Array(0), counts: new Float64Array(0) });

/** Sends the second racer head-on at the first, so the window holds a crash (the skin kernel only runs on a deforming car) whatever the race does in it. */
function stageHeadOn(engine: CrashEngine): void {
  const racers = engine["live"]().filter((car) => !car.crashed);
  assert.ok(racers.length >= 2, `${racers.length} racers left to stage a crash between`);
  const first = racers[0]!;
  const second = racers[1]!;
  first.refreshBasis();
  const yaw = Math.atan2(first.forward.x, first.forward.z);
  const at = first.group.position;
  second.spawnFacing(at.x + first.forward.x * STAGED_AHEAD, at.z + first.forward.z * STAGED_AHEAD, yaw + Math.PI, STAGED_SPEED);
}

describe("given a phase table made of a window's phase ms and counter differences", () => {
  const phaseMs = new Float64Array(PHASE_NAMES.length).fill(10);
  const counts = new Float64Array(COUNTER_NAMES.length).fill(50);

  it("when the window covered 2 sim seconds and cost 250 ms, then each phase and counter is per sim second and what the phases leave over is unattributed", () => {
    const card = phaseCard(phaseMs, counts, 250, 2, emptySeries());
    for (const name of PHASE_NAMES) assert.equal(card.msPerSimS[name], 5, `${name} ms per sim-second`);
    assert.equal(card.unattributedMsPerSimS, 75, "(250 - 10 phases of 10) / 2");
    for (const name of COUNTER_NAMES) assert.equal(card.workPerSimS[name], 25, `${name} per sim-second`);
  });

  it("when the window stepped 50 of each unit and each phase cost 10 ms, then a unit costs the phase's ms over the units it stepped, in us, and a car-slice of any class divides by all three classes", () => {
    const card = phaseCard(phaseMs, counts, 250, 2, emptySeries());
    assert.equal(card.unitUs["wreck us/wreck slice"], 200, "10 ms over 50 wreck slices");
    assert.ok(Math.abs(card.unitUs["integrate us/car slice"]! - 1000 * 10 / 150) < 1e-9, "10 ms over live + wreck + asleep slices");
  });

  it("when the window stepped no wreck, then the wreck units have no entry rather than an infinite cost", () => {
    const noWrecks = counts.slice();
    noWrecks[COUNTER_NAMES.indexOf("wreckCarSlices")] = 0;
    const card = phaseCard(phaseMs, noWrecks, 250, 2, emptySeries());
    assert.equal("wreck us/wreck slice" in card.unitUs, false, "no wreck units");
    assert.equal("structure us/wreck slice" in card.unitUs, false, "no wreck units");
    assert.ok(card.unitUs["integrate us/live slice"]! > 0, "the live units remain");
  });

  it("when the window covered no sim time, then every figure is zero rather than infinite", () => {
    const card = phaseCard(phaseMs, counts, 250, 0, emptySeries());
    assert.equal(card.unattributedMsPerSimS, 0, "unattributed");
    assert.equal(Object.values(card.msPerSimS).every((ms) => ms === 0), true, "phases");
    assert.equal(Object.values(card.workPerSimS).every((n) => n === 0), true, "counters");
  });
});

describe("given the real engine on the city bench's race, headless", () => {
  // One engine for the file: a second `CrashEngine` in the same process never resolves `ready`.
  let engine: CrashEngine;
  beforeAll(async () => {
    engine = await benchRaceEngine();
    runFrames(engine, WARM_FRAMES);
  });
  afterAll(() => disposeBenchEngine(engine));
  afterEach(() => {
    assert.equal(engine["world"].phases.on, false, "a window left the phase clock on");
  });

  it("when a window is watched on a clock that ticks once per read, then its phases plus the unattributed equal the sim's reads, no phase is negative, the unattributed is only the pacer's own reads, and the phases a race always runs each hold time", () => {
    let reads = 0;
    vi.spyOn(performance, "now").mockImplementation(() => ++reads);
    const parts = engine.benchParts();
    const pace = engine.pace;
    const run = pace.run;
    let simMs = 0;
    pace.run = (...args) => {
      const t0 = performance.now();
      run.apply(pace, args);
      simMs += performance.now() - t0;
    };
    const stepsBefore = pace.total;
    const work = watchWork(parts, pace);
    stageHeadOn(engine);
    for (let i = 1; i <= WINDOW_FRAMES; i++) {
      runFrames(engine, 1);
      work.tick(i * FRAME_S, i * FRAME_S);
    }
    const { phaseMs, counts, series } = work.end();
    pace.run = run;
    const clockS = WINDOW_FRAMES * FRAME_S;
    const card = phaseCard(phaseMs, counts, simMs, clockS, series);
    const windowS = WINDOW_FRAMES * FRAME_S;
    assert.ok(series.seconds >= windowS - 1 && series.seconds <= windowS, `one entry a whole second the window crossed (${windowS} s of frames), got ${series.seconds}`);
    for (let k = 0; k < PHASE_NAMES.length; k++) {
      let seconds = 0;
      for (let i = 0; i < series.seconds; i++) seconds += series.phaseMs[i * PHASE_NAMES.length + k]!;
      assert.ok(seconds <= phaseMs[k]! + 1e-9, `${PHASE_NAMES[k]}: the seconds' ms cannot exceed the window's`);
    }
    for (let k = 0; k < COUNTER_NAMES.length; k++) {
      let seconds = 0;
      for (let i = 0; i < series.seconds; i++) seconds += series.counts[i * COUNTER_NAMES.length + k]!;
      assert.ok(seconds <= counts[k]!, `${COUNTER_NAMES[k]}: the seconds' counts cannot exceed the window's`);
    }
    assert.equal(card.perSecond.wallS.length, series.seconds, "the card carries one entry a second");
    assert.equal(card.perSecond.workPerSimS["steps"]!.length, series.seconds, "each counter has an entry each second");
    let sum = card.unattributedMsPerSimS;
    for (const name of PHASE_NAMES) {
      assert.ok(card.msPerSimS[name]! >= 0, `${name} is negative`);
      sum += card.msPerSimS[name]!;
    }
    const headline = simMs / clockS;
    assert.ok(Math.abs(sum - headline) <= 1e-9 * headline, `phases + unattributed ${sum} against the sim's ${headline} ms per sim-second`);
    assert.ok(card.unattributedMsPerSimS >= 0, "the phases cannot exceed the sim's own time");
    const unattributedReads = card.unattributedMsPerSimS * clockS;
    const steps = pace.total - stepsBefore;
    assert.ok(unattributedReads <= MAX_UNATTRIBUTED_READS_PER_STEP * steps, `${unattributedReads} clock reads outside a phase over ${steps} steps`);
    for (const name of ["drive", "plan", "integrate", "pairs", "structure", "course", "rules", "settle"] as const) assert.ok(card.msPerSimS[name]! > 0, `${name} timed nothing`);
    if (card.workPerSimS["wreckCarSlices"]! > 0) assert.ok(card.msPerSimS["wreck"]! > 0, "wrecks stepped but the wreck phase timed nothing");
    assert.equal(counts[COUNTER_NAMES.indexOf("steps")], pace.total - stepsBefore, "the window's steps are the pacer's");
    for (const name of WORK_NAMES) assert.ok(card.workPerSimS[name]! >= 0, `${name} is negative`);
    for (const name of ["slices", "liveCarSlices", "pairTests", "prismQueries", "prismsVisited", "skins", "skinVerts"] as const) assert.ok(card.workPerSimS[name]! > 0, `${name} counted nothing`);
  });

  it("when the sim then runs unwatched, then the phase clock reads nothing", () => {
    const phases = engine["world"].phases;
    const before = phases.ms.slice();
    runFrames(engine, 60);
    for (const [i, name] of PHASE_NAMES.entries()) assert.equal(phases.ms[i], before[i], `${name} moved with the clock off`);
  });
});

describe("given a browser with long-task entries, or without", () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, "PerformanceObserver");
  afterEach(() => Object.defineProperty(globalThis, "PerformanceObserver", original!));

  class Supported {
    static supportedEntryTypes = ["longtask"];
    private readonly callback: (list: { getEntries(): { duration: number }[] }) => void;
    constructor(callback: (list: { getEntries(): { duration: number }[] }) => void) {
      this.callback = callback;
    }
    observe(): void {
      this.callback({ getEntries: () => [{ duration: 60 }, { duration: 110.5 }] });
    }
    takeRecords(): { duration: number }[] {
      return [{ duration: 52 }];
    }
    disconnect(): void {}
  }

  it("when the browser lists longtask, then the count, total and longest of the tasks seen, and the ones still pending at stop, are returned", () => {
    Object.defineProperty(globalThis, "PerformanceObserver", { value: Supported, configurable: true });
    const found = watchLongTasks().stop();
    assert.ok(found !== null, "long tasks are supported");
    assert.equal(found.count, 3, "count");
    assert.equal(found.totalMs, 222.5, "total ms");
    assert.equal(found.maxMs, 110.5, "longest ms");
  });

  it("when the browser does not list longtask, then there is no reading at all (null, not zero)", () => {
    Object.defineProperty(globalThis, "PerformanceObserver", { value: class { static supportedEntryTypes = ["mark"]; }, configurable: true });
    assert.equal(watchLongTasks().stop(), null);
  });
});

describe("given a browser with a battery, without one, or that refuses it", () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  afterEach(() => Object.defineProperty(globalThis, "navigator", original!));
  const withNavigator = (value: object): void => void Object.defineProperty(globalThis, "navigator", { value, configurable: true });

  it("when getBattery answers, then the charging flag and level are read", async () => {
    withNavigator({ getBattery: async () => ({ charging: true, level: 0.62, chargingTime: 5, dischargingTime: Infinity }) });
    const battery = await readBattery();
    assert.ok(battery !== null, "a battery");
    assert.equal(battery.charging, true, "charging");
    assert.equal(battery.level, 0.62, "level");
    assert.equal(Object.keys(battery).length, 2, "only the two fields a card keeps");
  });

  it("when the browser has no getBattery, then there is no reading (null)", async () => {
    withNavigator({});
    assert.equal(await readBattery(), null);
  });

  it("when getBattery is refused, then the refusal is logged and the reading is none", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    withNavigator({ getBattery: async () => Promise.reject(new Error("blocked by permissions policy")) });
    assert.equal(await readBattery(), null);
    assert.equal(warn.mock.calls.length, 1, "the refusal was logged");
  });
});
