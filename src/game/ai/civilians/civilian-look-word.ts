import { CAST } from "./civilian-cast.ts";
import { CAST_NAME_BASE, GENDER, MIX_INDEX, MIX_RESIDENT, MIX_SALT, RESIDENT_INT } from "./civilian-constants.ts";
import { LOOK, POLICE_HASH } from "./civilian-crowd-constants.ts";

/** The look word of the resident whose integer row starts at `base` (`LOOK`): the same resident in the same city always looks the same; a cast animal's who is its coat (`CastMember.coat`). */
export function lookOf(seed: number, ints: Int32Array, base: number): number {
  let hash = Math.imul(seed ^ LOOK.salt, MIX_RESIDENT);
  hash = Math.imul(hash ^ ints[base + RESIDENT_INT.firstName]!, MIX_INDEX);
  hash = Math.imul(hash ^ ints[base + RESIDENT_INT.familyName]!, MIX_SALT);
  hash = Math.imul(hash ^ ints[base + RESIDENT_INT.birthDay]!, MIX_RESIDENT);
  hash ^= hash >>> LOOK.hashShift;
  const woman = ints[base + RESIDENT_INT.gender] === GENDER.female ? 1 : 0;
  const castAt = ints[base + RESIDENT_INT.firstName]! - CAST_NAME_BASE;
  const coat = castAt >= 0 && castAt < CAST.length ? CAST[castAt]!.coat : null;
  const who = coat !== null ? coat : Math.min(hash & LOOK.hashMask, POLICE_HASH - 1);
  return ((ints[base + RESIDENT_INT.species]! << LOOK.speciesShift) | (woman << LOOK.womanShift) | who) >>> 0;
}
