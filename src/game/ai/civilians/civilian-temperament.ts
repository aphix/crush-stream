import { HASH_RANGE, LOOK } from "./civilian-crowd-constants.ts";
import { RESIDENT_INT_STRIDE } from "./civilian-constants.ts";
import { lookOf } from "./civilian-look-word.ts";
import type { CityState } from "./civilian-state.ts";

/** Odd 32-bit multipliers and a salt that scramble the look's who-hash into a number of its own, so that being jumpy goes with nothing else read from the look (dress, face, skin). */
const TEMPERAMENT_SALT = 0x6a09e667;
const SCRAMBLE_FIRST = 0x85ebca6b;
const SCRAMBLE_SECOND = 0xc2b2ae35;
const SHIFT_FIRST = 15;
const SHIFT_SECOND = 13;

/**
 * How jumpy a person is, 0 (nothing bothers them) to 1 (everything does), hidden: a pure function of the look word (the drawing has the poses' looks, the brain computes the same word from a resident's row), so
 * every peer agrees. Squared, so that most people are calm to middling (a median of a quarter, a mean of a third).
 */
function neuroticismOf(look: number): number {
  let hash = Math.imul((look & LOOK.hashMask) ^ TEMPERAMENT_SALT, SCRAMBLE_FIRST);
  hash ^= hash >>> SHIFT_FIRST;
  hash = Math.imul(hash, SCRAMBLE_SECOND);
  hash ^= hash >>> SHIFT_SECOND;
  const unit = (hash >>> 0) / HASH_RANGE;
  return unit * unit;
}

/** `neuroticismOf` for a resident of the brain. */
export function residentNeuroticism(state: CityState, resident: number): number {
  return neuroticismOf(lookOf(state.seed, state.ints, resident * RESIDENT_INT_STRIDE));
}
