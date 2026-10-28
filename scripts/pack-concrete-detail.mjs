/**
 * Packs the worn-concrete detail map (`public/materials/concrete-detail.webp`) from Poly Haven's "Concrete Floor Worn 02" (CC0,
 * https://polyhaven.com/a/concrete_floor_worn_02): R, G the high-passed GL normal's x and y, B the high-passed lightness (half
 * is the mean), 512 px, opaque. The source is its 1k `diff` and `nor_gl` JPEGs in one folder.
 *
 *   node scripts/pack-concrete-detail.mjs <folder with diff.jpg and nor_gl.jpg> [normal gain] [tone gain]
 */
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const SIZE = 512;
const TEXELS = SIZE * SIZE;
/** The blur that is taken out of each plane: features wider than this many texels are the scan's blotches, not the grain. */
const HIGH_PASS_RADIUS = 24;
/** Share of the lightness blotches kept: the albedo's low frequencies are the stains that make a slab read as worn concrete. */
const TONE_KEEP = 0.6;
const WEBP_QUALITY = 90;
const [folder, normalGainArg = "2.2", toneGainArg = "600"] = process.argv.slice(2);
if (folder === undefined) throw new Error("usage: pack-concrete-detail.mjs <folder with diff.jpg and nor_gl.jpg> [normal gain] [tone gain]");
const normalGain = Number(normalGainArg);
const toneGain = Number(toneGainArg);

async function readRgba(name) {
  const image = await loadImage(join(resolve(folder), `${name}.jpg`));
  const canvas = createCanvas(SIZE, SIZE);
  const context = canvas.getContext("2d");
  context.imageSmoothingQuality = "high";
  context.drawImage(image, 0, 0, SIZE, SIZE);
  return context.getImageData(0, 0, SIZE, SIZE).data;
}

/** A wrapping separable box blur of a SIZE² plane, so the map tiles. */
function blur(plane) {
  const wide = 2 * HIGH_PASS_RADIUS + 1;
  const rows = new Float32Array(TEXELS);
  const out = new Float32Array(TEXELS);
  const wrap = (i) => (i + SIZE) % SIZE;
  for (let y = 0; y < SIZE; y++) {
    let sum = 0;
    for (let k = -HIGH_PASS_RADIUS; k <= HIGH_PASS_RADIUS; k++) sum += plane[y * SIZE + wrap(k)];
    for (let x = 0; x < SIZE; x++) {
      rows[y * SIZE + x] = sum / wide;
      sum += plane[y * SIZE + wrap(x + HIGH_PASS_RADIUS + 1)] - plane[y * SIZE + wrap(x - HIGH_PASS_RADIUS)];
    }
  }
  for (let x = 0; x < SIZE; x++) {
    let sum = 0;
    for (let k = -HIGH_PASS_RADIUS; k <= HIGH_PASS_RADIUS; k++) sum += rows[wrap(k) * SIZE + x];
    for (let y = 0; y < SIZE; y++) {
      out[y * SIZE + x] = sum / wide;
      sum += rows[wrap(y + HIGH_PASS_RADIUS + 1) * SIZE + x] - rows[wrap(y - HIGH_PASS_RADIUS) * SIZE + x];
    }
  }
  return out;
}

const channel = (rgba, index) => Float32Array.from({ length: TEXELS }, (_, i) => rgba[i * 4 + index]);

/** `plane` minus the blur's `1 - keep` share, then minus its own mean: zero-centred detail. */
function highPass(plane, keep) {
  const low = blur(plane);
  const out = plane.map((value, i) => value - low[i] * (1 - keep));
  const mean = out.reduce((sum, value) => sum + value, 0) / TEXELS;
  return out.map((value) => value - mean);
}

const toByte = (value) => Math.max(0, Math.min(255, Math.round(128 + value)));
const diffuse = await readRgba("diff");
const normal = await readRgba("nor_gl");
const luma = Float32Array.from({ length: TEXELS }, (_, i) => 0.2126 * diffuse[i * 4] + 0.7152 * diffuse[i * 4 + 1] + 0.0722 * diffuse[i * 4 + 2]);
const lumaMean = luma.reduce((sum, value) => sum + value, 0) / TEXELS;
const normalX = highPass(channel(normal, 0), 0);
const normalY = highPass(channel(normal, 1), 0);
const tone = highPass(luma.map((value) => value / lumaMean), TONE_KEEP);

const rgb = Buffer.alloc(TEXELS * 3);
for (let i = 0; i < TEXELS; i++) {
  rgb[i * 3] = toByte(normalX[i] * normalGain);
  rgb[i * 3 + 1] = toByte(normalY[i] * normalGain);
  rgb[i * 3 + 2] = toByte(tone[i] * toneGain);
}
const scratch = mkdtempSync(join(tmpdir(), "concrete-detail-"));
const rawPath = join(scratch, "packed.rgb");
writeFileSync(rawPath, rgb);
const outPath = resolve("public/materials/concrete-detail.webp");
execFileSync("ffmpeg", ["-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", `${SIZE}x${SIZE}`, "-i", rawPath, "-c:v", "libwebp", "-quality", String(WEBP_QUALITY), "-compression_level", "6", outPath]);
rmSync(scratch, { recursive: true });
const rms = (offset) => Math.sqrt(rgb.reduce((sum, value, i) => (i % 3 === offset ? sum + (value - 128) ** 2 : sum), 0) / TEXELS);
console.log({ normalGain, toneGain, rmsNormalX: rms(0), rmsNormalY: rms(1), rmsTone: rms(2), out: outPath });
