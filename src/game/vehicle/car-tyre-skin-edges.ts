import type * as THREE from "three";
import { hypot3 } from "../kernel/physics-core.js";
import { ROW_KEEP } from "./tyre-carried.ts";

/** How fast (m per m of rest distance) a carried lift falls off along the skin at least: past the rows above a held point it spreads a hand's width, where a near-flat deck would carry it whole. */
const SPREAD = 0.5;

/** A mesh's edges between distinct rest points (a crease's copies welded into one), each from its lower end to its higher one. The points are numbered lowest first, so an edge always leads to a higher number. */
export type RestEdges = { weld: Int32Array; start: Int32Array; to: Int32Array; drop: Float32Array };

/** The upward edges of the mesh over `rest` (`index` its triangles); `drop`: how much of a lift the higher end may stand short of it (`ROW_KEEP`, `SPREAD`). */
export function restEdges(rest: Float32Array, index: THREE.BufferAttribute | null): RestEdges {
  const count = rest.length / 3;
  const weld = new Int32Array(count);
  // A point is its first vertex's position, welded by exact value (-0 with 0): an open-addressed table of point numbers, probed in a power of two at least twice the vertices.
  const bits = new Uint32Array(rest.buffer, rest.byteOffset, rest.length);
  const mask = (1 << (32 - Math.clz32(Math.max(8, 2 * count) - 1))) - 1;
  const shift = Math.clz32(mask);
  const table = new Int32Array(mask + 1).fill(-1);
  const points = new Int32Array(count);
  let found = 0;
  for (let v = 0; v < count; v++) {
    const o = v * 3;
    const x = rest[o]!;
    const y = rest[o + 1]!;
    const z = rest[o + 2]!;
    // The product's top bits, so sign and exponent (an x-mirrored twin) reach the slot.
    let slot = Math.imul(Math.imul(Math.imul(x === 0 ? 0 : bits[o]!, 0x9e3779b1) ^ (y === 0 ? 0 : bits[o + 1]!), 0x85ebca6b) ^ (z === 0 ? 0 : bits[o + 2]!), 0xc2b2ae35) >>> shift;
    for (;;) {
      const p = table[slot]!;
      if (p < 0) {
        table[slot] = found;
        weld[v] = found;
        points[found++] = v;
        break;
      }
      const at = points[p]! * 3;
      if (rest[at] === x && rest[at + 1] === y && rest[at + 2] === z) {
        weld[v] = p;
        break;
      }
      slot = (slot + 1) & mask;
    }
  }
  // Points ranked lowest first, then each point's rest position by rank.
  const order = Int32Array.from(points.subarray(0, found).keys()).sort((p, q) => rest[points[p]! * 3 + 1]! - rest[points[q]! * 3 + 1]!);
  const rank = new Int32Array(found);
  const at = new Int32Array(found);
  for (let k = 0; k < found; k++) {
    rank[order[k]!] = k;
    at[k] = points[order[k]!]! * 3;
  }
  for (let v = 0; v < count; v++) weld[v] = rank[weld[v]!]!;
  // The upward edges (lower rank, higher rank) in triangle order, then grouped by lower rank (CSR) in that order.
  const corners = index ? index.count : count;
  const lows = new Int32Array(corners);
  const highs = new Int32Array(corners);
  const start = new Int32Array(found + 1);
  let edges = 0;
  for (let t = 0; t + 2 < corners; t += 3) {
    for (let k = 0; k < 3; k++) {
      const a = weld[index ? index.getX(t + k) : t + k]!;
      const b = weld[index ? index.getX(t + ((k + 1) % 3)) : t + ((k + 1) % 3)]!;
      const ya = rest[at[a]! + 1]!;
      const yb = rest[at[b]! + 1]!;
      if (ya < yb) {
        lows[edges] = a;
        highs[edges++] = b;
      } else if (yb < ya) {
        lows[edges] = b;
        highs[edges++] = a;
      }
    }
  }
  for (let e = 0; e < edges; e++) start[lows[e]! + 1]!++;
  for (let p = 0; p < found; p++) start[p + 1] = start[p + 1]! + start[p]!;
  const fill = start.slice(0, found);
  const to = new Int32Array(edges);
  const drop = new Float32Array(edges);
  for (let e = 0; e < edges; e++) {
    const slot = fill[lows[e]!]!++;
    const from = at[lows[e]!]!;
    const upTo = at[highs[e]!]!;
    const rise = rest[upTo + 1]! - rest[from + 1]!;
    to[slot] = highs[e]!;
    drop[slot] = Math.max((1 - ROW_KEEP) * rise, SPREAD * hypot3(rest[upTo]! - rest[from]!, rise, rest[upTo + 2]! - rest[from + 2]!));
  }
  return { weld, start, to, drop };
}
