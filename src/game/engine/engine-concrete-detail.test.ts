import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { setImmediate as yieldToLoop } from "node:timers/promises";
import "../kernel/rapier-node.test-util.ts";
import { MATERIAL_DETAIL, MATERIAL_DETAIL_READY } from "../vehicle/material-class.ts";
import type { CrashEngine } from "./engine.ts";
import { bootEngine, stubBrowser } from "./engine-headless.test-util.ts";
import { servePublic } from "./page-files.test-util.ts";
import { PageWorker } from "./page-worker.test-util.ts";

/** Event-loop turns the map's stubbed decode may take before a row calls the load stuck. */
const MAX_TURNS = 500;
const DETAIL_FILE = "materials/concrete-detail.webp";
const PICTURE = { width: 512, height: 512, close() {} };

stubBrowser();
Object.assign(globalThis, { Worker: PageWorker });
servePublic();
const servedFetch = globalThis.fetch;
const detailRequests: string[] = [];
Object.assign(globalThis, {
  fetch: (input: string | { url: string }) => {
    const url = typeof input === "string" ? input : input.url;
    if (url.endsWith(DETAIL_FILE)) detailRequests.push(url);
    return Reflect.apply(servedFetch, undefined, [input]);
  },
  createImageBitmap: async () => PICTURE,
});

async function untilReady(on: number): Promise<void> {
  for (let turn = 0; turn < MAX_TURNS && MATERIAL_DETAIL_READY.value !== on; turn++) await yieldToLoop();
}

describe("given the engine's FX tiers and the worn-concrete detail map", () => {
  let engine: CrashEngine;
  before(async () => {
    engine = await bootEngine();
  });
  after(() => engine.dispose());

  it("when the engine runs on the plain tiers, then the map is never fetched and the detail stays off", () => {
    for (const tier of ["off", "minimal", "low"] as const) {
      engine["cine"].setTier(tier);
      assert.equal(MATERIAL_DETAIL_READY.value, 0, `${tier} switch`);
    }
    assert.equal(detailRequests.length, 0, "fetches");
    assert.equal(MATERIAL_DETAIL.value.image, null, "stand-in");
  });

  it("when the tier becomes high, then the map is fetched once and the detail comes on, and off again on low", async () => {
    engine["cine"].setTier("high");
    await untilReady(1);
    assert.equal(MATERIAL_DETAIL_READY.value, 1, "high switch");
    assert.equal(detailRequests.length, 1, "fetches");
    engine["cine"].setTier("low");
    assert.equal(MATERIAL_DETAIL_READY.value, 0, "low switch");
    engine["cine"].setTier("high");
    assert.equal(MATERIAL_DETAIL_READY.value, 1, "high again");
    assert.equal(detailRequests.length, 1, "fetches after the return");
  });
});
