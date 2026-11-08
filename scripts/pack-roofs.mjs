/**
 * Packs the roof coverings (`public/facades/roofs-{albedo,normal}.webp`, read by `src/game/present/facades.ts` as array textures): one webp strip of
 * `KINDS.length` layers of LAYER texels square stacked top to bottom, each a seamless top-down roof of one kind with its normal map derived from lightness.
 * The kinds, in layer order, are `ROOF_KINDS` in facades.ts: brown tar, red clay tile, grey slate, green copper, corrugated metal. The tar roof is made from
 * the asphalt picture, browned.
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

const LAYER = 256;
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

const height = LAYER * KINDS.length;
const albedo = new Float32Array(LAYER * height * 3);
const normal = new Float32Array(LAYER * height * 3);
for (const [i, kind] of KINDS.entries()) {
  const rgb = await seamlessTile(join(resolve(folder), `${SOURCE[kind]}.webp`), LAYER, recolor(kind));
  console.log(`${kind}: seam ${seam(rgb, LAYER).toFixed(1)}`);
  albedo.set(rgb, i * LAYER * LAYER * 3);
  normal.set(normalFromLightness(rgb, LAYER, RELIEF[kind]), i * LAYER * LAYER * 3);
}
console.log(`roofs ${LAYER}x${height}: albedo ${writeWebp(join(out, "roofs-albedo.webp"), LAYER, height, albedo, WEBP_QUALITY)} B, normal ${writeWebp(join(out, "roofs-normal.webp"), LAYER, height, normal, NORMAL_QUALITY)} B`);
