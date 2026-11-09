/**
 * Packs the building facades from one generated flat-on elevation per style (<style>.png in the folder given) into LAYERS, read by
 * `src/game/present/facades.ts` as array textures (`texture-array.ts`): one webp strip per map, `public/facades/<style>-{albedo,normal,glow}.webp`, each layer
 * its own picture of LAYER texels square, stacked top to bottom. The layers are the regions of a building: cornice (the roofline band), floor (one storey,
 * repeated up the wall: its top and bottom edges are cross-faded so it tiles), ground (the shopfront or entrance band) and, where a style has them, quoin (the
 * corner stones, made here from the wall's own colour). Each is cut from the picture between the rows `STYLES` gives, one bay wide (cut from pilaster to pilaster
 * and cross-faded at its sides so it tiles across), and scaled to LAYER x LAYER. The normal map of a layer is derived from its lightness (windows set back);
 * the glow map (GLOW_LAYER square) is R the window mask and G a turn-on threshold per window.
 *
 * A style with `relief` also gets `<style>-height.webp` and `<style>-roughness.webp` (layers like the albedo's: windows and doors recessed, sills, lintels and the cornice proud; glass and wet sills
 * shiny), read only by the relief tier; one with `neon` has its sign texels (the bright ones inside its `neon` boxes) in the glow strip's blue, lit in their own colour at night.
 *
 * It packs the styles whose <style>.png the folder holds and merges them by key into `src/game/present/facade-layers.json`: per style its bays, layer count, each band's height in metres (the picture's own
 * scale), a bare patch of wall (u, v in the floor layer) for the roof slab's sides, and `height`, `roughness`, `neon` where it has those strips. A style whose picture is not in the folder is left as it was.
 *
 *   node scripts/pack-facades.mjs <folder with <style>.png> [out folder, default public/facades] [json, default src/game/present/facade-layers.json]
 */
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { createCanvas as makeCanvas } from "@napi-rs/canvas";
import { BAY_WIDTH, ROWHOME_FLOOR_Y, SHOP_FLOOR_Y, SHOPFRONT } from "../src/game/world/openworld/interior-kinds.ts";
import { drawnHalf } from "../src/game/world/openworld/openworld-facade-solids.ts";
import { writeWebp } from "./pack-tile-lib.mjs";
import { blur, downPlane, heightOf, label, morph, roughnessOf, spread } from "./pack-window-lib.mjs";

const root = join(dirname(new URL(import.meta.url).pathname), "..");
const [folder, outArg, jsonArg] = process.argv.slice(2);
if (folder === undefined) throw new Error("usage: pack-facades.mjs <folder with <style>.png> [out folder] [json]");
const out = resolve(outArg ?? join(root, "public/facades"));
const jsonFile = resolve(jsonArg ?? join(root, "src/game/present/facade-layers.json"));
mkdirSync(out, { recursive: true });

/** A face's width (m): `building()` in prefabs.ts lays 11.8 m faces. */
const FACE_M = 11.8;
/** A layer's edge (texels); the glow layers are half of it. */
const LAYER = 256;
const GLOW_LAYER = 128;
/** Source pixels either side of a bay that the cross-fade reaches over, and rows the floor layer's top and bottom are cross-faded over. */
const MARGIN = 18;
const FLOOR_FADE_ROWS = 10;
const WEBP_QUALITY = 90;
const NORMAL_QUALITY = 95;
const WINDOW_OPEN_RADIUS = 2;
const GLOW_SPREAD = 3;
/** Texels the window mask is blurred by: the shader sharpens it back, so a half-size map keeps smooth window edges. */
const GLOW_BLUR = 3;
/** How steeply a layer's lightness tilts its normal. */
const RELIEF = { cornice: 6, floor: 5, ground: 5.5, quoin: 7 };
/** The cream a washed albedo leans to. */
const CREAM = [1.04, 1, 0.93];
/** Quoin stones: courses over a layer, the share of the strip a short course's stone covers, the joint width (texels), the pale stone the wall's colour leans to and by how much. */
const QUOIN_COURSES = 6;
const QUOIN_SHORT = 0.7;
const QUOIN_JOINT = 3;
const QUOIN_STONE = [226, 219, 202];
const QUOIN_LEAN = 0.55;
/** How far (as a share of the layer's mean lightness) a bare-wall patch may lie from it. */
const PLAIN_BAND = 0.25;
/** The relief strips' quality (their values are smooth: a high one keeps a recess's edge), the height a cornice layer is lifted by (it projects from the wall), and texels a sign's mask is grown by to clear the window mask round it. */
const RELIEF_QUALITY = 98;
const CORNICE_LIFT = 0.12;
const NEON_CLEAR = 2;

/**
 * crop [x, y, w, h] in the source (x is the bay's left pilaster centre, w one period); bays across a 11.8 m face; the rows (crop-relative) of the three bands:
 * cornice, floor (one storey) and ground; the glass: `rects` (window boxes, crop-relative, where colour cannot tell glass from wall) or `glass`, a predicate over (r, g, b)
 * in 0..255 and lightness; `quoins` whether the style has corner stones; `neutral` how far the albedo is washed to cream so the per-instance pastel tints colour it;
 * `background` [share, r, g, b, min]: sky (every channel at least `min`) above that share of the picture is painted that colour; `relief`: the style has height and roughness strips; `neon`
 * { rects, bright }: sign boxes (crop-relative like `rects`) whose texels with a channel of at least `bright` are lit signs; `metres`: the bands' heights in block metres, set by hand where
 * the picture's own scale is not the building's (a building drawn `H` m tall is stretched by H / 14); `open` { kind, floorY, ground }: the style's doorways (`SHOPFRONT[kind]`, per bay) are cut through the
 * ground layer's albedo alpha, `ground` being the ground band's height in world metres.
 */
/** A building of `height` m draws at height / BLOCK_HEIGHT of the 14 m block: bands in block metres that come out at the world heights `cornice`, `floor`, `ground`. */
const BLOCK_HEIGHT = 14;
const metresFor = (height, { cornice, floor, ground }) => {
  const k = BLOCK_HEIGHT / height;
  return { cornice: Math.round(cornice * k * 100) / 100, floor: Math.round(floor * k * 100) / 100, ground: Math.round(ground * k * 100) / 100 };
};
const HOME = metresFor(10.9, { cornice: 0.9, floor: 3.2, ground: 3.6 });
const SHOP = metresFor(11.3, { cornice: 0.9, floor: 3.2, ground: 4 });
const MARKET = metresFor(8.1, { cornice: 0.9, floor: 3.2, ground: 4 });
const STYLES = {
  prague: { crop: [288, 0, 270, 1264], bays: 4, cornice: [0, 395], floor: [688, 1035], ground: [1035, 1264], quoins: true, rects: [[95, 268, 177, 352], [95, 790, 177, 963], [66, 1130, 207, 1264]] },
  dc: { crop: [283, 0, 282, 1264], bays: 4, cornice: [0, 235], floor: [235, 528], ground: [838, 1264], quoins: true, rects: [[57, 172, 117, 230], [167, 172, 227, 230], [110, 312, 175, 455], [54, 327, 80, 468], [204, 327, 230, 468], [49, 897, 105, 1045], [180, 893, 243, 925]] },
  stucco: { crop: [300, 44, 262, 1194], bays: 4, cornice: [0, 166], floor: [166, 486], ground: [800, 1194], quoins: false, neutral: 0.8, glass: (r, g, b, l) => l < 0.5 },
  glass: { crop: [185, 0, 480, 1264], bays: 2, cornice: [0, 120], floor: [120, 322], ground: [920, 1264], quoins: false, rects: [[25, 125, 455, 240], [45, 935, 440, 1070], [45, 1135, 440, 1262]] },
  adobe: { crop: [283, 668, 282, 596], bays: 2, cornice: [0, 42], floor: [42, 227], ground: [412, 596], quoins: false, glass: (r, g, b, l) => l < 0.42 },
  shops: { crop: [270, 0, 308, 1264], bays: 4, cornice: [0, 330], floor: [330, 635], ground: [925, 1264], quoins: false, rects: [[110, 152, 198, 292], [110, 417, 198, 590], [25, 1090, 105, 1205], [220, 1090, 290, 1205], [125, 1080, 185, 1245]] },
  baroque: { crop: [282, 0, 283, 1264], bays: 4, cornice: [0, 400], floor: [688, 965], ground: [968, 1264], quoins: true, background: [0.17, 214, 206, 192, 215], rects: [[76, 312, 130, 384], [153, 312, 208, 384], [76, 782, 130, 905], [153, 782, 208, 905], [78, 1105, 206, 1215]] },
  havana: { crop: [282, 0, 280, 1264], bays: 4, cornice: [0, 135], floor: [135, 443], ground: [1005, 1264], quoins: false, glass: (r, g, b, l) => l < 0.4 },
  federal: { crop: [300, 0, 246, 1264], bays: 4, cornice: [0, 255], floor: [455, 690], ground: [938, 1264], quoins: false, rects: [[90, 525, 160, 655], [65, 1020, 180, 1250]] },
  warehouse: { crop: [280, 0, 287, 1264], bays: 4, cornice: [0, 352], floor: [352, 642], ground: [940, 1264], quoins: false, rects: [[82, 95, 207, 290], [82, 385, 207, 575]] },
  farm: { crop: [282, 0, 284, 1264], bays: 4, cornice: [0, 45], floor: [655, 905], ground: [905, 1264], quoins: false, rects: [[24, 685, 78, 750], [115, 685, 169, 750], [206, 685, 260, 750]] },
  rowbrick: { mirror: true, crop: [85, 0, 677, 1264], bays: 1, cornice: [72, 135], floor: [135, 477], ground: [843, 1228], quoins: false, rects: [[107, 172, 223, 388], [456, 172, 572, 388], [160, 878, 323, 1108], [507, 880, 633, 930]], metres: HOME, open: { kind: "rowhome", floorY: ROWHOME_FLOOR_Y, ground: 3.6 } },
  rowpainted: { mirror: true, crop: [0, 0, 848, 1264], bays: 1, cornice: [45, 125], floor: [132, 453], ground: [818, 1250], quoins: false, rects: [[162, 165, 305, 365], [545, 165, 688, 365], [212, 868, 402, 1125], [650, 870, 780, 925]], metres: HOME, open: { kind: "rowhome", floorY: ROWHOME_FLOOR_Y, ground: 3.6 } },
  coffee: { crop: [68, 0, 712, 1264], bays: 1, cornice: [68, 138], floor: [138, 478], ground: [757, 1225], quoins: false, rects: [[137, 175, 272, 390], [442, 175, 574, 390], [54, 960, 240, 1130], [474, 960, 659, 1130], [310, 985, 402, 1195]], metres: SHOP, open: { kind: "coffee", floorY: SHOP_FLOOR_Y, ground: 4 } },
  bar: { crop: [93, 0, 540, 848], bays: 2, cornice: [38, 115], floor: [115, 320], ground: [510, 840], quoins: false, rects: [[112, 130, 209, 262], [320, 130, 425, 262], [50, 642, 139, 730], [394, 642, 480, 730]], neon: { rects: [[67, 660, 122, 715], [417, 660, 452, 708]], bright: 170 }, metres: SHOP, open: { kind: "bar", floorY: SHOP_FLOOR_Y, ground: 4 } },
  office: { crop: [10, 0, 622, 848], bays: 2, cornice: [85, 125], floor: [125, 345], ground: [565, 848], quoins: false, glass: (r, g, b) => b - r > 30, metres: SHOP, open: { kind: "office", floorY: SHOP_FLOOR_Y, ground: 4 } },
  cornerstore: { crop: [100, 0, 532, 848], bays: 2, cornice: [48, 125], floor: [130, 330], ground: [492, 848], quoins: false, rects: [[105, 155, 190, 275], [347, 155, 430, 275], [230, 637, 508, 790]], neon: { rects: [[243, 643, 293, 672]], bright: 170 }, metres: SHOP, open: { kind: "store", floorY: SHOP_FLOOR_Y, ground: 4 } },
  supermarket: { crop: [72, 0, 280, 848], bays: 2, cornice: [185, 235], floor: [235, 380], ground: [380, 800], quoins: false, rects: [[48, 270, 96, 315], [188, 270, 236, 315], [8, 578, 272, 640], [8, 662, 272, 800]], metres: MARKET },
  rowhouse: { crop: [233, 0, 383, 1264], bays: 3, cornice: [0, 275], floor: [275, 548], ground: [838, 1264], quoins: false, rects: [[159, 165, 225, 275], [159, 350, 224, 490], [95, 365, 119, 505], [264, 365, 288, 505], [254, 912, 322, 1060], [52, 910, 126, 942], [257, 1160, 322, 1240]] },
};

const lightOf = (rgb, i) => (0.299 * rgb[i * 3] + 0.587 * rgb[i * 3 + 1] + 0.114 * rgb[i * 3 + 2]) / 255;

/** The bay: the crop scaled to LAYER wide, its left and right edges cross-faded with the next bay's so it tiles across; `rgb` floats 0..255 and its height `h`. */
async function bayPicture(name, spec) {
  const image = await loadImage(join(resolve(folder), `${name}.png`));
  const [cx, cy, cw, ch] = spec.crop;
  const k = LAYER / cw;
  const h = Math.round(ch * k);
  const margin = Math.round(MARGIN * k);
  const wide = createCanvas(LAYER + 2 * margin, h);
  const ctx = wide.getContext("2d");
  ctx.imageSmoothingQuality = "high";
  // A building face's u runs to the viewer's right, which is the building's local -z: a style drawn the other way round (`mirror`) is flipped to match the plan.
  if (spec.mirror) {
    ctx.translate(LAYER + 2 * margin, 0);
    ctx.scale(-1, 1);
  }
  ctx.drawImage(image, cx - MARGIN, cy, cw + 2 * MARGIN, ch, 0, 0, LAYER + 2 * margin, h);
  const src = ctx.getImageData(0, 0, wide.width, h).data;
  const rgb = new Float32Array(LAYER * h * 3);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < LAYER; x++) {
      // Weight of the neighbouring bay's pixel: half at the seam, none a margin in.
      const edge = Math.min(x, LAYER - 1 - x);
      const mix = edge < margin ? 0.5 * (1 - edge / margin) : 0;
      const here = (y * wide.width + x + margin) * 4;
      const other = (y * wide.width + (x < LAYER / 2 ? x + margin + LAYER : x + margin - LAYER)) * 4;
      for (let c = 0; c < 3; c++) rgb[(y * LAYER + x) * 3 + c] = mix > 0 ? src[here + c] * (1 - mix) + src[other + c] * mix : src[here + c];
    }
  }
  if (spec.background) {
    const [share, r, g, b, min] = spec.background;
    const fill = [r, g, b];
    for (let i = 0; i < Math.floor(share * h) * LAYER; i++) if (Math.min(rgb[i * 3], rgb[i * 3 + 1], rgb[i * 3 + 2]) >= min) for (let c = 0; c < 3; c++) rgb[i * 3 + c] = fill[c];
  }
  return { rgb, h, k };
}

/** Rows [r0, r1) of the bay (one row is LAYER texels), scaled in y to LAYER rows by linear interpolation. */
function resizeRows(bay, r0, r1) {
  const rows = r1 - r0;
  const out = new Float32Array(LAYER * LAYER * 3);
  for (let y = 0; y < LAYER; y++) {
    const at = ((y + 0.5) * rows) / LAYER - 0.5;
    const a = Math.min(rows - 1, Math.max(0, Math.floor(at)));
    const b = Math.min(rows - 1, a + 1);
    const t = Math.min(1, Math.max(0, at - a));
    for (let x = 0; x < LAYER * 3; x++) out[y * LAYER * 3 + x] = bay[(r0 + a) * LAYER * 3 + x] * (1 - t) + bay[(r0 + b) * LAYER * 3 + x] * t;
  }
  return out;
}

/** One band as a layer; the floor's top and bottom edges are blended with the rows past them, so a storey tiles on itself up the wall. */
function bandLayer(picture, [y0, y1], tiles) {
  const r0 = Math.round(y0 * picture.k);
  const r1 = Math.round(y1 * picture.k);
  if (!tiles) return resizeRows(picture.rgb, r0, r1);
  const rows = r1 - r0;
  const fade = FLOOR_FADE_ROWS;
  const band = new Float32Array(rows * LAYER * 3);
  const row = (r) => picture.rgb.subarray(r * LAYER * 3, (r + 1) * LAYER * 3);
  for (let y = 0; y < rows; y++) {
    let other = null;
    let w = 0;
    if (y < fade) {
      other = row(r1 + y);
      w = 0.5 * (1 - y / fade);
    } else if (y >= rows - fade) {
      other = row(r0 + y - rows);
      w = 0.5 * (1 - (rows - 1 - y) / fade);
    }
    const here = row(r0 + y);
    for (let x = 0; x < LAYER * 3; x++) band[y * LAYER * 3 + x] = other ? here[x] * (1 - w) + other[x] * w : here[x];
  }
  return resizeRows(band, 0, rows);
}

/** A cheap hash in 0..1 of two integers: the quoin stones' per-block tone. */
function hash2(a, b) {
  let h = Math.imul(a ^ Math.imul(b + 1, 0x9e3779b9), 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** The corner stones: courses of pale stone made from the wall's mean colour, every other course short, joints between (deterministic). */
function quoinLayer(floor) {
  const mean = [0, 0, 0];
  for (let i = 0; i < LAYER * LAYER; i++) for (let c = 0; c < 3; c++) mean[c] += floor[i * 3 + c] / (LAYER * LAYER);
  const stone = mean.map((m, c) => m * (1 - QUOIN_LEAN) + QUOIN_STONE[c] * QUOIN_LEAN);
  const wall = mean.map((m) => m * 0.72);
  const rgb = new Float32Array(LAYER * LAYER * 3);
  const course = LAYER / QUOIN_COURSES;
  for (let y = 0; y < LAYER; y++) {
    const j = Math.floor(y / course);
    const edge = y - j * course;
    const reach = j % 2 === 0 ? LAYER : Math.round(LAYER * QUOIN_SHORT);
    for (let x = 0; x < LAYER; x++) {
      const joint = edge < QUOIN_JOINT || x >= reach - QUOIN_JOINT / 2 && x < reach + QUOIN_JOINT / 2;
      const base = x < reach ? stone : wall;
      const tone = (x < reach ? 0.94 + 0.12 * hash2(j, 3) : 1) * (0.97 + 0.06 * hash2(x >> 2, y >> 2));
      for (let c = 0; c < 3; c++) rgb[(y * LAYER + x) * 3 + c] = joint ? base[c] * 0.5 : base[c] * tone;
    }
  }
  return rgb;
}

/** The window mask of one layer (LAYER square, 0/1): boxes that fall in the layer's band (from `rects`) or the predicate over its colours. */
function windowMask(spec, rgb, band) {
  const mask = new Uint8Array(LAYER * LAYER);
  const [y0, y1] = band;
  const kx = LAYER / spec.crop[2];
  const ky = LAYER / (y1 - y0);
  if (spec.rects) {
    for (const [rx0, ry0, rx1, ry1] of spec.rects) {
      if (ry0 < y0 - 1 || ry1 > y1 + 1) continue;
      const [fx0, fx1] = spec.mirror ? [spec.crop[2] - rx1, spec.crop[2] - rx0] : [rx0, rx1];
      for (let y = Math.max(0, Math.floor((ry0 - y0) * ky)); y < Math.min(LAYER, Math.ceil((ry1 - y0) * ky)); y++) {
        for (let x = Math.max(0, Math.floor(fx0 * kx)); x < Math.min(LAYER, Math.ceil(fx1 * kx)); x++) mask[y * LAYER + x] = 1;
      }
    }
    return mask;
  }
  for (let i = 0; i < LAYER * LAYER; i++) mask[i] = spec.glass(rgb[i * 3], rgb[i * 3 + 1], rgb[i * 3 + 2], lightOf(rgb, i)) ? 1 : 0;
  return mask;
}

/** The sign mask of one layer (LAYER square, 0/1): the texels of the style's `neon` boxes that fall in the layer's band and have a channel of at least `bright`. */
function neonMask(spec, rgb, band) {
  const mask = new Uint8Array(LAYER * LAYER);
  if (!spec.neon) return mask;
  const [y0, y1] = band;
  const kx = LAYER / spec.crop[2];
  const ky = LAYER / (y1 - y0);
  for (const [rx0, ry0, rx1, ry1] of spec.neon.rects) {
    if (ry0 < y0 - 1 || ry1 > y1 + 1) continue;
    const [fx0, fx1] = spec.mirror ? [spec.crop[2] - rx1, spec.crop[2] - rx0] : [rx0, rx1];
    for (let y = Math.max(0, Math.floor((ry0 - y0) * ky)); y < Math.min(LAYER, Math.ceil((ry1 - y0) * ky)); y++) {
      for (let x = Math.max(0, Math.floor(fx0 * kx)); x < Math.min(LAYER, Math.ceil(fx1 * kx)); x++) {
        const p = y * LAYER + x;
        if (Math.max(rgb[p * 3], rgb[p * 3 + 1], rgb[p * 3 + 2]) >= spec.neon.bright) mask[p] = 1;
      }
    }
  }
  return mask;
}

/** A plane of floats 0..1 as a grey layer (floats 0..255, three per texel). */
function grey(plane) {
  const rgb = new Float32Array(plane.length * 3);
  for (let i = 0; i < plane.length; i++) rgb.fill(plane[i] * 255, i * 3, i * 3 + 3);
  return rgb;
}

/** The normal map of a layer (floats 0..255): lightness for the fine relief, a wider blur for the mouldings' swell, the windows set back. */
function normalOf(rgb, mask, relief) {
  const light = Float32Array.from({ length: LAYER * LAYER }, (_, i) => lightOf(rgb, i));
  const fine = blur(light, LAYER, LAYER, 1);
  const wide = blur(light, LAYER, LAYER, 4);
  const soft = blur(Float32Array.from(mask), LAYER, LAYER, 2);
  const height = Float32Array.from({ length: LAYER * LAYER }, (_, i) => 0.6 * fine[i] + 0.4 * wide[i] - 0.3 * soft[i]);
  const normal = new Float32Array(LAYER * LAYER * 3);
  for (let y = 0; y < LAYER; y++) {
    for (let x = 0; x < LAYER; x++) {
      const gx = (height[y * LAYER + ((x + 1) % LAYER)] - height[y * LAYER + ((x + LAYER - 1) % LAYER)]) / 2;
      const gy = (height[Math.min(LAYER - 1, y + 1) * LAYER + x] - height[Math.max(0, y - 1) * LAYER + x]) / 2;
      // Tangent space, +v up: the picture's down is -v, so a rise towards the bottom tilts the normal up the picture's y.
      const nx = -gx * relief * 8;
      const ny = gy * relief * 8;
      const len = Math.hypot(nx, ny, 1);
      const o = (y * LAYER + x) * 3;
      normal[o] = ((nx / len) * 0.5 + 0.5) * 255;
      normal[o + 1] = ((ny / len) * 0.5 + 0.5) * 255;
      normal[o + 2] = ((1 / len) * 0.5 + 0.5) * 255;
    }
  }
  return normal;
}

/** The glow layer (GLOW_LAYER square floats 0..255, R the window, G its threshold) of a mask. */
function glowOf(rawMask) {
  const mask = morph(morph(rawMask, LAYER, LAYER, WINDOW_OPEN_RADIUS, false), LAYER, LAYER, WINDOW_OPEN_RADIUS, true);
  const ids = label(mask, LAYER, LAYER);
  const down = LAYER / GLOW_LAYER;
  const blurred = blur(Float32Array.from(mask), LAYER, LAYER, GLOW_BLUR);
  const glow = new Float32Array(GLOW_LAYER * GLOW_LAYER * 3);
  const thresholds = new Uint8Array(GLOW_LAYER * GLOW_LAYER);
  for (let y = 0; y < GLOW_LAYER; y++) {
    for (let x = 0; x < GLOW_LAYER; x++) {
      let cover = 0;
      let id = 0;
      for (let dy = 0; dy < down; dy++) {
        for (let dx = 0; dx < down; dx++) {
          const p = (y * down + dy) * LAYER + x * down + dx;
          cover += blurred[p];
          id = Math.max(id, ids[p]);
        }
      }
      glow[(y * GLOW_LAYER + x) * 3] = (cover / (down * down)) * 255;
      thresholds[y * GLOW_LAYER + x] = id;
    }
  }
  const spreadThresholds = spread(thresholds, GLOW_LAYER, GLOW_LAYER, GLOW_SPREAD);
  for (let i = 0; i < GLOW_LAYER * GLOW_LAYER; i++) glow[i * 3 + 1] = spreadThresholds[i];
  return { glow, mask, windows: new Set(ids).size - 1 };
}

/** The flattest 10 x 10 patch of the floor layer clear of every window: (u, v) of its centre, for the roof slab's sides to sample. */
function plainPatch(rgb, mask) {
  const clear = morph(mask, LAYER, LAYER, 6, true);
  let meanLight = 0;
  for (let i = 0; i < LAYER * LAYER; i++) meanLight += lightOf(rgb, i) / (LAYER * LAYER);
  let best = Infinity;
  let at = [0.5, 0.5];
  for (let y = 8; y < LAYER - 18; y += 4) {
    for (let x = 8; x < LAYER - 18; x += 4) {
      let sum = 0;
      let sq = 0;
      let bad = false;
      for (let dy = 0; dy < 10 && !bad; dy++) {
        for (let dx = 0; dx < 10; dx++) {
          const p = (y + dy) * LAYER + x + dx;
          if (clear[p]) {
            bad = true;
            break;
          }
          sum += lightOf(rgb, p);
          sq += lightOf(rgb, p) ** 2;
        }
      }
      const variance = sq / 100 - (sum / 100) ** 2;
      // Not a shadow or a dark frame: a patch near the layer's own lightness, or a roof's edge takes its black.
      const typical = Math.abs(sum / 100 - meanLight) < PLAIN_BAND * meanLight;
      if (!bad && typical && variance < best) {
        best = variance;
        at = [(x + 5) / LAYER, 1 - (y + 5) / LAYER];
      }
    }
  }
  return at;
}

/** The ground layer's albedo alpha (LAYER square, 0 in a doorway): the style's `SHOPFRONT` doorways of one bay, mapped from metres across the bay's drawn width (the layer's u runs toward the plan's -across) and up the ground band. Windows stay painted: a room behind a shut door is not built, so nothing is seen through them. */
function openingAlpha(open) {
  const alpha = new Uint8Array(LAYER * LAYER).fill(255);
  const half = drawnHalf(BAY_WIDTH);
  for (const opening of SHOPFRONT[open.kind]) {
    if (!opening.door) continue;
    const x0 = Math.round(((half - (opening.centre + opening.width / 2)) / (2 * half)) * LAYER);
    const x1 = Math.round(((half - (opening.centre - opening.width / 2)) / (2 * half)) * LAYER);
    const y0 = Math.round(((open.ground - (open.floorY + opening.top)) / open.ground) * LAYER);
    const y1 = Math.round(((open.ground - (open.floorY + opening.sill)) / open.ground) * LAYER);
    for (let y = Math.max(0, y0); y < Math.min(LAYER, y1); y++) for (let x = Math.max(0, x0); x < Math.min(LAYER, x1); x++) alpha[y * LAYER + x] = 0;
  }
  return alpha;
}

/** floats 0..255 (3 per texel) with `alpha` (a byte per texel) as a webp: the albedo strip of a style with openings. */
function writeWebpAlpha(file, width, height, rgb, alpha, quality) {
  const canvas = makeCanvas(width, height);
  const ctx = canvas.getContext("2d");
  const image = ctx.createImageData(width, height);
  for (let i = 0; i < width * height; i++) {
    for (let c = 0; c < 3; c++) image.data[i * 4 + c] = rgb[i * 3 + c];
    image.data[i * 4 + 3] = alpha[i];
  }
  ctx.putImageData(image, 0, 0);
  const bytes = canvas.toBuffer("image/webp", quality);
  writeFileSync(file, bytes);
  return bytes.length;
}

/** Layers stacked into one strip (floats 0..255, three per texel). */
function stack(layers, size) {
  const strip = new Float32Array(layers.length * size * size * 3);
  for (const [i, layer] of layers.entries()) strip.set(layer, i * size * size * 3);
  return strip;
}

const BANDS = ["cornice", "floor", "ground"];
const metadata = existsSync(jsonFile) ? JSON.parse(readFileSync(jsonFile, "utf8")) : {};
for (const [name, spec] of Object.entries(STYLES)) {
  if (!existsSync(join(resolve(folder), `${name}.png`))) continue;
  const picture = await bayPicture(name, spec);
  const rgbs = BANDS.map((band) => bandLayer(picture, spec[band], band === "floor"));
  if (spec.neutral) {
    for (const rgb of rgbs) {
      for (let i = 0; i < LAYER * LAYER; i++) for (let c = 0; c < 3; c++) rgb[i * 3 + c] = rgb[i * 3 + c] * (1 - spec.neutral) + lightOf(rgb, i) * 255 * CREAM[c] * spec.neutral;
    }
  }
  const names = spec.quoins ? [...BANDS, "quoin"] : BANDS;
  if (spec.quoins) rgbs.push(quoinLayer(rgbs[1]));
  // Corner stones have no glass; a cornice has none unless boxes say so (a colour test would take its shadows for glass).
  const hasGlass = (layer) => layer !== "quoin" && (layer !== "cornice" || spec.rects);
  const masks = rgbs.map((rgb, i) => (hasGlass(names[i]) ? windowMask(spec, rgb, spec[names[i]]) : new Uint8Array(LAYER * LAYER)));
  // A sign is lit in its own colour from the glow strip's blue: the window mask leaves it.
  const signs = rgbs.map((rgb, i) => {
    const sign = hasGlass(names[i]) ? neonMask(spec, rgb, spec[names[i]]) : new Uint8Array(LAYER * LAYER);
    if (spec.neon) {
      const grown = morph(sign, LAYER, LAYER, NEON_CLEAR, true);
      for (let p = 0; p < LAYER * LAYER; p++) if (grown[p]) masks[i][p] = 0;
    }
    return sign;
  });
  const glows = masks.map((mask) => glowOf(mask));
  if (spec.neon) {
    for (const [i, sign] of signs.entries()) {
      const cover = downPlane(blur(Float32Array.from(morph(sign, LAYER, LAYER, 1, true)), LAYER, LAYER, 1), LAYER, LAYER / GLOW_LAYER);
      for (let p = 0; p < GLOW_LAYER * GLOW_LAYER; p++) glows[i].glow[p * 3 + 2] = cover[p];
    }
  }
  const normals = rgbs.map((rgb, i) => normalOf(rgb, glows[i].mask, RELIEF[names[i]]));
  const bytes = [
    spec.open
      ? writeWebpAlpha(join(out, `${name}-albedo.webp`), LAYER, LAYER * rgbs.length, stack(rgbs, LAYER), Uint8Array.from({ length: LAYER * LAYER * rgbs.length }, (_, i) => (Math.floor(i / (LAYER * LAYER)) === 2 ? openingAlpha(spec.open)[i % (LAYER * LAYER)] : 255)), WEBP_QUALITY)
      : writeWebp(join(out, `${name}-albedo.webp`), LAYER, LAYER * rgbs.length, stack(rgbs, LAYER), WEBP_QUALITY),
    writeWebp(join(out, `${name}-normal.webp`), LAYER, LAYER * rgbs.length, stack(normals, LAYER), NORMAL_QUALITY),
    writeWebp(join(out, `${name}-glow.webp`), GLOW_LAYER, GLOW_LAYER * rgbs.length, stack(glows.map((g) => g.glow), GLOW_LAYER), 100),
  ];
  if (spec.relief) {
    const heights = rgbs.map((rgb, i) => grey(heightOf(rgb, glows[i].mask, LAYER, names[i] === "cornice" ? CORNICE_LIFT : 0)));
    const roughnesses = rgbs.map((rgb, i) => grey(roughnessOf(rgb, glows[i].mask, LAYER)));
    bytes.push(
      writeWebp(join(out, `${name}-height.webp`), LAYER, LAYER * rgbs.length, stack(heights, LAYER), RELIEF_QUALITY),
      writeWebp(join(out, `${name}-roughness.webp`), LAYER, LAYER * rgbs.length, stack(roughnesses, LAYER), RELIEF_QUALITY),
    );
  }
  const [, , cw] = spec.crop;
  const metresPerRow = FACE_M / spec.bays / cw;
  const bandMetres = (band) => Math.round((spec[band][1] - spec[band][0]) * metresPerRow * 100) / 100;
  metadata[name] = {
    bays: spec.bays,
    layers: rgbs.length,
    metres: spec.metres ?? { cornice: bandMetres("cornice"), floor: bandMetres("floor"), ground: bandMetres("ground") },
    plain: plainPatch(rgbs[1], glows[1].mask).map((v) => Math.round(v * 1000) / 1000),
    ...(spec.relief ? { height: true, roughness: true } : {}),
    ...(spec.neon ? { neon: true } : {}),
    ...(spec.open ? { open: true } : {}),
  };
  console.log(`${name}: ${rgbs.length} layers, albedo ${bytes[0]} B, normal ${bytes[1]} B, glow ${bytes[2]} B${bytes[3] ? `, height ${bytes[3]} B, roughness ${bytes[4]} B` : ""}; windows ${glows.map((g) => g.windows).join("/")}; ${JSON.stringify(metadata[name].metres)}`);
}
writeFileSync(jsonFile, `${JSON.stringify(metadata, null, 2)}\n`);
