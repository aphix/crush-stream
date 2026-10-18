import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { SKY_DRAWN, type SkyDrawn } from "../present/sky-dome.ts";
import { skyPinOf } from "./bench-measure.ts";
import { benchPlan } from "./engine-bench-plan.ts";
import { benchPlanEngine, disposeBenchEngine, runFrames } from "./engine-bench-headless.test-util.ts";
import type { FxTier } from "../present/engine-post.ts";
import type { CrashEngine } from "./engine.ts";

const TIERS: readonly FxTier[] = ["minimal", "low", "high"];
/** Frames the Auto FX policy runs for in the row (it judges a few seconds of draw cost before it moves a tier). */
const AUTO_FRAMES = 1200;

/** Lets a picture load that the last frames asked for land (its decode is a promise chain). */
const settled = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

describe("given the real engine on the city bench, whose sky is a picture the page decodes (a one-pixel stand-in here)", () => {
  let engine: CrashEngine;
  const real = { fetch: globalThis.fetch, createImageBitmap: (globalThis as { createImageBitmap?: unknown }).createImageBitmap };
  before(async () => {
    Object.assign(globalThis, {
      fetch: async () => ({ ok: true, status: 200, blob: async () => new Blob([]) }),
      createImageBitmap: async () => ({ width: 1, height: 1, close() {} }),
    });
    engine = await benchPlanEngine("?bench=city");
  });
  after(async () => {
    await settled();
    disposeBenchEngine(engine);
    Object.assign(globalThis, real);
    if (real.createImageBitmap === undefined) Reflect.deleteProperty(globalThis, "createImageBitmap");
  });

  /** The sky as drawn once `tier` is in force and the frames ran. */
  const drawnAt = async (tier: FxTier): Promise<SkyDrawn> => {
    engine.setFxTier(tier);
    runFrames(engine, 3);
    await settled();
    runFrames(engine, 3);
    return engine.benchParts().sky.drawn;
  };

  it("when the Sky setting is left on auto (what a bench ran under before), then the sky drawn follows the FX tier: the control, so the rows below can fail", async () => {
    engine.setSky("auto");
    const states = new Set<SkyDrawn>();
    for (const tier of TIERS) states.add(await drawnAt(tier));
    assert.ok(states.has(SKY_DRAWN.off), "none on minimal");
    assert.ok(states.has(SKY_DRAWN.full), "the full strip on high");
    assert.ok(states.size > 1, `${[...states]} : an auto sky changes with the tier`);
  });

  it("when the bench pins the Sky setting for a race, then every FX tier, and the engine's Auto FX policy running on its own, leave the sky drawn as the strip for every frame", async () => {
    const pin = skyPinOf(benchPlan("?bench=city")!);
    assert.equal(pin, "full", "a race pins the full strip");
    engine.setSky(pin);
    for (const tier of TIERS) assert.equal(await drawnAt(tier), SKY_DRAWN.full, `at ${tier}`);
    engine.setFxAuto();
    const seen = new Set<SkyDrawn>();
    const tiers = new Set<string>();
    for (let i = 0; i < AUTO_FRAMES; i++) {
      runFrames(engine, 1);
      seen.add(engine.benchParts().sky.drawn);
      tiers.add(engine.benchParts().cine.tier);
    }
    assert.equal(seen.size, 1, `one sky state over ${AUTO_FRAMES} frames of Auto FX (tiers seen: ${[...tiers]})`);
    assert.ok(seen.has(SKY_DRAWN.full), "and it is the strip");
  });

  it("when the bench pins the Sky setting for the Lab (it has no sky), then no FX tier draws one", async () => {
    engine.setSky(skyPinOf(benchPlan("?bench=lab")!));
    for (const tier of TIERS) assert.equal(await drawnAt(tier), SKY_DRAWN.off, `at ${tier}`);
  });
});
