import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { epicenterOn } from "../deform/epicenter.ts";
import { KNOB_DEFAULTS, KNOBS } from "../hud/knobs.ts";
import { FINE_HZ } from "../kernel/constants.ts";
import { enterBenchScene } from "./bench-scene.ts";
import { benchPlan } from "./engine-bench-plan.ts";
import { benchPlanEngine, disposeBenchEngine, runFrames, simCounters, simDigest } from "./engine-bench-headless.test-util.ts";
import type { CrashEngine } from "./engine.ts";

/** Sim seconds each step of the sequence runs: the grid, the start, the first crash and the pile-up that follows it (a wreck phase of about 260 ms a second at 7-11 s). */
const STEP_S = 14;

describe("given one page that runs the bench's steps in turn, as the loop does (a second CrashEngine never resolves ready, so one engine for the file)", () => {
  let engine: CrashEngine;
  /** The sim digest of each step of the sequence, by step name. */
  const digests: Record<string, string> = {};
  /** One step as `runBench` begins it (its adaptive quality reset, its scene entered), then `STEP_S` sim seconds on the 1/240 s floor. */
  const step = (name: string, query: string): void => {
    engine.resetAdaptiveQuality();
    const since = simCounters(engine);
    enterBenchScene(engine, engine.benchParts(), benchPlan(query)!);
    engine.pace.pin = false;
    runFrames(engine, STEP_S * FINE_HZ);
    digests[name] = simDigest(engine, since);
  };

  before(async () => {
    engine = await benchPlanEngine("?bench=city");
    step("city first", "?bench=city");
    step("city with the activation", "?bench=city&epi=1");
    step("strip", "?bench=strip");
    step("city again", "?bench=city");
  });
  after(() => disposeBenchEngine(engine));

  it("when the city bench is entered again after the epicenter arm and the strip, then its sim is bit for bit the first one's: nothing a step leaves behind reaches the next", () => {
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
});
