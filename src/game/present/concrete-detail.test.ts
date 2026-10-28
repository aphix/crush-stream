import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { setImmediate as yieldToLoop } from "node:timers/promises";
import { MATERIAL_DETAIL, MATERIAL_DETAIL_READY } from "../vehicle/material-class.ts";
import { setConcreteDetailTier } from "./concrete-detail.ts";

/** Event-loop turns the stubbed fetch and decode may take before a row calls the load stuck. */
const MAX_TURNS = 200;
const PICTURE = { width: 512, height: 512, close() {} };

const requested: string[] = [];
const realFetch = globalThis.fetch;
const realCreateImageBitmap = Reflect.get(globalThis, "createImageBitmap");

before(() => {
  Object.assign(globalThis, {
    fetch: async (url: string) => {
      requested.push(String(url));
      return { ok: true, status: 200, blob: async () => new Blob([]) };
    },
    createImageBitmap: async () => PICTURE,
  });
});

after(() => {
  Object.assign(globalThis, { fetch: realFetch, createImageBitmap: realCreateImageBitmap });
});

async function untilLoaded(): Promise<void> {
  for (let turn = 0; turn < MAX_TURNS && MATERIAL_DETAIL.value.image === null; turn++) await yieldToLoop();
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
    await untilLoaded();
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
