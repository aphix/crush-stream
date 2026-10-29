import { afterAll, beforeAll, describe, expect, it } from "vitest";
import "../kernel/rapier-node.test-util.ts";
import { activeGround, setGround } from "../world/ground.ts";
import { CHASE } from "../present/drive-cam.ts";
import type { CrashEngine } from "./engine.ts";
import { bootEngine, stubBrowser } from "./engine-headless.test-util.ts";
import { FRAME_HZ } from "../kernel/constants.ts";

const FRAME = 1 / FRAME_HZ;
/** Fields whose cars' mean spot crosses a mound or ramp in their first `SECONDS`. */
const SEEDS = [6, 4];
const SECONDS = 12;

describe("given the real engine in a 10-car derby, watched from the orbit (no car followed)", () => {
  // One engine for the file: a second `CrashEngine` in the same process never resolves `ready`.
  let engine: CrashEngine;
  beforeAll(async () => {
    stubBrowser();
    engine = await bootEngine({ pacer: true });
  });
  afterAll(() => {
    engine.dispose();
    setGround(null);
  });

  it("when the cars' mean spot crosses the sand's rises, then the eye stands a chase eye's floor over the sand every frame", () => {
    for (const seed of SEEDS) {
      engine["pinnedSeed"] = seed;
      if (!engine.derbyMode) engine.toggleDerby();
      engine.setTimeScale(null);
      engine.setCarCount(10);
      engine.setSpeedRange(18, 28);
      engine.reset();
      let worst = Infinity;
      let at = -1;
      for (let f = 0; f < SECONDS * FRAME_HZ; f++) {
        engine.advance(FRAME, { frameDt: FRAME });
        const eye = engine["camera"].position;
        const clear = eye.y - activeGround().heightAt(eye.x, eye.z);
        if (clear < worst) {
          worst = clear;
          at = f;
        }
      }
      expect(worst, `seed ${seed}: the eye stood ${worst.toFixed(2)} m over the sand at frame ${at}`).toBeGreaterThanOrEqual(CHASE.floor);
    }
  });
});
