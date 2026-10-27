import * as THREE from "three";

/** About this many vertices share a cell: its bound test costs about as much as reading that many. */
const CELL_VERTICES = 16;
/** A cell grid has at most this many cells along an axis. */
const MAX_CELLS_PER_AXIS = 8;
/** What a cell's lower bound keeps over a height (m) past the rounding of the per-vertex sum it stands in for (1e-13 at most). */
const CELL_BOUND_SLACK = 1e-9;
const BOX_FLOATS = 6;

/** A geometry's vertices grouped into runs of neighbours, each with the local box it spans. */
interface ClearanceCells {
  /** `position`'s version and vertex count when built: a geometry written since is built again. */
  readonly version: number;
  readonly count: number;
  readonly cellCount: number;
  /** Vertex indices cell by cell: cell `c` holds `order[start[c]]` up to (not including) `order[start[c + 1]]`. */
  readonly order: Uint32Array;
  readonly start: Uint32Array;
  /** Per cell, min x y z then max x y z of its vertices. */
  readonly box: Float64Array;
}

const built = new WeakMap<THREE.BufferGeometry, ClearanceCells>();

/** `geometry`'s cells, built on first ask and again after a write to its positions. */
export function clearanceCellsOf(geometry: THREE.BufferGeometry): ClearanceCells {
  const position = geometry.getAttribute("position");
  const version = position instanceof THREE.BufferAttribute ? position.version : position.data.version;
  const kept = built.get(geometry);
  if (kept !== undefined && kept.version === version && kept.count === position.count) return kept;
  const cells = buildCells(position, version);
  built.set(geometry, cells);
  return cells;
}

function buildCells(position: THREE.BufferAttribute | THREE.InterleavedBufferAttribute, version: number): ClearanceCells {
  const count = position.count;
  const low = [Infinity, Infinity, Infinity];
  const high = [-Infinity, -Infinity, -Infinity];
  for (let k = 0; k < count; k++) {
    low[0] = Math.min(low[0]!, position.getX(k));
    low[1] = Math.min(low[1]!, position.getY(k));
    low[2] = Math.min(low[2]!, position.getZ(k));
    high[0] = Math.max(high[0]!, position.getX(k));
    high[1] = Math.max(high[1]!, position.getY(k));
    high[2] = Math.max(high[2]!, position.getZ(k));
  }
  const perAxis = Math.min(MAX_CELLS_PER_AXIS, Math.max(1, Math.round(Math.cbrt(count / CELL_VERTICES))));
  const cellCount = perAxis * perAxis * perAxis;
  const cellOf = new Uint32Array(count);
  const start = new Uint32Array(cellCount + 1);
  for (let k = 0; k < count; k++) {
    const cx = cellAlong(position.getX(k), low[0]!, high[0]!, perAxis);
    const cy = cellAlong(position.getY(k), low[1]!, high[1]!, perAxis);
    const cz = cellAlong(position.getZ(k), low[2]!, high[2]!, perAxis);
    const c = (cx * perAxis + cy) * perAxis + cz;
    cellOf[k] = c;
    start[c + 1] = start[c + 1]! + 1;
  }
  for (let c = 0; c < cellCount; c++) start[c + 1] = start[c + 1]! + start[c]!;
  const next = start.slice(0, cellCount);
  const order = new Uint32Array(count);
  const box = new Float64Array(cellCount * BOX_FLOATS);
  for (let c = 0; c < cellCount; c++) box.set([Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity], c * BOX_FLOATS);
  for (let k = 0; k < count; k++) {
    const c = cellOf[k]!;
    order[next[c]!] = k;
    next[c] = next[c]! + 1;
    const b = c * BOX_FLOATS;
    box[b] = Math.min(box[b]!, position.getX(k));
    box[b + 1] = Math.min(box[b + 1]!, position.getY(k));
    box[b + 2] = Math.min(box[b + 2]!, position.getZ(k));
    box[b + 3] = Math.max(box[b + 3]!, position.getX(k));
    box[b + 4] = Math.max(box[b + 4]!, position.getY(k));
    box[b + 5] = Math.max(box[b + 5]!, position.getZ(k));
  }
  return { version, count, cellCount, order, start, box };
}

/** Which of `perAxis` equal slices of [`low`, `high`] holds `v`. */
function cellAlong(v: number, low: number, high: number, perAxis: number): number {
  return high > low ? Math.min(perAxis - 1, Math.floor(((v - low) / (high - low)) * perAxis)) : 0;
}

/**
 * Whether every vertex of cell `c` stands at or over world height `height` under the affine world matrix `e` (the vertex sum
 * `lowestClearance` reads): its local box's lowest corner does, with `CELL_BOUND_SLACK` to spare.
 */
export function cellIsOver(cells: ClearanceCells, c: number, e: ArrayLike<number>, height: number): boolean {
  const b = c * BOX_FLOATS;
  const box = cells.box;
  const lowest = e[13]! + Math.min(e[1]! * box[b]!, e[1]! * box[b + 3]!) + Math.min(e[5]! * box[b + 1]!, e[5]! * box[b + 4]!) + Math.min(e[9]! * box[b + 2]!, e[9]! * box[b + 5]!);
  return lowest - CELL_BOUND_SLACK >= height;
}
