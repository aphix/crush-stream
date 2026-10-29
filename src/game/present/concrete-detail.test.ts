import { afterAll, beforeAll, describe, it } from "vitest";
import assert from "node:assert/strict";
import { setImmediate as yieldToLoop } from "node:timers/promises";
import { MATERIAL_DETAIL, MATERIAL_DETAIL_READY } from "../vehicle/material-class.ts";
import { setConcreteDetailTier } from "./concrete-detail.ts";

const PICTURE = { width: 512, height: 512, close() {} };
/** Resolves when the map's (stubbed) decode is asked for: everything after it is microtasks, drained by one loop turn. */
let decoded: () => void = () => {};
const decodeAsked = new Promise<void>((resolve) => (decoded = resolve));

const requested: string[] = [];
const realFetch = globalThis.fetch;
const realCreateImageBitmap = Reflect.get(globalThis, "createImageBitmap");

beforeAll(() => {
  Object.assign(globalThis, {
    fetch: async (url: string) => {
      requested.push(String(url));
      return { ok: true, status: 200, blob: async () => new Blob([]) };
    },
    createImageBitmap: async () => {
      decoded();
      return PICTURE;
    },
  });
});

afterAll(() => {
  Object.assign(globalThis, { fetch: realFetch, createImageBitmap: realCreateImageBitmap });
});

async function mapLoaded(): Promise<void> {
  await decodeAsked;
  await yieldToLoop();
}

describe("given the detail map's finish-tier switch", () => {
  it("when a tier without the finish is set, then nothing is fetched and the switch stays off", () => {
    setConcreteDetailTier(false);
    assert.equal(requested.length, 0, "fetches");
    assert.equal(MATERIAL_DETAIL_READY.value, 0, "switch");
    assert.equal(MATERIAL_DETAIL.value.image, null, "stand-in");
  });

  it("when a finish tier is set, then the map is fetched once, bound to the shared uniform, and the switch comes on when it arrives", async () => {
    setConcreteDetailTier(true);
    assert.equal(MATERIAL_DETAIL_READY.value, 0, "off until the picture arrives");
    await mapLoaded();
    assert.equal(requested.length, 1, "fetches");
    assert.ok(requested[0]!.endsWith("materials/concrete-detail.webp"), `url ${requested[0]}`);
    assert.equal(MATERIAL_DETAIL.value.image, PICTURE, "the decoded picture");
    assert.equal(MATERIAL_DETAIL_READY.value, 1, "switch");
  });

  it("when the tier drops to one without the finish and returns, then the switch follows it and the map is not fetched again", () => {
    setConcreteDetailTier(false);
    assert.equal(MATERIAL_DETAIL_READY.value, 0, "off");
    setConcreteDetailTier(true);
    assert.equal(MATERIAL_DETAIL_READY.value, 1, "on again");
    assert.equal(requested.length, 1, "fetches");
  });
});
