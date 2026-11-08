import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { benchRaceEngine, disposeBenchEngine, FRAME_S, runFrames } from "./engine-bench-headless.test-util.ts";
import type { CrashEngine } from "./engine.ts";
import { endParts, frameParts, PART, PART_NAMES, startParts } from "../kernel/frame-parts.ts";

/** Frames the race runs unmeasured first (2.5 s of sim: the field is off the grid), then the measured stretch (0.5 s: the HUD's push, due every 0.12 s, falls in it several times). */
const WARM_FRAMES = 600;
const WINDOW_FRAMES = 120;

/** The part clock's own clock reads in a frame (two around the sim, a few more at the other laps) as a sum over the window: well under a microsecond each. */
const SIM_LAP_TOLERANCE_MS = 0.5;
/** The float rounding of a window of laps summed against the frame's own two reads. */
const TILE_TOLERANCE_MS = 1e-6;

describe("given the real engine on the city bench's race, a few frames with the part clock on and no draw", () => {
  let engine: CrashEngine;
  let cpu = 0;
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
    frameParts.on = true;
    for (let i = 0; i < WINDOW_FRAMES; i++) {
      const t0 = performance.now();
      startParts(t0);
      engine.advance(FRAME_S, { frameDt: FRAME_S });
      const t1 = performance.now();
      endParts(t1);
      cpu += t1 - t0;
    }
    frameParts.on = false;
    engine.pace.run = run;
  }, 120_000);

  afterAll(() => disposeBenchEngine(engine));

  it("when the frames are over, then the parts sum to the frames' cpu and none is negative", () => {
    const sum = frameParts.ms.reduce((total, ms) => total + ms, 0);
    expect(Math.abs(sum - cpu), `${PART_NAMES.map((name, k) => `${name} ${frameParts.ms[k]!.toFixed(2)}`).join(", ")} against cpu ${cpu.toFixed(2)} ms`).toBeLessThan(TILE_TOLERANCE_MS);
    expect(frameParts.ms.every((ms) => ms >= 0), "no part is negative").toBeTruthy();
  });

  it("when the sim ran inside the frames, then the sim part is what a pair of clock reads round the pacer's run took, so sim is in no other part", () => {
    expect(simPair, "the pair timer saw the sim").toBeGreaterThan(0);
    expect(Math.abs(frameParts.ms[PART.sim]! - simPair), `sim part ${frameParts.ms[PART.sim]!.toFixed(3)} against the pair's ${simPair.toFixed(3)} ms`).toBeLessThan(SIM_LAP_TOLERANCE_MS);
  });

  it("when a race frame ran, then the skin, scenery, effects, camera and HUD parts each hold time", () => {
    for (const name of ["skin", "scenery", "fx", "camera", "hud"] as const) expect(frameParts.ms[PART[name]]!, name).toBeGreaterThan(0);
  });
});
