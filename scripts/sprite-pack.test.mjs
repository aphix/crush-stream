import { createCanvas, loadImage } from "@napi-rs/canvas";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { pack } from "./sprite-pack.mjs";

/** Texels of clear border the plan promises round every cell's content (the pad that keeps mips from bleeding). */
const REQUIRED_CLEAR_TEXELS = 8;
/** The side of a tile layer at the full tier. */
const TILE_SIDE = 256;
const WEBP_OUTPUTS = ["albedo", "albedoHalf", "normal", "tilesAlbedo", "tilesAlbedoHalf", "tilesNormal"];

/** Decodes a webp to straight RGBA bytes through ffmpeg: the canvas premultiplies, which would hide the colour under alpha 0. */
function decodeStraight(webp) {
  const result = spawnSync("ffmpeg", ["-v", "error", "-i", "pipe:0", "-f", "rawvideo", "-pix_fmt", "rgba", "pipe:1"], { input: webp, maxBuffer: 1 << 26 });
  if (result.status !== 0) throw new Error(`ffmpeg could not decode the webp: ${result.error ?? result.stderr}`);
  return result.stdout;
}

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

  // mutation: sed -i 's/const BLEED_PASSES = 8;/const BLEED_PASSES = 0;/' scripts/sprite-pack-pixels.mjs
  it("when the albedo atlas is decoded with its colour kept, then a clear texel near the disc's edge carries the disc's red, not grey or black", async () => {
    const packed = await pack("test", [row("test-disc", "card", [1, 1], discPicture())]);
    const rgba = decodeStraight(packed.albedo);
    const content = contentTexels(packed.layout, "test-disc");
    const rowStart = (content.top + (content.height >> 2)) * packed.layout.width;
    const alphaAt = (x) => rgba[(rowStart + x) * 4 + 3];
    let edge = content.left;
    while (edge < content.left + content.width && alphaAt(edge) === 0) edge++;
    expect(edge - content.left, "clear texels between the content's left side and the disc").toBeGreaterThan(3);
    const outside = (rowStart + edge - 3) * 4;
    expect(rgba[outside + 3], "alpha of a clear texel two short of the disc's edge").toBe(0);
    expect(rgba[outside] - rgba[outside + 1], "red minus green of that clear texel (grey without the bleed)").toBeGreaterThan(40);
  });
});

describe("given a card and a tile packed together", () => {
  const rows = () => [row("test-disc", "card", [1, 1], discPicture()), row("test-floor", "tile", [2, 1], plainPicture("#2060c0", 192, 128))];

  // mutation: sed -i 's/"-q:v", String(quality),/"-q:v", String(quality - Math.floor(Math.random() * 20)),/' scripts/sprite-pack-pixels.mjs
  it("when they are packed twice, then every output is byte for byte the same", async () => {
    const first = await pack("test", rows());
    const second = await pack("test", rows());
    for (const output of WEBP_OUTPUTS) {
      expect(first[output].length, `${output} bytes`).toBeGreaterThan(0);
      expect(first[output].equals(second[output]), `${output} identical across runs`).toBe(true);
    }
    expect(second.worldJsonText === first.worldJsonText, "world data text identical across runs").toBe(true);
    expect(second.atlasJsonText === first.atlasJsonText, "atlas data text identical across runs").toBe(true);
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

describe("given a card, a box with a depth and a tile, listed in that order", () => {
  const rows = () => [
    row("test-disc", "card", [1, 1], discPicture()),
    { ...row("test-crate", "box", [1.2, 0.9], plainPicture("#a06020", 120, 90)), depth: 0.9 },
    row("test-floor", "tile", [2, 1], plainPicture("#2060c0", 192, 128)),
  ];

  // mutation: sed -i 's/return typeof row.depth === "number" ? { ...asset, depth: row.depth } : asset;/return asset;/' scripts/sprite-pack.mjs
  it("when they are packed, then the world rows follow the manifest order with their collider share, the box's depth and no family", async () => {
    const { worldJson } = await pack("test", rows());
    expect(worldJson, "world rows").toHaveLength(3);
    expect(worldJson.map((asset) => asset.id).join(" "), "world row order").toBe("test-disc test-crate test-floor");
    const [disc, crate, floor] = worldJson;
    expect(disc.family, "the card row's family field").toBeUndefined();
    expect(disc.depth, "the card row's depth").toBeUndefined();
    expect(crate.depth, "the box row's depth").toBe(0.9);
    expect(crate.core, "the box row's collider share").toBe(1);
    expect(disc.core, "the disc row's collider share").toBeGreaterThan(0.15);
    expect(floor.core, "the tile row's collider share").toBe(1);
  });

  // mutation: sed -i 's/const cells = layout.cells.map(({ rect, tint, layer }) => (layer === undefined ? { rect, tint } : { rect, tint, layer }));/const cells = layout.cells;/' scripts/sprite-pack.mjs
  it("when they are packed, then the atlas cells run parallel to the world rows with no id and the tile's layer", async () => {
    const { atlasJson, worldJson } = await pack("test", rows());
    expect(atlasJson.cells, "atlas cells beside the world rows").toHaveLength(worldJson.length);
    for (const [index, cell] of atlasJson.cells.entries()) expect(cell.id, `cell ${index} id`).toBeUndefined();
    expect(atlasJson.cells[0].layer, "the card cell's layer").toBeUndefined();
    expect(atlasJson.cells[2].layer, "the tile cell's layer").toBe(0);
    expect(atlasJson.cells[2].rect.join(" "), "the tile cell's rect").toBe("0 0 1 1");
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
    expect(packed.atlasJson.tiles, "atlas data layer count").toBe(2);
    expect(packed.atlasJson.tileSize, "atlas data tile size").toBe(TILE_SIDE);
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
