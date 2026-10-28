import type * as THREE from "three";

/**
 * The HUD's Car contour strength (0 off, 1 the default, 2 the most): how many passes pull a vertex normal toward its neighbours' mean (3 at
 * the default, 6 at the most). One object every car reads. A car's rest shells are relaxed once per style (`bakeRestNormals`), a crushed
 * skin's moved vertices every skin (`smoothNormals`); a change of passes re-paints the cars (`DeformableCar.followContourStrength`).
 */
export const CONTOUR_SMOOTHING = { value: 1 };

/** 1 on the tiers that draw the finish (high, ultra), 0 elsewhere: low and minimal draw the sim's own normals, and pay nothing for the pass. */
export const SMOOTHING_TIER = { value: 0 };

/** The strength the cars are drawn at: the slider's, on the tiers that smooth. */
export function smoothingNow(): number {
  return CONTOUR_SMOOTHING.value * SMOOTHING_TIER.value;
}

/** How many relax passes a strength runs: strength values with the same count draw the same normals. */
export function passesFor(strength: number): number {
  return Math.ceil(strength * PASSES_AT_ONE);
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

type Neighbours = { start: Int32Array; to: Int32Array; scratch: Float32Array; moved: Int32Array; frozen: Uint8Array };

const graphs = new WeakMap<ArrayLike<number>, Neighbours>();

/** Positions closer than this (1/WELD_PER_M m) are one place: a split crease copy is no open edge. */
const WELD_PER_M = 1e4;

/** 1 for each vertex standing on an open edge (one that only one face of the mesh has, a window or door opening's lip, an arch edge), 0 elsewhere. A crease copy at the same place as another vertex does not open the edge. */
function onOpenEdge(index: ArrayLike<number>, positions: ArrayLike<number>, vertexCount: number): Uint8Array {
  const placeIds = new Map<string, number>();
  const place = new Int32Array(vertexCount);
  for (let v = 0; v < vertexCount; v++) {
    const key = `${Math.round(positions[v * 3]! * WELD_PER_M)},${Math.round(positions[v * 3 + 1]! * WELD_PER_M)},${Math.round(positions[v * 3 + 2]! * WELD_PER_M)}`;
    const known = placeIds.get(key);
    place[v] = known ?? placeIds.size;
    if (known === undefined) placeIds.set(key, place[v]!);
  }
  const faces = new Map<number, number>();
  const edgeKey = (a: number, b: number): number => Math.min(place[a]!, place[b]!) * vertexCount + Math.max(place[a]!, place[b]!);
  for (let t = 0; t < index.length; t += 3) {
    for (let k = 0; k < 3; k++) {
      const key = edgeKey(index[t + k]!, index[t + ((k + 1) % 3)]!);
      faces.set(key, (faces.get(key) ?? 0) + 1);
    }
  }
  const frozen = new Uint8Array(vertexCount);
  for (let t = 0; t < index.length; t += 3) {
    for (let k = 0; k < 3; k++) {
      const a = index[t + k]!;
      const b = index[t + ((k + 1) % 3)]!;
      if (faces.get(edgeKey(a, b)) === 1) frozen[a] = frozen[b] = 1;
    }
  }
  return frozen;
}

/** Vertex to vertex edges of an indexed mesh (both directions, a shared edge listed once per triangle that has it) and the vertices on its open edges, built once per index array. `positions` are the mesh's rest places. */
function neighboursOf(index: ArrayLike<number>, positions: ArrayLike<number>, vertexCount: number): Neighbours {
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
  const built = { start, to, scratch: new Float32Array(vertexCount * 3), moved: new Int32Array(vertexCount), frozen: onOpenEdge(index, positions, vertexCount) };
  graphs.set(index, built);
  return built;
}

/** The vertices of `pos` off their `rest` place, written to `moved`; how many. The others take their `restNormals` (when given) into `nor`. */
function gatherMoved(pos: ArrayLike<number>, rest: ArrayLike<number>, moved: Int32Array, nor: Float32Array, restNormals: Float32Array | null): number {
  let count = 0;
  for (let v = 0, n = pos.length / 3; v < n; v++) {
    const i = v * 3;
    const dx = pos[i]! - rest[i]!;
    const dy = pos[i + 1]! - rest[i + 1]!;
    const dz = pos[i + 2]! - rest[i + 2]!;
    if (dx * dx + dy * dy + dz * dz > MOVED_SQ) moved[count++] = v;
    else if (restNormals) {
      nor[i] = restNormals[i]!;
      nor[i + 1] = restNormals[i + 1]!;
      nor[i + 2] = restNormals[i + 2]!;
    }
  }
  return count;
}

/** One Jacobi pass over the moved vertices (the ones on an open edge keep their normal): each normal moves `BLEND_PER_PASS` of the way to the mean of its own and its in-angle neighbours' normals, written to `out` (the others' entries are `from`'s own). */
function smoothPass(from: Float32Array, graph: Neighbours, count: number, out: Float32Array): void {
  const { start, to, moved, frozen } = graph;
  for (let m = 0; m < count; m++) {
    const v = moved[m]!;
    if (frozen[v]) continue;
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

/** `passes` Jacobi passes over the first `count` vertices listed in `graph.moved`, in place in `nor`. */
function relax(nor: Float32Array, graph: Neighbours, count: number, passes: number): void {
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

/**
 * A style product's rest normals relaxed at `strength`: the built (faceted) normals with every vertex pulled toward its in-angle
 * neighbours', so a soft facet edge (under about 55 degrees) rounds and a crease of `CREASE_COS` or more keeps its step. A vertex on an
 * open edge (a window or door opening's lip) keeps its built normal, so it matches the glass and trim it meets. Strength 0 gives the
 * built normals themselves (shared: never written). Null for a mesh the pass cannot index or whose normals are not floats.
 */
export function bakeRestNormals(template: THREE.BufferGeometry, strength: number): Float32Array | null {
  const index = template.index;
  const attr = template.getAttribute("normal");
  if (!index || !attr || !(attr.array instanceof Float32Array)) return null;
  if (strength <= 0) return attr.array;
  const graph = neighboursOf(index.array, template.getAttribute("position").array, attr.count);
  for (let v = 0; v < attr.count; v++) graph.moved[v] = v;
  const baked = attr.array.slice();
  relax(baked, graph, attr.count, passesFor(strength));
  return baked;
}

/**
 * Round the facets of a crushed skin: the vertex normals of the vertices that have left their `rest` place are pulled toward their
 * neighbours' (never across a crease sharper than `CREASE_COS`, and never across a split crease copy, which shares no edge); the others
 * take their baked `restNormals` (null: the sim's own, as just computed), so an uncrushed panel stays as smooth as the car was built.
 * Reads and writes only the drawn `normal` attribute; a mesh the pass cannot index or whose normals are not floats is left alone.
 * Allocation-free once a mesh's graph is built.
 */
export function smoothNormals(geometry: THREE.BufferGeometry, rest: ArrayLike<number>, strength: number, restNormals: Float32Array | null = null): void {
  if (strength <= 0 && !restNormals) return;
  const index = geometry.index;
  const attr = geometry.getAttribute("normal");
  const pos = geometry.getAttribute("position").array;
  if (!index || !attr || !(attr.array instanceof Float32Array)) return;
  const nor = attr.array;
  const graph = neighboursOf(index.array, rest, attr.count);
  const count = gatherMoved(pos, rest, graph.moved, nor, restNormals);
  if (count === 0 || strength <= 0) return;
  relax(nor, graph, count, passesFor(strength));
}
