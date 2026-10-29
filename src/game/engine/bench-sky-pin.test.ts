import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SKY_DRAWN, type SkyDrawn } from "../present/sky-dome.ts";
import { skyPinOf, tap } from "./bench-measure.ts";
import { applySkyPin, newBeat, pinSky } from "./bench-frame.ts";
import { INITIAL_HUD } from "../hud/hud-store.ts";
import { restoreFrame } from "./bench-frame.test-util.ts";
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
  beforeAll(async () => {
    Object.assign(globalThis, {
      fetch: async () => ({ ok: true, status: 200, blob: async () => new Blob([]) }),
      createImageBitmap: async () => ({ width: 1, height: 1, close() {} }),
    });
    engine = await benchPlanEngine("?bench=city");
  });
  afterAll(async () => {
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
    expect(states.has(SKY_DRAWN.off), "none on minimal").toBeTruthy();
    expect(states.has(SKY_DRAWN.procedural), "the default procedural sky on high").toBeTruthy();
    expect(states.size, `${[...states]} : an auto sky changes with the tier`).toBeGreaterThan(1);
  });

  it("when the bench pins the sky for a race, then every FX tier, and the engine's Auto FX policy running on its own, leave the default procedural sky drawn for every frame", async () => {
    const pin = skyPinOf(benchPlan("?bench=city")!);
    expect(pin, "a race pins the default procedural sky").toBe("procedural");
    applySkyPin(engine, pin);
    for (const tier of TIERS) expect(await drawnAt(tier), `at ${tier}`).toBe(SKY_DRAWN.procedural);
    engine.setFxAuto();
    const seen = new Set<SkyDrawn>();
    const tiers = new Set<string>();
    for (let i = 0; i < AUTO_FRAMES; i++) {
      runFrames(engine, 1);
      seen.add(engine.benchParts().sky.drawn);
      tiers.add(engine.benchParts().cine.tier);
    }
    expect(seen.size, `one sky state over ${AUTO_FRAMES} frames of Auto FX (tiers seen: ${[...tiers]})`).toBe(1);
    expect(seen.has(SKY_DRAWN.procedural), "and it is the procedural sky").toBeTruthy();
  });

  it("when the bench pins the painted strip (the sky A/B's `full` arm), then every FX tier draws the strip", async () => {
    applySkyPin(engine, "full");
    for (const tier of TIERS) expect(await drawnAt(tier), `at ${tier}`).toBe(SKY_DRAWN.full);
  });

  it("when the bench pins the sky for the Lab (it has no sky), then no FX tier draws one", async () => {
    applySkyPin(engine, skyPinOf(benchPlan("?bench=lab")!));
    for (const tier of TIERS) expect(await drawnAt(tier), `at ${tier}`).toBe(SKY_DRAWN.off);
  });

  for (const player of [{ it: "the picture", cover: null }, { it: "a cover of 0.8", cover: 0.8 }]) {
    it(`when the player has ${player.it} and the bench pins each sky in turn, then each pin is drawn, the procedural sky at the default cover, then the strip, then nothing, instead of waiting out \`BENCH.skyWaitS\``, async () => {
      engine.setProceduralSky(player.cover);
      let stamp = 0;
      Object.defineProperty(globalThis, "requestAnimationFrame", { value: (callback: (at: number) => void) => void setImmediate(() => callback((stamp += 1000 / 60))), configurable: true });
      try {
        const parts = engine.benchParts();
        const t = tap(engine.pace, parts);
        const beat = newBeat(parts, 0, null, 0);
        expect(await pinSky(engine, parts, t, beat, "procedural"), "the procedural sky is pinned").toBe(true);
        expect(parts.sky.drawn).toBe(SKY_DRAWN.procedural);
        expect(engine["stage"].sky["mat"].uniforms.uCover!.value, "at the default cover, not the player's").toBe(INITIAL_HUD.proceduralSky);
        expect(await pinSky(engine, parts, t, beat, "full"), "the strip is pinned").toBe(true);
        expect(parts.sky.drawn).toBe(SKY_DRAWN.full);
        expect(await pinSky(engine, parts, t, beat, "off"), "off is pinned").toBe(true);
        expect(parts.sky.drawn).toBe(SKY_DRAWN.off);
      } finally {
        restoreFrame();
        engine.setProceduralSky(INITIAL_HUD.proceduralSky);
      }
    });
  }
});
