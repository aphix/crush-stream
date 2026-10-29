import { afterAll, beforeAll, describe, expect, it } from "vitest";
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
    expect(requested.length, "fetches").toBe(0);
    expect(MATERIAL_DETAIL_READY.value, "switch").toBe(0);
    expect(MATERIAL_DETAIL.value.image, "stand-in").toBe(null);
  });

  it("when a finish tier is set, then the map is fetched once, bound to the shared uniform, and the switch comes on when it arrives", async () => {
    setConcreteDetailTier(true);
    expect(MATERIAL_DETAIL_READY.value, "off until the picture arrives").toBe(0);
    await mapLoaded();
    expect(requested.length, "fetches").toBe(1);
    expect(requested[0]!.endsWith("materials/concrete-detail.webp"), `url ${requested[0]}`).toBeTruthy();
    expect(MATERIAL_DETAIL.value.image, "the decoded picture").toBe(PICTURE);
    expect(MATERIAL_DETAIL_READY.value, "switch").toBe(1);
  });

  it("when the tier drops to one without the finish and returns, then the switch follows it and the map is not fetched again", () => {
    setConcreteDetailTier(false);
    expect(MATERIAL_DETAIL_READY.value, "off").toBe(0);
    setConcreteDetailTier(true);
    expect(MATERIAL_DETAIL_READY.value, "on again").toBe(1);
    expect(requested.length, "fetches").toBe(1);
  });
});
