import { createCanvas, loadImage } from "@napi-rs/canvas";
import { describe, expect, it } from "vitest";
import { pack } from "./sprite-pack.mjs";

/** Texels of clear border the plan promises round every cell's content (the pad that keeps mips from bleeding). */
const REQUIRED_CLEAR_TEXELS = 8;
/** The side of a tile layer at the full tier. */
const TILE_SIDE = 256;
const WEBP_OUTPUTS = ["albedo", "albedoHalf", "normal", "tilesAlbedo", "tilesAlbedoHalf", "tilesNormal"];

function discPicture() {
  const canvas = createCanvas(96, 96);
  const context = canvas.getContext("2d");
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, 96, 96);
  context.fillStyle = "#ff0000";
  context.beginPath();
  context.arc(48, 48, 30, 0, Math.PI * 2);
  context.fill();
  return canvas.toBuffer("image/png");
}

function plainPicture(colour, width, height) {
  const canvas = createCanvas(width, height);
  const context = canvas.getContext("2d");
  context.fillStyle = colour;
  context.fillRect(0, 0, width, height);
  return canvas.toBuffer("image/png");
}

const row = (id, kind, size, image) => ({ id, kind, size, body: "poof", biomes: ["park"], rule: "verge", weight: 0.5, source: `${id}.png`, prompt: "", image });

async function decodeWebp(webp) {
  const picture = await loadImage(webp);
  const canvas = createCanvas(picture.width, picture.height);
  const context = canvas.getContext("2d");
  context.drawImage(picture, 0, 0);
  return { width: picture.width, height: picture.height, data: context.getImageData(0, 0, picture.width, picture.height).data };
}

const texel = (decoded, x, y) => Array.from(decoded.data.slice((y * decoded.width + x) * 4, (y * decoded.width + x) * 4 + 4));

/** A cell's content rectangle in atlas texels. */
function contentTexels(layout, id) {
  const cell = layout.cells.find((candidate) => candidate.id === id);
  const [u, v, du, dv] = cell.rect;
  return { left: Math.round(u * layout.width), top: Math.round(v * layout.height), width: Math.round(du * layout.width), height: Math.round(dv * layout.height) };
}

describe("given a 96 px picture of a saturated red disc on a white background, packed as a card", () => {
  // mutation: sed -i 's/const BACKGROUND_SLACK = 22;/const BACKGROUND_SLACK = -400;/' scripts/sprite-pack-pixels.mjs
  it("when the albedo atlas is decoded, then the corners of the cell's content are clear and its centre is opaque", async () => {
    const packed = await pack("test", [row("test-disc", "card", [1, 1], discPicture())]);
    const atlas = await decodeWebp(packed.albedo);
    const content = contentTexels(packed.layout, "test-disc");
    const right = content.left + content.width - 1;
    const bottom = content.top + content.height - 1;
    const corners = [
      ["top left", content.left, content.top],
      ["top right", right, content.top],
      ["bottom left", content.left, bottom],
      ["bottom right", right, bottom],
    ];
    for (const [name, x, y] of corners) expect(texel(atlas, x, y)[3], `alpha at the content's ${name} corner`).toBe(0);
    const centre = texel(atlas, content.left + (content.width >> 1), content.top + (content.height >> 1));
    expect(centre[3], "alpha at the content's centre").toBe(255);
    expect(centre[0], "red at the content's centre").toBeGreaterThan(200);
    expect(centre[1], "green at the content's centre").toBeLessThan(60);
  });
});

describe("given a card and a tile packed together", () => {
  const rows = () => [row("test-disc", "card", [1, 1], discPicture()), row("test-floor", "tile", [2, 1], plainPicture("#2060c0", 192, 128))];

  // mutation: sed -i 's/return canvas.toBuffer("image\/webp", quality);/return canvas.toBuffer("image\/webp", quality - Math.floor(Math.random() * 20));/' scripts/sprite-pack-pixels.mjs
  it("when they are packed twice, then every output is byte for byte the same", async () => {
    const first = await pack("test", rows());
    const second = await pack("test", rows());
    for (const output of WEBP_OUTPUTS) {
      expect(first[output].length, `${output} bytes`).toBeGreaterThan(0);
      expect(first[output].equals(second[output]), `${output} identical across runs`).toBe(true);
    }
    expect(second.worldTs === first.worldTs, "world file text identical across runs").toBe(true);
    expect(second.atlasTs === first.atlasTs, "atlas file text identical across runs").toBe(true);
  });
});

describe("given two cards of different sizes packed into one family", () => {
  // mutation: sed -i 's/const PAD = 8;/const PAD = 0;/' scripts/sprite-pack.mjs
  // mutation: sed -i 's/taken\[row \* columns + column\] === 1) return false;/taken[row * columns + column] === 2) return false;/' scripts/sprite-pack.mjs
  // mutation: sed -i 's/x += block.width) {/x += block.width \/ 2) {/' scripts/sprite-pack.mjs
  it("when the cells are listed, then each content keeps its pad clear inside its own block, no two blocks overlap, and each block sits aligned to its own size", async () => {
    const packed = await pack("test", [row("test-small", "card", [1, 1], discPicture()), row("test-wide", "card", [2, 0.5], discPicture())]);
    const { blocks } = packed.layout;
    expect(blocks, "blocks laid out").toHaveLength(2);
    for (const block of blocks) {
      const content = contentTexels(packed.layout, block.id);
      expect(content.left - block.x, `${block.id} clear texels on the left`).toBeGreaterThanOrEqual(REQUIRED_CLEAR_TEXELS);
      expect(content.top - block.y, `${block.id} clear texels above`).toBeGreaterThanOrEqual(REQUIRED_CLEAR_TEXELS);
      expect(block.x + block.width - (content.left + content.width), `${block.id} clear texels on the right`).toBeGreaterThanOrEqual(REQUIRED_CLEAR_TEXELS);
      expect(block.y + block.height - (content.top + content.height), `${block.id} clear texels below`).toBeGreaterThanOrEqual(REQUIRED_CLEAR_TEXELS);
      expect(block.x % block.width, `${block.id} left edge against its own width`).toBe(0);
      expect(block.y % block.height, `${block.id} top edge against its own height`).toBe(0);
    }
    const [first, second] = blocks;
    const apartAcross = first.x + first.width <= second.x || second.x + second.width <= first.x;
    const apartDown = first.y + first.height <= second.y || second.y + second.height <= first.y;
    expect(apartAcross || apartDown, "the two blocks are apart").toBe(true);
  });
});

describe("given two tile rows, one red and one blue", () => {
  const rows = () => [row("test-red", "tile", [2, 1], plainPicture("#c82828", 192, 128)), row("test-blue", "tile", [2, 1], plainPicture("#2828c8", 192, 128))];

  // mutation: sed -i 's/encodeWebp(strip, TILE_SIZE, stripHeight, WEBP_QUALITY_ALBEDO)/encodeWebp(strip, TILE_SIZE, stripHeight + 1, WEBP_QUALITY_ALBEDO)/' scripts/sprite-pack.mjs
  // mutation: sed -i 's/strip.set(entry.layerBytes, layer \* TILE_SIZE/strip.set(entry.layerBytes, 0 * TILE_SIZE/' scripts/sprite-pack.mjs
  it("when they are packed, then the tile strip is one layer wide and two layers tall with each layer in its own rows", async () => {
    const packed = await pack("test", rows());
    const strip = await decodeWebp(packed.tilesAlbedo);
    expect(strip.width, "strip width").toBe(TILE_SIDE);
    expect(strip.height, "strip height").toBe(2 * TILE_SIDE);
    const redLayer = texel(strip, TILE_SIDE >> 1, TILE_SIDE >> 1);
    const blueLayer = texel(strip, TILE_SIDE >> 1, TILE_SIDE + (TILE_SIDE >> 1));
    expect(redLayer[0] - redLayer[2], "red minus blue in the first layer").toBeGreaterThan(100);
    expect(blueLayer[2] - blueLayer[0], "blue minus red in the second layer").toBeGreaterThan(100);
    expect(packed.atlasTs, "atlas file layer count").toContain("tiles: 2,");
    expect(packed.atlasTs, "atlas file tile size").toContain(`tileSize: ${TILE_SIDE}`);
  });

  it("when they are packed, then the half-size albedo and the normal strips are half the strip each way", async () => {
    const packed = await pack("test", rows());
    for (const output of ["tilesAlbedoHalf", "tilesNormal"]) {
      const half = await decodeWebp(packed[output]);
      expect(half.width, `${output} width`).toBe(TILE_SIDE >> 1);
      expect(half.height, `${output} height`).toBe(TILE_SIDE);
    }
  });
});
