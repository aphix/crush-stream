import { describe, expect, it } from "vitest";
import { DECAL_FACE_AT, DECAL_FLAT, DECAL_H, DECAL_HALF_X, DECAL_HALF_Z, DECAL_NO_PAINT, DECAL_RAISE_STEP, DECAL_W, DECAL_Y, decalMap, FABRIC, fabricTexels } from "./dummy-cloth.ts";
import type { Decal } from "./dummy-rig.ts";

/** The fabric tiles' layout: square RGBA tiles, a fabric a channel, four to a layer; every fabric before NONE has a tile. */
const RGBA = 4;
const FABRIC_LAYERS = Math.ceil(FABRIC.NONE / RGBA);
/** A decal texel's side (m): the decal window's height over its rows. */
const DECAL_TEXEL = (DECAL_Y[1] - DECAL_Y[0]) / DECAL_H;

const fabricCases = [
  { it: "when skin's tile is read across its wrap, then the step from its last column or row to its first is no bigger than the largest step inside it", fabric: "SKIN" },
  { it: "when denim's tile is read across its wrap, then the step from its last column or row to its first is no bigger than the largest step inside it", fabric: "DENIM" },
  { it: "when jersey's tile is read across its wrap, then the step from its last column or row to its first is no bigger than the largest step inside it", fabric: "JERSEY" },
  { it: "when canvas's tile is read across its wrap, then the step from its last column or row to its first is no bigger than the largest step inside it", fabric: "CANVAS" },
  { it: "when leather's tile is read across its wrap, then the step from its last column or row to its first is no bigger than the largest step inside it", fabric: "LEATHER" },
  { it: "when wool's tile is read across its wrap, then the step from its last column or row to its first is no bigger than the largest step inside it", fabric: "WOOL" },
  { it: "when cotton's tile is read across its wrap, then the step from its last column or row to its first is no bigger than the largest step inside it", fabric: "COTTON" },
  { it: "when twill's tile is read across its wrap, then the step from its last column or row to its first is no bigger than the largest step inside it", fabric: "TWILL" },
  { it: "when hair's tile is read across its wrap, then the step from its last column or row to its first is no bigger than the largest step inside it", fabric: "HAIR" },
] as const;

describe("given the fabric tiles", () => {
  const texels = fabricTexels();
  const tile = Math.sqrt(texels.length / (FABRIC_LAYERS * RGBA));
  for (const testCase of fabricCases) {
    it(testCase.it, () => {
      const fabric = FABRIC[testCase.fabric];
      const height = (i: number, j: number) => texels[(((fabric >> 2) * tile + j) * tile + i) * RGBA + (fabric & 3)]!;
      let [inside, wrap] = [0, 0];
      for (let j = 0; j < tile; j++) {
        for (let i = 0; i < tile; i++) {
          const [right, down] = [Math.abs(height((i + 1) % tile, j) - height(i, j)), Math.abs(height(i, (j + 1) % tile) - height(i, j))];
          inside = Math.max(inside, i + 1 < tile ? right : 0, j + 1 < tile ? down : 0);
          wrap = Math.max(wrap, i + 1 < tile ? 0 : right, j + 1 < tile ? 0 : down);
        }
      }
      expect(inside, "the tile has relief").toBeGreaterThan(0);
      expect(wrap, `the wrap steps ${wrap}, the largest step inside is ${inside}`).toBeLessThanOrEqual(inside);
    });
  }
});

const FILLED: Decal = { face: "+z", x0: 0.05, x1: 0.11, y0: 1.0, y1: 1.06, round: 0, edge: 0, raise: 0.001, shade: 0.5, paint: -1, taper: 1 };
const BORDER: Decal = { face: "-x", x0: -0.04, x1: 0.04, y0: 0.6, y1: 0.7, round: 0, edge: 0.006, raise: 0, shade: 1, paint: 7, taper: 1 };
/** How far (m) outside a decal a texel is left alone; the border's band holds a texel this far in from its outline. */
const OUTSIDE = 0.02;
const IN_BAND = 0.0025;

/** The RGBA of layer `layer`'s texel at (across, y) m on `face`. */
function texelAt(data: Uint8Array, layer: number, face: Decal["face"], across: number, y: number): number[] {
  const half = face === "+x" || face === "-x" ? DECAL_HALF_Z : DECAL_HALF_X;
  const [column, row] = [Math.floor((across + half) / DECAL_TEXEL), Math.floor((y - DECAL_Y[0]) / DECAL_TEXEL)];
  const at = (layer * DECAL_W * DECAL_H + row * DECAL_W + DECAL_FACE_AT[face] + column) * RGBA;
  return Array.from(data.subarray(at, at + RGBA));
}

describe("given an outfit's decals baked into the decal layers", () => {
  const data = decalMap([[FILLED], [BORDER]]).image.data as Uint8Array;
  const [middleX, middleY] = [(FILLED.x0 + FILLED.x1) / 2, (FILLED.y0 + FILLED.y1) / 2];
  const FLAT = [DECAL_FLAT, DECAL_FLAT, DECAL_NO_PAINT, 0].join(",");

  it("when a filled rect on the front is read, then its middle carries its shade and raise and no paint, a texel past it and the other layer's same texel are flat", () => {
    const [red, green, blue] = texelAt(data, 0, "+z", middleX, middleY);
    expect(red, "shade").toBe(Math.round(DECAL_FLAT * FILLED.shade));
    expect(green, "raise").toBe(Math.round(DECAL_FLAT + FILLED.raise / DECAL_RAISE_STEP));
    expect(blue, "no paint").toBe(DECAL_NO_PAINT);
    expect(texelAt(data, 0, "+z", FILLED.x1 + OUTSIDE, middleY).join(","), "outside the rect").toBe(FLAT);
    expect(texelAt(data, 1, "+z", middleX, middleY).join(","), "the other layer").toBe(FLAT);
  });

  it("when a painted border on his right side is read, then its middle has no cover and no relief, and its band carries the painted role at full cover on that side's columns", () => {
    const middle = texelAt(data, 1, "-x", (BORDER.x0 + BORDER.x1) / 2, (BORDER.y0 + BORDER.y1) / 2);
    expect(middle[0], "middle shade").toBe(DECAL_FLAT);
    expect(middle[1], "middle raise").toBe(DECAL_FLAT);
    expect(middle[3], "middle cover").toBe(0);
    const band = texelAt(data, 1, "-x", BORDER.x0 + IN_BAND, (BORDER.y0 + BORDER.y1) / 2);
    expect(band[2], "band paint").toBe(BORDER.paint);
    expect(band[3], "band cover").toBe(255);
    expect(texelAt(data, 1, "+z", BORDER.x0 + IN_BAND, (BORDER.y0 + BORDER.y1) / 2).join(","), "the front's same texel").toBe(FLAT);
  });
});
