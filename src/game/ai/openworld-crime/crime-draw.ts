import { hash01 } from "../../kernel/scalar.ts";
import { DRAW_INDEX_SCALE, DRAW_SEED_MASK, DRAW_SEED_SCALE, DRAW_STREAM_SCALE } from "./crime-constants.ts";

/** A draw in [0, 1) that is the same on every peer for (seed, stream, index, step): no state, so a late joiner and the host agree. */
export function crimeDraw(seed: number, stream: number, index: number, step: number): number {
  return hash01((seed & DRAW_SEED_MASK) * DRAW_SEED_SCALE + stream * DRAW_STREAM_SCALE + index * DRAW_INDEX_SCALE, step);
}
