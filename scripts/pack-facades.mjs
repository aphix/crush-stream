/**
 * Packs the building facade maps (`public/facades/<style>-{albedo,normal,glow}.webp`, read by `src/game/present/facades.ts`) from one generated
 * flat-on elevation per style (a PNG named <style>.png in the folder given). One bay is cut from pilaster to pilaster and made tile across by
 * cross-fading its edges; the normal map is derived from the albedo's lightness (windows recessed), and the glow map is R the window mask, G a
 * turn-on threshold per window, spread a few texels round it (the shader lights the windows whose threshold the night is past), found from the albedo's dark glass or shutters.
 *
 *   node scripts/pack-facades.mjs <folder with prague.png dc.png stucco.png glass.png adobe.png> [out folder, default public/facades]
 *
 * It prints each style's `plain` point (u, v: a bare patch of wall, no window, for the roof slab) and the texel bytes for `FACADE_STYLES`.
 */
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const root = join(dirname(new URL(import.meta.url).pathname), "..");
const [folder, outArg] = process.argv.slice(2);
if (folder === undefined) throw new Error("usage: pack-facades.mjs <folder with the five <style>.png> [out folder]");
const out = resolve(outArg ?? join(root, "public/facades"));
mkdirSync(out, { recursive: true });

/** Source pixels either side of a bay that the cross-fade reaches over. */
const MARGIN = 18;
/** Share of the glow map's size against the albedo's. */
const GLOW_DOWN = 2;
/** Glow-map texels a window's threshold reaches past its mask. */
const GLOW_SPREAD = 3;
/** Texels the window mask is blurred by: the shader sharpens it back, so a half-size map keeps smooth window edges. */
const GLOW_BLUR = 3;
const NORMAL_STRENGTH = 5;
const WEBP_QUALITY = 90;
const WINDOW_OPEN_RADIUS = 2;

/**
 * crop [x, y, w, h] in the source (x is the bay's left pilaster centre, w one period), size [w, h] of the tile, and `glass`, the window
 * predicate over (r, g, b) in 0..255 and lightness 0..1 (or `rects`, window boxes in crop pixels where the colour cannot tell them);
 * `top`, the share of the tile under its roofline that holds no glass (cornice, balustrade, log ends); `bands`, [from, to] shares of the tile
 * height from its top that hold no glass either (fascias, railings, roller doors); `neutral`, how far the albedo is washed to cream so the
 * per-instance pastel tints colour it; `background`, [share, r, g, b]: near-white sky above that share of the tile is painted that colour.
 */
const STYLES = {
  prague: { crop: [295, 0, 259, 1264], size: [256, 1024], top: 0.07, glass: (r, g, b, l) => l < 0.3 },
  dc: { crop: [283, 0, 283, 1264], size: [256, 1024], top: 0.04, glass: (r, g, b, l) => l < 0.34 && g > r + 4 },
  stucco: { crop: [300, 44, 262, 1194], size: [256, 1024], top: 0.07, neutral: 0.8, glass: (r, g, b, l) => l < 0.5 },
  glass: { crop: [277, 0, 293, 1264], size: [256, 1024], top: 0.08, glass: (r, g, b, l) => l < 0.4 && b > r + 8 },
  adobe: { crop: [283, 668, 282, 596], size: [256, 512], top: 0.12, glass: (r, g, b, l) => l < 0.42 },
  shops: { crop: [283, 0, 283, 1264], size: [256, 1024], top: 0.04, bands: [[0.74, 0.81]], glass: (r, g, b, l) => l < 0.32 && b >= r - 6 },
  baroque: { crop: [290, 0, 270, 1264], size: [256, 1024], top: 0.1, background: [0.25, 214, 206, 192], glass: (r, g, b, l) => l < 0.34 && b >= r - 6 },
  havana: { crop: [282, 0, 280, 1264], size: [256, 1024], top: 0.08, bands: [[0.255, 0.31], [0.5, 0.552], [0.742, 0.795]], glass: (r, g, b, l) => l < 0.4 },
  federal: { crop: [300, 0, 246, 1264], size: [256, 1024], top: 0.27, glass: (r, g, b, l) => l < 0.3 },
  warehouse: { crop: [280, 0, 287, 1264], size: [256, 1024], top: 0.04, rects: [[82, 95, 207, 290], [82, 385, 207, 575], [82, 675, 207, 865]] },
  farm: { crop: [282, 0, 283, 1264], size: [256, 1024], top: 0.05, rects: [[43, 163, 113, 253], [171, 163, 241, 253], [43, 432, 113, 533], [171, 432, 241, 533], [98, 757, 188, 923]] },
  rowhouse: { crop: [283, 0, 283, 1264], size: [256, 1024], top: 0.04, neutral: 0.5, glass: (r, g, b, l) => l < 0.3 && b > r + 8 },
};

function readPixels(canvas) {
  return canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height).data;
}

function writeWebp(file, w, h, rgb, quality) {
  const canvas = createCanvas(w, h);
  const ctx = canvas.getContext("2d");
  const image = ctx.createImageData(w, h);
  for (let i = 0; i < w * h; i++) {
    image.data[i * 4] = rgb[i * 3];
    image.data[i * 4 + 1] = rgb[i * 3 + 1];
    image.data[i * 4 + 2] = rgb[i * 3 + 2];
    image.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(image, 0, 0);
  const bytes = canvas.toBuffer("image/webp", quality);
  writeFileSync(file, bytes);
  return bytes.length;
}

/** The cream a washed albedo leans to. */
const CREAM = [1.04, 1, 0.93];

/** The tile: the cropped bay scaled to `size`, its left and right edges cross-faded with the next bay's so it tiles across. */
async function tile(name, spec) {
  const image = await loadImage(join(resolve(folder), `${name}.png`));
  const [cx, cy, cw, ch] = spec.crop;
  const [w, h] = spec.size;
  const k = w / cw;
  const margin = Math.round(MARGIN * k);
  const wide = createCanvas(w + 2 * margin, h);
  const ctx = wide.getContext("2d");
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(image, cx - MARGIN, cy, cw + 2 * MARGIN, ch, 0, 0, w + 2 * margin, h);
  const src = readPixels(wide);
  const stride = wide.width;
  const rgb = new Uint8ClampedArray(w * h * 3);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const at = (sx) => (y * stride + sx) * 4;
      // Weight of the neighbouring bay's pixel: half at the seam, none a margin in.
      const edge = Math.min(x, w - 1 - x);
      const mix = edge < margin ? 0.5 * (1 - edge / margin) : 0;
      const here = at(x + margin);
      const other = at(x < w / 2 ? x + margin + w : x + margin - w);
      for (let c = 0; c < 3; c++) rgb[(y * w + x) * 3 + c] = src[here + c] * (1 - mix) + src[other + c] * mix;
    }
  }
  if (spec.background) {
    const [share, ...fill] = spec.background;
    for (let i = 0; i < Math.floor(share * h) * w; i++) if (Math.min(rgb[i * 3], rgb[i * 3 + 1], rgb[i * 3 + 2]) >= 238) for (let c = 0; c < 3; c++) rgb[i * 3 + c] = fill[c];
  }
  return rgb;
}

const lightness = (rgb, i) => (0.299 * rgb[i * 3] + 0.587 * rgb[i * 3 + 1] + 0.114 * rgb[i * 3 + 2]) / 255;

/** A wrapping-in-x, clamped-in-y box blur of a w×h plane, `r` texels each way. */
function blur(plane, w, h, r) {
  const tmp = new Float32Array(w * h);
  const res = new Float32Array(w * h);
  const n = 2 * r + 1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let s = 0;
      for (let k = -r; k <= r; k++) s += plane[y * w + ((x + k + w) % w)];
      tmp[y * w + x] = s / n;
    }
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let s = 0;
      for (let k = -r; k <= r; k++) s += tmp[Math.min(h - 1, Math.max(0, y + k)) * w + x];
      res[y * w + x] = s / n;
    }
  }
  return res;
}

/** Dilate (grow = true) or erode a 0/1 plane by `r` texels, in a square window. */
function morph(plane, w, h, r, grow) {
  const res = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let hit = grow ? 0 : 1;
      for (let dy = -r; dy <= r && (grow ? !hit : hit); dy++) {
        for (let dx = -r; dx <= r; dx++) {
          const yy = y + dy;
          const v = yy < 0 || yy >= h ? 0 : plane[yy * w + ((x + dx + w) % w)];
          if (grow ? v : !v) {
            hit = grow ? 1 : 0;
            break;
          }
        }
      }
      res[y * w + x] = hit;
    }
  }
  return res;
}

/** Windows below this many texels, or thinner than `MIN_SIDE`, are mouldings, rails and log ends, not glass. */
const MIN_AREA = 160;
const MIN_SIDE = 12;

/** Each window (a connected run of mask texels, wrapping in x) gets an id 1..255; a run too small or thin to be one is cleared from the mask. Returns the ids plane. */
function label(mask, w, h) {
  const ids = new Uint8Array(w * h);
  const seen = new Uint8Array(w * h);
  let next = 0;
  for (let start = 0; start < w * h; start++) {
    if (!mask[start] || seen[start]) continue;
    const members = [start];
    seen[start] = 1;
    let minY = h;
    let maxY = 0;
    const xs = new Set();
    for (let i = 0; i < members.length; i++) {
      const p = members[i];
      const x = p % w;
      const y = (p - x) / w;
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
      xs.add(x);
      for (const q of [y * w + ((x + 1) % w), y * w + ((x + w - 1) % w), y > 0 ? p - w : -1, y < h - 1 ? p + w : -1]) {
        if (q >= 0 && mask[q] && !seen[q]) {
          seen[q] = 1;
          members.push(q);
        }
      }
    }
    const window = members.length >= MIN_AREA && maxY - minY + 1 >= MIN_SIDE && xs.size >= MIN_SIDE;
    if (window) next = ((next * 97 + 61) % 254) + 1;
    for (const p of members) {
      ids[p] = window ? next : 0;
      if (!window) mask[p] = 0;
    }
  }
  return ids;
}

/** Each empty texel within `passes` texels of a nonzero one takes that one's value, so the threshold holds under the filtering at a window's edge. */
function spread(plane, w, h, passes) {
  let cur = plane;
  for (let pass = 0; pass < passes; pass++) {
    const next = Uint8Array.from(cur);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (cur[y * w + x]) continue;
        for (const q of [y * w + ((x + 1) % w), y * w + ((x + w - 1) % w), y > 0 ? (y - 1) * w + x : -1, y < h - 1 ? (y + 1) * w + x : -1]) {
          if (q >= 0 && cur[q]) {
            next[y * w + x] = cur[q];
            break;
          }
        }
      }
    }
    cur = next;
  }
  return cur;
}

for (const [name, spec] of Object.entries(STYLES)) {
  const [w, h] = spec.size;
  const rgb = await tile(name, spec);
  const light = Float32Array.from({ length: w * h }, (_, i) => lightness(rgb, i));

  const inRect = (i) => {
    const x = (i % w) / (w / spec.crop[2]);
    const y = Math.floor(i / w) / (h / spec.crop[3]);
    return spec.rects.some(([x0, y0, x1, y1]) => x >= x0 && x < x1 && y >= y0 && y < y1);
  };
  const glassAt = (i) => (spec.rects ? inRect(i) : spec.glass(rgb[i * 3], rgb[i * 3 + 1], rgb[i * 3 + 2], light[i]));
  const inBand = (i) => (spec.bands ?? []).some(([from, to]) => i >= from * h * w && i < to * h * w);
  const raw = Uint8Array.from({ length: w * h }, (_, i) => (i >= spec.top * h * w && !inBand(i) && glassAt(i) ? 1 : 0));
  const mask = morph(morph(raw, w, h, WINDOW_OPEN_RADIUS, false), w, h, WINDOW_OPEN_RADIUS, true);
  const ids = label(mask, w, h);

  // Height: the lightness, a wider blur for the mouldings' swell, the windows set back.
  const fine = blur(light, w, h, 1);
  const wide = blur(light, w, h, 4);
  const soft = blur(Float32Array.from(mask), w, h, 2);
  const height = Float32Array.from({ length: w * h }, (_, i) => 0.6 * fine[i] + 0.4 * wide[i] - 0.3 * soft[i]);
  const normal = new Uint8ClampedArray(w * h * 3);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const gx = (height[y * w + ((x + 1) % w)] - height[y * w + ((x + w - 1) % w)]) / 2;
      const gy = (height[Math.min(h - 1, y + 1) * w + x] - height[Math.max(0, y - 1) * w + x]) / 2;
      // Tangent space, +v up: the picture's down is -v, so a rise towards the bottom tilts the normal up the picture's y.
      const nx = -gx * NORMAL_STRENGTH * 8;
      const ny = gy * NORMAL_STRENGTH * 8;
      const len = Math.hypot(nx, ny, 1);
      const o = (y * w + x) * 3;
      normal[o] = ((nx / len) * 0.5 + 0.5) * 255;
      normal[o + 1] = ((ny / len) * 0.5 + 0.5) * 255;
      normal[o + 2] = ((1 / len) * 0.5 + 0.5) * 255;
    }
  }

  const gw = w / GLOW_DOWN;
  const gh = h / GLOW_DOWN;
  const glow = new Uint8ClampedArray(gw * gh * 3);
  const thresholds = new Uint8Array(gw * gh);
  const glowMask = blur(Float32Array.from(mask), w, h, GLOW_BLUR);
  for (let y = 0; y < gh; y++) {
    for (let x = 0; x < gw; x++) {
      let cover = 0;
      let id = 0;
      for (let dy = 0; dy < GLOW_DOWN; dy++) {
        for (let dx = 0; dx < GLOW_DOWN; dx++) {
          const p = (y * GLOW_DOWN + dy) * w + x * GLOW_DOWN + dx;
          cover += glowMask[p];
          id = Math.max(id, ids[p]);
        }
      }
      glow[(y * gw + x) * 3] = (cover / (GLOW_DOWN * GLOW_DOWN)) * 255;
      thresholds[y * gw + x] = id;
    }
  }
  const spreadThresholds = spread(thresholds, gw, gh, GLOW_SPREAD);
  for (let i = 0; i < gw * gh; i++) glow[i * 3 + 1] = spreadThresholds[i];

  // A bare patch of wall: the flattest 10×10 window clear of every window, for the roof slab to sample.
  const clear = morph(mask, w, h, 6, true);
  let best = Infinity;
  let plain = [0, 0];
  for (let y = 8; y < h - 18; y += 4) {
    for (let x = 8; x < w - 18; x += 4) {
      let sum = 0;
      let sq = 0;
      let bad = false;
      for (let dy = 0; dy < 10 && !bad; dy++) {
        for (let dx = 0; dx < 10; dx++) {
          const p = (y + dy) * w + x + dx;
          if (clear[p]) {
            bad = true;
            break;
          }
          sum += light[p];
          sq += light[p] * light[p];
        }
      }
      const variance = sq / 100 - (sum / 100) ** 2;
      if (!bad && variance < best) {
        best = variance;
        plain = [(x + 5) / w, 1 - (y + 5) / h];
      }
    }
  }

  if (spec.neutral) {
    for (let i = 0; i < w * h; i++) for (let c = 0; c < 3; c++) rgb[i * 3 + c] = rgb[i * 3 + c] * (1 - spec.neutral) + light[i] * 255 * CREAM[c] * spec.neutral;
  }
  const bytes = [
    writeWebp(join(out, `${name}-albedo.webp`), w, h, rgb, WEBP_QUALITY),
    writeWebp(join(out, `${name}-normal.webp`), w, h, normal, 95),
    writeWebp(join(out, `${name}-glow.webp`), gw, gh, glow, 100),
  ];
  console.log(`${name}: ${w}x${h} albedo ${bytes[0]} B, normal ${bytes[1]} B, glow ${bytes[2]} B; windows ${new Set(ids).size - 1}; plain [${plain.map((v) => v.toFixed(3)).join(", ")}]`);
}
