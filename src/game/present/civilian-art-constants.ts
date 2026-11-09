import { JEANS, OUTFIT, SHIRTS } from "./driver-look.ts";

/** A civilian within this distance (m) of the eye may take a posed dummy: at 60 m a 1.75 m figure is still about 35 px tall at 1080p. */
export const NEAR_DRAW = 60;
/** Nothing is drawn past this distance (m): the city's fog has swallowed it. */
export const FAR_DRAW = 120;
/** Posed dummies a tier draws. A slot no civilian holds costs nothing: a mesh draws up to its highest slot in use, and slots fill from the lowest. */
export const NEAR_SLOTS = { phone: 20, desktop: 64 } as const;
/** A person's size to the sight field (m): the sphere about the chest that must be in view. */
export const SIGHT_RADIUS = 1;
/** A civilian holding a dummy counts as this share nearer than it is, so two civilians at the cutoff do not trade dummies (and looks) every frame. */
export const SLOT_KEEP_DISTANCE_SCALE = 0.9;
/** One `DummyMesh` tracks the slots it draws in a 32-bit mask, so a tier with more near slots spreads them over several. */
export const SLOTS_PER_DUMMY_MESH = 32;
/** The open world's ground is flat: a civilian's feet stand at this height (m). */
export const FEET_Y = 0;

/** What a civilian wears today. */
export const ATTIRE = { CASUAL: 0, HOODIE: 1, SUIT: 2, SCRUBS: 3, DELIVERY: 4 } as const;
type Attire = (typeof ATTIRE)[keyof typeof ATTIRE];

/** Sixteen draws of a look's attire field: the commoner the attire, the more of them. */
export const ATTIRE_DRAWS: readonly Attire[] = [
  ATTIRE.CASUAL, ATTIRE.CASUAL, ATTIRE.CASUAL, ATTIRE.CASUAL, ATTIRE.CASUAL, ATTIRE.CASUAL,
  ATTIRE.HOODIE, ATTIRE.HOODIE, ATTIRE.HOODIE, ATTIRE.HOODIE,
  ATTIRE.SUIT, ATTIRE.SUIT, ATTIRE.SUIT,
  ATTIRE.SCRUBS,
  ATTIRE.DELIVERY, ATTIRE.DELIVERY,
];

/** One attire's garment and colours (sRGB): the dummy outfit a man and a woman wear, the shirt and trousers palettes (no trousers: the suit and the scrubs match), and the cap's share in sixteenths. */
type AttireWear = { outfitMan: number; outfitWoman: number; shirts: readonly number[]; trousers: readonly number[]; capSixteenths: number };

/** Caps a casual civilian may wear (sRGB): navy, charcoal, red, off-white. */
export const CAP_COLOURS: readonly number[] = [0x1d2a4a, 0x2f3238, 0xc0392b, 0xe9e9e2];

/** Hoodie greys, blacks and navies with a maroon, a forest green and a mustard for the loud ones (sRGB). */
const HOODIE_COLOURS: readonly number[] = [0x2f3238, 0x1b1d22, 0x3d5a80, 0x7a2a35, 0x41563a, 0x6b6f76, 0xe2b53a];
/** Charcoal, navy, slate and tobacco suits (sRGB). */
const SUIT_COLOURS: readonly number[] = [0x26272a, 0x262a35, 0x3b3f46, 0x4b3f35];
/** Teal, sky, sage and lavender scrubs (sRGB). */
const SCRUB_COLOURS: readonly number[] = [0x3aa6a0, 0x4aa3df, 0x5a9f6e, 0x7a6fb5];
/** High-visibility rider jackets: orange, yellow, lime, red (sRGB). */
const RIDER_COLOURS: readonly number[] = [0xe0762c, 0xe2b53a, 0xb7d43a, 0xc0392b];
/** Everyday trousers: jeans, black jeans, slate, navy, khaki (sRGB). */
const TROUSER_COLOURS: readonly number[] = [JEANS, 0x1f2430, 0x4a4f5a, 0x2f3a4d, 0x6b5b45];
/** A rider's dark work trousers (sRGB). */
const RIDER_TROUSERS: readonly number[] = [0x1f2430, 0x2f3238];

/** Each `ATTIRE`'s wear: the dummy's tee, long sleeves, her top and cut-offs, or the suit; scrubs are a tee in one colour head to toe. */
export const ATTIRE_WEAR: readonly AttireWear[] = [
  { outfitMan: OUTFIT.TEE, outfitWoman: OUTFIT.TOP, shirts: SHIRTS, trousers: TROUSER_COLOURS, capSixteenths: 2 },
  { outfitMan: OUTFIT.LONG_SLEEVE, outfitWoman: OUTFIT.LONG_SLEEVE, shirts: HOODIE_COLOURS, trousers: TROUSER_COLOURS, capSixteenths: 2 },
  { outfitMan: OUTFIT.SUIT, outfitWoman: OUTFIT.SUIT, shirts: SUIT_COLOURS, trousers: [], capSixteenths: 0 },
  { outfitMan: OUTFIT.TEE, outfitWoman: OUTFIT.TEE, shirts: SCRUB_COLOURS, trousers: [], capSixteenths: 0 },
  { outfitMan: OUTFIT.LONG_SLEEVE, outfitWoman: OUTFIT.LONG_SLEEVE, shirts: RIDER_COLOURS, trousers: RIDER_TROUSERS, capSixteenths: 16 },
];

/** A look's bit fields once scrambled: where each starts and how wide it is (attire 4, shirt 4, trousers 3, hair 5, cap 4, moustache 4, shades 3, face 2). The woman bit is not one: it is read raw (`LOOK`). */
export const LOOK_FIELD = {
  attire: { shift: 1, bits: 4 },
  shirt: { shift: 5, bits: 4 },
  trousers: { shift: 9, bits: 3 },
  hair: { shift: 12, bits: 5 },
  cap: { shift: 17, bits: 4 },
  moustache: { shift: 21, bits: 4 },
  shades: { shift: 25, bits: 3 },
  face: { shift: 28, bits: 2 },
} as const;
/** Of 16 men one wears a moustache; of 8 civilians one wears shades (scrubs: none). */
export const MOUSTACHE_DRAWS = 1;
export const SHADES_DRAWS = 1;
/** The 32-bit integer finaliser's multipliers and shifts (lowbias32): a crowd's look seeds need not be uniform in every bit, these make them so. */
export const LOOK_SCRAMBLE = { first: 0x7feb352d, second: 0x846ca68b, shiftFirst: 16, shiftSecond: 15 } as const;

/** The far figure's vertex roles: which per-instance colour a vertex takes. */
export const FIGURE_ROLE = { SKIN: 0, SHIRT: 1, TROUSERS: 2, DARK: 3 } as const;
/** The far figure's hair and shoes (sRGB): one dark brown, as at 20 m and more nobody sees them apart. */
export const FIGURE_DARK = 0x2a1d15;
/** The far figure's vertex attributes beyond position and normal: role, swing and pivot height (`rig`), the per-instance trousers and skin colours, and the walk's phase and amplitude (`gait`). */
export const FIGURE_ATTRIBUTE = { RIG: "rig", TROUSERS: "trousers", SKIN: "skin", GAIT: "gait" } as const;
/** Floats an instance holds in each of those: a mat4, three colours, a phase and an amplitude. */
export const FIGURE_FLOATS = { MATRIX: 16, COLOUR: 3, GAIT: 2 } as const;
/** The hair block's rise down the head from its top (m) and how far it stands off the skull. */
export const FIGURE_HAIR = { rise: 0.08, margin: 0.01 } as const;
/** The shoulders' extra half width over the torso box (m): the arms hang from them. */
export const FIGURE_SHOULDER_FLARE = 0.02;
/** A hand's half width and its length below the forearm's end (m). */
export const FIGURE_HAND = { half: 0.035, length: 0.11 } as const;
/** The far end of each limb and the jaw is this share of its near end's half width. */
export const FIGURE_TAPER = { leg: 0.65, arm: 0.8, head: 0.8 } as const;

/** Arms hang this far (rad) out from the sides, and a foot tips with its shin by this share of the shin's swing: as the guards stand and walk (`People`). */
export const POSE_ARM_OUT = 0.05;
export const POSE_FOOT_FOLLOW = 0.5;
/** Floats of linear colour a civilian's far figure keeps cached: shirt, trousers and skin. */
export const FIGURE_COLOUR_CACHE_FLOATS = FIGURE_FLOATS.COLOUR * 3;
