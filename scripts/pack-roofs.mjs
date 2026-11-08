/**
 * Packs the roof coverings (`public/facades/roofs-{albedo,normal}.webp`, read by `src/game/present/facades.ts`): one atlas of 3 x 2 cells of
 * CELL texels, each a seamless top-down roof of one kind, its normal map derived from lightness. Cell k sits at column k % 3 and row k / 3
 * counted from the bottom of the picture (the shader's v runs up). The kinds, in cell order, are `ROOF_KINDS` in facades.ts: brown tar, red
 * clay tile, grey slate, green copper, corrugated metal. The tar roof is made from the asphalt picture, browned.
 *
 *   node scripts/pack-roofs.mjs <folder with tile, copper, slate, metal .webp and asphalt .webp> [out folder, default public/facades]
 */
import { mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { normalFromLightness, seam, seamlessTile, writeWebp } from "./pack-tile-lib.mjs";

const root = join(dirname(new URL(import.meta.url).pathname), "..");
const [folder, outArg] = process.argv.slice(2);
if (folder === undefined) throw new Error("usage: pack-roofs.mjs <folder with tile, copper, slate, metal and asphalt .webp> [out folder]");
const out = resolve(outArg ?? join(root, "public/facades"));
mkdirSync(out, { recursive: true });

const CELL = 256;
const COLUMNS = 3;
const ROWS = 2;
const WEBP_QUALITY = 88;
const NORMAL_QUALITY = 92;
/** How steeply a roof's lightness tilts its normal: tiles and slate are courses, copper seams, tar a grain. */
const RELIEF = { tar: 2.5, tile: 5, slate: 4.5, copper: 3.5, metal: 4 };
const KINDS = ["tar", "tile", "slate", "copper", "metal"];
const SOURCE = { tar: "asphalt", tile: "tile", slate: "slate", copper: "copper", metal: "metal" };
/** How much of its colour a roof keeps (1: all): the slate picture is bluer than slate. */
const SATURATION = { slate: 0.45 };
/** The asphalt picture's lightness taken to a roofing-felt brown. */
const TAR_BROWN = [1.35, 1.05, 0.8];

const recolor = (kind) => (r, g, b, lum) => {
  if (kind === "tar") return TAR_BROWN.map((k) => Math.min(255, lum * 255 * k * 0.75));
  const keep = SATURATION[kind] ?? 1;
  return [r, g, b].map((v) => lum * 255 + (v - lum * 255) * keep);
};

const width = CELL * COLUMNS;
const height = CELL * ROWS;
const albedo = new Float32Array(width * height * 3);
const normal = new Float32Array(width * height * 3);
for (let k = 0; k < COLUMNS * ROWS; k++) {
  const kind = KINDS[Math.min(k, KINDS.length - 1)];
  const rgb = await seamlessTile(join(resolve(folder), `${SOURCE[kind]}.webp`), CELL, recolor(kind));
  if (k < KINDS.length) console.log(`${kind}: seam ${seam(rgb, CELL).toFixed(1)}`);
  const n = normalFromLightness(rgb, CELL, RELIEF[kind]);
  const x0 = (k % COLUMNS) * CELL;
  // Row 0 is the bottom of the picture: the top row of the file is the last row of cells.
  const y0 = (ROWS - 1 - Math.floor(k / COLUMNS)) * CELL;
  for (let y = 0; y < CELL; y++) {
    const from = y * CELL * 3;
    const to = ((y0 + y) * width + x0) * 3;
    albedo.set(rgb.subarray(from, from + CELL * 3), to);
    normal.set(n.subarray(from, from + CELL * 3), to);
  }
}
console.log(`roofs ${width}x${height}: albedo ${writeWebp(join(out, "roofs-albedo.webp"), width, height, albedo, WEBP_QUALITY)} B, normal ${writeWebp(join(out, "roofs-normal.webp"), width, height, normal, NORMAL_QUALITY)} B`);
