import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import "../kernel/rapier-node.test-util.ts";
import { EPICENTER } from "../deform/epicenter.ts";
import { FRAME_HZ } from "../kernel/constants.ts";
import { drawnTriangles } from "../vehicle/drawn-body.test-util.ts";
import { sillInTyre, tyreClearance } from "../vehicle/tyre-clearance.test-util.ts";
import { setGround } from "../world/ground.ts";
import type { CrashEngine } from "./engine.ts";
import { bootEngine, stubBrowser } from "./engine-headless.test-util.ts";

/**
 * The owner's five-car fleet crash (the pickup is the fifth car): its drawn front tyres stay under its drawn hood, and its drawn sill out of
 * them, while the cars hit and settle. A pickup's hood is crushed down onto its tyres by the car that hits it, whose wheels the sim leaves
 * where they stand.
 */
const FRAME = 1 / FRAME_HZ;
const FLEET = 5;
const PICKUP = 4;
const FRONT_WHEELS = [0, 1] as const;
/** The sim time (s) the window opens at (the first contact is at 0.38) and shuts at. */
const FROM_S = 0.38;
const TO_S = 1.6;
/** The clearance (m) every drawn tyre top keeps under the skin (`tyre-hood.test.ts`). */
const CLEARANCE_M = 0.005;
const SEED = 12641919;
const SPEEDS_MS = [10, 32] as const;
const SQUASH = 0.32;
const BUCKLE = 0.45;
const REALISM = 0.25;

describe("given the real engine running the owner's five-car fleet crash with the epicentre off", () => {
  let engine: CrashEngine;
  /** Over the window, every frame: the least clearance of a front tyre under the drawn hood, and the deepest the drawn sill stands in one. */
  let least = { clearance: Infinity, sim: 0 };
  let sill = { depth: 0, sim: 0 };

  before(async () => {
    stubBrowser();
    engine = await bootEngine({ fades: true });
    engine.setCarCount(FLEET);
    engine.setSpeedRange(SPEEDS_MS[0], SPEEDS_MS[1]);
    engine.setSquash(SQUASH);
    engine.setBuckle(BUCKLE);
    engine.setRealism(REALISM);
    engine["pinnedSeed"] = SEED;
    engine.reset();
    // One crash: the loop resets the fleet 10.4 wall s after the hit, which the slow-mo reaches at about 0.89 sim s, so the window would only
    // close in a run whose later hit restarted that clock.
    engine["looping"] = false;
    EPICENTER.on = 0;
    // Headless has no dummy world: a launched dummy calls `onThrow` at once, which lifts the slow-mo for his exit.
    const throwDriver = engine["throwDriver"].bind(engine);
    engine["throwDriver"] = (...args: Parameters<typeof throwDriver>) => {
      throwDriver(...args);
      engine["onThrow"](args[0].car);
    };
    Object.assign(engine.pace, { now: () => 0, pin: false });
    while (engine["elapsedSim"] < TO_S) {
      engine.advance(FRAME, { frameDt: FRAME });
      if (engine["elapsedSim"] < FROM_S) continue;
      const car = engine["live"]()[PICKUP]!;
      const tris = drawnTriangles(car);
      for (const wheel of FRONT_WHEELS) {
        if (car["looseWheels"][wheel]!.loose) continue;
        const clearance = tyreClearance(car, wheel, tris);
        if (clearance < least.clearance) least = { clearance, sim: engine["elapsedSim"] };
        const depth = sillInTyre(car, wheel);
        if (depth > sill.depth) sill = { depth, sim: engine["elapsedSim"] };
      }
    }
  });
  after(() => {
    engine.dispose();
    setGround(null);
  });

  it(`when the cars hit and settle for ${TO_S} s, then the pickup's front tyres keep 5 mm under its drawn hood in every frame`, () => {
    assert.ok(least.clearance >= CLEARANCE_M, `${(least.clearance * 1000).toFixed(1)} mm at sim ${least.sim.toFixed(2)} s`);
  });

  it(`when the cars hit and settle for ${TO_S} s, then the pickup's drawn sill (the rocker and the arch's rear lip) never stands inside a front tyre`, () => {
    assert.equal(sill.depth, 0, `the sill stood ${(sill.depth * 1000).toFixed(1)} mm inside a front tyre at sim ${sill.sim.toFixed(2)} s`);
  });
});
