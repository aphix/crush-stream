/** What the facade packer needs to turn a window mask into a glow map and into the relief tier's height and roughness maps: blurs, grows and shrinks, labelling each window, spreading its threshold. All planes wrap in x and clamp in y. */

/** Windows below this many texels, or thinner than `MIN_SIDE`, are mouldings, rails and log ends, not glass. */
const MIN_AREA = 160;
const MIN_SIDE = 12;

/** A box blur of a w x h plane, `r` texels each way. */
export function blur(plane, w, h, r) {
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
export function morph(plane, w, h, r, grow) {
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

/** Each window (a connected run of mask texels) gets an id 1..255; a run too small or thin to be one is cleared from the mask. Returns the ids plane. */
export function label(mask, w, h) {
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
export function spread(plane, w, h, passes) {
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

/** The height map (0..1, 1 the proudest): the wall's own level, its lightness detail (a mortar joint low, a moulding high), windows recessed, and a sill and a lintel proud of the wall. Texels counted in the layer's own size. */
const WALL_HEIGHT = 0.78;
const DETAIL_GAIN = 1.2;
const DETAIL_LIMIT = 0.12;
/** The blur radii (texels) that split a layer's lightness into its fine detail and its broad shading. */
const DETAIL_FINE = 1;
const DETAIL_WIDE = 6;
const RECESS = 0.55;
const RECESS_SOFT = 2;
const SILL_ROWS = 6;
const SILL_RISE = 0.2;
const LINTEL_ROWS = 5;
const LINTEL_RISE = 0.1;
/** Texels each way a sill or lintel reaches past its window. */
const SILL_WIDEN = 2;

const lightness = (rgb, i) => (0.299 * rgb[i * 3] + 0.587 * rgb[i * 3 + 1] + 0.114 * rgb[i * 3 + 2]) / 255;

/** A plane of the texels that lie within `rows` rows below (rows > 0) or above (rows < 0) a mask texel, `widen` texels each side, themselves clear of it: a sill or a lintel. */
export function ledgeOf(mask, size, rows, widen) {
  const out = new Float32Array(size * size);
  const step = Math.sign(rows);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (mask[y * size + x]) continue;
      for (let k = 1; k <= Math.abs(rows) && !out[y * size + x]; k++) {
        const source = y - step * k;
        if (source < 0 || source >= size) break;
        for (let dx = -widen; dx <= widen; dx++) {
          if (mask[source * size + ((x + dx + size) % size)]) {
            out[y * size + x] = 1;
            break;
          }
        }
      }
    }
  }
  return out;
}

/** The height plane (floats 0..1) of a size x size layer from its colours and its window mask; `lift` raises the whole layer (a cornice stands proud of the wall). */
export function heightOf(rgb, mask, size, lift = 0) {
  const light = Float32Array.from({ length: size * size }, (_, i) => lightness(rgb, i));
  const fine = blur(light, size, size, DETAIL_FINE);
  const wide = blur(light, size, size, DETAIL_WIDE);
  const soft = blur(Float32Array.from(mask), size, size, RECESS_SOFT);
  const sills = blur(ledgeOf(mask, size, SILL_ROWS, SILL_WIDEN), size, size, 1);
  const lintels = blur(ledgeOf(mask, size, -LINTEL_ROWS, SILL_WIDEN), size, size, 1);
  return Float32Array.from({ length: size * size }, (_, i) => {
    const detail = Math.max(-DETAIL_LIMIT, Math.min(DETAIL_LIMIT, (fine[i] - wide[i]) * DETAIL_GAIN));
    return Math.max(0, Math.min(1, WALL_HEIGHT + lift + detail - RECESS * soft[i] + SILL_RISE * sills[i] + LINTEL_RISE * lintels[i]));
  });
}

/** The roughness plane (floats 0..1): a rough wall (its joints rougher), glass shiny, a wet sill between. */
const WALL_ROUGHNESS = 0.82;
const JOINT_ROUGHNESS = 0.6;
const GLASS_ROUGHNESS = 0.1;
const SILL_ROUGHNESS = 0.4;
export function roughnessOf(rgb, mask, size) {
  const light = Float32Array.from({ length: size * size }, (_, i) => lightness(rgb, i));
  const fine = blur(light, size, size, DETAIL_FINE);
  const wide = blur(light, size, size, DETAIL_WIDE);
  const glass = blur(Float32Array.from(mask), size, size, 1);
  const sills = blur(ledgeOf(mask, size, SILL_ROWS, SILL_WIDEN), size, size, 1);
  return Float32Array.from({ length: size * size }, (_, i) => {
    const wall = WALL_ROUGHNESS + JOINT_ROUGHNESS * Math.max(-DETAIL_LIMIT, Math.min(DETAIL_LIMIT, wide[i] - fine[i]));
    const wet = wall + (SILL_ROUGHNESS - wall) * sills[i];
    return wet + (GLASS_ROUGHNESS - wet) * glass[i];
  });
}

/** A plane of 0..1 (a blurred sign mask, `down` times smaller each way by averaging) as one byte per texel's worth of float 0..255: the glow strip's blue. */
export function downPlane(plane, size, down) {
  const out = size / down;
  const result = new Float32Array(out * out);
  for (let y = 0; y < out; y++) {
    for (let x = 0; x < out; x++) {
      let sum = 0;
      for (let dy = 0; dy < down; dy++) for (let dx = 0; dx < down; dx++) sum += plane[(y * down + dy) * size + x * down + dx];
      result[y * out + x] = (sum / (down * down)) * 255;
    }
  }
  return result;
}
