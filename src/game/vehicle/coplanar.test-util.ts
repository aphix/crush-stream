/**
 * Finds drawn faces that flicker against each other: two triangles facing one way that stand within `GAP_M` of one plane over an area,
 * and are seen from outside. The depth buffer (24 bits over 0.1 to 180 m) tells faces apart only beyond 0.015 mm at 5 m and 0.4 mm
 * at 25 m; faces that merely cross, or stand a millimetre off, do not fight. Not a test file itself.
 */

export const GAP_M = 0.0005;
/** Grid cell (m) of the triangle lookup. */
const CELL_M = 0.06;
/** Overlaps smaller than this (m²) are the shared edge of two neighbouring triangles, not a patch. */
const MIN_PATCH_M2 = 2e-6;
/** The biggest patches of a pair tested for being seen, and how far (rad) their rays lean off the face's normal. */
const SEEN_SAMPLES = 10;
const SEEN_LEAN = 1.2;

type V3 = [number, number, number];
type V2 = [number, number];

/** One drawn thing in the car's frame: 9 numbers a triangle. Its own faces are checked against each other only where `self` (a bumper's inlays); a `hides` one only hides what lies behind it. */
export interface Item {
  name: string;
  tris: Float64Array;
  self?: boolean;
  hides?: boolean;
}

interface Tri {
  item: number;
  p: [V3, V3, V3];
  n: V3;
  d: number;
}

const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const unit = (a: V3): V3 => {
  const length = Math.hypot(...a);
  return [a[0] / length, a[1] / length, a[2] / length];
};

function triangles(items: readonly Item[]): Tri[] {
  const tris: Tri[] = [];
  for (let item = 0; item < items.length; item++) {
    const t = items[item]!.tris;
    for (let k = 0; k + 8 < t.length; k += 9) {
      const p: [V3, V3, V3] = [[t[k]!, t[k + 1]!, t[k + 2]!], [t[k + 3]!, t[k + 4]!, t[k + 5]!], [t[k + 6]!, t[k + 7]!, t[k + 8]!]];
      const c = cross(sub(p[1], p[0]), sub(p[2], p[0]));
      if (Math.hypot(...c) < 1e-9) continue;
      const n = unit(c);
      tris.push({ item, p, n, d: dot(n, p[0]) });
    }
  }
  return tris;
}

const cell = (x: number): number => Math.floor(x / CELL_M);

/** The cells a triangle's box (grown by `GAP_M`) touches, as lookup keys. */
function cellsOf(t: Tri): string[] {
  const [lo, hi] = [0, 1].map((side) => [0, 1, 2].map((a) => cell((side === 0 ? Math.min : Math.max)(t.p[0][a]!, t.p[1][a]!, t.p[2][a]!) + (side === 0 ? -GAP_M : GAP_M))));
  const keys: string[] = [];
  for (let x = lo![0]!; x <= hi![0]!; x++) for (let y = lo![1]!; y <= hi![1]!; y++) for (let z = lo![2]!; z <= hi![2]!; z++) keys.push(`${x},${y},${z}`);
  return keys;
}

/** `a`'s overlap with `b` in `a`'s plane: the clipped polygon's area (m²) and centre, when every corner of it stands within `GAP_M` of `b`'s plane. */
function overlap(a: Tri, b: Tri): { area: number; centre: V3 } | null {
  const ux = unit(cross(a.n, Math.abs(a.n[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0]));
  const uy = cross(a.n, ux);
  const flat = (p: V3): V2 => [dot(p, ux), dot(p, uy)];
  const counterClockwise = (poly: V2[]): V2[] => (area2(poly) < 0 ? poly.reverse() : poly);
  const poly = clip(counterClockwise(a.p.map(flat)), counterClockwise(b.p.map(flat)));
  const area = Math.abs(area2(poly));
  if (poly.length < 3 || area < MIN_PATCH_M2) return null;
  const onPlane = (q: V2): V3 => [ux[0] * q[0] + uy[0] * q[1] + a.n[0] * a.d, ux[1] * q[0] + uy[1] * q[1] + a.n[1] * a.d, ux[2] * q[0] + uy[2] * q[1] + a.n[2] * a.d];
  const corners = poly.map(onPlane);
  if (corners.some((c) => Math.abs(dot(b.n, c) - b.d) > GAP_M)) return null;
  const centre: V3 = [0, 0, 0];
  for (const c of corners) for (let k = 0; k < 3; k++) centre[k] += c[k]! / corners.length;
  return { area, centre };
}

/** Sutherland-Hodgman: counter-clockwise `subject` cut by counter-clockwise `by`. */
function clip(subject: V2[], by: V2[]): V2[] {
  let out = subject;
  for (let i = 0; i < by.length && out.length > 0; i++) {
    const [a, b] = [by[i]!, by[(i + 1) % by.length]!];
    const side = (p: V2) => (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
    const input = out;
    out = [];
    for (let j = 0; j < input.length; j++) {
      const [p, q] = [input[j]!, input[(j + 1) % input.length]!];
      const [sp, sq] = [side(p), side(q)];
      if (sp >= 0) out.push(p);
      if (sp >= 0 !== sq >= 0) out.push([p[0] + ((q[0] - p[0]) * sp) / (sp - sq), p[1] + ((q[1] - p[1]) * sp) / (sp - sq)]);
    }
  }
  return out;
}

function area2(poly: V2[]): number {
  let s = 0;
  for (let i = 0; i < poly.length; i++) s += poly[i]![0] * poly[(i + 1) % poly.length]![1] - poly[(i + 1) % poly.length]![0] * poly[i]![1];
  return s / 2;
}

/** Whether a ray from `from` along `dir` meets no triangle (Moller-Trumbore). */
function escapes(tris: readonly Tri[], from: V3, dir: V3): boolean {
  for (const t of tris) {
    const [e1, e2] = [sub(t.p[1], t.p[0]), sub(t.p[2], t.p[0])];
    const pv = cross(dir, e2);
    const det = dot(e1, pv);
    if (Math.abs(det) < 1e-12) continue;
    const to = sub(from, t.p[0]);
    const u = dot(to, pv) / det;
    if (u < 0 || u > 1) continue;
    const q = cross(to, e1);
    const v = dot(dir, q) / det;
    if (v >= 0 && u + v <= 1 && dot(e2, q) / det > 0) return false;
  }
  return true;
}

/** Whether a patch centred `centre` on a face with normal `n` is seen from outside: a ray along the normal, or leaning off it, meets nothing. */
function seen(tris: readonly Tri[], centre: V3, n: V3): boolean {
  const ux = unit(cross(n, Math.abs(n[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0]));
  const uy = cross(n, ux);
  const from: V3 = [centre[0] + n[0] * 1e-3, centre[1] + n[1] * 1e-3, centre[2] + n[2] * 1e-3];
  const [c, s] = [Math.cos(SEEN_LEAN), Math.sin(SEEN_LEAN)];
  const lean = (t: V3, sign: number): V3 => [n[0] * c + t[0] * s * sign, n[1] * c + t[1] * s * sign, n[2] * c + t[2] * s * sign];
  return [n, lean(ux, 1), lean(ux, -1), lean(uy, 1), lean(uy, -1)].some((dir) => escapes(tris, from, dir));
}

/** Per item pair "a|b" (names sorted), the area (cm²) over which their faces face one way within `GAP_M` of a plane, seen from outside unless `fromOutside` is off. */
export function coplanarOverlaps(items: readonly Item[], minCm2 = 0, fromOutside = true): Map<string, number> {
  const tris = triangles(items);
  const grid = new Map<string, number[]>();
  for (let i = 0; i < tris.length; i++) {
    for (const key of cellsOf(tris[i]!)) {
      const list = grid.get(key);
      if (list) list.push(i);
      else grid.set(key, [i]);
    }
  }
  const patches = new Map<string, { area: number; list: { area: number; centre: V3; n: V3 }[] }>();
  for (let i = 0; i < tris.length; i++) {
    const a = tris[i]!;
    const near = new Set<number>();
    for (const key of cellsOf(a)) for (const j of grid.get(key) ?? []) if (j > i) near.add(j);
    for (const j of near) {
      const b = tris[j]!;
      if (dot(a.n, b.n) < 0.999 || (a.item === b.item && !items[a.item]!.self) || items[a.item]!.hides || items[b.item]!.hides) continue;
      const hit = overlap(a, b);
      if (hit === null) continue;
      const [first, second] = [items[a.item]!.name, items[b.item]!.name].sort();
      const pair = patches.get(`${first}|${second}`) ?? { area: 0, list: [] };
      pair.area += hit.area * 1e4;
      pair.list.push({ area: hit.area, centre: hit.centre, n: a.n });
      patches.set(`${first}|${second}`, pair);
    }
  }
  const found = new Map<string, number>();
  for (const [pair, { area, list }] of patches) {
    if (area < minCm2) continue;
    list.sort((x, y) => y.area - x.area);
    const sample = list.slice(0, SEEN_SAMPLES);
    const total = sample.reduce((sum, p) => sum + p.area, 0);
    const shown = fromOutside ? sample.filter((p) => seen(tris, p.centre, p.n)).reduce((sum, p) => sum + p.area, 0) : total;
    if (shown > 0) found.set(pair, (area * shown) / total);
  }
  return found;
}
