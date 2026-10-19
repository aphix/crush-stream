import * as THREE from "three";
import { PARTS } from "./ragdoll-body.ts";

/** The dummy's shared vocabulary: colour roles, build and wear bits, the pose row, the fitted body and shell shapes, and the skinning. */

/** Colour roles: each vertex takes its colour from its slot's palette (`DummyMesh.dress`). */
export const ROLE = {
  SHIRT: 0,
  SKIN: 1,
  LEGS: 2,
  HAIR: 3,
  SHOE: 4,
  BRIM: 5,
  BADGE: 6,
  EYES: 7,
  LOCKS: 8,
  MUSTACHE: 9,
  TIE: 10,
  COLLAR: 11,
  ARM: 12,
  BELT: 13,
  BUCKLE: 14,
  SOLE: 15,
  PATCH: 16,
} as const;
export const ROLES = 17;
/**
 * A slot's flags: its build (one of `BUILD`) and the optional bits it wears. A vertex is drawn when its kinds share the slot's
 * build bit and every optional bit its kinds hold is in the slot's flags.
 */
export const BUILD = { MAN: 1, WOMAN: 2, PORTLY: 4 } as const;
export const WHISKERS = 8;
/** A civilian's cap. */
export const CAPPED = 16;
/** A uniform's duty kit: belt, holster, pouches, badge, shoulder patch. */
export const UNIFORM = 32;
/** Hair with no cap over it. */
export const BARE = 64;
export const SHADES = 128;
export const SHORT_SLEEVES = 256;
export const LONG_SLEEVES = 512;
export const BELTED = 1024;
export const SNEAKERS = 2048;
export const HEELS = 4096;
export const SUITED = 8192;
export const DRESS_SHOES = 16384;
/** The police's own: the shoulder patch (a guard wears the cop's kit without it). */
export const POLICE = 32768;
export const OPTIONAL = WHISKERS | CAPPED | UNIFORM | BARE | SHADES | SHORT_SLEEVES | LONG_SLEEVES | BELTED | SNEAKERS | HEELS | SUITED | DRESS_SHOES | POLICE;
const CIVIL = BUILD.MAN | BUILD.WOMAN;
export const EVERY_BUILD = CIVIL | BUILD.PORTLY;

/** Whether a vertex of `kinds` is drawn on a slot with `flags`: `dollShown` in the shader, line for line. */
export function isDrawn(kinds: number, flags: number): boolean {
  return (kinds & flags & EVERY_BUILD) !== 0 && (kinds & OPTIONAL & ~flags) === 0;
}

/** The geometry's attributes beside `position` and `normal`; the shader declares them by these names. */
export const BONES_ATTRIBUTE = "bones";
export const KINDS_ATTRIBUTE = "roleKind";
/** The woman's and the portly man's rest positions, beside the man's `position`; the shader declares them by these names. */
export const SHAPE_WOMAN_ATTRIBUTE = "shapeWoman";
export const SHAPE_PORTLY_ATTRIBUTE = "shapePortly";
/** Their normals, each from its own shape (the man's are `normal`). */
export const NORMAL_WOMAN_ATTRIBUTE = "normalWoman";
export const NORMAL_PORTLY_ATTRIBUTE = "normalPortly";
/** Every vertex's print (u, v, atlas cell, weight); the shader declares it by this name. */
export const PRINT_ATTRIBUTE = "print";
/** Every body vertex's rest-space push out to where the casual clothes hang (zero on the wear); the shader declares it by this name. */
export const HANG_ATTRIBUTE = "hang";

/**
 * A slot's row in the pose texture: two texels per bone (translation, rotation), a texel per role colour, the flags (x: flags,
 * y: face row), the two bust orbs' lag, and the garment cuts.
 */
const BONES = PARTS.length;
export const PALETTE_AT = BONES * 2;
export const FLAGS_AT = PALETTE_AT + ROLES;
export const ORBS_AT = FLAGS_AT + 1;
export const CUTS_AT = ORBS_AT + 2;
export const ROW_TEXELS = CUTS_AT + 2;

/** `PARTS` indices the skinning and the wear name. */
export const TORSO = 0;
export const HEAD = 1;
export const [LEFT_ARM, RIGHT_ARM] = [2, 4];
export const [LEFT_LEG, RIGHT_LEG] = [6, 8];

/** Smoothstep from `from` (0) to `to` (1), either way round. */
export function smooth(from: number, to: number, value: number): number {
  const fraction = Math.min(1, Math.max(0, (value - from) / (to - from)));
  return fraction * fraction * (3 - 2 * fraction);
}

/** One baked body fitted to the rig: its scaled T-pose, its arms-down rest, and the weights the bending and the skinning share. */
export type Fit = {
  /** The T-pose scaled to the rig (x, y, z a vertex). */
  tpose: Float32Array;
  /** The rest pose: arms and legs bent straight down onto the rig's joints. */
  rest: Float32Array;
  /** 0 torso to 1 arm: the shoulder's blend. */
  shoulderWeight: Float32Array;
  /** 0 upper arm to 1 forearm: the elbow's blend (0 off the arm). */
  elbowWeight: Float32Array;
  /** 0 torso to 1 thigh: the hip's blend. */
  hipWeight: Float32Array;
  /** 0 torso to 1 head: the neck's blend. */
  neckWeight: Float32Array;
  /** The lowest y (m) of the rest arm: its fingertip, from which the wrist is `HAND_LENGTH` up. */
  fingertipY: number;
};

/**
 * One cross-section: height, half widths in x and z (to the polygon's corners), the z of its middle, its role, the share of its
 * z half width its face half keeps (default 1), a scale per side on both half widths, and the x offset of its
 * middle from the shell's axis (a strip running across the body as it falls, a lapel).
 */
export type Ring = readonly [y: number, halfWidth: number, halfDepth: number, middleZ: number, role: number, frontShare?: number, radii?: readonly number[], across?: number];
/**
 * A picture from the print atlas laid flat on a shell: atlas `cell`, centred at `centre` and `size` wide and tall (m) in the
 * plane across the axis it is seen `along` ("z": seen from +z, x right, y up; "x": seen from -x, z right, y up), shown only
 * where the depth toward the viewer (z, or -x) reaches `from` (m), so it never shows through on the shell's far side.
 */
type Print = { cell: number; centre: readonly [number, number]; size: readonly [number, number]; along: "z" | "x"; from?: number };
/** A lofted shell: rings top to bottom around the vertical axis at `x`, riding one `bone`, closed at an end by a pole `top` above the first ring or `bottom` below the last (open when absent). `frontPower` narrows a brim so only the centre of the face half sticks out. */
export type Shell = { x: number; sides: number; kinds: number; bone: number; rings: readonly Ring[]; top?: number; bottom?: number; frontPower?: number; print?: Print };
/** A vertex's print (u, v, atlas cell, weight): the slot's face row is cell -1; weight 0 shows no print. */
export const NO_PRINT = [0, 0, -1, 0] as const;

/** `print`'s (u, v, cell, weight) at rest point (x, y, z). */
export function printAt(print: Print | undefined, x: number, y: number, z: number): readonly [number, number, number, number] {
  if (print === undefined) return NO_PRINT;
  const [across, depth] = print.along === "z" ? [x, z] : [z, -x];
  return [(across - print.centre[0]) / print.size[0] + 0.5, (y - print.centre[1]) / print.size[1] + 0.5, print.cell, depth >= (print.from ?? -Infinity) ? 1 : 0];
}

/**
 * A garment detail painted into the cloth (pockets, seams, buttons, lapels), in the man's rest metres on the body side it faces:
 * a rounded rectangle x0..x1 by y0..y1 whose width at y0 is `taper` of its width at y1, with its edge, raise, shade and paint.
 */
export type Decal = { face: "+z" | "-z" | "+x" | "-x"; x0: number; x1: number; y0: number; y1: number; round: number; edge: number; raise: number; shade: number; paint: number; taper: number };

const _qa = new THREE.Quaternion();
const _qb = new THREE.Quaternion();
const _pa = new THREE.Vector3();
const _pb = new THREE.Vector3();

/** Rest point `v` posed by `slot`'s bones `a` and `b` (weight `w` on b) in the pose rows `data`: each bone's rigid move, blended. */
export function skinPoint(data: Float32Array, slot: number, a: number, b: number, w: number, v: THREE.Vector3, out: THREE.Vector3): THREE.Vector3 {
  const ta = slot * ROW_TEXELS * 4 + a * 8;
  const tb = slot * ROW_TEXELS * 4 + b * 8;
  _pa.copy(v).applyQuaternion(_qa.fromArray(data, ta + 4));
  _pb.copy(v).applyQuaternion(_qb.fromArray(data, tb + 4));
  return out.set(
    (1 - w) * (data[ta]! + _pa.x) + w * (data[tb]! + _pb.x),
    (1 - w) * (data[ta + 1]! + _pa.y) + w * (data[tb + 1]! + _pb.y),
    (1 - w) * (data[ta + 2]! + _pa.z) + w * (data[tb + 2]! + _pb.z),
  );
}
