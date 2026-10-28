import type * as THREE from "three";

/**
 * The HUD's Car contour strength (0 off, 1 the default, 2 the most): how many passes pull a crushed skin's vertex normals toward their
 * neighbours' mean (3 at the default, 6 at the most). One object every car reads; a change re-skins the crashed cars (`DeformableCar.updateSkin`).
 */
export const CONTOUR_SMOOTHING = { value: 1 };

/** 1 on the tiers that draw the finish (high, ultra), 0 elsewhere: low and minimal draw the sim's own normals, and pay nothing for the pass. */
export const SMOOTHING_TIER = { value: 0 };

/** The strength the cars are drawn at: the slider's, on the tiers that smooth. */
export function smoothingNow(): number {
  return CONTOUR_SMOOTHING.value * SMOOTHING_TIER.value;
}

/** A neighbour joins a vertex's average only when its normal is within this angle (cos 65 degrees): a real shoulder line or panel edge keeps its step. */
const CREASE_COS = 0.42;
/** The share of the neighbours' mean one pass blends in, and how many passes strength 1 runs (strength 2 runs twice as many). */
const BLEND_PER_PASS = 0.9;
const PASSES_AT_ONE = 3;
/** A vertex counts as crushed (its normal is worth smoothing) once it has moved this far from its rest place (m, squared): the rest skin's normals are the designed ones. */
const MOVED_SQ = 1e-6;
/** A vertex with no neighbour inside the crease angle, or a zero mean, keeps its own normal. */
const MIN_LENGTH_SQ = 1e-12;

type Neighbours = { start: Int32Array; to: Int32Array; scratch: Float32Array; moved: Int32Array };

const graphs = new WeakMap<ArrayLike<number>, Neighbours>();

/** Vertex to vertex edges of an indexed mesh (both directions, a shared edge listed once per triangle that has it), built once per index array. */
function neighboursOf(index: ArrayLike<number>, vertexCount: number): Neighbours {
  const cached = graphs.get(index);
  if (cached && cached.scratch.length === vertexCount * 3) return cached;
  const start = new Int32Array(vertexCount + 1);
  for (let t = 0; t < index.length; t += 3) {
    for (let k = 0; k < 3; k++) start[index[t + k]! + 1]! += 2;
  }
  for (let v = 0; v < vertexCount; v++) start[v + 1]! += start[v]!;
  const fill = start.slice(0, vertexCount);
  const to = new Int32Array(start[vertexCount]!);
  for (let t = 0; t < index.length; t += 3) {
    for (let k = 0; k < 3; k++) {
      const a = index[t + k]!;
      const b = index[t + ((k + 1) % 3)]!;
      to[fill[a]!++] = b;
      to[fill[b]!++] = a;
    }
  }
  const built = { start, to, scratch: new Float32Array(vertexCount * 3), moved: new Int32Array(vertexCount) };
  graphs.set(index, built);
  return built;
}

/** The vertices of `pos` off their `rest` place, written to `moved`; how many. */
function gatherMoved(pos: ArrayLike<number>, rest: ArrayLike<number>, moved: Int32Array): number {
  let count = 0;
  for (let v = 0, n = pos.length / 3; v < n; v++) {
    const i = v * 3;
    const dx = pos[i]! - rest[i]!;
    const dy = pos[i + 1]! - rest[i + 1]!;
    const dz = pos[i + 2]! - rest[i + 2]!;
    if (dx * dx + dy * dy + dz * dz > MOVED_SQ) moved[count++] = v;
  }
  return count;
}

/** One Jacobi pass over the moved vertices: each normal moves `BLEND_PER_PASS` of the way to the mean of its own and its in-angle neighbours' normals, written to `out` (the others' entries are `from`'s own). */
function smoothPass(from: Float32Array, graph: Neighbours, count: number, out: Float32Array): void {
  const { start, to, moved } = graph;
  for (let m = 0; m < count; m++) {
    const v = moved[m]!;
    const i = v * 3;
    const nx = from[i]!;
    const ny = from[i + 1]!;
    const nz = from[i + 2]!;
    let sx = nx;
    let sy = ny;
    let sz = nz;
    let neighbours = 1;
    for (let e = start[v]!, end = start[v + 1]!; e < end; e++) {
      const j = to[e]! * 3;
      const mx = from[j]!;
      const my = from[j + 1]!;
      const mz = from[j + 2]!;
      if (nx * mx + ny * my + nz * mz < CREASE_COS) continue;
      sx += mx;
      sy += my;
      sz += mz;
      neighbours++;
    }
    const inv = BLEND_PER_PASS / neighbours;
    const x = nx * (1 - BLEND_PER_PASS) + sx * inv;
    const y = ny * (1 - BLEND_PER_PASS) + sy * inv;
    const z = nz * (1 - BLEND_PER_PASS) + sz * inv;
    const lengthSq = x * x + y * y + z * z;
    if (lengthSq < MIN_LENGTH_SQ) {
      out[i] = nx;
      out[i + 1] = ny;
      out[i + 2] = nz;
      continue;
    }
    const scale = 1 / Math.sqrt(lengthSq);
    out[i] = x * scale;
    out[i + 1] = y * scale;
    out[i + 2] = z * scale;
  }
}

/**
 * Round the facets of a crushed skin: the vertex normals of the vertices that have left their `rest` place are pulled toward their
 * neighbours' (never across a crease sharper than `CREASE_COS`, and never across a split crease copy, which shares no edge); the rest
 * skin keeps its designed normals, and an uncrushed panel costs one scan. Reads and writes only the drawn `normal` attribute; a mesh
 * the pass cannot index or whose normals are not floats is left alone. Allocation-free once a mesh's graph is built.
 */
export function smoothNormals(geometry: THREE.BufferGeometry, rest: ArrayLike<number>, strength: number): void {
  if (strength <= 0) return;
  const index = geometry.index;
  const attr = geometry.getAttribute("normal");
  const pos = geometry.getAttribute("position").array;
  if (!index || !attr || !(attr.array instanceof Float32Array)) return;
  const nor = attr.array;
  const graph = neighboursOf(index.array, attr.count);
  const count = gatherMoved(pos, rest, graph.moved);
  if (count === 0) return;
  const passes = Math.ceil(strength * PASSES_AT_ONE);
  const other = graph.scratch;
  other.set(nor);
  let from = nor;
  let into = other;
  for (let pass = 0; pass < passes; pass++) {
    smoothPass(from, graph, count, into);
    const done = from;
    from = into;
    into = done;
  }
  if (from !== nor) nor.set(from);
}
