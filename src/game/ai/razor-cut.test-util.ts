import type { TrackPath } from "../world/track.ts";

/** A hairpin bends one way on a radius of at most this (m) ... */
const HAIRPIN_RADIUS = 20;
/** ... and turns the car through at least this (rad), 150°, before the bend eases. */
const HAIRPIN_TURN = (150 * Math.PI) / 180;

/** The hairpins of `path` as [first, last] sample indices: runs of samples tighter than `HAIRPIN_RADIUS` that bend the same way and add up to `HAIRPIN_TURN`. */
export function hairpinsOf(path: TrackPath): [number, number][] {
  const step = path.length / (path.count - 1);
  const found: [number, number][] = [];
  let first = -1;
  let turn = 0;
  let sign = 0;
  const close = (last: number): void => {
    if (first >= 0 && Math.abs(turn) >= HAIRPIN_TURN) found.push([first, last]);
    first = -1;
    turn = 0;
    sign = 0;
  };
  for (let k = 0; k < path.count; k++) {
    const curv = path.curv[k]!;
    const tight = Math.abs(curv) * HAIRPIN_RADIUS >= 1;
    if (!tight || (sign !== 0 && Math.sign(curv) !== sign)) close(k - 1);
    if (!tight) continue;
    if (first < 0) first = k;
    sign = Math.sign(curv);
    turn += curv * step;
  }
  close(path.count - 1);
  return found;
}
