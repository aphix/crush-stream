/**
 * The tracing harness's mask arithmetic and fit metrics. A mask is a W x H Uint8Array, rows top-down; a frame (`trace-core.mjs`)
 * maps its pixels to metres: `h(u)` along the view's screen right, `g(v)` along its screen up, `u(h)` / `v(g)` back.
 */

/** A named corner within this (cm, signed) is matched. */
const CORNER_TOL_CM = 2;
/** Mismatch thinner than twice this (m) along the outline is anti-aliasing, not a gap. */
const GAP_TOL_M = 0.005;
/** Gap regions smaller than this (cm²) are left out of the report. */
const GAP_MIN_CM2 = 4;
/** A gap region larger than this (cm²) fails the checklist: a 5 x 5 cm patch shows on a phone. */
const GAP_FAIL_CM2 = 25;
/** Gap regions listed per kind, largest first. */
const GAPS_LISTED = 6;
/** How far inside a corner (m) its probe starts, and how far past it the probe looks. */
const PROBE_IN = 0.3;
const PROBE_OUT = 0.3;
/** A tyre's ground contact: its bottom edge within this (m) of the lowest row. */
const CONTACT_TOL = 0.012;
/** Contact runs closer than this (m) are one tyre. */
const CONTACT_MERGE = 0.3;
/** Circle-fit band (m above the ground, and m either side of the contact) of a tyre's bottom edge: under the arch, clear of the flat. */
const TYRE_FIT_BAND = [0.01, 0.12];
const TYRE_FIT_REACH = 0.45;
/** The arch-lip probes stand this many tyre radii from each hub: the body's lower edge just past the tyre. */
const ARCH_REACH = 1.15;
/** Without a measured tyre (m). */
const ARCH_FALLBACK_R = 0.33;
/** Without a measured belt, the belt sits at this share of the height; the roof corners are probed over this share of belt to crown. */
const BELT_SHARE = 0.55;
const ROOF_SHARE = 0.6;

/** Sets every pixel the frame's border cannot reach through unset pixels: a silhouette has no holes (glass, highlights, gaps). */
export function fillHoles(mask, W, H) {
  const outside = new Uint8Array(W * H);
  const stack = [];
  for (let u = 0; u < W; u++) stack.push(u, (H - 1) * W + u);
  for (let v = 0; v < H; v++) stack.push(v * W, v * W + W - 1);
  while (stack.length > 0) {
    const i = stack.pop();
    if (outside[i] || mask[i]) continue;
    outside[i] = 1;
    for (const j of neighbours(i, W, H)) if (j >= 0) stack.push(j);
  }
  for (let i = 0; i < W * H; i++) mask[i] = outside[i] ? 0 : 1;
  return mask;
}

function neighbours(i, W, H) {
  const u = i % W;
  return [u > 0 ? i - 1 : -1, u < W - 1 ? i + 1 : -1, i >= W ? i - W : -1, i < W * (H - 1) ? i + W : -1];
}

/** The 4-connected regions of `mask`: pixel count, box and pixel indices. */
export function labelRegions(mask, W, H) {
  const seen = new Uint8Array(W * H);
  const list = [];
  for (let s = 0; s < W * H; s++) {
    if (!mask[s] || seen[s]) continue;
    const reg = { n: 0, u0: W, u1: -1, v0: H, v1: -1, pixels: [] };
    const stack = [s];
    seen[s] = 1;
    while (stack.length > 0) {
      const i = stack.pop();
      const u = i % W;
      const v = (i - u) / W;
      reg.n++;
      reg.pixels.push(i);
      reg.u0 = Math.min(reg.u0, u);
      reg.u1 = Math.max(reg.u1, u);
      reg.v0 = Math.min(reg.v0, v);
      reg.v1 = Math.max(reg.v1, v);
      for (const j of neighbours(i, W, H)) {
        if (j < 0 || seen[j] || !mask[j]) continue;
        seen[j] = 1;
        stack.push(j);
      }
    }
    list.push(reg);
  }
  return list;
}

export function maskBox(mask, W, H) {
  const b = { u0: W, u1: -1, v0: H, v1: -1 };
  for (let v = 0; v < H; v++) {
    for (let u = 0; u < W; u++) {
      if (!mask[v * W + u]) continue;
      b.u0 = Math.min(b.u0, u);
      b.u1 = Math.max(b.u1, u);
      b.v0 = Math.min(b.v0, v);
      b.v1 = Math.max(b.v1, v);
    }
  }
  return b;
}

export function iou(a, b) {
  let both = 0;
  let either = 0;
  for (let i = 0; i < a.length; i++) {
    both += a[i] & b[i];
    either += a[i] | b[i];
  }
  return either === 0 ? null : round(both / either, 4);
}

export function round(x, digits = 3) {
  return Number.isFinite(x) ? Number(x.toFixed(digits)) : null;
}

/** Paints `mask`'s border pixels (a set pixel with an unset 4-neighbour) `rgb` into the RGBA `shot`. */
export function outline(shot, mask, W, rgb) {
  const H = mask.length / W;
  for (let v = 0; v < H; v++) {
    for (let u = 0; u < W; u++) {
      const i = v * W + u;
      if (!mask[i]) continue;
      if (u > 0 && u < W - 1 && v > 0 && v < H - 1 && mask[i - 1] && mask[i + 1] && mask[i - W] && mask[i + W]) continue;
      shot.set(rgb, i * 4);
    }
  }
}

/** Per column: its first set row from the top and from the bottom, -1 where the column is empty. */
export function columnEdges(mask, W, H) {
  const top = new Int32Array(W).fill(-1);
  const bottom = new Int32Array(W).fill(-1);
  for (let u = 0; u < W; u++) {
    for (let v = 0; v < H; v++) {
      if (!mask[v * W + u]) continue;
      if (top[u] < 0) top[u] = v;
      bottom[u] = v;
    }
  }
  return { top, bottom };
}

/** Per row: its first set column from the left and from the right, -1 where the row is empty. */
export function rowEdges(mask, W, H) {
  const left = new Int32Array(H).fill(-1);
  const right = new Int32Array(H).fill(-1);
  for (let v = 0; v < H; v++) {
    for (let u = 0; u < W; u++) {
      if (!mask[v * W + u]) continue;
      if (left[v] < 0) left[v] = u;
      right[v] = u;
    }
  }
  return { left, right };
}

/** The view's four edge names: screen top, bottom, left, right (the car's front is at the left in the side and top views). */
function edgeNames(view) {
  return view === "front" || view === "rear" ? ["top", "bottom", "left", "right"] : ["top", "bottom", "front", "rear"];
}

/**
 * IoU, signed edge offsets (cm, positive where `car` sticks out past `ref`) at `nCols` columns and `nRows` rows spread over both
 * silhouettes, and both extents (m). `edges[name]` lists [station m, car edge m, ref edge m, offset cm] in the view's axes.
 */
export function compare(frame, car, ref, nCols, nRows) {
  const { W, H, ppm } = frame;
  const cb = maskBox(car, W, H);
  const rb = maskBox(ref, W, H);
  const cols = spread(Math.min(cb.u0, rb.u0), Math.max(cb.u1, rb.u1), nCols);
  const rows = spread(Math.min(cb.v0, rb.v0), Math.max(cb.v1, rb.v1), nRows);
  const cc = columnEdges(car, W, H);
  const rc = columnEdges(ref, W, H);
  const cr = rowEdges(car, W, H);
  const rr = rowEdges(ref, W, H);
  const [top, bottom, lo, hi] = edgeNames(frame.view);
  const col = (u) => frame.h(u + 0.5);
  const row = (v) => frame.g(v + 0.5);
  const edges = {
    [top]: edgeOffsets(cols, col, cc.top, rc.top, (v) => frame.g(v), -1, ppm),
    [bottom]: edgeOffsets(cols, col, cc.bottom, rc.bottom, (v) => frame.g(v + 1), 1, ppm),
    [lo]: edgeOffsets(rows, row, cr.left, rr.left, (u) => frame.h(u), -1, ppm),
    [hi]: edgeOffsets(rows, row, cr.right, rr.right, (u) => frame.h(u + 1), 1, ppm),
  };
  const size = (b) => [round((b.u1 + 1 - b.u0) / ppm), round((b.v1 + 1 - b.v0) / ppm)];
  return { iou: iou(car, ref), offsetCm: summarize(edges), refSize: size(rb), carSize: size(cb), edges };
}

/** Each line's car and reference edge (m) and the car's outward offset (cm); `out` is the outward screen direction (+1 right/down). */
function edgeOffsets(lines, station, carEdge, refEdge, toWorld, out, ppm) {
  return lines.map((p) => {
    const c = carEdge[p] < 0 ? null : carEdge[p];
    const r = refEdge[p] < 0 ? null : refEdge[p];
    const d = c === null || r === null ? null : ((c - r) * out * 100) / ppm;
    return [round(station(p)), c === null ? null : round(toWorld(c)), r === null ? null : round(toWorld(r)), d === null ? null : round(d, 1)];
  });
}

/** Per edge list: the mean signed offset, the mean |offset| (`abs`: a wavy edge shows here, not in `mean`) and the largest (cm). */
function summarize(edges) {
  const out = {};
  for (const [name, list] of Object.entries(edges)) {
    const d = list.filter((s) => s[3] !== null).map((s) => s[3]);
    const largest = d.reduce((a, b) => (Math.abs(b) > Math.abs(a) ? b : a), 0);
    const mean = (xs) => (xs.length === 0 ? null : round(xs.reduce((a, b) => a + b, 0) / xs.length, 1));
    out[name] = { mean: mean(d), abs: mean(d.map(Math.abs)), max: round(largest, 1) };
  }
  return out;
}

/** `n` pixel lines evenly over [a, b], each at the middle of its share. */
function spread(a, b, n) {
  if (b < a) return [];
  return Array.from({ length: n }, (_, k) => Math.floor(a + ((k + 0.5) * (b + 1 - a)) / n));
}

/**
 * The glass: IoU and its outline's offsets. Side view: the daylight opening's `roofRail` (top), `sill`, `aPillar` (front) and
 * `cPillar` (rear) edges, and each pillar's lean ([car, reference] degrees from vertical, positive leaning forward going up).
 */
export function glassCompare(frame, carGlass, refGlass, nCols, nRows) {
  const { W, H } = frame;
  if (maskBox(refGlass, W, H).u1 < 0 || maskBox(carGlass, W, H).u1 < 0) return null;
  const c = compare(frame, carGlass, refGlass, nCols, nRows);
  if (frame.view !== "side") return { iou: c.iou, offsetCm: c.offsetCm, edges: c.edges };
  const offsetCm = { roofRail: c.offsetCm.top, sill: c.offsetCm.bottom, aPillar: c.offsetCm.front, cPillar: c.offsetCm.rear };
  const edges = { roofRail: c.edges.top, sill: c.edges.bottom, aPillar: c.edges.front, cPillar: c.edges.rear };
  const rakeDeg = { aPillar: [lean(edges.aPillar, 1), lean(edges.aPillar, 2)], cPillar: [lean(edges.cPillar, 1), lean(edges.cPillar, 2)] };
  return { iou: c.iou, offsetCm, rakeDeg, edges };
}

/** Least-squares lean (degrees from vertical) of an edge's rows: station g against column `k`'s h. */
function lean(rows, k) {
  const pts = rows.filter((r) => r[k] !== null).map((r) => [r[0], r[k]]);
  if (pts.length < 3) return null;
  const mg = pts.reduce((s, p) => s + p[0], 0) / pts.length;
  const mh = pts.reduce((s, p) => s + p[1], 0) / pts.length;
  let num = 0;
  let den = 0;
  for (const [g, h] of pts) {
    num += (g - mg) * (h - mh);
    den += (g - mg) ** 2;
  }
  return round((Math.atan(num / den) * 180) / Math.PI, 1);
}

/**
 * The reference's wheels in a side view, from its silhouette's bottom edge: each tyre's contact (the columns within CONTACT_TOL of
 * the lowest row) gives its centre z, and the bottom edge either side, as a circle through it, its radius. Null without two tyres.
 */
export function sideHubs(frame, mask) {
  const { bottom } = columnEdges(mask, frame.W, frame.H);
  const pts = [];
  for (let u = 0; u < frame.W; u++) if (bottom[u] >= 0) pts.push([frame.h(u + 0.5), frame.g(bottom[u] + 1)]);
  if (pts.length === 0) return null;
  const ground = Math.min(...pts.map((p) => p[1]));
  const runs = [];
  for (const [h, g] of pts.sort((a, b) => a[0] - b[0])) {
    if (g > ground + CONTACT_TOL) continue;
    const last = runs.at(-1);
    if (last && h - last[1] < CONTACT_MERGE) last[1] = h;
    else runs.push([h, h]);
  }
  if (runs.length < 2) return null;
  const tyre = ([h0, h1]) => {
    const z = (h0 + h1) / 2;
    const r = pts
      .filter(([h, g]) => Math.abs(h - z) < TYRE_FIT_REACH && g - ground > TYRE_FIT_BAND[0] && g - ground < TYRE_FIT_BAND[1])
      .map(([h, g]) => ((h - z) ** 2 + (g - ground) ** 2) / (2 * (g - ground)))
      .sort((a, b) => a - b);
    return { z: round(z), radius: r.length === 0 ? null : round(r[r.length >> 1]) };
  };
  return { front: tyre(runs.at(-1)), rear: tyre(runs[0]), ground: round(ground) };
}

/**
 * The side view's named corners (nose, tail, bumper corners, sill, arch lips, roof corners), each probed along its outward
 * direction: the car's outline minus the reference's (cm, positive where the car sticks out). `marks`: the reference's `hubs`
 * (`sideHubs`) and `belt` (its glass sill height, m, or null).
 */
export function sideCorners(frame, car, ref, marks) {
  if (marks.hubs === null) return [];
  return cornerTargets(frame, ref, marks).map((t) => probeCorner(frame, car, ref, t));
}

function cornerTargets(frame, ref, { hubs, belt }) {
  const pts = borderPoints(frame, ref);
  const top = Math.max(...pts.map((p) => p[1]));
  const beltY = belt ?? BELT_SHARE * top;
  const roofY = beltY + ROOF_SHARE * (top - beltY);
  const { front, rear } = hubs;
  const reach = ARCH_REACH * (front.radius ?? ARCH_FALLBACK_R);
  const extreme = (name, keep, dz, dy) => {
    const list = pts.filter(keep);
    if (list.length === 0) return null;
    const best = Math.max(...list.map(([z, y]) => z * dz + y * dy));
    const at = list.filter(([z, y]) => z * dz + y * dy >= best - 0.5 / frame.ppm);
    const n = Math.hypot(dz, dy);
    return { name, at: at[at.length >> 1], dir: [dz / n, dy / n] };
  };
  const lowest = (name, z) => {
    const at = pts.filter(([pz, py]) => Math.abs(pz - z) <= 0.6 / frame.ppm && py < beltY).sort((a, b) => a[1] - b[1])[0];
    return at === undefined ? null : { name, at, dir: [0, -1] };
  };
  return [
    extreme("nose", () => true, 1, 0),
    extreme("frontBumperTop", ([z, y]) => z > front.z && y < beltY, 1, 1),
    extreme("frontBumperBottom", ([z, y]) => z > front.z && y < beltY, 1, -1),
    extreme("tail", () => true, -1, 0),
    extreme("rearBumperTop", ([z, y]) => z < rear.z && y < beltY, -1, 1),
    extreme("rearBumperBottom", ([z, y]) => z < rear.z && y < beltY, -1, -1),
    lowest("sill", (front.z + rear.z) / 2),
    lowest("frontArchFore", front.z + reach),
    lowest("frontArchAft", front.z - reach),
    lowest("rearArchFore", rear.z + reach),
    lowest("rearArchAft", rear.z - reach),
    extreme("roofFront", ([, y]) => y > roofY, 1, 1),
    extreme("roofRear", ([, y]) => y > roofY, -1, 1),
  ].filter((t) => t !== null);
}

/** [h, g] of every border pixel of `mask` (a set pixel with an unset 4-neighbour). */
function borderPoints(frame, mask) {
  const { W, H } = frame;
  const pts = [];
  for (let v = 1; v < H - 1; v++) {
    for (let u = 1; u < W - 1; u++) {
      const i = v * W + u;
      if (mask[i] && !(mask[i - 1] && mask[i + 1] && mask[i - W] && mask[i + W])) pts.push([frame.h(u + 0.5), frame.g(v + 0.5)]);
    }
  }
  return pts;
}

function probeCorner(frame, car, ref, { name, at: [z, y], dir: [dz, dy] }) {
  const c = exitAlong(frame, car, z, y, dz, dy);
  const r = exitAlong(frame, ref, z, y, dz, dy);
  // No car along the whole probe: it falls short by at least the probe's reach inside.
  const offsetCm = r === null ? null : round(((c ?? -PROBE_IN) - r) * 100, 1);
  return { name, at: [round(z), round(y)], offsetCm, ok: c !== null && offsetCm !== null && Math.abs(offsetCm) <= CORNER_TOL_CM };
}

/** The farthest point (m along the probe, 0 at the corner) where `mask` is still set walking from inside the corner outward. */
function exitAlong(frame, mask, z, y, dz, dy) {
  let last = null;
  for (let t = -PROBE_IN; t <= PROBE_OUT; t += 1 / frame.ppm) {
    const u = Math.floor(frame.u(z + dz * t));
    const v = Math.floor(frame.v(y + dy * t));
    if (u >= 0 && u < frame.W && v >= 0 && v < frame.H && mask[v * frame.W + u]) last = t;
  }
  return last;
}

/**
 * The mismatch as regions: `uncovered` (reference the car leaves bare) and `overhang` (car past the reference), each region's area
 * (cm²) and extent [min, max] in the view's two axes, largest first. Slivers thinner than 2 x GAP_TOL_M are dropped.
 */
export function gapRegions(frame, car, ref) {
  const { W, H, ppm } = frame;
  const r = Math.max(1, Math.round(GAP_TOL_M * ppm));
  const [a, b] = frame.axes;
  const kinds = { uncovered: (i) => ref[i] && !car[i], overhang: (i) => car[i] && !ref[i] };
  const out = {};
  for (const [kind, test] of Object.entries(kinds)) {
    const diff = new Uint8Array(W * H);
    for (let i = 0; i < W * H; i++) diff[i] = test(i) ? 1 : 0;
    out[kind] = labelRegions(openMask(diff, W, H, r), W, H)
      .map((reg) => ({
        cm2: round((reg.n / ppm ** 2) * 1e4, 0),
        [a]: [round(frame.h(reg.u0)), round(frame.h(reg.u1 + 1))].sort((x, y) => x - y),
        [b]: [round(frame.g(reg.v1 + 1)), round(frame.g(reg.v0))].sort((x, y) => x - y),
      }))
      .filter((reg) => reg.cm2 >= GAP_MIN_CM2)
      .sort((x, y) => y.cm2 - x.cm2)
      .slice(0, GAPS_LISTED);
  }
  return out;
}

/** `mask` with every feature thinner than 2r + 1 pixels removed (erosion then dilation, square of radius `r`). */
export function openMask(mask, W, H, r) {
  return boxFilter(boxFilter(mask, W, H, r, true), W, H, r, false);
}

/** Separable square erosion (`all`) or dilation of radius `r`. */
function boxFilter(mask, W, H, r, all) {
  const pass = (src, horizontal) => {
    const dst = new Uint8Array(W * H);
    for (let v = 0; v < H; v++) {
      for (let u = 0; u < W; u++) {
        let every = 1;
        let some = 0;
        for (let k = -r; k <= r; k++) {
          const uu = horizontal ? u + k : u;
          const vv = horizontal ? v : v + k;
          const set = uu >= 0 && uu < W && vv >= 0 && vv < H ? src[vv * W + uu] : 0;
          every &= set;
          some |= set;
        }
        dst[v * W + u] = all ? every : some;
      }
    }
    return dst;
  };
  return pass(pass(mask, true), false);
}

/** One line per corner and per gap region, `FAIL` or `ok`: a fit is done when every line reads `ok`. */
export function checklist(frame, corners, gaps) {
  const [a, b] = frame.axes;
  const lines = corners.map((c) => `${c.ok ? "ok  " : "FAIL"} ${c.name} ${c.offsetCm === null ? "unmeasured" : `${c.offsetCm > 0 ? "+" : ""}${c.offsetCm} cm`} at ${a} ${c.at[0]} ${b} ${c.at[1]}`);
  for (const [kind, list] of Object.entries(gaps)) {
    for (const g of list) lines.push(`${g.cm2 > GAP_FAIL_CM2 ? "FAIL" : "ok  "} ${kind} ${g.cm2} cm² ${a} ${g[a][0]}..${g[a][1]} ${b} ${g[b][0]}..${g[b][1]}`);
  }
  return lines;
}
