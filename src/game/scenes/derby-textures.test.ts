import { describe, expect, it } from "vitest";
import * as THREE from "three";
import {
  GLASS_CELL_ALPHA,
  GLASS_STREAK_ALPHA,
  HAZARD_BAND_METRES,
  WALL_HEIGHT_METRES,
  makeBarrierTexture,
  makeConcreteWallTexture,
  makeCorrugatedTexture,
  makeGlassTexture,
  makePlankTexture,
  makeRubberTexture,
  makeTyreStackTexture,
} from "./derby-textures.ts";
import { pixelsOf } from "./derby-textures.test-util.ts";
import { firstMismatch } from "../kernel/compare-arrays.test-util.ts";

const BUILDERS = {
  plank: makePlankTexture,
  corrugated: makeCorrugatedTexture,
  tyre: makeTyreStackTexture,
  rubber: makeRubberTexture,
  wall: makeConcreteWallTexture,
  barrier: makeBarrierTexture,
  glass: makeGlassTexture,
} as const;

const built = new Map<keyof typeof BUILDERS, THREE.DataTexture>();
function textureOf(name: keyof typeof BUILDERS): THREE.DataTexture {
  const cached = built.get(name);
  if (cached) return cached;
  const texture = BUILDERS[name]();
  built.set(name, texture);
  return texture;
}

const CHANNELS = 4;
const OPAQUE = 255;
const BLUE_INDEX = 2;
const ALPHA_INDEX = 3;

function channelAt(texture: THREE.DataTexture, column: number, row: number, channel: number): number {
  return pixelsOf(texture)[(row * texture.image.width + column) * CHANNELS + channel];
}

function luminanceAt(texture: THREE.DataTexture, column: number, row: number): number {
  return (channelAt(texture, column, row, 0) + channelAt(texture, column, row, 1) + channelAt(texture, column, row, BLUE_INDEX)) / 3;
}

function rowMean(texture: THREE.DataTexture, row: number): number {
  let total = 0;
  for (let column = 0; column < texture.image.width; column++) total += luminanceAt(texture, column, row);
  return total / texture.image.width;
}

/** Mean luminance down a column over the rows `fromRow` up to (not including) `toRow`. */
function columnMean(texture: THREE.DataTexture, column: number, fromRow: number, toRow: number): number {
  let total = 0;
  for (let row = fromRow; row < toRow; row++) total += luminanceAt(texture, column, row);
  return total / (toRow - fromRow);
}

describe("given each procedural arena texture", () => {
  const shapeCases = [
    { it: "when the planks are built, then they are 256 x 256, repeating, opaque", builder: "plank", width: 256, height: 256, wrapS: THREE.RepeatWrapping, wrapT: THREE.RepeatWrapping, hasTranslucentTexel: false },
    { it: "when the corrugated metal is built, then it is 128 x 128, repeating, opaque", builder: "corrugated", width: 128, height: 128, wrapS: THREE.RepeatWrapping, wrapT: THREE.RepeatWrapping, hasTranslucentTexel: false },
    { it: "when the tyre stack is built, then it is 128 x 128, repeating, opaque", builder: "tyre", width: 128, height: 128, wrapS: THREE.RepeatWrapping, wrapT: THREE.RepeatWrapping, hasTranslucentTexel: false },
    { it: "when the rubber is built, then it is 64 x 64, repeating, opaque", builder: "rubber", width: 64, height: 64, wrapS: THREE.RepeatWrapping, wrapT: THREE.RepeatWrapping, hasTranslucentTexel: false },
    { it: "when the concrete wall is built, then it is 256 x 256, repeating along, clamped up, opaque", builder: "wall", width: 256, height: 256, wrapS: THREE.RepeatWrapping, wrapT: THREE.ClampToEdgeWrapping, hasTranslucentTexel: false },
    { it: "when the barrier is built, then it is 128 x 128, repeating, opaque", builder: "barrier", width: 128, height: 128, wrapS: THREE.RepeatWrapping, wrapT: THREE.RepeatWrapping, hasTranslucentTexel: false },
    { it: "when the glass is built, then it is 256 x 256, repeating along, clamped up, with translucent texels", builder: "glass", width: 256, height: 256, wrapS: THREE.RepeatWrapping, wrapT: THREE.ClampToEdgeWrapping, hasTranslucentTexel: true },
  ] as const;

  for (const testCase of shapeCases) {
    it(testCase.it, () => {
      const texture = textureOf(testCase.builder);
      let translucentTexels = 0;
      const pixels = pixelsOf(texture);
      for (let index = ALPHA_INDEX; index < pixels.length; index += CHANNELS) {
        if (pixels[index] < OPAQUE) translucentTexels++;
      }
      expect(texture.image.width, "width").toBe(testCase.width);
      expect(texture.image.height, "height").toBe(testCase.height);
      expect(texture.wrapS, "wrapS").toBe(testCase.wrapS);
      expect(texture.wrapT, "wrapT").toBe(testCase.wrapT);
      expect(texture.colorSpace, "colour space").toBe(THREE.SRGBColorSpace);
      expect(texture.generateMipmaps, "mipmaps").toBe(true);
      expect(translucentTexels > 0, "has translucent texels").toBe(testCase.hasTranslucentTexel);
    });
  }

  const determinismCases = [
    { it: "when the plank texture is built twice, then no texel differs", builder: "plank" },
    { it: "when the corrugated texture is built twice, then no texel differs", builder: "corrugated" },
    { it: "when the tyre texture is built twice, then no texel differs", builder: "tyre" },
    { it: "when the rubber texture is built twice, then no texel differs", builder: "rubber" },
    { it: "when the wall texture is built twice, then no texel differs", builder: "wall" },
    { it: "when the barrier texture is built twice, then no texel differs", builder: "barrier" },
    { it: "when the glass texture is built twice, then no texel differs", builder: "glass" },
  ] as const;

  for (const testCase of determinismCases) {
    it(testCase.it, () => {
      expect(firstMismatch(pixelsOf(textureOf(testCase.builder)), pixelsOf(BUILDERS[testCase.builder]())), "first mismatching byte").toBeUndefined();
    });
  }
});

describe("given the plank texture", () => {
  const plankCases = [
    { it: "when the first plank edge row meets its body row, then the gap is darker", gapRow: 0, bodyRow: 32 },
    { it: "when the second plank edge row meets its body row, then the gap is darker", gapRow: 64, bodyRow: 96 },
    { it: "when the third plank edge row meets its body row, then the gap is darker", gapRow: 128, bodyRow: 160 },
    { it: "when the fourth plank edge row meets its body row, then the gap is darker", gapRow: 192, bodyRow: 224 },
  ] as const;
  const GAP_BRIGHTNESS_SHARE = 0.5;

  for (const testCase of plankCases) {
    it(testCase.it, () => {
      const texture = textureOf("plank");
      expect(rowMean(texture, testCase.gapRow), "gap row mean luminance").toBeLessThan(rowMean(texture, testCase.bodyRow) * GAP_BRIGHTNESS_SHARE);
    });
  }
});

describe("given the corrugated metal texture", () => {
  const ribCases = [
    { it: "when the first rib crest meets the trough beside it, then the crest is brighter", crestColumn: 0, troughColumn: 13 },
    { it: "when the second rib crest meets the trough beside it, then the crest is brighter", crestColumn: 26, troughColumn: 38 },
    { it: "when the third rib crest meets the trough beside it, then the crest is brighter", crestColumn: 51, troughColumn: 64 },
    { it: "when the fourth rib crest meets the trough beside it, then the crest is brighter", crestColumn: 77, troughColumn: 90 },
    { it: "when the fifth rib crest meets the trough beside it, then the crest is brighter", crestColumn: 102, troughColumn: 115 },
  ] as const;

  for (const testCase of ribCases) {
    it(testCase.it, () => {
      const texture = textureOf("corrugated");
      const height = texture.image.height;
      expect(columnMean(texture, testCase.crestColumn, 0, height), "crest column mean over trough column mean").toBeGreaterThan(columnMean(texture, testCase.troughColumn, 0, height));
    });
  }
});

describe("given the corrugated metal texture with rust", () => {
  const RUST_RED_OVER_BLUE = 1.5;
  const PLAIN_METAL_RED = 228;
  const RUST_DARKER_THAN_PLAIN_SHARE = 0.75;
  it("when its texels are scanned, then rust streaks are present as brown texels darker than the plain metal", () => {
    const texture = textureOf("corrugated");
    let rustTexels = 0;
    let plainTexels = 0;
    for (let row = 0; row < texture.image.height; row++) {
      for (let column = 0; column < texture.image.width; column++) {
        const red = channelAt(texture, column, row, 0);
        const blue = channelAt(texture, column, row, BLUE_INDEX);
        if (red > blue * RUST_RED_OVER_BLUE && red < PLAIN_METAL_RED * RUST_DARKER_THAN_PLAIN_SHARE) rustTexels++;
        else if (red <= blue * RUST_RED_OVER_BLUE) plainTexels++;
      }
    }
    expect(rustTexels, "rust texels").toBeGreaterThan(0);
    expect(plainTexels, "plain metal texels outnumber rust texels").toBeGreaterThan(rustTexels);
  });
});

describe("given the tyre stack texture", () => {
  const TREAD_RING_OFFSET = 27;
  const SIDEWALL_OFFSET = 17;
  const tyreCases = [
    { it: "when the hole of a first-row tyre meets its tread ring, then the hole is darker", centreColumn: 32, centreRow: 32 },
    { it: "when the hole of a staggered second-row tyre meets its tread ring, then the hole is darker", centreColumn: 64, centreRow: 96 },
  ] as const;

  for (const testCase of tyreCases) {
    it(testCase.it, () => {
      const texture = textureOf("tyre");
      const hole = luminanceAt(texture, testCase.centreColumn, testCase.centreRow);
      const sidewall = luminanceAt(texture, testCase.centreColumn + SIDEWALL_OFFSET, testCase.centreRow);
      const treadRing = luminanceAt(texture, testCase.centreColumn + TREAD_RING_OFFSET, testCase.centreRow);
      expect(hole, "hole luminance under tread ring luminance").toBeLessThan(treadRing);
      expect(sidewall, "sidewall luminance under tread ring luminance").toBeLessThan(treadRing);
    });
  }
});

describe("given the tyre stack texture's finish", () => {
  const TYRE_CENTRE = 32;
  const TREAD_RADIUS = 27;
  const SIDEWALL_REACH = 12;
  const RING_STEPS = 360;
  const BLOCK_EDGE_RATIO = 1.6;
  const LEAST_BLOCK_EDGES = 40;
  const TREAD_RING_AT_ANGLE_ZERO = [
    [59, 32],
    [123, 32],
    [91, 96],
    [27, 96],
  ] as const;
  const LEAST_GREY_SPREAD = 10;

  it("when the tread ring is walked round one degree at a time, then neighbouring texels jump by 1.6x or more at least 40 times (tread blocks and grooves)", () => {
    const texture = textureOf("tyre");
    const ring = Array.from({ length: RING_STEPS }, (_, step) => {
      const angle = (step * 2 * Math.PI) / RING_STEPS;
      return luminanceAt(texture, TYRE_CENTRE + Math.round(TREAD_RADIUS * Math.cos(angle)), TYRE_CENTRE + Math.round(TREAD_RADIUS * Math.sin(angle)));
    });
    let edges = 0;
    for (let step = 0; step < RING_STEPS; step++) {
      const here = ring[step];
      const next = ring[(step + 1) % RING_STEPS];
      if (Math.max(here / next, next / here) >= BLOCK_EDGE_RATIO) edges++;
    }
    expect(edges, "block edges round the ring").toBeGreaterThanOrEqual(LEAST_BLOCK_EDGES);
  });

  it("when the sidewall's upper left meets its lower right, then the upper left is lighter (dusty highlight)", () => {
    const texture = textureOf("tyre");
    const upperLeft = luminanceAt(texture, TYRE_CENTRE - SIDEWALL_REACH, TYRE_CENTRE + SIDEWALL_REACH);
    const lowerRight = luminanceAt(texture, TYRE_CENTRE + SIDEWALL_REACH, TYRE_CENTRE - SIDEWALL_REACH);
    expect(upperLeft, "upper-left sidewall luminance over lower-right").toBeGreaterThan(lowerRight * 1.4);
  });

  it("when four tyres of the tile are read at the same point of their tread, then their greys differ by 10 levels or more", () => {
    const texture = textureOf("tyre");
    const greys = TREAD_RING_AT_ANGLE_ZERO.map(([column, row]) => luminanceAt(texture, column, row));
    expect(Math.max(...greys) - Math.min(...greys), "spread of the four greys (levels)").toBeGreaterThanOrEqual(LEAST_GREY_SPREAD);
  });

  it("when the darkest texel is found, then it is the gap between tyres and darker than a tyre's hole", () => {
    const texture = textureOf("tyre");
    let darkest = Infinity;
    for (let row = 0; row < texture.image.height; row++) {
      for (let column = 0; column < texture.image.width; column++) darkest = Math.min(darkest, luminanceAt(texture, column, row));
    }
    expect(darkest, "darkest texel under the hole of the tyre at (32, 32)").toBeLessThan(luminanceAt(texture, TYRE_CENTRE, TYRE_CENTRE));
  });
});

describe("given the rubber texture", () => {
  const STUD_CENTRES = [8, 24, 40, 56];
  const BETWEEN_STUDS = [16, 32, 48];
  const EDGE_COLUMN = 0;
  const PLAIN_COLUMN = 16;

  function meanAt(texture: THREE.DataTexture, positions: number[]): number {
    let total = 0;
    for (const column of positions) {
      for (const row of positions) total += luminanceAt(texture, column, row);
    }
    return total / (positions.length * positions.length);
  }

  it("when stud centres meet the rubber between them, then the studs are lighter on average", () => {
    const texture = textureOf("rubber");
    expect(meanAt(texture, STUD_CENTRES), "mean stud luminance over mean plain luminance").toBeGreaterThan(meanAt(texture, BETWEEN_STUDS));
  });

  it("when the edge band column meets a plain column, then the edge band is lighter on average", () => {
    const texture = textureOf("rubber");
    expect(columnMean(texture, EDGE_COLUMN, 0, texture.image.height), "edge column mean over plain column mean").toBeGreaterThan(columnMean(texture, PLAIN_COLUMN, 0, texture.image.height));
  });
});

describe("given the concrete wall texture", () => {
  const rowAt = (metres: number) => Math.floor((metres / WALL_HEIGHT_METRES) * 256);
  const SEAM_BRIGHTNESS_SHARE = 0.8;
  const hazardCases = [
    { it: "when the very top row is read, then it is all hazard stripes", metres: 3.45, expectedHazard: true },
    { it: "when a row mid-band is read, then it is all hazard stripes", metres: 3.0, expectedHazard: true },
    { it: "when the lowest band row (0.6 m down) is read, then it is all hazard stripes", metres: 3.5 - HAZARD_BAND_METRES + 0.02, expectedHazard: true },
    { it: "when the row just below the band is read, then it is plain concrete", metres: 3.5 - HAZARD_BAND_METRES - 0.02, expectedHazard: false },
    { it: "when a mid-wall row is read, then it is plain concrete", metres: 2.0, expectedHazard: false },
    { it: "when a row near the foot is read, then it is plain concrete", metres: 0.2, expectedHazard: false },
  ] as const;

  for (const testCase of hazardCases) {
    it(testCase.it, () => {
      const texture = textureOf("wall");
      const row = rowAt(testCase.metres);
      let yellow = 0;
      let black = 0;
      let concrete = 0;
      for (let column = 0; column < texture.image.width; column++) {
        const red = channelAt(texture, column, row, 0);
        const green = channelAt(texture, column, row, 1);
        const blue = channelAt(texture, column, row, BLUE_INDEX);
        if (red > 200 && green > 150 && blue < 80) yellow++;
        else if (Math.max(red, green, blue) < 60) black++;
        else concrete++;
      }
      expect(yellow > 0, "has yellow stripe texels").toBe(testCase.expectedHazard);
      expect(black > 0, "has black stripe texels").toBe(testCase.expectedHazard);
      expect(concrete > 0, "has concrete texels").toBe(!testCase.expectedHazard);
    });
  }

  it("when the panel seam column meets the middle of the panel, then the seam is darker", () => {
    const texture = textureOf("wall");
    const concreteRows = rowAt(3.5 - HAZARD_BAND_METRES);
    expect(columnMean(texture, 0, 0, concreteRows), "seam column mean over panel column mean").toBeLessThan(columnMean(texture, 128, 0, concreteRows) * SEAM_BRIGHTNESS_SHARE);
  });
});

describe("given the barrier texture", () => {
  const BASE_ROW = 3;
  const BODY_ROW = 60;
  const SHOULDER_ROW = 84;
  const BELOW_SHOULDER_ROW = 76;
  const SEAM_COLUMN = 0;
  const PANEL_COLUMN = 64;
  it("when the base, the shoulder and the seam meet the body, then the base is darker, the shoulder lighter, the seam darker", () => {
    const texture = textureOf("barrier");
    expect(rowMean(texture, BASE_ROW), "base row mean under body row mean").toBeLessThan(rowMean(texture, BODY_ROW));
    expect(rowMean(texture, SHOULDER_ROW), "shoulder row mean over body row mean").toBeGreaterThan(rowMean(texture, BELOW_SHOULDER_ROW));
    expect(columnMean(texture, SEAM_COLUMN, 0, texture.image.height), "seam column mean under panel column mean").toBeLessThan(columnMean(texture, PANEL_COLUMN, 0, texture.image.height));
  });
});

describe("given the glass texture", () => {
  const MULLION_COLUMN = 0;
  const MULLION_EDGE_COLUMN = 255;
  const CELL_COLUMN = 128;
  const CELL_ROW = 40;
  const TRANSOM_ROW = 84;
  const glassCases = [
    { it: "when a texel inside a cell is read, then it is translucent at the cell alpha", column: CELL_COLUMN, row: CELL_ROW, expectedAlpha: GLASS_CELL_ALPHA, expectedOpaque: false },
    { it: "when a texel on the mullion is read, then it is opaque", column: MULLION_COLUMN, row: CELL_ROW, expectedAlpha: OPAQUE, expectedOpaque: true },
    { it: "when a texel on the mullion's other edge is read, then it is opaque", column: MULLION_EDGE_COLUMN, row: CELL_ROW, expectedAlpha: OPAQUE, expectedOpaque: true },
    { it: "when a texel on a transom is read, then it is opaque", column: CELL_COLUMN, row: TRANSOM_ROW, expectedAlpha: OPAQUE, expectedOpaque: true },
  ] as const;

  for (const testCase of glassCases) {
    it(testCase.it, () => {
      const alpha = channelAt(textureOf("glass"), testCase.column, testCase.row, ALPHA_INDEX);
      expect(alpha, "alpha").toBe(testCase.expectedAlpha);
      expect(alpha === OPAQUE, "is opaque").toBe(testCase.expectedOpaque);
    });
  }

  it("when the frame is measured, then a mullion is 0.12 m of a 3 m panel wide and a transom recurs every 2.8 m of 8.5 m", () => {
    const texture = textureOf("glass");
    const MULLION_TEXELS = { least: 10, most: 11 };
    const EXPECTED_TRANSOMS = 4;
    let opaqueColumns = 0;
    for (let column = 0; column < texture.image.width; column++) {
      if (channelAt(texture, column, CELL_ROW, ALPHA_INDEX) === OPAQUE) opaqueColumns++;
    }
    let transomRuns = 0;
    for (let row = 0; row < texture.image.height; row++) {
      const opaque = channelAt(texture, CELL_COLUMN, row, ALPHA_INDEX) === OPAQUE;
      const previousOpaque = row > 0 && channelAt(texture, CELL_COLUMN, row - 1, ALPHA_INDEX) === OPAQUE;
      if (opaque && !previousOpaque) transomRuns++;
    }
    expect(opaqueColumns >= MULLION_TEXELS.least && opaqueColumns <= MULLION_TEXELS.most, "opaque columns of a cell row").toBeTruthy();
    expect(transomRuns, "transom runs in a cell column").toBe(EXPECTED_TRANSOMS);
  });

  it("when the interior alphas are scanned, then the reflection streak lifts the strongest one to the streak alpha", () => {
    const texture = textureOf("glass");
    let strongestInterior = 0;
    const pixels = pixelsOf(texture);
    for (let index = ALPHA_INDEX; index < pixels.length; index += CHANNELS) {
      const alpha = pixels[index];
      if (alpha < OPAQUE && alpha > strongestInterior) strongestInterior = alpha;
    }
    expect(strongestInterior, "strongest interior alpha").toBe(GLASS_STREAK_ALPHA);
  });
});
