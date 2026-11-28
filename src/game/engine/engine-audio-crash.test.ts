import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setGround } from "../world/ground.ts";
import type { CrashEngine } from "./engine.ts";
import { bootCrashEngine, runCrash } from "./engine-audio-crash.test-util.ts";

describe("given the real engine's fleet sandbox, two cars head-on and a third driven into the slab, run with audio off twice and with audio on", () => {
  let engine: CrashEngine;
  beforeAll(async () => {
    engine = await bootCrashEngine();
  });
  afterAll(() => {
    engine.dispose();
    setGround(null);
  });

  it("when it runs, then entering the fleet again is clean, the car-car crash is heard steel on steel, the slab steel on concrete, and the audio-on world is the audio-off one to the bit", () => {
    // The first run after boot carries the boot scene's state; every entry after a `reset` is the same numbers.
    runCrash(engine, false);
    const first = runCrash(engine, false);
    const second = runCrash(engine, false);
    expect(second.digest, "control: two audio-off runs, the fleet entered again between").toBe(first.digest);
    expect(first.hits.length, "no audio off, no hit heard").toBe(0);
    const on = runCrash(engine, true);
    const pairs = on.hits.map((h) => `${h.a}/${h.b}`);
    expect(pairs, "a car-car hit, steel on steel").toContain("steel/steel");
    expect(pairs, "the slab, steel on concrete").toContain("steel/concrete");
    for (const h of on.hits) expect(h.impulse, "every hit is a real one").toBeGreaterThan(1.5);
    expect(on.digest, "world digest with audio on").toBe(first.digest);
  }, 240_000);
});
