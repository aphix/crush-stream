import { detAtan2 } from "../../kernel/physics-core.js";
import { AISLE_STRIDE } from "../../world/openworld/walk-graph.ts";

/** Slots of `AISLE_WALK`: the walk's ends and the share of it walked (in), its point, heading, metres walked and length (out), and what the steps below hand each other. */
export const WALK = { fromX: 0, fromZ: 1, toX: 2, toZ: 3, share: 4, x: 5, z: 6, yaw: 7, walked: 8, length: 9, x0: 10, z0: 11, x1: 12, z1: 13, t: 14, metres: 15 } as const;
/** The walk being read: a double passed to or returned from a call V8 does not inline is boxed, so they cross here. */
export const AISLE_WALK = new Float64Array(16);

/** The aisle node nearest the point in `AISLE_WALK` slots `slot`, `slot + 1`. */
function nearestNode(aisle: Float32Array, slot: number): number {
  const x = AISLE_WALK[slot]!;
  const z = AISLE_WALK[slot + 1]!;
  let best = 0;
  let bestGap = Infinity;
  for (let node = 0; node * AISLE_STRIDE < aisle.length; node++) {
    const dx = aisle[node * AISLE_STRIDE]! - x;
    const dz = aisle[node * AISLE_STRIDE + 1]! - z;
    const gap = dx * dx + dz * dz;
    if (gap >= bestGap) continue;
    bestGap = gap;
    best = node;
  }
  return best;
}

function depthOf(aisle: Float32Array, node: number): number {
  let depth = 0;
  for (let at = node; aisle[at * AISLE_STRIDE + 2]! >= 0; at = aisle[at * AISLE_STRIDE + 2]!) depth++;
  return depth;
}

/** The node where the paths from the door to `a` and to `b` part. */
function meeting(aisle: Float32Array, a: number, b: number): number {
  let first = a;
  let second = b;
  for (let gap = depthOf(aisle, first) - depthOf(aisle, second); gap > 0; gap--) first = aisle[first * AISLE_STRIDE + 2]!;
  for (let gap = depthOf(aisle, second) - depthOf(aisle, first); gap > 0; gap--) second = aisle[second * AISLE_STRIDE + 2]!;
  while (first !== second) {
    first = aisle[first * AISLE_STRIDE + 2]!;
    second = aisle[second * AISLE_STRIDE + 2]!;
  }
  return first;
}

/** Metres from `node` up the tree to `top`, into `WALK.metres`. */
function climb(aisle: Float32Array, node: number, top: number): void {
  let metres = 0;
  for (let at = node; at !== top; at = aisle[at * AISLE_STRIDE + 2]!) {
    const up = aisle[at * AISLE_STRIDE + 2]!;
    const dx = aisle[up * AISLE_STRIDE]! - aisle[at * AISLE_STRIDE]!;
    const dz = aisle[up * AISLE_STRIDE + 1]! - aisle[at * AISLE_STRIDE + 1]!;
    metres += Math.sqrt(dx * dx + dz * dz);
  }
  AISLE_WALK[WALK.metres] = metres;
}

/** The walk's point `WALK.t` of the way from (`x0`, `z0`) to (`x1`, `z1`), heading along it. */
function onSegment(): void {
  const x0 = AISLE_WALK[WALK.x0]!;
  const z0 = AISLE_WALK[WALK.z0]!;
  const dx = AISLE_WALK[WALK.x1]! - x0;
  const dz = AISLE_WALK[WALK.z1]! - z0;
  AISLE_WALK[WALK.x] = x0 + dx * AISLE_WALK[WALK.t]!;
  AISLE_WALK[WALK.z] = z0 + dz * AISLE_WALK[WALK.t]!;
  // A walk of no length keeps the heading her reading had.
  if (dx !== 0 || dz !== 0) AISLE_WALK[WALK.yaw] = detAtan2(dx, dz);
}

/** Where a walk along `aisle` is, `WALK.share` of the way: from its start to the nearest node, through the tree, from the nearest node to its end. Writes its point, heading, metres walked and length. */
export function walkAisle(aisle: Float32Array): void {
  const toX = AISLE_WALK[WALK.toX]!;
  const toZ = AISLE_WALK[WALK.toZ]!;
  const a = nearestNode(aisle, WALK.fromX);
  const b = nearestNode(aisle, WALK.toX);
  const top = meeting(aisle, a, b);
  const firstX = aisle[a * AISLE_STRIDE]! - AISLE_WALK[WALK.fromX]!;
  const firstZ = aisle[a * AISLE_STRIDE + 1]! - AISLE_WALK[WALK.fromZ]!;
  const first = Math.sqrt(firstX * firstX + firstZ * firstZ);
  climb(aisle, a, top);
  const up = AISLE_WALK[WALK.metres]!;
  climb(aisle, b, top);
  const down = AISLE_WALK[WALK.metres]!;
  const lastX = toX - aisle[b * AISLE_STRIDE]!;
  const lastZ = toZ - aisle[b * AISLE_STRIDE + 1]!;
  const last = Math.sqrt(lastX * lastX + lastZ * lastZ);
  const length = first + up + down + last;
  const s = AISLE_WALK[WALK.share]! * length;
  AISLE_WALK[WALK.length] = length;
  AISLE_WALK[WALK.walked] = s;
  if (s <= first) {
    AISLE_WALK[WALK.x0] = AISLE_WALK[WALK.fromX]!;
    AISLE_WALK[WALK.z0] = AISLE_WALK[WALK.fromZ]!;
    AISLE_WALK[WALK.x1] = aisle[a * AISLE_STRIDE]!;
    AISLE_WALK[WALK.z1] = aisle[a * AISLE_STRIDE + 1]!;
    AISLE_WALK[WALK.t] = first > 0 ? s / first : 1;
  } else if (s <= first + up) {
    AISLE_WALK[WALK.metres] = s - first;
    climbTo(aisle, a, false);
  } else if (s <= first + up + down) {
    AISLE_WALK[WALK.metres] = first + up + down - s;
    climbTo(aisle, b, true);
  } else {
    AISLE_WALK[WALK.x0] = aisle[b * AISLE_STRIDE]!;
    AISLE_WALK[WALK.z0] = aisle[b * AISLE_STRIDE + 1]!;
    AISLE_WALK[WALK.x1] = toX;
    AISLE_WALK[WALK.z1] = toZ;
    AISLE_WALK[WALK.t] = last > 0 ? (s - first - up - down) / last : 1;
  }
  onSegment();
}

/** The segment holding the point `WALK.metres` up the tree from `node`; `descending`: she walks it the other way, toward `node`. */
function climbTo(aisle: Float32Array, node: number, descending: boolean): void {
  let left = AISLE_WALK[WALK.metres]!;
  let at = node;
  for (; aisle[at * AISLE_STRIDE + 2]! >= 0; at = aisle[at * AISLE_STRIDE + 2]!) {
    const up = aisle[at * AISLE_STRIDE + 2]!;
    const dx = aisle[up * AISLE_STRIDE]! - aisle[at * AISLE_STRIDE]!;
    const dz = aisle[up * AISLE_STRIDE + 1]! - aisle[at * AISLE_STRIDE + 1]!;
    const step = Math.sqrt(dx * dx + dz * dz);
    if (left > step) {
      left -= step;
      continue;
    }
    const near = descending ? up : at;
    const far = descending ? at : up;
    AISLE_WALK[WALK.x0] = aisle[near * AISLE_STRIDE]!;
    AISLE_WALK[WALK.z0] = aisle[near * AISLE_STRIDE + 1]!;
    AISLE_WALK[WALK.x1] = aisle[far * AISLE_STRIDE]!;
    AISLE_WALK[WALK.z1] = aisle[far * AISLE_STRIDE + 1]!;
    const t = step > 0 ? left / step : 0;
    AISLE_WALK[WALK.t] = descending ? 1 - t : t;
    return;
  }
  AISLE_WALK[WALK.x0] = aisle[at * AISLE_STRIDE]!;
  AISLE_WALK[WALK.z0] = aisle[at * AISLE_STRIDE + 1]!;
  AISLE_WALK[WALK.x1] = AISLE_WALK[WALK.x0]!;
  AISLE_WALK[WALK.z1] = AISLE_WALK[WALK.z0]!;
  AISLE_WALK[WALK.t] = 0;
}
