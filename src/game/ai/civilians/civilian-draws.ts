import { mulberry32 } from "../../world/placements.ts";
import { MIX_INDEX, MIX_RESIDENT, MIX_SALT } from "./civilian-constants.ts";

/** A draw stream private to (seed, resident, salt, index): the same four give the same draws on every peer and in the worker, whatever else was drawn before. */
export function residentDraws(seed: number, resident: number, salt: number, index: number): () => number {
  let hash = Math.imul(seed ^ MIX_SALT, MIX_RESIDENT);
  hash = Math.imul(hash ^ (resident + 1), MIX_SALT);
  hash = Math.imul(hash ^ salt, MIX_INDEX);
  hash = Math.imul(hash ^ (index + 1), MIX_RESIDENT);
  return mulberry32(hash ^ (hash >>> 15));
}
