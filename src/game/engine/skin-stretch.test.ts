import { afterAll, beforeAll, describe, expect, it } from "vitest";
import "../kernel/rapier-node.test-util.ts";
import { FRAME_HZ } from "../kernel/constants.ts";
import { HudStore } from "../hud/hud-store.ts";
import { decodeShare } from "../hud/share-url.ts";
import { snapshotRest, worstHoldStretch, worstSkinStretch } from "../vehicle/skin-stretch.test-util.ts";
import { setGround } from "../world/ground.ts";
import type { CrashEngine } from "./engine.ts";
import { bootEngine, stubBrowser } from "./engine-headless.test-util.ts";

const FRAME = 1 / FRAME_HZ;
/** A five-car Fleet that noses cars into each other at 20-32 m/s: four of them end with a front row crushed back inside a front tyre. */
const FLEET = "#scene=fleet&cars=5&smin=20&smax=32&real=0.25&squash=0.32&buckle=0.45&seed=bc52ca&deform=shape&loop=0&slomo=0";
/** The measured worst after the fix is 3.0 over rest (a crush's own fold); before it, 13.2. */
const MAX_OVER_REST = 4;
/** The measured worst after the fix is 2.6 over the written skin; before it, 15. */
const MAX_OVER_WRITTEN = 3;

describe("given five Fleet cars that crushed their noses into each other at 20-32 m/s and came to rest", () => {
  let engine: CrashEngine;
  beforeAll(async () => {
    stubBrowser();
    engine = await bootEngine({ hud: new HudStore(), pacer: true });
  });
  afterAll(() => {
    engine.dispose();
    setGround(null);
  });

  it("when the wrecks are drawn, then no skin edge stands past 4 times its rest length, and the tyre hold stretches none past 3 times what the crush wrote", () => {
    engine["applyShare"](decodeShare(FLEET), false);
    const cars = engine["live"]();
    const rest = cars.map((c) => snapshotRest(c));
    for (let f = 0; f < 8 * FRAME_HZ; f++) engine.advance(FRAME, { frameDt: FRAME });
    expect(cars.filter((c) => c.crashed).length, "the cars crashed").toBeGreaterThanOrEqual(4);
    for (const [i, car] of cars.entries()) {
      expect(worstSkinStretch(car, rest[i]!), `car ${i} (${car.style.id}) worst drawn edge over its rest length`).toBeLessThan(MAX_OVER_REST);
      expect(worstHoldStretch(car), `car ${i} (${car.style.id}) worst drawn edge over the crush's written length`).toBeLessThan(MAX_OVER_WRITTEN);
    }
  });
});
