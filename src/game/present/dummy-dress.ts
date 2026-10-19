import * as THREE from "three";
import { FABRIC } from "./dummy-cloth.ts";
import { FACE, FACES } from "./dummy-faces.ts";
import { CREW_NECK, JEANS_DECALS, LONG_SLEEVE_END, SHORT_SLEEVE_END, SUIT_HANG, TROUSERS_FROM, UNIFORM_HANG } from "./dummy-garments.ts";
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
/** Her scoop neckline (m, man's rest): its lowest and highest height at the middle, and its half width at the top (the second reference's top: 5 cm above her bust's peak, 11 cm wide each side on her). */
const SCOOP_LOW = 1.32;
const SCOOP_HIGH = 1.47;
const SCOOP_HALF = 0.13;
/** A neckline's cut rises as |x|^power: a crew's is round (the crew rib's seam follows it); her scoop is the reference's flat-bottomed U. */
const ROUND_NECK = 2;
const SCOOP_POWER = 6;
/** Her heels' straps: skin shows above this height (m) on the foot. */
const HEEL_SHOE_TOP = 0.05;
/** A civilian's cap peak against its crown: the reference's cap is one navy, the peak a little darker under its curve. */
const PEAK_SHADE = 0.85;

/** The cop's shoulder patch field (sRGB); on anyone else the patch is never drawn. */
const PATCH_FIELD = 0x8fa2c4;

/** The decal layers, by index: the jeans' (a woman's cut-offs show their top), the suit's, the uniform's, and the guard's (the uniform's with the earpiece). */
const LAYER = { JEANS: 0, SUIT: 1, UNIFORM: 2, GUARD: 3 } as const;

/** Fabric kit (cuts texel 2's w): the shirt's, the legs' and the shoes' fabric, the decal layer and the neckline's power, four bits each. */
function kit(shirt: number, legs: number, shoe: number, layer: number, neckPower = ROUND_NECK): number {
  return shirt | (legs << 4) | (shoe << 8) | (layer << 12) | (neckPower << 16);
}

type Outfit = {
  /** The wear bits it draws. */
  flags: number;
  /** Its fixed role colours (sRGB), by role; the look's shirt, trousers, hair and cap fill the rest. */
  colours: Partial<Record<number, number>>;
  /** The garment cuts (`CUTS_AT`): sleeve end, leg end, waist, shoe top; scoop low, scoop high, scoop half width, kit. */
  cuts: readonly [number, number, number, number, number, number, number, number];
  /** How far its torso and sleeves, then its trousers, hang off the body (the flags texel's z and w: a share of `hang`; 0 clings). */
  hang: readonly [number, number];
};

/** The reference's sneakers: charcoal canvas, a dark-brown leather belt with a dull silver buckle (sRGB, tuned to read so under the showcase's light). */
const SNEAKER = { [ROLE.SHOE]: 0x352e2c, [ROLE.SOLE]: RUBBER_WHITE, [ROLE.BELT]: 0x3a3230, [ROLE.BUCKLE]: 0xb9bdc4, [ROLE.EYES]: 0x0b0b0c };
const DRESS_SHOE = { [ROLE.SHOE]: 0x0e0e10, [ROLE.SOLE]: 0x0e0e10, [ROLE.EYES]: 0x0b0b0c };
/** A casual outfit hangs as `hang` has it; the rest cling to the body, as a woman always does (`hang` is the men's push). */
const HUNG = [1, 1] as const;
const CLINGS = [0, 0] as const;
/** The suit jacket's sleeve ends here (m, man's rest): its white shirt cuff shows below. */
const JACKET_SLEEVE_END = 0.8;

/** Each `OUTFIT`'s bits, colours and cuts. */
const OUTFITS: readonly Outfit[] = [
  { flags: SHORT_SLEEVES | BELTED | SNEAKERS, colours: SNEAKER, cuts: [SHORT_SLEEVE_END, 0, TROUSERS_FROM, NO_CUT, ...CREW_NECK, kit(FABRIC.JERSEY, FABRIC.DENIM, FABRIC.CANVAS, LAYER.JEANS)], hang: HUNG },
  { flags: LONG_SLEEVES | SNEAKERS, colours: SNEAKER, cuts: [LONG_SLEEVE_END, 0, TROUSERS_FROM, NO_CUT, ...CREW_NECK, kit(FABRIC.JERSEY, FABRIC.DENIM, FABRIC.CANVAS, LAYER.JEANS)], hang: HUNG },
  {
    flags: SHORT_SLEEVES | HEELS,
    colours: { [ROLE.SHOE]: 0x141a33, [ROLE.SOLE]: 0x141a33, [ROLE.EYES]: 0x0b0b0c },
    cuts: [SLEEVE_END, SHORTS_END, TROUSERS_FROM, HEEL_SHOE_TOP, SCOOP_LOW, SCOOP_HIGH, SCOOP_HALF, kit(FABRIC.JERSEY, FABRIC.DENIM, FABRIC.LEATHER, LAYER.JEANS, SCOOP_POWER)],
    hang: CLINGS,
  },
  {
    flags: SUITED | DRESS_SHOES,
    colours: { ...DRESS_SHOE, [ROLE.COLLAR]: 0xf4f4f1, [ROLE.TIE]: 0x7a2d16 },
    cuts: [JACKET_SLEEVE_END, 0, TROUSERS_FROM, NO_CUT, ...CREW_NECK, kit(FABRIC.WOOL, FABRIC.WOOL, FABRIC.LEATHER, LAYER.SUIT)],
    hang: SUIT_HANG,
  },
  {
    flags: UNIFORM | BELTED | LONG_SLEEVES | DRESS_SHOES,
    colours: { ...DRESS_SHOE, [ROLE.BELT]: 0x111113, [ROLE.BUCKLE]: 0xb9bec6, [ROLE.BADGE]: 0xb9bec6 },
    cuts: [LONG_SLEEVE_END, 0, TROUSERS_FROM, NO_CUT, ...CREW_NECK, kit(FABRIC.TWILL, FABRIC.TWILL, FABRIC.LEATHER, LAYER.UNIFORM)],
    hang: UNIFORM_HANG,
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

/** The uniformed division: dark-navy shirt and trousers, short dark hair, no cap, no glasses (the reference's cop; sRGB tuned to read as it under the showcase's light). */
export const COP_LOOK: DriverLook = { woman: false, shirt: 0x2c3749, pants: 0x192333, hair: 0x473727, hat: null, mustache: false, outfit: OUTFIT.UNIFORM, face: FACE.COP };
/** A plain-clothes agent: the cop's build and kit in black (a charcoal black that reads as cloth under the showcase's light, as the reference aide's suit does), with dark glasses and an earpiece. */
export const GUARD_LOOK: DriverLook = { ...COP_LOOK, shirt: 0x37383b, pants: 0x202125, shades: true };
/** The VIP: portly, in a navy-blue suit with a brick-red tie, his golden-blond hair swept back. */
export const VIP_LOOK: DriverLook = { woman: false, shirt: 0x262a35, pants: 0x20262f, hair: 0xb5855f, hat: null, mustache: false, portly: true, outfit: OUTFIT.SUIT, face: FACE.PRESIDENT };
/** His older aide: grey-haired, in a near-black charcoal suit and a dark tie. */
export const ELDER_LOOK: DriverLook = { woman: false, shirt: 0x26272a, pants: 0x26272a, hair: 0xa9a8a3, hat: null, mustache: false, outfit: OUTFIT.SUIT, face: FACE.ELDER, tie: 0x1d2027 };

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
  rows.set(build === BUILD.WOMAN ? CLINGS : wear.hang, at + FLAGS_AT * 4 + 2);
  rows.set(wear.cuts, at + CUTS_AT * 4);
  if (cop || !look.shades || outfit !== OUTFIT.UNIFORM) return;
  rows[at + (CUTS_AT + 1) * 4 + 3] = kit(FABRIC.TWILL, FABRIC.TWILL, FABRIC.LEATHER, LAYER.GUARD);
}
