import { describe, it } from "node:test";
import assert from "node:assert/strict";
import "../kernel/rapier-node.test-util.ts";
import { EPICENTER } from "../deform/epicenter.ts";
import { FRAME_HZ } from "../kernel/constants.ts";
import { drawnTriangles } from "../vehicle/drawn-body.test-util.ts";
import { tyreClearance } from "../vehicle/tyre-clearance.test-util.ts";
import { setGround } from "../world/ground.ts";
import { bootEngine, stubBrowser } from "./engine-headless.test-util.ts";

/**
 * `fleet-tyres.test.ts`' crash on other seeds of the fleet's layout: on these the car that hits the pickup destroys its nose, and the front tyres stand 50-260 mm through the drawn
 * skin that is left (the arch liner, below the tyre's top). A crushed hood should buckle around a tyre, not pass it.
 */
const FRAME = 1 / FRAME_HZ;
const FLEET = 5;
const PICKUP = 4;
const FRONT_WHEELS = [0, 1] as const;
const FROM_S = 0.38;
const TO_S = 1.6;
const CLEARANCE_M = 0.005;
const SPEEDS_MS = [10, 32] as const;
const SQUASH = 0.32;
const BUCKLE = 0.45;
const REALISM = 0.25;
const SEEDS = [4, 6, 11, 12, 13] as const;

/** The least clearance (m) of the pickup's front tyres under its drawn skin from the first contact to `TO_S`, on a fresh engine seeded `seed`. */
async function leastClearance(seed: number): Promise<number> {
  stubBrowser();
  const engine = await bootEngine({ fades: true });
  engine.setCarCount(FLEET);
  engine.setSpeedRange(SPEEDS_MS[0], SPEEDS_MS[1]);
  engine.setSquash(SQUASH);
  engine.setBuckle(BUCKLE);
  engine.setRealism(REALISM);
  engine["pinnedSeed"] = seed;
  engine.reset();
  engine["looping"] = false;
  EPICENTER.on = 0;
  const throwDriver = engine["throwDriver"].bind(engine);
  engine["throwDriver"] = (...args: Parameters<typeof throwDriver>) => {
    throwDriver(...args);
    engine["onThrow"](args[0].car);
  };
  Object.assign(engine.pace, { now: () => 0, pin: false });
  let least = Infinity;
  try {
    while (engine["elapsedSim"] < TO_S) {
      engine.advance(FRAME, { frameDt: FRAME });
      if (engine["elapsedSim"] < FROM_S) continue;
      const car = engine["live"]()[PICKUP]!;
      const tris = drawnTriangles(car);
      for (const wheel of FRONT_WHEELS) if (!car["looseWheels"][wheel]!.loose) least = Math.min(least, tyreClearance(car, wheel, tris));
    }
  } finally {
    engine.dispose();
    setGround(null);
  }
  return least;
}

describe("given the owner's five-car fleet crash on seeds where the pickup's nose is destroyed", () => {
  for (const seed of SEEDS) {
    it(
      `when the cars hit and settle for ${TO_S} s on seed ${seed}, then the pickup's front tyres keep 5 mm under its drawn skin in every frame`,
      { todo: "after the plan: a destroyed nose leaves the tyre standing through the arch liner: the crushed hood and fender must buckle around the tyre, not pass it" },
      async () => {
        const clearance = await leastClearance(seed);
        assert.ok(clearance >= CLEARANCE_M, `${(clearance * 1000).toFixed(1)} mm`);
      },
    );
  }
});
