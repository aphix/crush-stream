/** The cage's mesh: the drawn body mesh decimated to the cage's vertices (build-time, once per style). */

const QUADRIC = 10;

/** Adds `weight` × (n, d)(n, d)ᵀ (the plane n·p + d = 0, n unit) to quadric `q` at offset `o`. */
function addPlane(q: Float64Array, o: number, nx: number, ny: number, nz: number, d: number, weight: number): void {
  q[o] += weight * nx * nx;
  q[o + 1] += weight * nx * ny;
  q[o + 2] += weight * nx * nz;
  q[o + 3] += weight * nx * d;
  q[o + 4] += weight * ny * ny;
  q[o + 5] += weight * ny * nz;
  q[o + 6] += weight * ny * d;
  q[o + 7] += weight * nz * nz;
  q[o + 8] += weight * nz * d;
  q[o + 9] += weight * d * d;
}

function quadricError(q: Float64Array, o: number, x: number, y: number, z: number): number {
  return (
    q[o]! * x * x + 2 * q[o + 1]! * x * y + 2 * q[o + 2]! * x * z + 2 * q[o + 3]! * x +
    q[o + 4]! * y * y + 2 * q[o + 5]! * y * z + 2 * q[o + 6]! * y +
    q[o + 7]! * z * z + 2 * q[o + 8]! * z + q[o + 9]!
  );
}

/** Folded-over triangles stay out: a collapse may not turn a neighbouring triangle's normal below this cosine. */
const MIN_COS = 0.2;
/** Boundary edges are held in place by a plane of this weight per m² of edge. */
const BOUNDARY_WEIGHT = 100;

/**
 * Marks in `held` the loft's underside points a body resting on flat ground can stand on: on either side of the mirror plane, each
 * station's (one rest z) lowest ring point, of those the ones on the lower convex hull of the side profile (z, y). A point over the
 * chord between two others is never the lowest at any pitch; one on the hull is at some, and the cage carries the ground on its
 * vertices alone. Without them the quadric collapsed a nose lip's low points onto the rocker corner above them, and a wreck down on its
 * nose rested on that corner: the sedan's drawn lip at the front-left stood 3 cm in the ground (hatchback 4.4 cm, the SUV 2.8). The
 * loft is the first `lofted` of the mesh's vertices (`reps` their mesh ids). Of equal heights at a station the outermost. Those `held`
 * did not hold already go in `under` too; returns how many.
 */
function holdUnderside(px: Float64Array, py: Float64Array, pz: Float64Array, reps: readonly number[], lofted: number, held: Uint8Array, under: Uint8Array): number {
  const lowest = new Map<string, number>();
  for (let v = 0; v < px.length; v++) {
    if (reps[v]! >= lofted || Math.abs(px[v]!) < 1e-4) continue;
    const key = `${Math.round(pz[v]! * 1e4)}:${Math.sign(px[v]!)}`;
    const at = lowest.get(key);
    if (at === undefined || py[v]! < py[at]! || (py[v]! === py[at]! && Math.abs(px[v]!) > Math.abs(px[at]!))) lowest.set(key, v);
  }
  let added = 0;
  for (const side of [-1, 1]) {
    const run = [...lowest.values()].filter((v) => Math.sign(px[v]!) === side).sort((a, b) => pz[a]! - pz[b]!);
    // Monotone chain: a point that leaves no left turn from the two before it is over their chord.
    const hull: number[] = [];
    for (const c of run) {
      while (hull.length >= 2) {
        const a = hull[hull.length - 2]!;
        const b = hull[hull.length - 1]!;
        if ((pz[b]! - pz[a]!) * (py[c]! - py[a]!) - (py[b]! - py[a]!) * (pz[c]! - pz[a]!) > 0) break;
        hull.pop();
      }
      hull.push(c);
    }
    for (const v of hull) {
      if (held[v] !== 0) continue;
      added++;
      held[v] = 1;
      under[v] = 1;
    }
  }
  return added;
}

/**
 * The drawn mesh's vertices that stay and the triangles between them: edge-collapse decimation by quadric error (Garland
 * and Heckbert 1997), each collapse moving one end onto the other (never to a new place), so every cage vertex is a
 * vertex of the drawn mesh and takes that vertex's skin weights as they are. Vertices at one rest position are one
 * (the mesh splits them for its normals). `lofted`: the body loft's vertices, the first of the mesh, whose underside a body rests on
 * is held (`holdUnderside`), over the `target`: held within it, they cost the vertices that stood elsewhere (an upside-down sedan lost its
 * cowl's sides, rested on the drawn A-pillar's foot 7.3 cm in the ground). They come last in `source`, from `heldFrom` (`held` of them),
 * so a reader may leave them out where only a wreck stands on them. `keep` (per mesh vertex): 1 never collapses, within the `target`.
 * Build-time only: allocates freely, runs once per style.
 */
export function decimate(rest: Float32Array, index: ArrayLike<number>, group: Uint8Array, target: number, lofted = 0, keep?: Uint8Array): { source: Int32Array; tris: Uint16Array; triGroup: Uint8Array; held: number; heldFrom: number } {
  const meshVertices = rest.length / 3;
  // Weld by rest position, within one mesh (a panel's vertex at the body's is not the body's).
  const weld = new Int32Array(meshVertices);
  const keys = new Map<string, number>();
  const reps: number[] = [];
  for (let i = 0; i < meshVertices; i++) {
    const key = `${group[i]!}|${Math.round(rest[i * 3]! * 1e4)},${Math.round(rest[i * 3 + 1]! * 1e4)},${Math.round(rest[i * 3 + 2]! * 1e4)}`;
    let id = keys.get(key);
    if (id === undefined) {
      id = reps.length;
      keys.set(key, id);
      reps.push(i);
    }
    weld[i] = id;
  }
  const nv = reps.length;
  const px = new Float64Array(nv);
  const py = new Float64Array(nv);
  const pz = new Float64Array(nv);
  for (let v = 0; v < nv; v++) {
    px[v] = rest[reps[v]! * 3]!;
    py[v] = rest[reps[v]! * 3 + 1]!;
    pz[v] = rest[reps[v]! * 3 + 2]!;
  }
  // Welded triangles, without degenerate or repeated ones.
  const triList: number[] = [];
  const seen = new Set<string>();
  for (let t = 0; t + 2 < index.length; t += 3) {
    const a = weld[index[t]!]!;
    const b = weld[index[t + 1]!]!;
    const c = weld[index[t + 2]!]!;
    if (a === b || b === c || a === c) continue;
    const key = [a, b, c].sort((p, q) => p - q).join(",");
    if (seen.has(key)) continue;
    seen.add(key);
    triList.push(a, b, c);
  }
  const nt = triList.length / 3;
  const tv = Int32Array.from(triList);
  const alive = new Uint8Array(nt).fill(1);
  const vertexAlive = new Uint8Array(nv).fill(1);
  const incident: number[][] = Array.from({ length: nv }, () => []);
  const neighbours: Set<number>[] = Array.from({ length: nv }, () => new Set<number>());
  const Q = new Float64Array(nv * QUADRIC);
  const edgeTris = new Map<number, number>();
  const edgeKey = (a: number, b: number): number => (a < b ? a * nv + b : b * nv + a);
  for (let t = 0; t < nt; t++) {
    const a = tv[t * 3]!;
    const b = tv[t * 3 + 1]!;
    const c = tv[t * 3 + 2]!;
    incident[a]!.push(t);
    incident[b]!.push(t);
    incident[c]!.push(t);
    neighbours[a]!.add(b).add(c);
    neighbours[b]!.add(a).add(c);
    neighbours[c]!.add(a).add(b);
    for (const k of [edgeKey(a, b), edgeKey(b, c), edgeKey(a, c)]) edgeTris.set(k, (edgeTris.get(k) ?? 0) + 1);
    const ux = px[b]! - px[a]!;
    const uy = py[b]! - py[a]!;
    const uz = pz[b]! - pz[a]!;
    const wx = px[c]! - px[a]!;
    const wy = py[c]! - py[a]!;
    const wz = pz[c]! - pz[a]!;
    let nx = uy * wz - uz * wy;
    let ny = uz * wx - ux * wz;
    let nz = ux * wy - uy * wx;
    const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
    if (len < 1e-12) continue;
    nx /= len;
    ny /= len;
    nz /= len;
    const d = -(nx * px[a]! + ny * py[a]! + nz * pz[a]!);
    const area = len / 2;
    for (const v of [a, b, c]) addPlane(Q, v * QUADRIC, nx, ny, nz, d, area);
  }
  // Boundary edges (one triangle): a plane through the edge, square to its triangle.
  for (let t = 0; t < nt; t++) {
    for (let e = 0; e < 3; e++) {
      const a = tv[t * 3 + e]!;
      const b = tv[t * 3 + ((e + 1) % 3)]!;
      if (edgeTris.get(edgeKey(a, b)) !== 1) continue;
      const c = tv[t * 3 + ((e + 2) % 3)]!;
      const ex = px[b]! - px[a]!;
      const ey = py[b]! - py[a]!;
      const ez = pz[b]! - pz[a]!;
      const wx = px[c]! - px[a]!;
      const wy = py[c]! - py[a]!;
      const wz = pz[c]! - pz[a]!;
      const fx = ey * wz - ez * wy;
      const fy = ez * wx - ex * wz;
      const fz = ex * wy - ey * wx;
      let nx = ey * fz - ez * fy;
      let ny = ez * fx - ex * fz;
      let nz = ex * fy - ey * fx;
      const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
      const edgeLength = Math.sqrt(ex * ex + ey * ey + ez * ez);
      if (len < 1e-12) continue;
      nx /= len;
      ny /= len;
      nz /= len;
      const d = -(nx * px[a]! + ny * py[a]! + nz * pz[a]!);
      for (const v of [a, b]) addPlane(Q, v * QUADRIC, nx, ny, nz, d, BOUNDARY_WEIGHT * edgeLength * edgeLength);
    }
  }

  // The nose cap (every body vertex at the rest front z) is the drawn front face, and a head-on crush moves each of its vertices by its own
  // amount, so which one stands furthest out is not their rest order: none of them may collapse. The tail cap's lower half (the rear
  // bumper's lip, under the cap's middle) is what a wreck without its rear wheels rests on: none of it may collapse either.
  let zFront = -Infinity;
  let zBack = Infinity;
  for (let v = 0; v < nv; v++) {
    if (group[reps[v]!] !== 0) continue;
    zFront = Math.max(zFront, pz[v]!);
    zBack = Math.min(zBack, pz[v]!);
  }
  let tailLow = Infinity;
  let tailHigh = -Infinity;
  for (let v = 0; v < nv; v++) {
    if (group[reps[v]!] !== 0 || pz[v]! >= zBack + 1e-4) continue;
    tailLow = Math.min(tailLow, py[v]!);
    tailHigh = Math.max(tailHigh, py[v]!);
  }
  const noseCap = new Uint8Array(nv);
  for (let v = 0; v < nv; v++) {
    if (keep?.[reps[v]!] === 1) noseCap[v] = 1;
    if (group[reps[v]!] !== 0) continue;
    if (pz[v]! > zFront - 1e-4 || (pz[v]! < zBack + 1e-4 && py[v]! < (tailLow + tailHigh) / 2)) noseCap[v] = 1;
  }
  const under = new Uint8Array(nv);
  const held = holdUnderside(px, py, pz, reps, lofted, noseCap, under);

  const tmp = new Float64Array(QUADRIC);
  /** Cost of moving `from` onto `to`: the merged quadric at `to`'s place; Infinity when a neighbouring triangle would fold over. */
  const cost = (from: number, to: number): number => {
    if (noseCap[from]) return Infinity;
    for (const t of incident[from]!) {
      if (!alive[t]) continue;
      const a = tv[t * 3]!;
      const b = tv[t * 3 + 1]!;
      const c = tv[t * 3 + 2]!;
      if (a === to || b === to || c === to) continue;
      const ax = px[a]!;
      const ay = py[a]!;
      const az = pz[a]!;
      const bx = px[b]!;
      const by = py[b]!;
      const bz = pz[b]!;
      const cx = px[c]!;
      const cy = py[c]!;
      const cz = pz[c]!;
      const n0x = (by - ay) * (cz - az) - (bz - az) * (cy - ay);
      const n0y = (bz - az) * (cx - ax) - (bx - ax) * (cz - az);
      const n0z = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
      const fa = a === from;
      const fb = b === from;
      const fc = c === from;
      const ax1 = fa ? px[to]! : ax;
      const ay1 = fa ? py[to]! : ay;
      const az1 = fa ? pz[to]! : az;
      const bx1 = fb ? px[to]! : bx;
      const by1 = fb ? py[to]! : by;
      const bz1 = fb ? pz[to]! : bz;
      const cx1 = fc ? px[to]! : cx;
      const cy1 = fc ? py[to]! : cy;
      const cz1 = fc ? pz[to]! : cz;
      const n1x = (by1 - ay1) * (cz1 - az1) - (bz1 - az1) * (cy1 - ay1);
      const n1y = (bz1 - az1) * (cx1 - ax1) - (bx1 - ax1) * (cz1 - az1);
      const n1z = (bx1 - ax1) * (cy1 - ay1) - (by1 - ay1) * (cx1 - ax1);
      const l0 = Math.sqrt(n0x * n0x + n0y * n0y + n0z * n0z);
      const l1 = Math.sqrt(n1x * n1x + n1y * n1y + n1z * n1z);
      if (l0 < 1e-12) continue;
      if (l1 < 1e-12 || (n0x * n1x + n0y * n1y + n0z * n1z) / (l0 * l1) < MIN_COS) return Infinity;
    }
    for (let k = 0; k < QUADRIC; k++) tmp[k] = Q[from * QUADRIC + k]! + Q[to * QUADRIC + k]!;
    return quadricError(tmp, 0, px[to]!, py[to]!, pz[to]!);
  };

  // The body is mirror-symmetric (x to -x): a collapse is made on both sides at once, and a vertex on the mirror plane never collapses
  // onto one off it, so the cage's vertices are a mirror-symmetric set and a car's reflection is its mirror image to float error.
  const mirror = new Int32Array(nv).fill(-1);
  const placeOf = (v: number, x: number): string => `${group[reps[v]!]!}|${Math.round(x * 1e4) + 0},${Math.round(py[v]! * 1e4)},${Math.round(pz[v]! * 1e4)}`;
  const byPlace = new Map<string, number>();
  for (let v = 0; v < nv; v++) byPlace.set(placeOf(v, px[v]!), v);
  for (let v = 0; v < nv; v++) mirror[v] = byPlace.get(placeOf(v, -px[v]!)) ?? -1;

  /** Moves `from` onto `to`: its quadric, its triangles and its neighbours go to `to`. */
  const collapse = (from: number, to: number): void => {
    for (let k = 0; k < QUADRIC; k++) Q[to * QUADRIC + k] += Q[from * QUADRIC + k]!;
    for (const t of incident[from]!) {
      if (!alive[t]) continue;
      const a = tv[t * 3]!;
      const b = tv[t * 3 + 1]!;
      const c = tv[t * 3 + 2]!;
      if (a === to || b === to || c === to) {
        alive[t] = 0;
        continue;
      }
      for (let k = 0; k < 3; k++) if (tv[t * 3 + k] === from) tv[t * 3 + k] = to;
      incident[to]!.push(t);
    }
    for (const w of neighbours[from]!) {
      neighbours[w]!.delete(from);
      if (w !== to) {
        neighbours[w]!.add(to);
        neighbours[to]!.add(w);
      }
    }
    neighbours[from]!.clear();
    vertexAlive[from] = 0;
  };

  // Each vertex's cheapest allowed collapse (the first neighbour, in set order, at the least cost) is kept between passes. A collapse
  // changes only what its two ends, the survivor's neighbours and their mirror twins read, so only those rescan; every other
  // vertex's kept pick is what a fresh scan would find, and the pass's pick is the same first strict minimum over ascending vertices.
  const bestCost = new Float64Array(nv);
  const bestOnto = new Int32Array(nv);
  const stale = new Uint8Array(nv).fill(1);
  const scan = (u: number): void => {
    const onPlane = mirror[u] === u;
    const twin = mirror[u]!;
    let least = Infinity;
    let onto = -1;
    for (const v of neighbours[u]!) {
      if (onPlane && mirror[v] !== v) continue;
      if (twin >= 0 && !onPlane && (v === twin || mirror[v]! < 0 || !vertexAlive[twin] || !neighbours[twin]!.has(mirror[v]!))) continue;
      const c = cost(u, v);
      if (c < least) {
        least = c;
        onto = v;
      }
    }
    bestCost[u] = least;
    bestOnto[u] = onto;
    stale[u] = 0;
  };
  const touch = (v: number): void => {
    stale[v] = 1;
    if (mirror[v]! >= 0) stale[mirror[v]!] = 1;
  };
  /** Marks what a finished collapse of `from` onto `to` changed. */
  const touched = (from: number, to: number): void => {
    touch(from);
    touch(to);
    for (const w of neighbours[to]!) touch(w);
  };

  let remaining = nv;
  while (remaining > target + held) {
    let best = Infinity;
    let bestFrom = -1;
    let bestTo = -1;
    for (let u = 0; u < nv; u++) {
      if (!vertexAlive[u]) continue;
      if (stale[u]) scan(u);
      if (bestCost[u]! < best) {
        best = bestCost[u]!;
        bestFrom = u;
        bestTo = bestOnto[u]!;
      }
    }
    if (bestFrom < 0) break;
    const twinFrom = mirror[bestFrom]!;
    const twinTo = mirror[bestTo]!;
    collapse(bestFrom, bestTo);
    touched(bestFrom, bestTo);
    remaining--;
    if (twinFrom >= 0 && twinFrom !== bestFrom && twinTo >= 0 && twinFrom !== twinTo && vertexAlive[twinFrom] && vertexAlive[twinTo] && neighbours[twinFrom]!.has(twinTo)) {
      collapse(twinFrom, twinTo);
      touched(twinFrom, twinTo);
      remaining--;
    }
  }

  const slot = new Int32Array(nv).fill(-1);
  const source: number[] = [];
  let heldFrom = 0;
  for (const pass of [0, 1]) {
    if (pass === 1) heldFrom = source.length;
    for (let v = 0; v < nv; v++) {
      if (!vertexAlive[v] || under[v] !== pass) continue;
      slot[v] = source.length;
      source.push(reps[v]!);
    }
  }
  const out: number[] = [];
  const outGroup: number[] = [];
  for (let t = 0; t < nt; t++) {
    if (!alive[t]) continue;
    const a = slot[tv[t * 3]!]!;
    const b = slot[tv[t * 3 + 1]!]!;
    const c = slot[tv[t * 3 + 2]!]!;
    if (a < 0 || b < 0 || c < 0 || a === b || b === c || a === c) continue;
    out.push(a, b, c);
    outGroup.push(group[reps[tv[t * 3]!]!]!);
  }
  return { source: Int32Array.from(source), tris: Uint16Array.from(out), triGroup: Uint8Array.from(outGroup), held, heldFrom };
}

/**
 * The triangles of a mesh that face up (the outward winding's normal has a positive y) and the vertices they use: the cage's top
 * field reads nothing else of the interior (a box's underside and sides lie under or beside its top), and every triangle kept costs
 * a raster at each refit.
 */
export function upFacing(rest: Float32Array, index: ArrayLike<number>): { rest: Float32Array; index: Uint32Array } {
  const slot = new Int32Array(rest.length / 3).fill(-1);
  const kept: number[] = [];
  const out: number[] = [];
  for (let t = 0; t + 2 < index.length; t += 3) {
    const a = index[t]! * 3;
    const b = index[t + 1]! * 3;
    const c = index[t + 2]! * 3;
    // y of (b - a) x (c - a): (bz - az)(cx - ax) - (bx - ax)(cz - az).
    if ((rest[b + 2]! - rest[a + 2]!) * (rest[c]! - rest[a]!) - (rest[b]! - rest[a]!) * (rest[c + 2]! - rest[a + 2]!) <= 0) continue;
    for (let k = 0; k < 3; k++) {
      const v = index[t + k]!;
      if (slot[v]! < 0) {
        slot[v] = kept.length / 3;
        kept.push(rest[v * 3]!, rest[v * 3 + 1]!, rest[v * 3 + 2]!);
      }
      out.push(slot[v]!);
    }
  }
  return { rest: Float32Array.from(kept), index: Uint32Array.from(out) };
}
