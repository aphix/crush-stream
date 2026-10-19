import * as THREE from "three";
import { FABRIC } from "./dummy-cloth.ts";
import { FACE, FACES } from "./dummy-faces.ts";
import { CREW_NECK, JEANS_DECALS, LONG_SLEEVE_END, SHORT_SLEEVE_END, TROUSERS_FROM } from "./dummy-garments.ts";
import { BARE, BELTED, BUILD, CAPPED, CUTS_AT, DRESS_SHOES, FLAGS_AT, HEELS, LONG_SLEEVES, PALETTE_AT, POLICE, ROLE, ROLES, SHADES, SHORT_SLEEVES, SNEAKERS, SUITED, UNIFORM, WHISKERS, type Decal } from "./dummy-rig.ts";
import { SUIT_DECALS, UNIFORM_DECALS } from "./dummy-uniform.ts";
import { SHORTS_END, SLEEVE_END } from "./dummy-woman.ts";
import { RUBBER_WHITE } from "./dummy-texture.ts";
import { OUTFIT, type DriverLook } from "./driver-look.ts";

/**
 * How a slot is dressed: its row's palette, flags, face and garment cuts, from a look and its outfit. Every person the game
 * draws (drivers, the course's figures, the showcase) goes through `dressRow`.
 */

/** A cut no body vertex reaches (m, man's rest): the garment runs the whole region. */
const NO_CUT = 9;
/** Her scoop neckline (m, man's rest): its lowest and highest height at the middle, and its half width at the top (the second reference's top). */
const SCOOP_LOW = 1.29;
const SCOOP_HIGH = 1.48;
const SCOOP_HALF = 0.105;
/** Her heels' straps: skin shows above this height (m) on the foot. */
const HEEL_SHOE_TOP = 0.05;
/** A civilian's cap peak against its crown: the reference's cap is one navy, the peak a little darker under its curve. */
const PEAK_SHADE = 0.85;

/** The cop's shoulder patch field (sRGB); on anyone else the patch is never drawn. */
const PATCH_FIELD = 0x8fa2c4;

/** The decal layers, by index: the jeans' (a woman's cut-offs show their top), the suit's, the uniform's, and the guard's (the uniform's with the earpiece). */
const LAYER = { JEANS: 0, SUIT: 1, UNIFORM: 2, GUARD: 3 } as const;

/** Fabric kit (cuts texel 2's w): the shirt's, the legs' and the shoes' fabric and the decal layer, four bits each. */
function kit(shirt: number, legs: number, shoe: number, layer: number): number {
  return shirt | (legs << 4) | (shoe << 8) | (layer << 12);
}

type Outfit = {
  /** The wear bits it draws. */
  flags: number;
  /** Its fixed role colours (sRGB), by role; the look's shirt, trousers, hair and cap fill the rest. */
  colours: Partial<Record<number, number>>;
  /** The garment cuts (`CUTS_AT`): sleeve end, leg end, waist, shoe top; scoop low, scoop high, scoop half width, kit. */
  cuts: readonly [number, number, number, number, number, number, number, number];
};

const SNEAKER = { [ROLE.SHOE]: 0x3e4045, [ROLE.SOLE]: RUBBER_WHITE, [ROLE.BELT]: 0x17140f, [ROLE.BUCKLE]: 0xb9bdc4, [ROLE.EYES]: 0x0b0b0c };
const DRESS_SHOE = { [ROLE.SHOE]: 0x0e0e10, [ROLE.SOLE]: 0x0e0e10, [ROLE.EYES]: 0x0b0b0c };

/** Each `OUTFIT`'s bits, colours and cuts. */
const OUTFITS: readonly Outfit[] = [
  { flags: SHORT_SLEEVES | BELTED | SNEAKERS, colours: SNEAKER, cuts: [SHORT_SLEEVE_END, 0, TROUSERS_FROM, NO_CUT, ...CREW_NECK, kit(FABRIC.JERSEY, FABRIC.DENIM, FABRIC.CANVAS, LAYER.JEANS)] },
  { flags: LONG_SLEEVES | SNEAKERS, colours: SNEAKER, cuts: [LONG_SLEEVE_END, 0, TROUSERS_FROM, NO_CUT, ...CREW_NECK, kit(FABRIC.JERSEY, FABRIC.DENIM, FABRIC.CANVAS, LAYER.JEANS)] },
  {
    flags: SHORT_SLEEVES | HEELS,
    colours: { [ROLE.SHOE]: 0x1d2340, [ROLE.SOLE]: 0x1d2340, [ROLE.EYES]: 0x0b0b0c },
    cuts: [SLEEVE_END, SHORTS_END, TROUSERS_FROM, HEEL_SHOE_TOP, SCOOP_LOW, SCOOP_HIGH, SCOOP_HALF, kit(FABRIC.JERSEY, FABRIC.DENIM, FABRIC.LEATHER, LAYER.JEANS)],
  },
  {
    flags: SUITED | LONG_SLEEVES | DRESS_SHOES,
    colours: { ...DRESS_SHOE, [ROLE.COLLAR]: 0xf4f4f1, [ROLE.TIE]: 0xb3202a },
    cuts: [LONG_SLEEVE_END, 0, TROUSERS_FROM, NO_CUT, ...CREW_NECK, kit(FABRIC.WOOL, FABRIC.WOOL, FABRIC.LEATHER, LAYER.SUIT)],
  },
  {
    flags: UNIFORM | BELTED | LONG_SLEEVES | DRESS_SHOES,
    colours: { ...DRESS_SHOE, [ROLE.BELT]: 0x111113, [ROLE.BUCKLE]: 0xb9bec6, [ROLE.BADGE]: 0xb9bec6 },
    cuts: [LONG_SLEEVE_END, 0, TROUSERS_FROM, NO_CUT, ...CREW_NECK, kit(FABRIC.TWILL, FABRIC.TWILL, FABRIC.LEATHER, LAYER.UNIFORM)],
  },
];

/** The guard's earpiece on his right (-x): a black bud in the ear, its clear coiled wire down behind the jaw into the collar; how far (m) each stands off the skin. */
const EARBUD_RAISE = 0.002;
const EARPIECE_WIRE_RAISE = 0.0015;
const EARPIECE_DECALS: readonly Decal[] = [
  { face: "-x", x0: -0.008, x1: 0.008, y0: 1.602, y1: 1.622, round: 0.008, edge: 0, raise: EARBUD_RAISE, shade: 1, paint: ROLE.EYES, taper: 1 },
  { face: "-x", x0: -0.022, x1: -0.016, y0: 1.44, y1: 1.605, round: 0.003, edge: 0, raise: EARPIECE_WIRE_RAISE, shade: 0.8, paint: -1, taper: 1 },
];

/** The decal layers in `LAYER` order. */
export const DRESS_DECALS: readonly (readonly Decal[])[] = [JEANS_DECALS, SUIT_DECALS, UNIFORM_DECALS, [...UNIFORM_DECALS, ...EARPIECE_DECALS]];

/** The uniformed division: navy shirt and trousers, short dark hair, no cap, no glasses (the reference's cop). */
export const COP_LOOK: DriverLook = { woman: false, shirt: 0x1b2a4a, pants: 0x1b2a4a, hair: 0x2a2018, hat: null, mustache: false, outfit: OUTFIT.UNIFORM, face: FACE.COP };
/** A plain-clothes agent: the cop's build and kit in black, with dark glasses and an earpiece. */
export const GUARD_LOOK: DriverLook = { ...COP_LOOK, shirt: 0x16181d, pants: 0x16181d, shades: true };
/** The VIP: portly, in a navy-blue suit with a red tie, his golden-blond hair swept back. */
export const VIP_LOOK: DriverLook = { woman: false, shirt: 0x1f3463, pants: 0x1f3463, hair: 0xc89a4a, hat: null, mustache: false, portly: true, outfit: OUTFIT.SUIT, face: FACE.PRESIDENT };
/** His older aide: grey-haired, in a charcoal suit and a dark tie. */
export const ELDER_LOOK: DriverLook = { woman: false, shirt: 0x2a2d33, pants: 0x2a2d33, hair: 0xa9a8a3, hat: null, mustache: false, outfit: OUTFIT.SUIT, face: FACE.ELDER, tie: 0x1d2027 };

const _c = new THREE.Color();

/** Dress the pose row at `at` (floats) in `rows`: a police driver (`cop`) wears the uniform over his own hair and face. */
export function dressRow(rows: Float32Array, at: number, cop: boolean, look: DriverLook): void {
  const build = look.woman ? BUILD.WOMAN : look.portly ? BUILD.PORTLY : BUILD.MAN;
  const outfit = cop ? OUTFIT.UNIFORM : (look.outfit ?? (look.woman ? OUTFIT.TOP : look.portly ? OUTFIT.SUIT : OUTFIT.TEE));
  const wear = OUTFITS[outfit]!;
  const capped = !cop && look.hat !== null;
  const face = look.face ?? (look.woman ? FACE.WOMAN : FACE.MAN);
  const shirt = cop ? COP_LOOK.shirt : look.shirt;
  const pants = cop ? COP_LOOK.pants : look.pants;
  const flags = build | wear.flags | (look.mustache ? WHISKERS : 0) | (capped ? CAPPED : BARE) | (look.shades ? SHADES : 0) | (cop ? POLICE : 0);
  for (let role = 0; role < ROLES; role++) {
    const fixed = wear.colours[role] ?? 0;
    const colour =
      role === ROLE.SHIRT || role === ROLE.ARM ? shirt
      : role === ROLE.LEGS ? pants
      : role === ROLE.SKIN ? FACES[face]!.skin
      : role === ROLE.HAIR ? (capped ? look.hat! : look.hair)
      : role === ROLE.BRIM ? (capped ? look.hat! : look.hair)
      : role === ROLE.LOCKS || role === ROLE.MUSTACHE ? look.hair
      : role === ROLE.COLLAR ? (wear.colours[role] ?? shirt)
      : role === ROLE.TIE ? (look.tie ?? fixed)
      : role === ROLE.PATCH ? (cop ? PATCH_FIELD : shirt)
      : fixed;
    _c.setHex(colour);
    if (role === ROLE.BRIM && capped) _c.multiplyScalar(PEAK_SHADE);
    _c.toArray(rows, at + (PALETTE_AT + role) * 4);
  }
  rows[at + FLAGS_AT * 4] = flags;
  rows[at + FLAGS_AT * 4 + 1] = face;
  rows.set(wear.cuts, at + CUTS_AT * 4);
  if (cop || !look.shades || outfit !== OUTFIT.UNIFORM) return;
  rows[at + (CUTS_AT + 1) * 4 + 3] = kit(FABRIC.TWILL, FABRIC.TWILL, FABRIC.LEATHER, LAYER.GUARD);
}
