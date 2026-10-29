import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setImmediate as yieldToLoop } from "node:timers/promises";
import "../kernel/rapier-node.test-util.ts";
import { MATERIAL_DETAIL, MATERIAL_DETAIL_READY } from "../vehicle/material-class.ts";
import type { CrashEngine } from "./engine.ts";
import { bootEngine, stubBrowser } from "./engine-headless.test-util.ts";
import { servePublic } from "./page-files.test-util.ts";
import { PageWorker } from "./page-worker.test-util.ts";

const DETAIL_FILE = "materials/concrete-detail.webp";
const PICTURE = { width: 512, height: 512, close() {} };
/** Resolves when the map's (stubbed) decode is asked for: everything after it is microtasks, drained by one loop turn. */
let decoded: () => void = () => {};
const decodeAsked = new Promise<void>((resolve) => (decoded = resolve));

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
  createImageBitmap: async () => {
    decoded();
    return PICTURE;
  },
});

/** The map's load: its decode is asked for, then the rest of the chain (three's loader, the texture) settles within one loop turn. */
async function mapLoaded(): Promise<void> {
  await decodeAsked;
  await yieldToLoop();
}

describe("given the engine's FX tiers and the worn-concrete detail map", () => {
  let engine: CrashEngine;
  beforeAll(async () => {
    engine = await bootEngine();
  });
  afterAll(() => engine.dispose());

  it("when the engine runs on the plain tiers, then the map is never fetched and the detail stays off", () => {
    for (const tier of ["off", "minimal", "low"] as const) {
      engine["cine"].setTier(tier);
      expect(MATERIAL_DETAIL_READY.value, `${tier} switch`).toBe(0);
    }
    expect(detailRequests.length, "fetches").toBe(0);
    expect(MATERIAL_DETAIL.value.image, "stand-in").toBe(null);
  });

  it("when the tier becomes high, then the map is fetched once and the detail comes on, and off again on low", async () => {
    engine["cine"].setTier("high");
    await mapLoaded();
    expect(MATERIAL_DETAIL_READY.value, "high switch").toBe(1);
    expect(detailRequests.length, "fetches").toBe(1);
    engine["cine"].setTier("low");
    expect(MATERIAL_DETAIL_READY.value, "low switch").toBe(0);
    engine["cine"].setTier("high");
    expect(MATERIAL_DETAIL_READY.value, "high again").toBe(1);
    expect(detailRequests.length, "fetches after the return").toBe(1);
  });
});
