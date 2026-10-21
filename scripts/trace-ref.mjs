/**
 * The tracing harness's reference pictures: decoded and cropped, drawn on a frame's canvas, and read as masks: the car's
 * silhouette (a ground shadow on an opaque backdrop left out) and its glass.
 */
import { readFileSync } from "node:fs";
import { fillHoles, labelRegions, maskBox, openMask } from "./trace-metrics.mjs";

/** A reference pixel this far (sum of |ΔR|+|ΔG|+|ΔB|+|ΔA|) from the background is the car: clears anti-aliased fringes. */
const REF_FG_DIFF = 96;
/** Glass in a side view sits above this share of the silhouette's height: under it are tyres, grilles, arch shadows and the hood. */
const GLASS_BAND = 0.62;
/** Chroma's weight in the glass score (luma + weight x chroma): tinted glass is dark and grey; paint is lighter or coloured. */
const GLASS_CHROMA_WEIGHT = 2;
/** Dark regions smaller than this share of the scored pixels are trim, not glass. */
const GLASS_MIN_SHARE = 0.01;
/** A top view's glass is under this share of the car: a darker class larger than it holds the body's shading too, split again. */
const TOP_GLASS_MAX_SHARE = 0.45;
/** Dark strips thinner than about twice this (reference pixels) are outline and trim, not glass: the glass mask is opened by it. */
const GLASS_OPEN_REF_PX = 1;
/** A ground shadow on an opaque backdrop: grey (chroma under this), lighter than SHADOW_LUMA, under the tyres' contact line. */
const SHADOW_CHROMA = 14;
const SHADOW_LUMA = 120;
/** A pixel this dark is tyre or undercarriage: the lowest one in each half of the picture sets the contact line. */
const DARK_LUMA = 60;

/** A reference picture (optionally cropped to [x, y, w, h]), its background colour (top-left pixel) and foreground box. */
export async function loadRef(game, file, crop) {
  let image = await game.loadImage(readFileSync(file));
  if (crop !== undefined) {
    const [x, y, w, h] = crop;
    const c = game.createCanvas(w, h);
    c.getContext("2d").drawImage(image, x, y, w, h, 0, 0, w, h);
    image = c;
  }
  const ctx = game.createCanvas(image.width, image.height).getContext("2d");
  ctx.drawImage(image, 0, 0);
  const d = ctx.getImageData(0, 0, image.width, image.height).data;
  const bg = d.slice(0, 4);
  const fg = new Uint8Array(image.width * image.height);
  for (let i = 0; i < fg.length; i++) fg[i] = diff(d, i * 4, bg) > REF_FG_DIFF ? 1 : 0;
  const box = maskBox(fg, image.width, image.height);
  if (box.u1 < 0) throw new Error(`${file}: no pixel differs from the top-left one`);
  return { file, image, width: image.width, height: image.height, bg, box };
}

function diff(d, o, bg) {
  let s = 0;
  for (let k = 0; k < 4; k++) s += Math.abs(d[o + k] - bg[k]);
  return s;
}

function luma(d, o) {
  return 0.299 * d[o] + 0.587 * d[o + 1] + 0.114 * d[o + 2];
}

function chroma(d, o) {
  return Math.max(d[o], d[o + 1], d[o + 2]) - Math.min(d[o], d[o + 1], d[o + 2]);
}

/** The reference scaled by `k` with its top-left at (dx, dy) on a W x H plate of its own background colour, as RGBA. */
export function refPlate(game, ref, W, H, dx, dy, k) {
  const c = game.createCanvas(W, H).getContext("2d");
  const [r, g, b, a] = ref.bg;
  c.fillStyle = `rgba(${r},${g},${b},${a / 255})`;
  c.fillRect(0, 0, W, H);
  c.imageSmoothingQuality = "high";
  c.drawImage(ref.image, dx, dy, ref.width * k, ref.height * k);
  return c.getImageData(0, 0, W, H).data;
}

/**
 * The reference's plate, silhouette (holes filled; a ground shadow on an opaque backdrop left out, `shadowPx` pixels) and glass
 * (`refGlass`), drawn on `frame`'s canvas at `zoom` with `pad`. A top view's glass keeps only what its mirror across the centreline
 * also holds: the car is symmetric, the picture's lighting is not (one fender's shading read as glass).
 */
export function refLayers(game, ref, frame, zoom, pad, plate = refPlate(game, ref, frame.W, frame.H, pad * zoom, pad * zoom, zoom)) {
  const { W, H } = frame;
  const sil = new Uint8Array(W * H);
  for (let i = 0; i < sil.length; i++) sil[i] = diff(plate, i * 4, ref.bg) > REF_FG_DIFF ? 1 : 0;
  const shadowPx = ref.bg[3] === 255 ? dropShadow(plate, sil, W, H) : 0;
  fillHoles(sil, W, H);
  const glass = refGlass(plate, sil, W, H, frame.view !== "top", Math.max(1, Math.round(GLASS_OPEN_REF_PX * zoom)));
  if (frame.view === "top") mirrorAnd(glass.mask, W, H, 2 * frame.v(0));
  return { plate, sil, glass: glass.mask, glassThreshold: glass.threshold, shadowPx };
}

/** Clears every pixel of `mask` whose mirror across the row `twice / 2` is clear (or off the frame). */
function mirrorAnd(mask, W, H, twice) {
  const keep = new Uint8Array(mask.length);
  for (let v = 0; v < H; v++) {
    const m = Math.round(twice - v - 1);
    if (m < 0 || m >= H) continue;
    for (let u = 0; u < W; u++) keep[v * W + u] = mask[v * W + u] & mask[m * W + u];
  }
  mask.set(keep);
}

/** Clears the grey ground shadow: grey pixels lighter than SHADOW_LUMA under the line through each half's lowest dark pixel. */
function dropShadow(plate, fg, W, H) {
  const box = maskBox(fg, W, H);
  const mid = (box.u0 + box.u1) >> 1;
  const low = [null, null];
  for (let v = box.v0; v <= box.v1; v++) {
    for (let u = box.u0; u <= box.u1; u++) {
      const i = v * W + u;
      if (fg[i] && luma(plate, i * 4) < DARK_LUMA) low[u < mid ? 0 : 1] = [u, v];
    }
  }
  if (low[0] === null || low[1] === null) return 0;
  const [[ua, va], [ub, vb]] = low;
  let cleared = 0;
  for (let v = box.v0; v <= box.v1; v++) {
    for (let u = box.u0; u <= box.u1; u++) {
      const i = v * W + u;
      if (!fg[i] || v <= va + ((vb - va) * (u - ua)) / (ub - ua)) continue;
      if (chroma(plate, i * 4) >= SHADOW_CHROMA || luma(plate, i * 4) <= SHADOW_LUMA) continue;
      fg[i] = 0;
      cleared++;
    }
  }
  return cleared;
}

/**
 * The reference's glass: pixels inside the silhouette (above GLASS_BAND of its height in a side view) whose score, luma +
 * GLASS_CHROMA_WEIGHT x chroma, is under the Otsu threshold of the scored pixels (printed, per picture); dark regions under
 * GLASS_MIN_SHARE dropped. A side view's openings get their reflections filled; a top view's are left as found (they ring the roof).
 */
function refGlass(plate, sil, W, H, side, open) {
  const box = maskBox(sil, W, H);
  const vMax = side ? box.v1 - GLASS_BAND * (box.v1 - box.v0) : box.v1;
  const score = new Int16Array(W * H).fill(-1);
  const hist = new Uint32Array(766);
  let n = 0;
  for (let v = box.v0; v <= vMax; v++) {
    for (let u = box.u0; u <= box.u1; u++) {
      const i = v * W + u;
      if (!sil[i] || plate[i * 4 + 3] < 128) continue;
      score[i] = Math.round(luma(plate, i * 4) + GLASS_CHROMA_WEIGHT * chroma(plate, i * 4));
      hist[score[i]]++;
      n++;
    }
  }
  let threshold = otsu(hist, n);
  const below = (t) => hist.subarray(0, t).reduce((a, b) => a + b, 0);
  for (let k = 0; !side && k < 2 && below(threshold) > TOP_GLASS_MAX_SHARE * n; k++) threshold = otsu(hist.subarray(0, threshold), below(threshold));
  const dark = new Uint8Array(W * H);
  for (let i = 0; i < dark.length; i++) dark[i] = score[i] >= 0 && score[i] < threshold ? 1 : 0;
  const mask = new Uint8Array(W * H);
  for (const reg of labelRegions(openMask(dark, W, H, open), W, H)) if (reg.n >= GLASS_MIN_SHARE * n) for (const i of reg.pixels) mask[i] = 1;
  return { mask: side ? fillHoles(mask, W, H) : mask, threshold };
}

/** The histogram's Otsu threshold: the bin that best splits it into two classes (between-class variance). */
function otsu(hist, n) {
  let sum = 0;
  for (let t = 0; t < hist.length; t++) sum += t * hist[t];
  let sumB = 0;
  let wB = 0;
  let best = 0;
  let threshold = 0;
  for (let t = 0; t < hist.length; t++) {
    wB += hist[t];
    if (wB === 0) continue;
    const wF = n - wB;
    if (wF === 0) break;
    sumB += t * hist[t];
    const between = wB * wF * (sumB / wB - (sum - sumB) / wF) ** 2;
    if (between > best) {
      best = between;
      threshold = t + 1;
    }
  }
  return threshold;
}

