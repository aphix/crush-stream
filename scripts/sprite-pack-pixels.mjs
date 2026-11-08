/**
 * The pixel work behind `sprite-pack.mjs`: keying a picture's background to alpha, trimming, resampling, halving, tangent-space normals and webp encoding.
 * An "image" here is { width, height, data }, `data` a Float32Array of RGBA texels with every channel (alpha too) in 0..255.
 */
import { createCanvas, loadImage } from "@napi-rs/canvas";

/** Side of the corner patches whose median colour is the picture's background (the renders are not pure white). */
const BACKGROUND_PATCH = 16;
/** A texel whose darkest channel is within this of the background's darkest is background: soft ground shadows and render noise still read as background. */
const BACKGROUND_SLACK = 22;
/** Inside the edge band alpha reaches 1 once the darkest channel is this far below the background's darkest. */
const EDGE_OPAQUE_BELOW = 44;
/** Texels (Chebyshev) from the background that take a soft alpha; deeper in, texels stay opaque so enclosed light parts (a sign's border, glass) survive. */
const EDGE_BAND = 2;
/** Per-channel standard deviation (levels) up to which an enclosed pocket is as flat as the render's background (measured: pockets of grass up to 6, glass 8 and up). */
const POCKET_FLATNESS = 6.5;
/** Per-channel distance (levels) of an enclosed pocket's mean from the sampled background colour up to which it is background. */
const POCKET_MEAN_DISTANCE = 6;
/** A soft ground shadow darkens the background by up to this many levels of the darkest channel (measured: 44 under the tent). */
const SOFT_SHADOW_SLACK = 70;
/** The most the darkest channel may change between two neighbouring texels for the fill to follow a soft shadow (an object's edge steps by far more). */
const SOFT_SHADOW_STEP = 5;
/** From this alpha (half of 255) a texel counts as opaque: it feeds the tint and the collider width. */
const OPAQUE_ALPHA = 127.5;
/** Share of the sprite's height, from its bottom, whose opaque span is the width a car meets. */
const CORE_ROWS_SHARE = 0.2;
/** A collider narrower than this share of the drawn width would be a pole a car misses by the sprite's own edge. */
const CORE_MIN = 0.15;
/** Digits kept of the collider share: three decimals is a millimetre at a metre. */
const CORE_PRECISION = 1000;
/** Weights of one side of the Sobel kernel sum to 4 and sit two texels from the other: a ramp of one unit a texel reads 8. */
const SOBEL_NORMALISER = 8;
/** Rec. 601 luma weights. */
const LUMA = [0.299, 0.587, 0.114];
/** Texel layout: R, G, B are the first CHANNELS values, alpha the fourth; BYTE is a channel's top value. */
const CHANNELS = 3;
const TEXEL = 4;
const ALPHA = 3;
const BYTE = 255;

/** Decodes png bytes to an RGBA image (alpha 255 where the picture has none). */
export async function decodeRgba(png) {
  const picture = await loadImage(png);
  const canvas = createCanvas(picture.width, picture.height);
  const context = canvas.getContext("2d");
  context.drawImage(picture, 0, 0);
  const bytes = context.getImageData(0, 0, picture.width, picture.height).data;
  return { width: picture.width, height: picture.height, data: Float32Array.from(bytes) };
}

/** A copy of the picture with every texel opaque (box skins and tiles are never keyed). */
export function opaqueImage({ width, height, data }) {
  const opaque = Float32Array.from(data);
  for (let i = ALPHA; i < opaque.length; i += TEXEL) opaque[i] = BYTE;
  return { width, height, data: opaque };
}

/** The largest centred square of the image. */
export function centreSquare({ width, height, data }) {
  const side = Math.min(width, height);
  return cropImage({ width, height, data }, { left: (width - side) >> 1, top: (height - side) >> 1, width: side, height: side });
}

function cropImage({ width, data }, bounds) {
  const cropped = new Float32Array(bounds.width * bounds.height * TEXEL);
  for (let row = 0; row < bounds.height; row++) {
    const from = ((bounds.top + row) * width + bounds.left) * TEXEL;
    cropped.set(data.subarray(from, from + bounds.width * TEXEL), row * bounds.width * TEXEL);
  }
  return { width: bounds.width, height: bounds.height, data: cropped };
}

function sampledBackground({ width, height, data }) {
  const side = Math.min(BACKGROUND_PATCH, width, height);
  const corners = [[0, 0], [width - side, 0], [0, height - side], [width - side, height - side]];
  const values = [[], [], []];
  for (const [left, top] of corners) {
    for (let y = top; y < top + side; y++) {
      for (let x = left; x < left + side; x++) {
        for (let c = 0; c < CHANNELS; c++) values[c].push(data[(y * width + x) * TEXEL + c]);
      }
    }
  }
  return values.map((channel) => Float32Array.from(channel).sort()[channel.length >> 1]);
}

/**
 * 1 for the texels that connect (4-way) to the picture's border through background: a texel is background when its darkest channel is within BACKGROUND_SLACK of `backgroundDarkest`,
 * or within SOFT_SHADOW_SLACK and a small step from the texel it is reached from (a soft ground shadow fades; an object's edge steps). The fill is an iterative stack, so the order is fixed.
 */
function floodBackground({ width, height, data }, backgroundDarkest) {
  const isBackground = new Uint8Array(width * height);
  const stack = new Int32Array(width * height);
  const darkestChannel = (index) => Math.min(data[index * TEXEL], data[index * TEXEL + 1], data[index * TEXEL + 2]);
  let top = 0;
  const admit = (index, from) => {
    if (isBackground[index] === 1) return;
    const darkest = darkestChannel(index);
    const isLight = darkest >= backgroundDarkest - BACKGROUND_SLACK;
    const isSoftShadow = from >= 0 && darkest >= backgroundDarkest - SOFT_SHADOW_SLACK && Math.abs(darkest - darkestChannel(from)) <= SOFT_SHADOW_STEP;
    if (!isLight && !isSoftShadow) return;
    isBackground[index] = 1;
    stack[top++] = index;
  };
  for (let x = 0; x < width; x++) {
    admit(x, -1);
    admit((height - 1) * width + x, -1);
  }
  for (let y = 0; y < height; y++) {
    admit(y * width, -1);
    admit(y * width + width - 1, -1);
  }
  while (top > 0) {
    const index = stack[--top];
    const x = index % width;
    if (x > 0) admit(index - 1, index);
    if (x < width - 1) admit(index + 1, index);
    if (index >= width) admit(index - width, index);
    if (index < width * (height - 1)) admit(index + width, index);
  }
  return isBackground;
}

/** Mean and per-channel standard deviation of the texels at `members[0..count)`. */
function colourStats(data, members, count) {
  const sum = [0, 0, 0];
  const squares = [0, 0, 0];
  for (let k = 0; k < count; k++) {
    for (let c = 0; c < CHANNELS; c++) {
      const value = data[members[k] * TEXEL + c];
      sum[c] += value;
      squares[c] += value * value;
    }
  }
  const mean = sum.map((total) => total / count);
  const deviation = squares.map((total, c) => Math.sqrt(Math.max(0, total / count - mean[c] * mean[c])));
  return { mean, deviation };
}

/**
 * Marks as background the enclosed pockets (gaps between pickets, under a canopy, between blades) that the border fill could not reach: a pocket of texels at least `threshold`
 * in their darkest channel is background when it is as flat as the render's background and its mean is near the sampled colour; shaded white parts (glass, a sign's border) are not.
 */
function fillFlatPockets({ width, height, data }, isBackground, background, threshold) {
  const seen = new Uint8Array(width * height);
  const members = new Int32Array(width * height);
  const isCandidate = (index) => seen[index] === 0 && isBackground[index] === 0 && Math.min(data[index * TEXEL], data[index * TEXEL + 1], data[index * TEXEL + 2]) >= threshold;
  for (let start = 0; start < width * height; start++) {
    if (!isCandidate(start)) continue;
    let count = 0;
    seen[start] = 1;
    members[count++] = start;
    for (let next = 0; next < count; next++) {
      const index = members[next];
      const x = index % width;
      const around = [x > 0 ? index - 1 : -1, x < width - 1 ? index + 1 : -1, index >= width ? index - width : -1, index < width * (height - 1) ? index + width : -1];
      for (const neighbour of around) {
        if (neighbour < 0 || !isCandidate(neighbour)) continue;
        seen[neighbour] = 1;
        members[count++] = neighbour;
      }
    }
    const { mean, deviation } = colourStats(data, members, count);
    const isFlat = deviation.every((spread) => spread <= POCKET_FLATNESS);
    const isBackgroundColoured = mean.every((value, c) => Math.abs(value - background[c]) <= POCKET_MEAN_DISTANCE);
    if (isFlat && isBackgroundColoured) for (let k = 0; k < count; k++) isBackground[members[k]] = 1;
  }
}

/** The mask grown by `radius` texels in a square window (a horizontal pass, then a vertical one). */
function dilate(mask, width, height, radius) {
  const across = new Uint8Array(mask.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      for (let dx = Math.max(0, x - radius); dx <= Math.min(width - 1, x + radius); dx++) {
        if (mask[y * width + dx] === 1) across[y * width + x] = 1;
      }
    }
  }
  const grown = new Uint8Array(mask.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      for (let dy = Math.max(0, y - radius); dy <= Math.min(height - 1, y + radius); dy++) {
        if (across[dy * width + x] === 1) grown[y * width + x] = 1;
      }
    }
  }
  return grown;
}

const clamp = (value, low, high) => Math.min(high, Math.max(low, value));

function smoothstep(from, to, value) {
  const t = clamp((value - from) / (to - from), 0, 1);
  return t * t * (3 - 2 * t);
}

/**
 * Keys the background out and trims to what is left: background is the texels near the sampled corner colour connected to the border; alpha ramps up over the
 * 2 texels inside it and the background colour is taken back out of those edge colours. Straight (not premultiplied) result.
 */
export function keyAndTrim(source) {
  const { width, height, data } = source;
  const background = sampledBackground(source);
  const backgroundDarkest = Math.min(...background);
  const isBackground = floodBackground(source, backgroundDarkest);
  fillFlatPockets(source, isBackground, background, backgroundDarkest - BACKGROUND_SLACK);
  const nearBackground = dilate(isBackground, width, height, EDGE_BAND);
  const keyed = new Float32Array(width * height * TEXEL);
  const bounds = { left: width, top: height, right: -1, bottom: -1 };
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const index = y * width + x;
      if (isBackground[index] === 1) continue;
      bounds.left = Math.min(bounds.left, x);
      bounds.right = Math.max(bounds.right, x);
      bounds.top = Math.min(bounds.top, y);
      bounds.bottom = Math.max(bounds.bottom, y);
      const darkest = Math.min(data[index * TEXEL], data[index * TEXEL + 1], data[index * TEXEL + 2]);
      const alpha = nearBackground[index] === 1 ? 1 - smoothstep(backgroundDarkest - EDGE_OPAQUE_BELOW, backgroundDarkest - BACKGROUND_SLACK, darkest) : 1;
      for (let c = 0; c < CHANNELS; c++) {
        const painted = data[index * TEXEL + c];
        keyed[index * TEXEL + c] = alpha > 0 && alpha < 1 ? clamp((painted - (1 - alpha) * background[c]) / alpha, 0, BYTE) : painted;
      }
      keyed[index * TEXEL + ALPHA] = alpha * BYTE;
    }
  }
  if (bounds.right < 0) throw new Error("the picture is all background");
  return cropImage({ width, height, data: keyed }, { left: bounds.left, top: bounds.top, width: bounds.right - bounds.left + 1, height: bounds.bottom - bounds.top + 1 });
}

/** Mean sRGB colour (0xRRGGBB) of the image's opaque texels; 0 for an image with none. */
export function meanOpaqueColour({ data }) {
  const sum = [0, 0, 0];
  let count = 0;
  for (let i = 0; i < data.length; i += TEXEL) {
    if (data[i + ALPHA] <= OPAQUE_ALPHA) continue;
    for (let c = 0; c < CHANNELS; c++) sum[c] += data[i + c];
    count++;
  }
  if (count === 0) return 0;
  const [red, green, blue] = sum.map((total) => Math.round(total / count));
  return (red << 16) | (green << 8) | blue;
}

/** Share of the image's width that its opaque texels span over its bottom fifth, within [CORE_MIN, 1], 3 decimals. */
export function bottomSpanShare({ width, height, data }) {
  let left = width;
  let right = -1;
  for (let y = Math.floor(height * (1 - CORE_ROWS_SHARE)); y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * TEXEL + ALPHA] <= OPAQUE_ALPHA) continue;
      left = Math.min(left, x);
      right = Math.max(right, x);
    }
  }
  const share = right < 0 ? 0 : (right - left + 1) / width;
  return Math.round(clamp(share, CORE_MIN, 1) * CORE_PRECISION) / CORE_PRECISION;
}

/** A copy with the colour channels multiplied by alpha, which is what filtering must average. */
export function premultiplied({ width, height, data }) {
  const scaled = Float32Array.from(data);
  for (let i = 0; i < scaled.length; i += TEXEL) {
    for (let c = 0; c < CHANNELS; c++) scaled[i + c] = (data[i + c] * data[i + ALPHA]) / BYTE;
  }
  return { width, height, data: scaled };
}

/** For each target texel the source texels it reads (`first`, `count`) and their weights (`stride` per target): the covered area when shrinking, the two nearest centres when growing. */
function tapTable(sourceLength, targetLength) {
  const ratio = sourceLength / targetLength;
  const shrinking = ratio > 1;
  const stride = shrinking ? Math.ceil(ratio) + 1 : 2;
  const first = new Int32Array(targetLength);
  const count = new Int32Array(targetLength);
  const weight = new Float64Array(targetLength * stride);
  for (let target = 0; target < targetLength; target++) {
    if (shrinking) {
      const from = target * ratio;
      const to = (target + 1) * ratio;
      first[target] = Math.floor(from);
      count[target] = Math.min(sourceLength, Math.ceil(to)) - first[target];
      for (let k = 0; k < count[target]; k++) weight[target * stride + k] = (Math.min(first[target] + k + 1, to) - Math.max(first[target] + k, from)) / ratio;
      continue;
    }
    const centre = (target + 0.5) * ratio - 0.5;
    const near = clamp(Math.floor(centre), 0, sourceLength - 1);
    const far = clamp(Math.floor(centre) + 1, 0, sourceLength - 1);
    first[target] = near;
    count[target] = far - near + 1;
    weight[target * stride] = far === near ? 1 : 1 - (centre - near);
    if (far !== near) weight[target * stride + 1] = centre - near;
  }
  return { first, count, weight, stride };
}

/** Resamples a premultiplied image to the given size: area-averaged down, bilinear up, clamped at the edges. */
export function resample({ width, height, data }, targetWidth, targetHeight) {
  const columns = tapTable(width, targetWidth);
  const across = new Float32Array(targetWidth * height * TEXEL);
  for (let y = 0; y < height; y++) {
    for (let tx = 0; tx < targetWidth; tx++) {
      for (let k = 0; k < columns.count[tx]; k++) {
        const w = columns.weight[tx * columns.stride + k];
        const from = (y * width + columns.first[tx] + k) * TEXEL;
        for (let c = 0; c < TEXEL; c++) across[(y * targetWidth + tx) * TEXEL + c] += w * data[from + c];
      }
    }
  }
  const rows = tapTable(height, targetHeight);
  const resized = new Float32Array(targetWidth * targetHeight * TEXEL);
  for (let ty = 0; ty < targetHeight; ty++) {
    for (let k = 0; k < rows.count[ty]; k++) {
      const w = rows.weight[ty * rows.stride + k];
      const from = (rows.first[ty] + k) * targetWidth * TEXEL;
      for (let i = 0; i < targetWidth * TEXEL; i++) resized[ty * targetWidth * TEXEL + i] += w * across[from + i];
    }
  }
  return { width: targetWidth, height: targetHeight, data: resized };
}

/** Straight RGBA bytes from a premultiplied image (transparent texels become transparent black). */
export function toStraightBytes({ data }) {
  const bytes = new Uint8ClampedArray(data.length);
  for (let i = 0; i < data.length; i += TEXEL) {
    const alpha = data[i + ALPHA];
    if (alpha > 0) for (let c = 0; c < CHANNELS; c++) bytes[i + c] = (data[i + c] * BYTE) / alpha;
    bytes[i + ALPHA] = alpha;
  }
  return bytes;
}

/** The 2x2 box that halving averages, its texel count, and how `k >> 1` and `k & 1` walk it. */
const HALVING_SIDE = 2;
const HALVING_AREA = 4;

/** A straight RGBA byte image at half size each way, each texel the 2x2 mean weighted by alpha (a box filter that keeps edge colours clean). */
export function halved(bytes, width, height) {
  const halfWidth = width >> 1;
  const half = new Uint8ClampedArray(halfWidth * (height >> 1) * TEXEL);
  for (let y = 0; y < height >> 1; y++) {
    for (let x = 0; x < halfWidth; x++) {
      const sum = [0, 0, 0];
      let alphaSum = 0;
      for (let k = 0; k < HALVING_AREA; k++) {
        const from = ((HALVING_SIDE * y + (k >> 1)) * width + HALVING_SIDE * x + (k & 1)) * TEXEL;
        const alpha = bytes[from + ALPHA];
        alphaSum += alpha;
        for (let c = 0; c < CHANNELS; c++) sum[c] += bytes[from + c] * alpha;
      }
      const to = (y * halfWidth + x) * TEXEL;
      for (let c = 0; c < CHANNELS; c++) half[to + c] = alphaSum > 0 ? sum[c] / alphaSum : 0;
      half[to + ALPHA] = alphaSum / HALVING_AREA;
    }
  }
  return half;
}

/** Luminance times alpha (0..1) of the width x height region at (left, top) of a straight RGBA byte image: keyed-out texels are 0, so they stay flat. */
export function lumaTimesAlpha(bytes, stride, region) {
  const luma = new Float32Array(region.width * region.height);
  for (let y = 0; y < region.height; y++) {
    for (let x = 0; x < region.width; x++) {
      const from = ((region.top + y) * stride + region.left + x) * TEXEL;
      let sum = 0;
      for (let c = 0; c < CHANNELS; c++) sum += LUMA[c] * bytes[from + c];
      luma[y * region.width + x] = (sum / BYTE) * (bytes[from + ALPHA] / BYTE);
    }
  }
  return luma;
}

/** Neighbour index tables of an axis, wrapping round (tiles repeat) or clamped to the edge (a cell is a self-contained clamped patch). */
function neighbours(length, wrap) {
  const before = new Int32Array(length);
  const after = new Int32Array(length);
  for (let i = 0; i < length; i++) {
    before[i] = wrap ? (i + length - 1) % length : Math.max(0, i - 1);
    after[i] = wrap ? (i + 1) % length : Math.min(length - 1, i + 1);
  }
  return { before, after };
}

/** RGB bytes of the tangent-space normal (OpenGL: +y up the picture) of a height plane: Sobel gradient times `strength`. */
export function normalTexels(height, width, rows, strength, wrap) {
  const columnsAround = neighbours(width, wrap);
  const rowsAround = neighbours(rows, wrap);
  const normals = new Uint8ClampedArray(width * rows * CHANNELS);
  for (let y = 0; y < rows; y++) {
    const above = rowsAround.before[y] * width;
    const here = y * width;
    const below = rowsAround.after[y] * width;
    for (let x = 0; x < width; x++) {
      const left = columnsAround.before[x];
      const right = columnsAround.after[x];
      const gradientX = (height[above + right] + 2 * height[here + right] + height[below + right] - height[above + left] - 2 * height[here + left] - height[below + left]) / SOBEL_NORMALISER;
      const gradientDown = (height[below + left] + 2 * height[below + x] + height[below + right] - height[above + left] - 2 * height[above + x] - height[above + right]) / SOBEL_NORMALISER;
      const tiltX = -gradientX * strength;
      const tiltY = gradientDown * strength;
      const inverseLength = 1 / Math.sqrt(tiltX * tiltX + tiltY * tiltY + 1);
      const to = (y * width + x) * CHANNELS;
      normals[to] = (tiltX * inverseLength * 0.5 + 0.5) * BYTE;
      normals[to + 1] = (tiltY * inverseLength * 0.5 + 0.5) * BYTE;
      normals[to + 2] = (inverseLength * 0.5 + 0.5) * BYTE;
    }
  }
  return normals;
}

/** A webp of a straight RGBA byte image. */
export function encodeWebp(bytes, width, height, quality) {
  const canvas = createCanvas(width, height);
  const context = canvas.getContext("2d");
  const image = context.createImageData(width, height);
  image.data.set(bytes);
  context.putImageData(image, 0, 0);
  return canvas.toBuffer("image/webp", quality);
}
