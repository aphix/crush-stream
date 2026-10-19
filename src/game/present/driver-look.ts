import { mulberry32 } from "../world/placements.ts";
import type { PersonPick } from "../match/look-data.ts";
import { FACE } from "./dummy-faces.ts";

/**
 * A driver's look: tee, trousers, hair, a cap (its colour, null for none), a moustache, and whether she is a woman; `portly` (a
 * figure of the course's own, never a drawn driver): a big man in a suit, white collar and red tie, his hair swept up and back.
 * `outfit` (one of `OUTFIT`; by default a woman's top or a man's tee, the portly man's suit), `shades`, `face` (one of `FACE`;
 * by default the man's or the woman's) and `tie` (sRGB; by default the outfit's) dress the figures the game places itself.
 * Cosmetic only. A drawn driver is a pure function of (the race's look seed, the car's slot), through its own
 * `mulberry32` stream and never the sim's RNG, so sim digests do not move, and every peer, replay and highlight clip that
 * knows the seed draws the same driver; a player's own picks (`look-pick.ts`) then override fields of it.
 */
export type DriverLook = {
  woman: boolean;
  shirt: number;
  pants: number;
  hair: number;
  hat: number | null;
  mustache: boolean;
  portly?: boolean;
  outfit?: number;
  shades?: boolean;
  face?: number;
  tie?: number;
};

/** What a figure wears: a tee and jeans, a long-sleeved shirt and jeans, a woman's top and cut-offs, a suit, a uniform. */
export const OUTFIT = { TEE: 0, LONG_SLEEVE: 1, TOP: 2, SUIT: 3, UNIFORM: 4 } as const;

/** A drawn driver's trousers: FlatOut's jeans (sRGB). */
export const JEANS = 0x3a4d6d;

/** Chance a civilian driver is a woman (owner: rare, 1 in 10). */
export const WOMAN_RATE = 0.1;

/**
 * Tees (sRGB), picked to read against asphalt, sand and the cars' paint (no sand tans, no road greys, no skin tones):
 * red, orange, mustard, leaf green, teal, sky, royal blue, violet, pink, white, cream, charcoal, olive, maroon,
 * navy-grey, lilac.
 */
export const SHIRTS: readonly number[] = [
  0xc0392b, 0xe0762c, 0xe2b53a, 0x58a04e, 0x2a9d8f, 0x4aa3df, 0x3a63c9, 0x7b4fa6, 0xd9638a, 0xe9e9e2, 0xe3d9b8, 0x2f3238, 0x6b7a3a, 0x7a2a35, 0x3d5a80,
  0xb08ed6,
];

/** Natural hair (black to blond and grey, with ginger and auburn) and the odd dyed one (blue, pink): 2 of 18. */
export const HAIRS: readonly number[] = [
  0x18120f, 0x18120f, 0x2a1d15, 0x2a1d15, 0x3a2618, 0x3a2618, 0x5a3a22, 0x5a3a22, 0x7a4a2a, 0x8a3a20, 0xb5532a, 0xd2b062, 0xa88a50, 0xe3d4a0, 0x9a9a9a,
  0xcfcfcf, 0x2d6cdf, 0xff6fa8,
];

/** The faces a drawn man may have: the reference's men without glasses. */
const MAN_FACES = [FACE.MAN, FACE.COP] as const;

/** The look of the driver in car `slot` of the race with look seed `seed`. */
export function driverLook(seed: number, slot: number): DriverLook {
  const rand = mulberry32(Math.imul(seed ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(slot + 1, 0xc2b2ae35));
  // Draws in a fixed order, so adding a field later never moves the ones before it.
  const woman = rand() < WOMAN_RATE;
  const shirt = SHIRTS[Math.floor(rand() * SHIRTS.length)]!;
  const hair = HAIRS[Math.floor(rand() * HAIRS.length)]!;
  const face = woman ? FACE.WOMAN : MAN_FACES[Math.floor(rand() * MAN_FACES.length)]!;
  return { woman, shirt, pants: JEANS, hair, hat: null, mustache: false, face };
}

/** The driver `base` (his drawn look) with the player's picks over it. The cap and the moustache are the player's alone; a pick that changes the build changes the face with it. */
export function pickedLook(base: DriverLook, pick: PersonPick): DriverLook {
  const woman = pick.woman ?? base.woman;
  return {
    woman,
    shirt: pick.shirt ?? base.shirt,
    pants: pick.pants ?? base.pants,
    hair: pick.hair ?? base.hair,
    hat: pick.hat,
    mustache: pick.mustache,
    face: woman === base.woman ? base.face : undefined,
  };
}
