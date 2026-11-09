import { createCanvas, loadImage } from "@napi-rs/canvas";
import { describe, expect, it } from "vitest";
import { downPlane, heightOf, ledgeOf, roughnessOf } from "./pack-window-lib.mjs";

/** A layer's edge in the albedo strip, and the glow strip's (its layers are half the size). */
const LAYER = 256;
const GLOW_LAYER = 128;
/** The DC style's storey layer: an old style used as a fixture, so the relief derivation is proved on real art that ships no height strip. */
const STOREY_LAYER = 1;
const WINDOW_GLOW_MIN = 128;

/** A strip's rows [layer * size, (layer + 1) * size) as RGBA bytes. */
async function stripLayer(file, size, layer) {
  const image = await loadImage(new URL(`../public/facades/${file}`, import.meta.url).pathname);
  const canvas = createCanvas(size, size);
  canvas.getContext("2d").drawImage(image, 0, layer * size, size, size, 0, 0, size, size);
  return canvas.getContext("2d").getImageData(0, 0, size, size).data;
}

/** The storey layer's colours (floats 0..255, three a texel) and its window mask (0/1, LAYER square) from the shipped DC strips. */
async function storeyFixture() {
  const colours = await stripLayer("dc-albedo.webp", LAYER, STOREY_LAYER);
  const glow = await stripLayer("dc-glow.webp", GLOW_LAYER, STOREY_LAYER);
  const rgb = new Float32Array(LAYER * LAYER * 3);
  for (let i = 0; i < LAYER * LAYER; i++) for (let c = 0; c < 3; c++) rgb[i * 3 + c] = colours[i * 4 + c];
  const mask = new Uint8Array(LAYER * LAYER);
  for (let y = 0; y < LAYER; y++) for (let x = 0; x < LAYER; x++) mask[y * LAYER + x] = glow[((y >> 1) * GLOW_LAYER + (x >> 1)) * 4] >= WINDOW_GLOW_MIN ? 1 : 0;
  return { rgb, mask };
}

const mean = (plane, test) => {
  let sum = 0;
  let count = 0;
  for (let i = 0; i < plane.length; i++) {
    if (!test(i)) continue;
    sum += plane[i];
    count++;
  }
  return { mean: sum / count, count };
};

describe("given the storey layer of the DC style and its window mask", () => {
  // mutation: in pack-window-lib.mjs set `const RECESS = 0.55;` to `0`
  it("when its height is derived, then the windows lie below the wall and the sills below them stand proud of it, all within 0..1", async () => {
    const { rgb, mask } = await storeyFixture();
    const sill = ledgeOf(mask, LAYER, 6, 2);
    const height = heightOf(rgb, mask, LAYER);
    for (const value of height) expect(value >= 0 && value <= 1, `height ${value}`).toBe(true);
    const glass = mean(height, (i) => mask[i] === 1 && sill[i] === 0);
    const wall = mean(height, (i) => mask[i] === 0 && sill[i] === 0);
    const ledge = mean(height, (i) => sill[i] === 1);
    expect(glass.count, "window texels").toBeGreaterThan(1000);
    expect(ledge.count, "sill texels").toBeGreaterThan(100);
    expect(glass.mean, `windows ${glass.mean.toFixed(2)} below the wall ${wall.mean.toFixed(2)}`).toBeLessThan(wall.mean - 0.3);
    expect(ledge.mean, `sills ${ledge.mean.toFixed(2)} above the wall ${wall.mean.toFixed(2)}`).toBeGreaterThan(wall.mean + 0.08);
  });

  // mutation: in pack-window-lib.mjs set `const GLASS_ROUGHNESS = 0.1;` to `0.9`
  it("when its roughness is derived, then glass is shiny, a wet sill is between, and the wall is rough", async () => {
    const { rgb, mask } = await storeyFixture();
    const sill = ledgeOf(mask, LAYER, 6, 2);
    const rough = roughnessOf(rgb, mask, LAYER);
    const glass = mean(rough, (i) => mask[i] === 1 && sill[i] === 0).mean;
    const wall = mean(rough, (i) => mask[i] === 0 && sill[i] === 0).mean;
    const ledge = mean(rough, (i) => sill[i] === 1).mean;
    expect(glass, `glass ${glass.toFixed(2)}`).toBeLessThan(0.25);
    expect(wall, `wall ${wall.toFixed(2)}`).toBeGreaterThan(0.7);
    expect(ledge, `sill ${ledge.toFixed(2)}`).toBeGreaterThan(glass + 0.1);
    expect(ledge, `sill ${ledge.toFixed(2)}`).toBeLessThan(wall - 0.1);
  });
});

describe("given a plane of 0..1", () => {
  it("when it is brought down by 2, then each texel is the average of its 2 x 2 block, scaled to 0..255", () => {
    const plane = new Float32Array(16);
    plane.set([1, 1, 0, 0, 1, 0, 0, 0], 0);
    const down = downPlane(plane, 4, 2);
    expect(Array.from(down)).toEqual([0.75 * 255, 0, 0, 0]);
  });
});
