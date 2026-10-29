import { afterAll, beforeAll, describe, expect, it } from "vitest";
import "../kernel/rapier-node.test-util.ts";
import { SKIN_SSS } from "../present/dummy-shader.ts";
import type { FxTier } from "../present/engine-post.ts";
import { setGround } from "../world/ground.ts";
import type { CrashEngine } from "./engine.ts";
import { bootEngine, stubBrowser } from "./engine-headless.test-util.ts";

describe("given the real engine and the people's skin switch", () => {
  let engine: CrashEngine;
  beforeAll(async () => {
    stubBrowser();
    engine = await bootEngine();
  });
  afterAll(() => {
    engine.dispose();
    setGround(null);
  });

  const CASES: readonly { tier: FxTier; expected: number }[] = [
    { tier: "minimal", expected: 0 },
    { tier: "low", expected: 0 },
    { tier: "high", expected: 1 },
  ];
  for (const testCase of CASES) {
    it(`when the FX tier is ${testCase.tier}, then the skin look's switch is ${testCase.expected}`, () => {
      engine.setFxTier("high");
      engine.setFxTier(testCase.tier);
      expect(SKIN_SSS.value).toBe(testCase.expected);
    });
  }
});
