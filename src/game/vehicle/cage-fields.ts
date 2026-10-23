import type { CageFields, CageStyle } from "./car-cage.ts";

/** A node this far (in steps) outside a triangle still takes its height (clamped to the triangle's), so an edge never leaves a gap. */
const EXPAND = 0.5;

/**
 * The plan boxes (x min, x max, z min, z max) of the glass panes that are gone, into `_open`: how many. A shattered pane's mesh is
 * not drawn, but its vertices are skinned where the frame holds it (`skinCage`), so the box is its opening as the crushed body has it.
 */
function gonePanes(style: CageStyle, f: CageFields, panelOn: Uint8Array): number {
  const { panelCount, panelGlass, vertexCount, vertexGroup } = style;
  let n = 0;
  for (let k = 0; k < panelCount && n < OPEN_MAX; k++) {
    if (panelOn[k] !== 0 || panelGlass[k] === 0) continue;
    let x0 = Infinity;
    let x1 = -Infinity;
    let z0 = Infinity;
    let z1 = -Infinity;
    for (let i = 0; i < vertexCount; i++) {
      if (vertexGroup[i] !== k + 1) continue;
      x0 = Math.min(x0, f.pos[i * 3]!);
      x1 = Math.max(x1, f.pos[i * 3]!);
      z0 = Math.min(z0, f.pos[i * 3 + 2]!);
      z1 = Math.max(z1, f.pos[i * 3 + 2]!);
    }
    _open[n * 4] = x0;
    _open[n * 4 + 1] = x1;
    _open[n * 4 + 2] = z0;
    _open[n * 4 + 3] = z1;
    n++;
  }
  return n;
}

/** Whether plan point (`x`, `z`) lies within `margin` of one of the first `n` openings of `gonePanes`. */
function inOpening(n: number, x: number, z: number, margin: number): boolean {
  for (let o = 0; o < n * 4; o += 4) if (x >= _open[o]! - margin && x <= _open[o + 1]! + margin && z >= _open[o + 2]! - margin && z <= _open[o + 3]! + margin) return true;
  return false;
}

/** The most gone glass panes a cage reads openings for (a car has a windscreen and a rear screen). */
const OPEN_MAX = 4;
const _open = new Float64Array(OPEN_MAX * 4);

/**
 * The top, bottom and coverage fields from `f.pos` and `f.rawY`: every triangle lays its plane's height over the nodes within
 * `EXPAND` steps of it (clamped to the triangle's own heights, so a steep one never throws a node far off), the field taking the
 * highest and the lowest; a node strictly inside a triangle is covered. A triangle with no plan area (a wall seen edge on) is a
 * line the neighbours already cover. The roof imprint's plane (`cutY + cutX x + cutZ z`) cuts the body's heights here, per node,
 * as it cuts every vertex of the drawn mesh: a coarse cage's clipped vertex is not where the drawn mesh's clipped edge runs.
 * A gone pane's opening shows the interior: its triangles lay heights over the opening's plan box only (everywhere else it is
 * inside the body, and a roof the load crushes below it is the load law's to stop, not a prop's).
 */
export function rasterise(style: CageStyle, f: CageFields, panelOn: Uint8Array, cutY: number, cutX: number, cutZ: number): void {
  const { nu, nv, step, u0, v0, tris, triGroup, partGroup } = style;
  const pos = f.pos;
  const rawY = f.rawY;
  const top = f.top;
  const bottom = f.bottom;
  const covered = f.covered;
  const part = f.part;
  top.fill(NaN);
  bottom.fill(NaN);
  covered.fill(0);
  part.fill(0);
  const margin = EXPAND * step;
  const interiorGroup = style.panelCount + 1;
  const opens = gonePanes(style, f, panelOn);
  let heightMax = 0;
  let xMin = Infinity;
  let xMax = -Infinity;
  let zMin = Infinity;
  let zMax = -Infinity;
  for (let t = 0; t < style.triCount * 3; t += 3) {
    const group = triGroup[t / 3]!;
    if (group === interiorGroup ? opens === 0 : group > 0 && panelOn[group - 1] === 0) continue;
    const a = tris[t]! * 3;
    const b = tris[t + 1]! * 3;
    const c = tris[t + 2]! * 3;
    const ax = pos[a]!;
    const ay = rawY[a / 3]!;
    const az = pos[a + 2]!;
    const bx = pos[b]!;
    const by = rawY[b / 3]!;
    const bz = pos[b + 2]!;
    const cx = pos[c]!;
    const cy = rawY[c / 3]!;
    const cz = pos[c + 2]!;
    const area2 = (bx - ax) * (cz - az) - (bz - az) * (cx - ax);
    if (Math.abs(area2) < 1e-9) continue;
    const sign = area2 > 0 ? 1 : -1;
    const lenAB = Math.sqrt((bx - ax) * (bx - ax) + (bz - az) * (bz - az));
    const lenBC = Math.sqrt((cx - bx) * (cx - bx) + (cz - bz) * (cz - bz));
    const lenCA = Math.sqrt((ax - cx) * (ax - cx) + (az - cz) * (az - cz));
    if (lenAB < 1e-9 || lenBC < 1e-9 || lenCA < 1e-9) continue;
    const yLow = Math.min(ay, by, cy);
    const yHigh = Math.max(ay, by, cy);
    xMin = Math.min(xMin, ax, bx, cx);
    xMax = Math.max(xMax, ax, bx, cx);
    zMin = Math.min(zMin, az, bz, cz);
    zMax = Math.max(zMax, az, bz, cz);
    const xLow = Math.min(ax, bx, cx) - margin;
    const xHigh = Math.max(ax, bx, cx) + margin;
    const zLow = Math.min(az, bz, cz) - margin;
    const zHigh = Math.max(az, bz, cz) + margin;
    const i0 = Math.max(0, Math.ceil((xLow - u0) / step));
    const i1 = Math.min(nu - 1, Math.floor((xHigh - u0) / step));
    const j0 = Math.max(0, Math.ceil((zLow - v0) / step));
    const j1 = Math.min(nv - 1, Math.floor((zHigh - v0) / step));
    // Each edge's signed distance (inside +) is linear in the node: e = nx x + nz z + k, and the barycentric weight of the corner
    // opposite an edge is that distance times the edge's length over the triangle's doubled area.
    const nxAB = (-(bz - az) * sign) / lenAB;
    const nzAB = ((bx - ax) * sign) / lenAB;
    const kAB = -(nxAB * ax + nzAB * az);
    const nxBC = (-(cz - bz) * sign) / lenBC;
    const nzBC = ((cx - bx) * sign) / lenBC;
    const kBC = -(nxBC * bx + nzBC * bz);
    const nxCA = (-(az - cz) * sign) / lenCA;
    const nzCA = ((ax - cx) * sign) / lenCA;
    const kCA = -(nxCA * cx + nzCA * cz);
    const scale = 1 / Math.abs(area2);
    const wA = lenBC * scale;
    const wB = lenCA * scale;
    const wC = lenAB * scale;
    for (let j = j0; j <= j1; j++) {
      const z = v0 + j * step;
      const rowAB = nzAB * z + kAB;
      const rowBC = nzBC * z + kBC;
      const rowCA = nzCA * z + kCA;
      for (let i = i0; i <= i1; i++) {
        const x = u0 + i * step;
        const eAB = nxAB * x + rowAB;
        const eBC = nxBC * x + rowBC;
        const eCA = nxCA * x + rowCA;
        if (eAB < -margin || eBC < -margin || eCA < -margin) continue;
        if (group === interiorGroup && !inOpening(opens, x, z, margin)) continue;
        let y = eBC * wA * ay + eCA * wB * by + eAB * wC * cy;
        if (y < yLow) y = yLow;
        else if (y > yHigh) y = yHigh;
        if (group === 0) y = Math.min(y, cutY + cutX * x + cutZ * z);
        const k = j * nu + i;
        if (!(top[k]! >= y)) top[k] = y;
        if (!(bottom[k]! <= y)) bottom[k] = y;
        if (eAB >= 0 && eBC >= 0 && eCA >= 0) {
          if (group < partGroup || group === interiorGroup) part[k] = 0;
          else if (covered[k] === 0) part[k] = group;
          covered[k] = 1;
        }
      }
    }
    heightMax = Math.max(heightMax, Math.abs(yLow), Math.abs(yHigh));
  }
  f.heightMax = heightMax;
  f.planFresh = false;
  f.planBox[0] = xMin;
  f.planBox[1] = xMax;
  f.planBox[2] = zMin;
  f.planBox[3] = zMax;
}

/** Stand-in squared distance of a node with none to measure from (no covered node, or none uncovered). */
const FAR2 = 1e12;
const scratch = { n: 0, f: new Float64Array(0), d: new Float64Array(0), v: new Int32Array(0), z: new Float64Array(0), a: new Float64Array(0), b: new Float64Array(0) };
/** The covered nodes' extent `[ci0, ci1, cj0, cj1]` of the last plan field. */
const coveredBox = new Int32Array(4);

/** One line of the exact squared-distance transform (Felzenszwalb and Huttenlocher 2012): `d` ← min over q of (p - q)² + f[q]. */
function transformLine(n: number, f: Float64Array, d: Float64Array, v: Int32Array, z: Float64Array): void {
  let k = 0;
  v[0] = 0;
  z[0] = -FAR2;
  z[1] = FAR2;
  for (let q = 1; q < n; q++) {
    let s = (f[q]! + q * q - (f[v[k]!]! + v[k]! * v[k]!)) / (2 * q - 2 * v[k]!);
    while (s <= z[k]!) {
      k--;
      s = (f[q]! + q * q - (f[v[k]!]! + v[k]! * v[k]!)) / (2 * q - 2 * v[k]!);
    }
    k++;
    v[k] = q;
    z[k] = s;
    z[k + 1] = FAR2;
  }
  k = 0;
  for (let q = 0; q < n; q++) {
    while (z[k + 1]! < q) k++;
    const dq = q - v[k]!;
    d[q] = dq * dq + f[v[k]!]!;
  }
}

/**
 * `g` ← the column pass of the squared-distance transform (in steps) of the binary image whose seeds are the nodes with
 * `(covered === 1) === inside`: each node's squared distance to the nearest seed in its column, `FAR2` where the column has none.
 * What `transformLine` gives a 0/`FAR2` column, by two sweeps. With `box`, it also gets the seeds' extent `[ci0, ci1, cj0, cj1]`
 * (columns, rows; `ci1 < 0` when there is no seed).
 */
function seedColumns(nu: number, nv: number, covered: Uint8Array, inside: boolean, g: Float64Array, box: Int32Array | null): void {
  if (box !== null) {
    box[0] = nu;
    box[1] = -1;
    box[2] = nv;
    box[3] = -1;
  }
  for (let i = 0; i < nu; i++) {
    let last = -1;
    let first = -1;
    for (let j = 0, k = i; j < nv; j++, k += nu) {
      if ((covered[k] === 1) === inside) {
        last = j;
        if (first < 0) first = j;
      }
      g[k] = last < 0 ? FAR2 : (j - last) * (j - last);
    }
    if (box !== null && first >= 0) {
      if (i < box[0]!) box[0] = i;
      box[1] = i;
      if (first < box[2]!) box[2] = first;
      if (last > box[3]!) box[3] = last;
    }
    last = -1;
    for (let j = nv - 1, k = j * nu + i; j >= 0; j--, k -= nu) {
      if ((covered[k] === 1) === inside) last = j;
      if (last >= 0 && (last - j) * (last - j) < g[k]!) g[k] = (last - j) * (last - j);
    }
  }
}

/** `g` (nu × nv, `seedColumns`' column pass) ← the row pass over rows `j0..j1` and nodes `i0..i1` (each row's sub-range is its own line): the squared distance transform done there. */
function transformRows(nu: number, g: Float64Array, s: typeof scratch, j0: number, j1: number, i0: number, i1: number): void {
  const n = i1 - i0 + 1;
  for (let j = j0; j <= j1; j++) {
    for (let i = 0; i < n; i++) s.f[i] = g[j * nu + i0 + i]!;
    transformLine(n, s.f, s.d, s.v, s.z);
    for (let i = 0; i < n; i++) g[j * nu + i0 + i] = s.d[i]!;
  }
}

/**
 * The plan field of `f` (signed distance to the outline, negative inside, 5 mm of the outline lying between a covered node and its
 * uncovered neighbour), made current if a fit left it stale. The fits skip it (a car near no other car never asks); a style's
 * pristine fields compute it once for all its cars.
 */
export function planFieldOf(style: CageStyle, f: CageFields): Float32Array {
  if (f.planFresh) return f.plan;
  const { nu, nv, step } = style;
  const n = nu * nv;
  if (scratch.n < n) {
    const line = Math.max(nu, nv);
    scratch.n = n;
    scratch.f = new Float64Array(line);
    scratch.d = new Float64Array(line);
    scratch.v = new Int32Array(line);
    scratch.z = new Float64Array(line + 1);
    scratch.a = new Float64Array(n);
    scratch.b = new Float64Array(n);
  }
  const toCovered = scratch.a;
  const toUncovered = scratch.b;
  const box = coveredBox;
  seedColumns(nu, nv, f.covered, true, toCovered, box);
  seedColumns(nu, nv, f.covered, false, toUncovered, null);
  transformRows(nu, toCovered, scratch, 0, nv - 1, 0, nu - 1);
  if (box[1]! >= 0) {
    // Outside the covered nodes' extent every node is uncovered (0, as `seedColumns` leaves it) and the ring around the extent is
    // all uncovered, so no node inside has a nearer uncovered node beyond the ring: the row pass runs over the ring box alone.
    transformRows(nu, toUncovered, scratch, Math.max(0, box[2]! - 1), Math.min(nv - 1, box[3]! + 1), Math.max(0, box[0]! - 1), Math.min(nu - 1, box[1]! + 1));
  }
  for (let k = 0; k < n; k++) {
    f.plan[k] = f.covered[k]! === 1 ? -(Math.sqrt(toUncovered[k]!) - 0.5) * step : (Math.sqrt(toCovered[k]!) - 0.5) * step;
  }
  f.planFresh = true;
  return f.plan;
}
