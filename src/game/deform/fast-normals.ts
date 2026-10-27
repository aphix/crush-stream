import * as THREE from "three";

/**
 * Area-weighted vertex normals straight on the typed arrays — the same sums in the same order as
 * `BufferGeometry.computeVertexNormals` (so the output matches it), without its per-vertex
 * `Vector3.fromBufferAttribute` / `setXYZ` round trips. Reuses the geometry's normal attribute;
 * allocates only if it is missing or the vertex count changed.
 */
export function computeNormalsFast(geometry: THREE.BufferGeometry): void {
  const posAttr = geometry.getAttribute("position") as THREE.BufferAttribute;
  const pos = posAttr.array as Float32Array;
  let normalAttr = geometry.getAttribute("normal") as THREE.BufferAttribute | undefined;
  if (!normalAttr || normalAttr.count !== posAttr.count || !(normalAttr.array instanceof Float32Array)) {
    normalAttr = new THREE.BufferAttribute(new Float32Array(posAttr.count * 3), 3).setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute("normal", normalAttr);
  }
  const nor = normalAttr.array as Float32Array;
  nor.fill(0);
  const index = geometry.index;
  const triCount = index ? index.count : posAttr.count;
  const idx = index ? index.array : null;
  for (let t = 0; t + 2 < triCount; t += 3) {
    const a = (idx ? idx[t]! : t) * 3;
    const b = (idx ? idx[t + 1]! : t + 1) * 3;
    const c = (idx ? idx[t + 2]! : t + 2) * 3;
    const bx = pos[b]!;
    const by = pos[b + 1]!;
    const bz = pos[b + 2]!;
    const cbx = pos[c]! - bx;
    const cby = pos[c + 1]! - by;
    const cbz = pos[c + 2]! - bz;
    const abx = pos[a]! - bx;
    const aby = pos[a + 1]! - by;
    const abz = pos[a + 2]! - bz;
    const nx = cby * abz - cbz * aby;
    const ny = cbz * abx - cbx * abz;
    const nz = cbx * aby - cby * abx;
    nor[a] += nx;
    nor[a + 1] += ny;
    nor[a + 2] += nz;
    nor[b] += nx;
    nor[b + 1] += ny;
    nor[b + 2] += nz;
    nor[c] += nx;
    nor[c + 1] += ny;
    nor[c + 2] += nz;
  }
  for (let i = 0; i < nor.length; i += 3) {
    const x = nor[i]!;
    const y = nor[i + 1]!;
    const z = nor[i + 2]!;
    const inv = 1 / (Math.sqrt(x * x + y * y + z * z) || 1);
    nor[i] = x * inv;
    nor[i + 1] = y * inv;
    nor[i + 2] = z * inv;
  }
  normalAttr.needsUpdate = true;
}

/** Per index array: each vertex's triangles (the slot of their first corner) in ascending order, and scratch marks and lists for one pass. */
interface Incidence {
  start: Int32Array;
  tris: Int32Array;
  vertexMark: Uint8Array;
  triangleMark: Uint8Array;
  verts: Int32Array;
  triangles: Int32Array;
}
const incidences = new WeakMap<ArrayLike<number>, Incidence>();

function incidenceOf(idx: ArrayLike<number>, vertices: number): Incidence {
  const known = incidences.get(idx);
  if (known) return known;
  const start = new Int32Array(vertices + 1);
  const slots = idx.length - (idx.length % 3);
  for (let t = 0; t < slots; t++) start[idx[t]! + 1]!++;
  for (let v = 0; v < vertices; v++) start[v + 1]! += start[v]!;
  const fill = start.slice(0, vertices);
  const tris = new Int32Array(slots);
  for (let t = 0; t < slots; t += 3) for (let k = 0; k < 3; k++) tris[fill[idx[t + k]!]!++] = t;
  const inc = { start, tris, vertexMark: new Uint8Array(vertices), triangleMark: new Uint8Array(slots / 3), verts: new Int32Array(vertices), triangles: new Int32Array(slots / 3) };
  incidences.set(idx, inc);
  return inc;
}

/** Marks every corner of a triangle touching one of the `n` `changed` vertices (their normals are the ones that move); returns how many, listed in `inc.verts`. */
function markAround(idx: ArrayLike<number>, inc: Incidence, changed: ArrayLike<number>, n: number): number {
  let marked = 0;
  for (let k = 0; k < n; k++) {
    const v = changed[k]!;
    for (let j = inc.start[v]!; j < inc.start[v + 1]!; j++) {
      for (let c = 0; c < 3; c++) {
        const u = idx[inc.tris[j]! + c]!;
        if (inc.vertexMark[u] === 1) continue;
        inc.vertexMark[u] = 1;
        inc.verts[marked++] = u;
      }
    }
  }
  return marked;
}

/** Every triangle of the `marked` vertices, listed in `inc.triangles` in ascending order (the full pass's): returns how many. */
function trianglesOf(inc: Incidence, marked: number): number {
  let n = 0;
  for (let k = 0; k < marked; k++) {
    const u = inc.verts[k]!;
    for (let j = inc.start[u]!; j < inc.start[u + 1]!; j++) {
      const t = inc.tris[j]!;
      if (inc.triangleMark[t / 3] === 1) continue;
      inc.triangleMark[t / 3] = 1;
      inc.triangles[n++] = t;
    }
  }
  inc.triangles.subarray(0, n).sort();
  return n;
}

/** Adds triangle `t`'s area-weighted normal to those of its marked corners, with `computeNormalsFast`'s arithmetic. */
function addFace(pos: Float32Array, nor: Float32Array, idx: ArrayLike<number>, t: number, mark: Uint8Array): void {
  const ia = idx[t]!;
  const ib = idx[t + 1]!;
  const ic = idx[t + 2]!;
  const a = ia * 3;
  const b = ib * 3;
  const c = ic * 3;
  const bx = pos[b]!;
  const by = pos[b + 1]!;
  const bz = pos[b + 2]!;
  const cbx = pos[c]! - bx;
  const cby = pos[c + 1]! - by;
  const cbz = pos[c + 2]! - bz;
  const abx = pos[a]! - bx;
  const aby = pos[a + 1]! - by;
  const abz = pos[a + 2]! - bz;
  const nx = cby * abz - cbz * aby;
  const ny = cbz * abx - cbx * abz;
  const nz = cbx * aby - cby * abx;
  if (mark[ia] === 1) addTo(nor, a, nx, ny, nz);
  if (mark[ib] === 1) addTo(nor, b, nx, ny, nz);
  if (mark[ic] === 1) addTo(nor, c, nx, ny, nz);
}

function addTo(nor: Float32Array, o: number, nx: number, ny: number, nz: number): void {
  nor[o] += nx;
  nor[o + 1] += ny;
  nor[o + 2] += nz;
}

/**
 * `computeNormalsFast` for the vertices whose normals the `n` `changed` vertices (positions moved since the normals were last
 * computed) move: each such vertex sums all its triangles in the full pass's order, so its normal is the full pass's to the bit,
 * and every other vertex keeps its own. Unindexed geometry, or no normals yet, takes the full pass.
 */
export function computeNormalsNear(geometry: THREE.BufferGeometry, changed: ArrayLike<number>, n: number): void {
  const posAttr = geometry.getAttribute("position") as THREE.BufferAttribute;
  const normalAttr = geometry.getAttribute("normal") as THREE.BufferAttribute | undefined;
  const index = geometry.index;
  if (!index || !normalAttr || normalAttr.count !== posAttr.count || !(normalAttr.array instanceof Float32Array)) {
    computeNormalsFast(geometry);
    return;
  }
  const pos = posAttr.array as Float32Array;
  const nor = normalAttr.array;
  const idx = index.array;
  const inc = incidenceOf(idx, posAttr.count);
  const marked = markAround(idx, inc, changed, n);
  const triangles = trianglesOf(inc, marked);
  for (let k = 0; k < marked; k++) nor.fill(0, inc.verts[k]! * 3, inc.verts[k]! * 3 + 3);
  for (let k = 0; k < triangles; k++) addFace(pos, nor, idx, inc.triangles[k]!, inc.vertexMark);
  for (let k = 0; k < marked; k++) {
    const i = inc.verts[k]! * 3;
    const x = nor[i]!;
    const y = nor[i + 1]!;
    const z = nor[i + 2]!;
    const inv = 1 / (Math.sqrt(x * x + y * y + z * z) || 1);
    nor[i] = x * inv;
    nor[i + 1] = y * inv;
    nor[i + 2] = z * inv;
    inc.vertexMark[inc.verts[k]!] = 0;
  }
  for (let k = 0; k < triangles; k++) inc.triangleMark[inc.triangles[k]! / 3] = 0;
  normalAttr.needsUpdate = true;
}

/** A crash rewrites this geometry whole every skin pass (every vertex moves, so no update range helps): dynamic-draw hint on its position and normal, set before the first upload. */
export function markSkinDynamic(geometry: THREE.BufferGeometry): THREE.BufferGeometry {
  for (const attr of [geometry.getAttribute("position"), geometry.getAttribute("normal")]) {
    if (attr instanceof THREE.BufferAttribute) attr.setUsage(THREE.DynamicDrawUsage);
  }
  return geometry;
}
