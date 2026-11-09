import * as THREE from "three";
import { ATTIRE_DRAWS, ATTIRE_WEAR, ATTIRE, CAP_COLOURS, LOOK_FIELD, LOOK_SCRAMBLE, MOUSTACHE_DRAWS, SHADES_DRAWS } from "./civilian-art-constants.ts";
import { HAIRS, type DriverLook } from "./driver-look.ts";
import { FACE, FACES } from "./dummy-faces.ts";

/** A bareheaded man's faces: the reference's two without a name (the president's and the elder's are people of the course); a capped man wears the cap man's. */
const BARE_MAN_FACES = [FACE.MAN, FACE.COP] as const;
const BYTE_RANGE = 256;
const BYTE_MAX = 255;
const COLOUR_CHANNELS = 3;
const BITS_PER_CHANNEL = 8;
const CHANNEL_MASK = 0xff;
/** Working-space (linear) value of each sRGB byte: the dummy and the far figure draw the same colour. */
const LINEAR_OF_BYTE = Float32Array.from({ length: BYTE_RANGE }, (_, byte) => new THREE.Color().setRGB(byte / BYTE_MAX, byte / BYTE_MAX, byte / BYTE_MAX, THREE.SRGBColorSpace).r);

type LookField = (typeof LOOK_FIELD)[keyof typeof LOOK_FIELD];

function scrambleLook(look: number): number {
  let bits = Math.imul(look ^ (look >>> LOOK_SCRAMBLE.shiftFirst), LOOK_SCRAMBLE.first);
  bits = Math.imul(bits ^ (bits >>> LOOK_SCRAMBLE.shiftSecond), LOOK_SCRAMBLE.second);
  return (bits ^ (bits >>> LOOK_SCRAMBLE.shiftFirst)) >>> 0;
}

function fieldOf(scrambled: number, field: LookField): number {
  return (scrambled >>> field.shift) & ((1 << field.bits) - 1);
}

/** `out` dressed as crowd look `look` says: build, today's clothes, hair, cap, face; the same look always dresses the same. Returns the attire the look drew. */
export function dressOfLook(look: number, out: DriverLook): number {
  const scrambled = scrambleLook(look);
  const attire = ATTIRE_DRAWS[fieldOf(scrambled, LOOK_FIELD.attire)]!;
  const wear = ATTIRE_WEAR[attire]!;
  const woman = fieldOf(scrambled, LOOK_FIELD.woman) === 1;
  const shirt = wear.shirts[fieldOf(scrambled, LOOK_FIELD.shirt) % wear.shirts.length]!;
  const capped = fieldOf(scrambled, LOOK_FIELD.cap) < wear.capSixteenths;
  out.woman = woman;
  out.outfit = woman ? wear.outfitWoman : wear.outfitMan;
  out.shirt = shirt;
  out.pants = wear.trousers.length === 0 ? shirt : wear.trousers[fieldOf(scrambled, LOOK_FIELD.trousers) % wear.trousers.length]!;
  out.hair = HAIRS[fieldOf(scrambled, LOOK_FIELD.hair) % HAIRS.length]!;
  out.hat = capped ? (attire === ATTIRE.DELIVERY ? shirt : CAP_COLOURS[fieldOf(scrambled, LOOK_FIELD.shirt) % CAP_COLOURS.length]!) : null;
  out.mustache = !woman && fieldOf(scrambled, LOOK_FIELD.moustache) < MOUSTACHE_DRAWS;
  out.shades = attire !== ATTIRE.SCRUBS && fieldOf(scrambled, LOOK_FIELD.shades) < SHADES_DRAWS;
  out.face = woman ? FACE.WOMAN : capped ? FACE.CAP_MAN : BARE_MAN_FACES[fieldOf(scrambled, LOOK_FIELD.face) % BARE_MAN_FACES.length]!;
  return attire;
}

/** The skin (sRGB) a dressed face shows. */
export function skinOfLook(look: DriverLook): number {
  return FACES[look.face!]!.skin;
}

/** sRGB colour `hex` as linear red, green and blue written at `target[at ..]`. */
export function writeLinearColour(hex: number, target: Float32Array, at: number): void {
  for (let channel = 0; channel < COLOUR_CHANNELS; channel++) {
    target[at + channel] = LINEAR_OF_BYTE[(hex >>> (BITS_PER_CHANNEL * (COLOUR_CHANNELS - 1 - channel))) & CHANNEL_MASK]!;
  }
}
