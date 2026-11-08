/**
 * Packs scenery families (`<raw>/<family>/manifest.json` and its pictures) into `public/scenery/<family>-*.webp` and the family's two generated TS files:
 * `node scripts/sprite-pack.mjs <family>... [--raw <folder>]`. `pack` itself is pure; the pixel work is in `sprite-pack-pixels.mjs`.
 */
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { isMainModule } from "./with-app-env.mjs";
import {
  bottomSpanShare,
  centreSquare,
  decodeRgba,
  encodeWebp,
  halved,
  keyAndTrim,
  lumaTimesAlpha,
  meanOpaqueColour,
  normalTexels,
  opaqueImage,
  premultiplied,
  resample,
  toStraightBytes,
} from "./sprite-pack-pixels.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
/** Where the generation lanes leave their pictures and manifests, outside the repo (`SPRITE_RAW_DIR`, else `~/crash-wt/assets`). */
const DEFAULT_RAW_DIR = process.env.SPRITE_RAW_DIR ?? join(homedir(), "crash-wt/assets");
const OUTPUT_DIR = join(ROOT, "public/scenery");

/** Texels of clamp-replicated border round every cell's content, so bilinear and the first mips never read a neighbour's. */
const PAD = 8;
/** Block sides (texels): a power of two, so a block aligned to its own size shares no mip texel with its neighbours down to its own size. */
const BLOCK_SIZES = [32, 64, 128, 256, 512];
/** Atlas sizes tried in order: the texture budget allows no more than 1024x1024 a family. */
const ATLAS_SIZES = [
  [1024, 512],
  [1024, 1024],
];
/** Texel density at a shrink of 1: a 2 m prop is 192 texels, sharp enough from the car camera at the full tier. */
const PIXELS_PER_METRE = 96;
/** Longest content side: with its pad it must fit the largest block. */
const MAX_CONTENT_SIDE = 384;
/** Each failed packing multiplies every content target by this, down to MIN_SHRINK, before the atlas grows. */
const SHRINK_STEP = 0.85;
/** A target this share over a block's inside still takes that block (its content shrinks to fit): a power-of-two step is 2x the area, so a hair over must not pay it. */
const BLOCK_SNAP = 0.06;
/** The smallest density kept (of PIXELS_PER_METRE): under it a sprite is a smear, so a bigger atlas is the lesser harm. */
const MIN_SHRINK = 0.45;
/** Trimmed aspect and `size` aspect may differ by this share of the size's before a warning: the quad would stretch the sprite. */
const RATIO_TOLERANCE = 0.05;
/** Side of a tile layer at the full tier (the half tier is half). */
const TILE_SIZE = 256;
/** A tile's height (the normal's alpha) never falls under this: webp alpha is premultiplied on decode, which crushes the normal's colour where alpha nears 0. */
const TILE_HEIGHT_FLOOR = 32;
/** Webp qualities: albedo carries the picture; the normal tolerates more loss. */
const WEBP_QUALITY_ALBEDO = 90;
const WEBP_QUALITY_NORMAL = 85;
/** Normal strength (per-texel gradient of luminance times alpha) by kind: soft for foliage, grainy for ground decals, relief from lightness for box skins and tiles. */
const NORMAL_STRENGTH = { card: 1.5, cross: 1.5, decal: 2.5, box: 3, tile: 3 };
/** The flat tangent-space normal, and the alpha of an atlas normal (sprites carry no height). */
const FLAT_NORMAL = [128, 128, 255, 255];
/** Kinds whose white background is keyed to alpha; box skins and tiles are full-bleed. */
const KEYED_KINDS = ["card", "cross", "decal"];
/** Kinds drawn flat on the ground, whose collider spans their whole width. */
const FLAT_KINDS = ["decal", "tile"];
/** uv rects are written to this many decimals (a millionth of an atlas side). */
const RECT_PRECISION = 1e6;
/** Estimated GPU bytes a texel: RGBA8 with a mip chain (4/3). */
const GPU_BYTES_PER_TEXEL = (4 * 4) / 3;
const BYTES_PER_MEGABYTE = 1024 * 1024;
/** Budget (MB, estimated GPU) of a family at the full tier (albedo, normal and tiles) and at the half tier. */
const FULL_TIER_BUDGET_MB = 4.5;
const HALF_TIER_BUDGET_MB = 1;
/** Texel layout of the byte images: R, G, B (COLOUR_CHANNELS of them) then alpha at ALPHA_OFFSET, each 0..BYTE. */
const TEXEL = 4;
const COLOUR_CHANNELS = 3;
const ALPHA_OFFSET = 3;
const BYTE = 255;
const OUTPUT_SUFFIXES = {
  albedo: "albedo",
  albedoHalf: "albedo-half",
  normal: "normal",
  tilesAlbedo: "tiles-albedo",
  tilesAlbedoHalf: "tiles-albedo-half",
  tilesNormal: "tiles-normal",
};

/** Content-density multipliers tried at each atlas size, from 1 down to MIN_SHRINK. */
const SHRINK_LADDER = (() => {
  const ladder = [];
  for (let shrink = 1; shrink > MIN_SHRINK; shrink *= SHRINK_STEP) ladder.push(shrink);
  return [...ladder, MIN_SHRINK];
})();

const clamp = (value, low, high) => Math.min(high, Math.max(low, value));

/** The row's picture read: a sprite's premultiplied trimmed image, or a tile's layer bytes, with its tint and collider share. */
async function prepareRow(row) {
  const source = await decodeRgba(row.image);
  if (row.kind === "tile") {
    const square = centreSquare(opaqueImage(source));
    return { row, tint: meanOpaqueColour(square), core: 1, sourceSize: [source.width, source.height], layerBytes: toStraightBytes(resample(square, TILE_SIZE, TILE_SIZE)) };
  }
  const trimmed = KEYED_KINDS.includes(row.kind) ? keyAndTrim(source) : opaqueImage(source);
  const core = FLAT_KINDS.includes(row.kind) ? 1 : bottomSpanShare(trimmed);
  return { row, tint: meanOpaqueColour(trimmed), core, image: premultiplied(trimmed) };
}

const blockExtent = (extent) => BLOCK_SIZES.find((side) => side - 2 * PAD >= extent * (1 - BLOCK_SNAP));

/** The block (width, height) an entry takes at a density shrink: the smallest whose inside holds `size` at PIXELS_PER_METRE, the longest side capped. */
function blockFor(entry, shrink) {
  const [metresWide, metresHigh] = entry.row.size;
  const capped = Math.min(1, MAX_CONTENT_SIDE / (Math.max(metresWide, metresHigh) * PIXELS_PER_METRE));
  const texelsPerMetre = PIXELS_PER_METRE * capped * shrink;
  return { width: blockExtent(metresWide * texelsPerMetre), height: blockExtent(metresHigh * texelsPerMetre) };
}

function isFree(taken, columns, spot, unit) {
  for (let row = spot.y / unit; row < (spot.y + spot.height) / unit; row++) {
    for (let column = spot.x / unit; column < (spot.x + spot.width) / unit; column++) {
      if (taken[row * columns + column] === 1) return false;
    }
  }
  return true;
}

/** The first spot, scanning rows then columns on a grid of the block's own size, that is free; marks it taken. */
function takeSpot(taken, atlasWidth, atlasHeight, block) {
  const unit = BLOCK_SIZES[0];
  const columns = atlasWidth / unit;
  for (let y = 0; y + block.height <= atlasHeight; y += block.height) {
    for (let x = 0; x + block.width <= atlasWidth; x += block.width) {
      const spot = { x, y, width: block.width, height: block.height };
      if (!isFree(taken, columns, spot, unit)) continue;
      for (let row = y / unit; row < (y + block.height) / unit; row++) taken.fill(1, row * columns + x / unit, row * columns + (x + block.width) / unit);
      return spot;
    }
  }
  return undefined;
}

/** The blocks' spots (parallel to `blocks`), largest area first and manifest order within a size, or undefined when they do not fit. */
function placeBlocks(blocks, atlasWidth, atlasHeight) {
  const totalArea = blocks.reduce((sum, block) => sum + block.width * block.height, 0);
  if (totalArea > atlasWidth * atlasHeight) return undefined;
  const taken = new Uint8Array((atlasWidth / BLOCK_SIZES[0]) * (atlasHeight / BLOCK_SIZES[0]));
  const order = blocks.map((_, index) => index).sort((a, b) => blocks[b].width * blocks[b].height - blocks[a].width * blocks[a].height || a - b);
  const spots = new Array(blocks.length);
  for (const index of order) {
    spots[index] = takeSpot(taken, atlasWidth, atlasHeight, blocks[index]);
    if (spots[index] === undefined) return undefined;
  }
  return spots;
}

/** The smallest atlas, and within it the highest density, that holds every sprite's block. */
function layoutAtlas(family, sprites) {
  for (const [width, height] of ATLAS_SIZES) {
    for (const shrink of SHRINK_LADDER) {
      const spots = placeBlocks(sprites.map((entry) => blockFor(entry, shrink)), width, height);
      if (spots !== undefined) return { width, height, shrink, spots };
    }
  }
  throw new Error(`${family}: the sprites do not fit ${ATLAS_SIZES.at(-1).join("x")} at ${MIN_SHRINK} of the density`);
}

/** Where the entry's image sits inside its block (offsets from the block's corner): as large as the pad allows, aspect kept, centred. */
function contentRect(image, block) {
  const innerWidth = block.width - 2 * PAD;
  const innerHeight = block.height - 2 * PAD;
  const scale = Math.min(innerWidth / image.width, innerHeight / image.height);
  const width = clamp(Math.round(image.width * scale), 1, innerWidth);
  const height = clamp(Math.round(image.height * scale), 1, innerHeight);
  return { x: PAD + ((innerWidth - width) >> 1), y: PAD + ((innerHeight - height) >> 1), width, height };
}

/** Fills the block's whole area of the atlas from the content bytes, the texels outside the content clamped to its nearest border texel (colour and alpha). */
function paintBlock(atlas, atlasWidth, spot, content, bytes) {
  for (let y = 0; y < spot.height; y++) {
    const sourceRow = clamp(y - content.y, 0, content.height - 1) * content.width;
    for (let x = 0; x < spot.width; x++) {
      const from = (sourceRow + clamp(x - content.x, 0, content.width - 1)) * TEXEL;
      const to = ((spot.y + y) * atlasWidth + spot.x + x) * TEXEL;
      for (let c = 0; c < TEXEL; c++) atlas[to + c] = bytes[from + c];
    }
  }
}

/** The normal atlas at half size: each block's own normals (clamped at its edges), flat elsewhere, alpha 255. */
function buildNormalAtlas(halfAlbedo, halfWidth, halfHeight, placements) {
  const normal = new Uint8ClampedArray(halfWidth * halfHeight * TEXEL);
  for (let i = 0; i < normal.length; i += TEXEL) normal.set(FLAT_NORMAL, i);
  for (const { entry, spot } of placements) {
    const region = { left: spot.x >> 1, top: spot.y >> 1, width: spot.width >> 1, height: spot.height >> 1 };
    const luma = lumaTimesAlpha(halfAlbedo, halfWidth, region);
    const texels = normalTexels(luma, region.width, region.height, NORMAL_STRENGTH[entry.row.kind], false);
    for (let y = 0; y < region.height; y++) {
      for (let x = 0; x < region.width; x++) {
        const to = ((region.top + y) * halfWidth + region.left + x) * TEXEL;
        for (let c = 0; c < COLOUR_CHANNELS; c++) normal[to + c] = texels[(y * region.width + x) * COLOUR_CHANNELS + c];
      }
    }
  }
  return normal;
}

function buildAtlas(family, sprites) {
  const { width, height, shrink, spots } = layoutAtlas(family, sprites);
  const albedo = new Uint8ClampedArray(width * height * TEXEL);
  const placements = sprites.map((entry, index) => {
    const spot = spots[index];
    const content = contentRect(entry.image, spot);
    const bytes = toStraightBytes(resample(entry.image, content.width, content.height));
    paintBlock(albedo, width, spot, content, bytes);
    return { entry, spot, content };
  });
  const halfAlbedo = halved(albedo, width, height);
  const normal = buildNormalAtlas(halfAlbedo, width >> 1, height >> 1, placements);
  return {
    width,
    height,
    shrink,
    placements,
    albedo: encodeWebp(albedo, width, height, WEBP_QUALITY_ALBEDO),
    albedoHalf: encodeWebp(halfAlbedo, width >> 1, height >> 1, WEBP_QUALITY_ALBEDO),
    normal: encodeWebp(normal, width >> 1, height >> 1, WEBP_QUALITY_NORMAL),
  };
}

/** The vertical strips of a family's tile layers (layer i at rows [i*S, (i+1)*S)): albedo, half-size albedo, and the half-size normal with height in alpha. */
function buildTiles(tiles) {
  const half = TILE_SIZE >> 1;
  const stripHeight = tiles.length * TILE_SIZE;
  const strip = new Uint8ClampedArray(TILE_SIZE * stripHeight * TEXEL);
  const halfStrip = new Uint8ClampedArray(half * (stripHeight >> 1) * TEXEL);
  const normalStrip = new Uint8ClampedArray(half * (stripHeight >> 1) * TEXEL);
  for (const [layer, entry] of tiles.entries()) {
    strip.set(entry.layerBytes, layer * TILE_SIZE * TILE_SIZE * TEXEL);
    const halfLayer = halved(entry.layerBytes, TILE_SIZE, TILE_SIZE);
    halfStrip.set(halfLayer, layer * half * half * TEXEL);
    const luma = lumaTimesAlpha(halfLayer, half, { left: 0, top: 0, width: half, height: half });
    const texels = normalTexels(luma, half, half, NORMAL_STRENGTH.tile, true);
    for (let i = 0; i < half * half; i++) {
      const to = (layer * half * half + i) * TEXEL;
      for (let c = 0; c < COLOUR_CHANNELS; c++) normalStrip[to + c] = texels[i * COLOUR_CHANNELS + c];
      normalStrip[to + ALPHA_OFFSET] = Math.max(TILE_HEIGHT_FLOOR, Math.round(luma[i] * BYTE));
    }
  }
  return {
    tilesAlbedo: encodeWebp(strip, TILE_SIZE, stripHeight, WEBP_QUALITY_ALBEDO),
    tilesAlbedoHalf: encodeWebp(halfStrip, half, stripHeight >> 1, WEBP_QUALITY_ALBEDO),
    tilesNormal: encodeWebp(normalStrip, half, stripHeight >> 1, WEBP_QUALITY_NORMAL),
  };
}

const roundRect = (value) => Math.round(value * RECT_PRECISION) / RECT_PRECISION;

function atlasCells(prepared, atlas, tiles) {
  const placementOf = new Map((atlas?.placements ?? []).map((placement) => [placement.entry, placement]));
  return prepared.map((entry) => {
    const { id } = entry.row;
    if (entry.row.kind === "tile") return { id, rect: [0, 0, 1, 1], tint: entry.tint, layer: tiles.indexOf(entry) };
    const { spot, content } = placementOf.get(entry);
    const rect = [(spot.x + content.x) / atlas.width, (spot.y + content.y) / atlas.height, content.width / atlas.width, content.height / atlas.height].map(roundRect);
    return { id, rect, tint: entry.tint };
  });
}

const constantName = (family) => family.toUpperCase();

function worldRowText(family, entry) {
  const { row } = entry;
  const depth = typeof row.depth === "number" ? `, depth: ${row.depth}` : "";
  const biomes = row.biomes.map((biome) => JSON.stringify(biome)).join(", ");
  return `  { id: ${JSON.stringify(row.id)}, family: ${JSON.stringify(family)}, kind: ${JSON.stringify(row.kind)}, size: [${row.size.join(", ")}], body: ${JSON.stringify(row.body)}, biomes: [${biomes}], rule: ${JSON.stringify(row.rule)}, weight: ${row.weight}, core: ${entry.core}${depth} },`;
}

function worldTs(family, prepared) {
  const rows = prepared.map((entry) => worldRowText(family, entry));
  const body = rows.length === 0 ? "[]" : `[\n${rows.join("\n")}\n]`;
  return `import type { SceneryAsset } from "./types.ts";\n\n/** The ${family} family's assets (generated by \`scripts/sprite-pack.mjs\`). */\nexport const ${constantName(family)}: readonly SceneryAsset[] = ${body};\n`;
}

function cellText(cell) {
  const layer = cell.layer === undefined ? "" : `, layer: ${cell.layer}`;
  return `    { id: ${JSON.stringify(cell.id)}, rect: [${cell.rect.join(", ")}], tint: 0x${cell.tint.toString(16).padStart(6, "0")}${layer} },`;
}

function atlasTs(family, layout, tileLayers) {
  const tileSize = tileLayers > 0 ? TILE_SIZE : 0;
  const cells = layout.cells.length === 0 ? "[]" : `[\n${layout.cells.map(cellText).join("\n")}\n  ]`;
  const fields = [`family: ${JSON.stringify(family)}`, `width: ${layout.width}`, `height: ${layout.height}`, `tiles: ${tileLayers}`, `tileSize: ${tileSize}`, `cells: ${cells}`];
  return `import type { AtlasFamily } from "./types.ts";\n\n/** The ${family} family's atlas (generated by \`scripts/sprite-pack.mjs\`). */\nexport const ${constantName(family)}_ATLAS: AtlasFamily = {\n${fields.map((field) => `  ${field},`).join("\n")}\n};\n`;
}

const gpuMegabytes = (width, height) => (width * height * GPU_BYTES_PER_TEXEL) / BYTES_PER_MEGABYTE;
const megabytes = (value) => `${value.toFixed(2)} MB`;

function assetLine(entry, atlas) {
  const { row } = entry;
  if (row.kind === "tile") return `  ${row.id} tile layer, centre-crop of ${entry.sourceSize.join("x")} to ${TILE_SIZE} px`;
  const { spot, content } = atlas.placements.find((placement) => placement.entry === entry);
  const trimmedRatio = entry.image.width / entry.image.height;
  const sizeRatio = row.size[0] / row.size[1];
  const stretched = Math.abs(trimmedRatio - sizeRatio) > RATIO_TOLERANCE * sizeRatio;
  const warning = stretched ? `  WARNING trimmed ratio ${trimmedRatio.toFixed(2)} against size ratio ${sizeRatio.toFixed(2)}` : "";
  return `  ${row.id} ${row.kind} block ${spot.width}x${spot.height} content ${content.width}x${content.height} core ${entry.core}${warning}`;
}

function report(family, prepared, atlas, tiles) {
  const half = TILE_SIZE >> 1;
  const albedoMb = atlas ? gpuMegabytes(atlas.width, atlas.height) : 0;
  const normalMb = atlas ? gpuMegabytes(atlas.width >> 1, atlas.height >> 1) : 0;
  const albedoHalfMb = atlas ? gpuMegabytes(atlas.width >> 1, atlas.height >> 1) : 0;
  const tilesMb = gpuMegabytes(TILE_SIZE, TILE_SIZE) * tiles.length + gpuMegabytes(half, half) * tiles.length;
  const tilesHalfMb = gpuMegabytes(half, half) * tiles.length;
  const fullMb = albedoMb + normalMb + tilesMb;
  const halfMb = albedoHalfMb + tilesHalfMb;
  const size = atlas ? `${atlas.width}x${atlas.height} (density ${atlas.shrink.toFixed(2)} of ${PIXELS_PER_METRE} px/m)` : "none";
  const lines = [
    `${family}: ${prepared.length} assets, atlas ${size}`,
    `  full tier: albedo ${megabytes(albedoMb)} + normal ${megabytes(normalMb)} + tiles ${megabytes(tilesMb)} (${tiles.length} layers of ${TILE_SIZE}, normal at ${half}) = ${megabytes(fullMb)}`,
    `  half tier: albedo ${megabytes(albedoHalfMb)} + tiles ${megabytes(tilesHalfMb)} = ${megabytes(halfMb)}`,
    ...prepared.map((entry) => assetLine(entry, atlas)),
  ];
  if (fullMb > FULL_TIER_BUDGET_MB) lines.push(`WARNING ${family}: full tier ${megabytes(fullMb)} is over the ${FULL_TIER_BUDGET_MB} MB budget`);
  if (halfMb > HALF_TIER_BUDGET_MB) lines.push(`WARNING ${family}: half tier ${megabytes(halfMb)} is over the ${HALF_TIER_BUDGET_MB} MB budget`);
  return lines.join("\n");
}

/** Packs a family from its manifest `rows`, each with `image` (png bytes): the webp buffers, the two TS files' text, the report and `layout` (block places, uv cells). Tile buffers exist only with tile rows. */
export async function pack(family, rows) {
  const prepared = [];
  for (const row of rows) prepared.push(await prepareRow(row));
  const sprites = prepared.filter((entry) => entry.row.kind !== "tile");
  const tiles = prepared.filter((entry) => entry.row.kind === "tile");
  const atlas = sprites.length > 0 ? buildAtlas(family, sprites) : undefined;
  const tileBuffers = tiles.length > 0 ? buildTiles(tiles) : {};
  const layout = {
    width: atlas?.width ?? 0,
    height: atlas?.height ?? 0,
    blocks: (atlas?.placements ?? []).map(({ entry, spot }) => ({ id: entry.row.id, x: spot.x, y: spot.y, width: spot.width, height: spot.height })),
    cells: atlasCells(prepared, atlas, tiles),
  };
  return {
    albedo: atlas?.albedo,
    albedoHalf: atlas?.albedoHalf,
    normal: atlas?.normal,
    ...tileBuffers,
    worldTs: worldTs(family, prepared),
    atlasTs: atlasTs(family, layout, tiles.length),
    report: report(family, prepared, atlas, tiles),
    layout,
  };
}

async function packFamily(family, rawDir) {
  const manifest = JSON.parse(readFileSync(join(rawDir, family, "manifest.json"), "utf8"));
  const rows = manifest.map((row) => ({ ...row, image: readFileSync(join(rawDir, family, row.source)) }));
  const result = await pack(family, rows);
  mkdirSync(OUTPUT_DIR, { recursive: true });
  for (const [key, suffix] of Object.entries(OUTPUT_SUFFIXES)) {
    const file = join(OUTPUT_DIR, `${family}-${suffix}.webp`);
    if (result[key] === undefined) rmSync(file, { force: true });
    else writeFileSync(file, result[key]);
  }
  writeFileSync(join(ROOT, "src/game/world/scenery-assets", `${family}.ts`), result.worldTs);
  writeFileSync(join(ROOT, "src/game/present/scenery-atlas", `${family}.ts`), result.atlasTs);
  console.log(result.report);
  const sizes = Object.keys(OUTPUT_SUFFIXES).filter((key) => result[key] !== undefined).map((key) => `${OUTPUT_SUFFIXES[key]} ${result[key].length} B`);
  console.log(`  wrote ${sizes.join(", ")}`);
}

async function main(argv) {
  const { values, positionals } = parseArgs({ args: argv, allowPositionals: true, options: { raw: { type: "string", default: DEFAULT_RAW_DIR } } });
  if (positionals.length === 0) throw new Error("usage: sprite-pack.mjs <family>... [--raw <folder holding <family>/manifest.json>]");
  for (const family of positionals) await packFamily(family, resolve(values.raw));
}

if (isMainModule(import.meta.url)) await main(process.argv.slice(2));
