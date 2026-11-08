/**
 * Packs the ground surfaces' normal maps (`public/surfaces/<name>-normal.webp`, read by `src/game/present/ground-relief.ts`) from one generated top-down
 * picture per surface (<name>.webp in the folder given): a seamless tile cut from the picture's middle (or the slab interior for concrete),
 * its relief from the picture's lightness with the large shading taken out. Only the normal is packed: the colours stay the course's own.
 *
 *   node scripts/pack-ground.mjs <folder with asphalt cobble concrete slab gravel dirt mud sand grass .webp> [out folder, default public/surfaces]
 *
 */
import { mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { normalFromLightness, seam, seamlessTile, writeWebp } from "./pack-tile-lib.mjs";

const root = join(dirname(new URL(import.meta.url).pathname), "..");
const [folder, outArg] = process.argv.slice(2);
if (folder === undefined) throw new Error("usage: pack-ground.mjs <folder with the nine .webp pictures> [out folder]");
const out = resolve(outArg ?? join(root, "public/surfaces"));
mkdirSync(out, { recursive: true });

const NORMAL_QUALITY = 92;
/** Share of the tile's edge whose blur is taken out of the lightness first. */
const HIGH_PASS_SHARE = 1 / 10;

/** texels; relief (how steeply lightness tilts the normal); crop [x, y, w, h] of the picture where the middle is not wanted (concrete: one slab's inside, no joints). */
const SURFACES = {
  asphalt: { texels: 512, relief: 3 },
  concrete: { texels: 256, relief: 3, crop: [272, 272, 224, 224] },
  cobble: { texels: 512, relief: 6 },
  dirt: { texels: 256, relief: 4 },
  gravel: { texels: 512, relief: 5 },
  grass: { texels: 256, relief: 3.5 },
  sand: { texels: 256, relief: 4 },
  mud: { texels: 512, relief: 5 },
  slab: { texels: 256, relief: 5 },
};

for (const [name, spec] of Object.entries(SURFACES)) {
  const rgb = await seamlessTile(join(resolve(folder), `${name}.webp`), spec.texels, undefined, spec.crop ?? null);
  const normal = normalFromLightness(rgb, spec.texels, spec.relief, Math.round(spec.texels * HIGH_PASS_SHARE));
  const bytes = writeWebp(join(out, `${name}-normal.webp`), spec.texels, spec.texels, normal, NORMAL_QUALITY);
  console.log(`${name}: ${spec.texels}x${spec.texels}, seam ${seam(rgb, spec.texels).toFixed(1)}, ${bytes} B`);
}
