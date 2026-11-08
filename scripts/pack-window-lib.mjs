/** What the facade packer needs to turn a window mask into a glow map: blurs, grows and shrinks, labelling each window, spreading its threshold. All planes wrap in x and clamp in y. */

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
