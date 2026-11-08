/** What the roof and ground packers share: a picture cut to a seamless square tile, a normal map from its lightness, a webp writer. */
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { writeFileSync } from "node:fs";

/** Source texels cut off each side of a picture, and the margin (texels of the tile) its seam is cross-faded over. */
const EDGE = 40;
const MARGIN = 24;

/** `rgb` (floats 0..255, 3 per texel) of `size` x `size` after `recolor(r, g, b, lightness)` -> [r, g, b] on every source texel: the picture's middle (or `crop`, [x, y, w, h] in source texels), its edges cross-faded with what lies beyond them so it tiles. */
export async function seamlessTile(file, size, recolor = (r, g, b) => [r, g, b], crop = null) {
  const image = await loadImage(file);
  const wide = size + 2 * MARGIN;
  const canvas = createCanvas(wide, wide);
  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingQuality = "high";
  const [cx, cy, cw, ch] = crop ?? [EDGE, EDGE, image.width - 2 * EDGE, image.height - 2 * EDGE];
  ctx.drawImage(image, cx, cy, cw, ch, 0, 0, wide, wide);
  const px = ctx.getImageData(0, 0, wide, wide).data;
  const ext = new Float32Array(wide * wide * 3);
  for (let i = 0; i < wide * wide; i++) {
    const lum = (0.299 * px[i * 4] + 0.587 * px[i * 4 + 1] + 0.114 * px[i * 4 + 2]) / 255;
    ext.set(recolor(px[i * 4], px[i * 4 + 1], px[i * 4 + 2], lum), i * 3);
  }
  // Cross-fade along x over every row, then along y over the result: half the neighbouring tile at the seam, none a margin in.
  const along = (src, axisX) => {
    const out = new Float32Array(src.length);
    for (let y = 0; y < wide; y++) {
      for (let x = 0; x < wide; x++) {
        const t = axisX ? x : y;
        const inside = t - MARGIN;
        if (inside < 0 || inside >= size) continue;
        const edge = Math.min(inside, size - 1 - inside);
        const w = edge < MARGIN ? 0.5 * (1 - edge / MARGIN) : 0;
        const here = (y * wide + x) * 3;
        const other = inside < size / 2 ? t + size : t - size;
        const there = w === 0 ? here : axisX ? (y * wide + other) * 3 : (other * wide + x) * 3;
        for (let c = 0; c < 3; c++) out[here + c] = src[here + c] * (1 - w) + src[there + c] * w;
      }
    }
    return out;
  };
  const faded = along(along(ext, true), false);
  const rgb = new Float32Array(size * size * 3);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) for (let c = 0; c < 3; c++) rgb[(y * size + x) * 3 + c] = faded[((y + MARGIN) * wide + x + MARGIN) * 3 + c];
  }
  return rgb;
}

/** The mean difference between a tile's opposite edges: small when it tiles. */
export function seam(rgb, size) {
  let sum = 0;
  for (let k = 0; k < size; k++) {
    for (let c = 0; c < 3; c++) {
      sum += Math.abs(rgb[k * size * 3 + c] - rgb[(k * size + size - 1) * 3 + c]);
      sum += Math.abs(rgb[k * 3 + c] - rgb[((size - 1) * size + k) * 3 + c]);
    }
  }
  return sum / (size * 6);
}

/** A wrapping separable box blur of a size x size plane, `r` texels each way. */
function blurWrap(plane, size, r) {
  const n = 2 * r + 1;
  const rows = new Float32Array(size * size);
  const out = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let sum = 0;
      for (let k = -r; k <= r; k++) sum += plane[y * size + ((x + k + size) % size)];
      rows[y * size + x] = sum / n;
    }
  }
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let sum = 0;
      for (let k = -r; k <= r; k++) sum += rows[((y + k + size) % size) * size + x];
      out[y * size + x] = sum / n;
    }
  }
  return out;
}

/**
 * A tangent-space normal map (floats 0..255) of a wrapping `size` x `size` tile from its lightness; `relief` how steeply lightness tilts it, and
 * `highPass` (texels, 0: none) the radius whose blur is taken out first, so the picture's large shading does not tilt the surface. +v is up, the picture's down is -v.
 */
export function normalFromLightness(rgb, size, relief, highPass = 0) {
  const raw = new Float32Array(size * size);
  for (let i = 0; i < size * size; i++) raw[i] = (0.299 * rgb[i * 3] + 0.587 * rgb[i * 3 + 1] + 0.114 * rgb[i * 3 + 2]) / 255;
  const low = highPass > 0 ? blurWrap(raw, size, highPass) : null;
  const light = low ? raw.map((v, i) => v - low[i]) : raw;
  const at = (x, y) => light[((y + size) % size) * size + ((x + size) % size)];
  const normal = new Float32Array(size * size * 3);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const nx = -((at(x + 1, y) - at(x - 1, y)) / 2) * relief * 8;
      const ny = ((at(x, y + 1) - at(x, y - 1)) / 2) * relief * 8;
      const len = Math.hypot(nx, ny, 1);
      const o = (y * size + x) * 3;
      normal[o] = ((nx / len) * 0.5 + 0.5) * 255;
      normal[o + 1] = ((ny / len) * 0.5 + 0.5) * 255;
      normal[o + 2] = ((1 / len) * 0.5 + 0.5) * 255;
    }
  }
  return normal;
}

/** Write floats 0..255 (3 per texel) as an opaque webp; returns the bytes written. */
export function writeWebp(file, width, height, rgb, quality) {
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");
  const image = ctx.createImageData(width, height);
  for (let i = 0; i < width * height; i++) {
    for (let c = 0; c < 3; c++) image.data[i * 4 + c] = rgb[i * 3 + c];
    image.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(image, 0, 0);
  const bytes = canvas.toBuffer("image/webp", quality);
  writeFileSync(file, bytes);
  return bytes.length;
}
