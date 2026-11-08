import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { benchRaceEngine, disposeBenchEngine, FRAME_S, runFrames } from "./engine-bench-headless.test-util.ts";
import type { CrashEngine } from "./engine.ts";
import { endParts, frameParts, PART, startParts } from "../kernel/frame-parts.ts";

/** Frames the race runs unmeasured first (2.5 s of sim: the field is off the grid), then the measured stretch (0.5 s: the HUD's push, due every 0.12 s, falls in it several times). */
const WARM_FRAMES = 600;
const WINDOW_FRAMES = 120;

/** What the lap pair may hold beyond the test's own pair of reads, a frame: the pair encloses the wrapper's call and its own two clock reads, and a collection or JIT pause inside the wrapper lands in the lap (measured on a loaded worker: 7 us a frame). A part's worth is milliseconds a frame. */
const SIM_LAP_TOLERANCE_MS_PER_FRAME = 0.02;

describe("given the real engine on the city bench's race, a few frames with the part clock on and no draw", () => {
  let engine: CrashEngine;
  let simPair = 0;

  beforeAll(async () => {
    engine = await benchRaceEngine();
    runFrames(engine, WARM_FRAMES);
    const run = engine.pace.run;
    engine.pace.run = (...args): void => {
      const t0 = performance.now();
      run.apply(engine.pace, args);
      simPair += performance.now() - t0;
    };
    frameParts.ms.fill(0);
    for (let i = 0; i < WINDOW_FRAMES; i++) {
      startParts(performance.now());
      engine.advance(FRAME_S, { frameDt: FRAME_S });
      endParts(performance.now());
    }
    engine.pace.run = run;
  }, 120_000);

  afterAll(() => disposeBenchEngine(engine));

  it("when the sim ran inside the frames, then the sim part is what a pair of clock reads round the pacer's run took, so sim is in no other part", () => {
    expect(simPair, "the pair timer saw the sim").toBeGreaterThan(0);
    expect(Math.abs(frameParts.ms[PART.sim]! - simPair), `sim part ${frameParts.ms[PART.sim]!.toFixed(3)} against the pair's ${simPair.toFixed(3)} ms over ${WINDOW_FRAMES} frames`).toBeLessThan(SIM_LAP_TOLERANCE_MS_PER_FRAME * WINDOW_FRAMES);
  });

  it("when a race frame ran, then the skin, scenery, effects, camera and HUD parts each hold time", () => {
    for (const name of ["skin", "scenery", "fx", "camera", "hud"] as const) expect(frameParts.ms[PART[name]]!, name).toBeGreaterThan(0);
  });
});
