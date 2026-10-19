import { BODY_VERTICES } from "./dummy-bodies.ts";
import { armOf, BELT_BOTTOM, BELT_OUT, BELT_TOP, fitted, FOOTPRINT_AT, legOf, LIMB_SIDES, TORSO_SIDES, torsoOf, TUCK, type Take } from "./dummy-garments.ts";
import { box, BOX_SIDES, surfaceZ, TUBE_SIDES } from "./dummy-loft.ts";
import { BUILD, DRESS_SHOES, LEFT_ARM, LEFT_LEG, POLICE, RIGHT_LEG, ROLE, SUITED, TORSO, UNIFORM, type Decal, type Fit, type Ring, type Shell } from "./dummy-rig.ts";
import { PRINT_CELL } from "./dummy-texture.ts";

/**
 * The uniformed kinds' wear, lofted on each build's own body: the cop's and the guard's duty kit (holster, pouches, badge,
 * shoulder patch, shirt collar, the shirt bloused over the belt), the suits' white collar, tie and jacket skirt, and dress
 * shoes under loose trousers; plus the garment marks (pockets, placket, lapels) the cloth bakes for each outfit.
 */

const { SHIRT, LEGS, SHOE, SOLE, BELT, BADGE, PATCH, TIE, COLLAR } = ROLE;

/** Half the height band (m) a section takes its vertices from. */
const SECTION_BAND = 0.012;

/** Where the duty kit hangs on the belt, as shares of the belt's half width (- is his right, the gun hand's side). */
const HOLSTER_AT = -0.85;
const CUFFS_AT = -0.55;
const MAGAZINES_AT = [0.5, 0.8] as const;
/** The holster (m wide, tall, deep) hanging from the belt's top, and the pistol grip standing out of it over the belt, sunk this far into it. */
const HOLSTER_SIZE = [0.034, 0.14, 0.045] as const;
const GRIP_SIZE = [0.028, 0.05, 0.032] as const;
const GRIP_SINK = 0.01;
/** A pouch (m wide, tall, deep), hanging this far under the belt's middle. */
const POUCH_SIZE = [0.04, 0.055, 0.03] as const;
const POUCH_DROP = 0.008;

/** The badge: a shield on his left breast centred (x, y), its outline as (m above its centre, half width there) top to bottom. */
const BADGE_AT = [0.095, 1.25] as const;
const BADGE_OUTLINE = [
  [0.03, 0.024],
  [0.015, 0.027],
  [-0.012, 0.024],
  [-0.03, 0.005],
] as const;
/** Its half thickness and how far (m) its middle stands off the breast's most forward point: the back sinks in, the face stands proud. */
const BADGE_HALF_DEPTH = 0.004;
const BADGE_OUT = 0.002;

/** The shoulder patch on his right upper arm (the -x arm), centred this high: a plate (m thick, tall, across) whose face stands `PATCH_PROUD` out of the arm. */
const PATCH_Y = 1.22;
const PATCH_SIZE = [0.012, 0.07, 0.05] as const;
const PATCH_PROUD = 0.002;

/** A shirt collar: rings dropping under the neck's section at `COLLAR_AT` (m), each wider by the neck's half width and depth plus these: (drop, widen, deepen). */
const COLLAR_AT = 1.47;
const COLLAR_RINGS = [
  [0.01, 0.012, 0.012],
  [0.035, 0.03, 0.025],
  [0.07, 0.065, 0.05],
] as const;
const COLLAR_MAX_X = 0.1;

/** A suit's tie down the chest, top to bottom as (height, half width) m: the knot, the narrow neck under it, the blade widening to its point at the belt. */
const TIE_OUTLINE = [
  [1.43, 0.02],
  [1.395, 0.016],
  [1.33, 0.024],
  [1.2, 0.032],
  [1.06, 0.04],
  [1.0, 0.016],
] as const;
/** Its half thickness, and how far (m) its middle stands off the chest. */
const TIE_HALF_DEPTH = 0.014;
const TIE_OUT = 0.006;

/** The dress shoe (m): a low polished upper from the ankle over the foot, on a thin sole. */
const SHOE_COLLAR = 0.095;
const SHOE_UPPER = [0.075, 0.05, 0.03] as const;
const SHOE_OUT = 0.006;
const SHOE_SOLE_TOP = 0.014;
const SHOE_SOLE_OUT = 0.009;
const SHOE_SOLE_BOTTOM = -0.016;
/**
 * Loose trousers (m): per leg a thigh tube from under the hip's blend to past the knee, and a shin tube from inside it down to
 * the hem over the shoe, as (height, out) top to bottom; growing `out` hangs them straight off the leg's taper.
 */
const THIGH_RINGS = [
  [0.8, TUCK],
  [0.77, 0.008],
  [0.62, 0.012],
  [0.47, 0.02],
  [0.39, 0.022],
] as const;
const SHIN_RINGS = [
  [0.45, 0.014],
  [0.3, 0.018],
  [0.18, 0.026],
  [0.105, 0.03],
] as const;
/** The uniform shirt bloused over the belt (m): out of the skin at the top, fullest (`BLOUSE_FULL` out) just over the belt, its hem tucked under the belt's top. */
const BLOUSE_FULL = 0.012;
const BLOUSE_RINGS = [
  [1.08, TUCK],
  [1.02, 0.007],
  [0.985, BLOUSE_FULL],
] as const;
const BLOUSE_TUCK = BELT_OUT - 0.002;
/** A suit jacket's skirt (m): out of the waist, standing off the belly and the hips, flaring to its hem over the trousers' top. */
const JACKET_RINGS = [
  [1.0, TUCK],
  [0.96, 0.015],
  [0.88, 0.025],
  [0.79, 0.04],
] as const;

/** The extent (m) of the `taken` body vertices within `SECTION_BAND` of height `y`. */
type Section = { left: number; right: number; back: number; front: number };
function sectionOf(fit: Fit, taken: Take, y: number): Section {
  const section = { left: Infinity, right: -Infinity, back: Infinity, front: -Infinity };
  for (let i = 0; i < BODY_VERTICES; i++) {
    if (!taken(i) || Math.abs(fit.rest[i * 3 + 1]! - y) > SECTION_BAND) continue;
    section.left = Math.min(section.left, fit.rest[i * 3]!);
    section.right = Math.max(section.right, fit.rest[i * 3]!);
    section.back = Math.min(section.back, fit.rest[i * 3 + 2]!);
    section.front = Math.max(section.front, fit.rest[i * 3 + 2]!);
  }
  if (section.left === Infinity) throw new RangeError(`no body vertices at y = ${y} to measure a section`);
  return section;
}

/** The most forward body surface (z, m) over the grid of `xs` by `ys`: where a piece worn on the front rests. */
function frontOver(fit: Fit, xs: readonly number[], ys: readonly number[]): number {
  let front = -Infinity;
  for (const x of xs) for (const y of ys) front = Math.max(front, surfaceZ(fit, x, y));
  return front;
}

/** The holster with its grip, the handcuff pouch and the magazine pouches, each resting on the belt's face; placed by the torso's narrowest half width over their heights, so every piece sits on the body whatever the build's shape. */
function dutyKit(fit: Fit, kinds: number): Shell[] {
  const middle = (BELT_TOP + BELT_BOTTOM) / 2;
  const gripTop = BELT_TOP + GRIP_SIZE[1] - GRIP_SINK;
  const halfWidth = Math.min(
    ...[middle, BELT_TOP, gripTop].map((y) => {
      const section = sectionOf(fit, torsoOf(fit), y);
      return Math.max(-section.left, section.right);
    }),
  );
  const onBelt = (share: number, size: readonly [number, number, number], y: number): Shell => {
    const x = share * halfWidth;
    const back = frontOver(fit, [x, x - (Math.sign(x) * size[0]) / 2], [BELT_TOP, middle]) + BELT_OUT;
    return box(x, y, back + size[2] / 2, size, BELT, kinds, TORSO);
  };
  const holsterX = HOLSTER_AT * halfWidth;
  const gripBack = frontOver(fit, [holsterX, holsterX + GRIP_SIZE[0] / 2], [BELT_TOP, gripTop]) + BLOUSE_FULL;
  const grip = box(holsterX, BELT_TOP + GRIP_SIZE[1] / 2 - GRIP_SINK, gripBack + GRIP_SIZE[2] / 2, GRIP_SIZE, BELT, kinds, TORSO);
  const pouchY = middle - POUCH_DROP;
  return [onBelt(HOLSTER_AT, HOLSTER_SIZE, BELT_TOP - HOLSTER_SIZE[1] / 2), grip, onBelt(CUFFS_AT, POUCH_SIZE, pouchY), ...MAGAZINES_AT.map((share) => onBelt(share, POUCH_SIZE, pouchY))];
}

/** The badge's shield: flat rings (a lofted square's corners reach `1 / cos(pi / 4)` past its faces) down its outline. */
function badge(fit: Fit, kinds: number): Shell {
  const [x, y] = BADGE_AT;
  const widest = Math.max(...BADGE_OUTLINE.map(([, halfWidth]) => halfWidth));
  const z = frontOver(fit, [x - widest, x, x + widest], [y + BADGE_OUTLINE[0][0], y + BADGE_OUTLINE[BADGE_OUTLINE.length - 1]![0]]) + BADGE_OUT;
  const corner = 1 / Math.cos(Math.PI / BOX_SIDES);
  const rings = BADGE_OUTLINE.map(([above, halfWidth]): Ring => [y + above, halfWidth * corner, BADGE_HALF_DEPTH * corner, z, BADGE]);
  const height = BADGE_OUTLINE[0][0] - BADGE_OUTLINE[BADGE_OUTLINE.length - 1]![0];
  return { x, sides: BOX_SIDES, kinds, bone: TORSO, rings, top: 0, bottom: 0, print: { cell: PRINT_CELL.BADGE, centre: [x, y], size: [widest * 2, height], along: "z" } };
}

function shoulderPatch(fit: Fit, kinds: number): Shell {
  const arm = sectionOf(fit, armOf(fit, -1), PATCH_Y);
  const z = (arm.back + arm.front) / 2;
  const print = { cell: PRINT_CELL.PATCH, centre: [z, PATCH_Y] as const, size: [PATCH_SIZE[2], PATCH_SIZE[1]] as const, along: "x" as const };
  return { ...box(arm.left - PATCH_PROUD + PATCH_SIZE[0] / 2, PATCH_Y, z, PATCH_SIZE, PATCH, kinds, LEFT_ARM), print };
}

function collar(fit: Fit, kinds: number): Shell {
  const neck = sectionOf(fit, (i) => fit.shoulderWeight[i] === 0 && Math.abs(fit.rest[i * 3]!) <= COLLAR_MAX_X, COLLAR_AT);
  const [halfWidth, halfDepth, middleZ] = [Math.max(-neck.left, neck.right), (neck.front - neck.back) / 2, (neck.front + neck.back) / 2];
  const rings = COLLAR_RINGS.map(([drop, widen, deepen]): Ring => [COLLAR_AT - drop, halfWidth + widen, halfDepth + deepen, middleZ, COLLAR]);
  return { x: 0, sides: TUBE_SIDES, kinds, bone: TORSO, rings };
}

function tie(fit: Fit, kinds: number): Shell {
  const corner = 1 / Math.cos(Math.PI / BOX_SIDES);
  const rings = TIE_OUTLINE.map(([y, halfWidth]): Ring => [y, halfWidth * corner, TIE_HALF_DEPTH * corner, surfaceZ(fit, 0, y) + TIE_OUT, TIE]);
  return { x: 0, sides: BOX_SIDES, kinds, bone: TORSO, rings, bottom: 0 };
}

/** Each leg's dress shoe under loose trousers: the shin tube and the shoe lofted about the ankle's middle so the hem closes onto the shoe. */
function dressShoes(fit: Fit, kinds: number): Shell[] {
  const shells: Shell[] = [];
  for (const [side, thigh] of [
    [-1, LEFT_LEG],
    [1, RIGHT_LEG],
  ] as const) {
    const leg = legOf(fit, side);
    const ankle = sectionOf(fit, leg, SHOE_COLLAR);
    const fitting = { bone: thigh + 1, kinds, sides: LIMB_SIDES, axis: [(ankle.left + ankle.right) / 2, (ankle.back + ankle.front) / 2] as const };
    const hem = SHIN_RINGS[SHIN_RINGS.length - 1]![0];
    const upper = [SHOE_COLLAR, ...SHOE_UPPER].map((y) => ({ y, out: SHOE_OUT, role: SHOE }));
    shells.push(
      fitted(fit, leg, THIGH_RINGS.map(([y, out]) => ({ y, out, role: LEGS })), { bone: thigh, kinds, sides: LIMB_SIDES }),
      fitted(fit, leg, [...SHIN_RINGS.map(([y, out]) => ({ y, out, role: LEGS })), { y: hem, out: SHOE_OUT, role: LEGS }], fitting),
      fitted(fit, leg, [{ y: SHOE_COLLAR, out: TUCK, role: SHOE }, ...upper, { y: SHOE_SOLE_TOP, out: SHOE_SOLE_OUT, role: SOLE }, { y: SHOE_SOLE_BOTTOM, out: SHOE_SOLE_OUT, role: SOLE, at: FOOTPRINT_AT }], { ...fitting, bottom: 0 }),
    );
  }
  return shells;
}

function blouse(fit: Fit, kinds: number): Shell {
  return fitted(fit, torsoOf(fit), [...BLOUSE_RINGS.map(([y, out]) => ({ y, out, role: SHIRT })), { y: BELT_TOP, out: BLOUSE_TUCK, role: SHIRT }], { bone: TORSO, kinds, sides: TORSO_SIDES });
}

/** The jacket's skirt over the body below the arms (the hips and the tops of both thighs in one section). */
function jacketSkirt(fit: Fit, kinds: number): Shell {
  return fitted(fit, (i) => fit.shoulderWeight[i] === 0, JACKET_RINGS.map(([y, out]) => ({ y, out, role: SHIRT })), { bone: TORSO, kinds, sides: TORSO_SIDES });
}

/** Build `build`'s uniformed wear: the duty kit on the builds a cop may have, the suit and the dress shoes on the builds that wear them. */
export function uniformWear(build: number, fit: Fit): Shell[] {
  const shells: Shell[] = [];
  if (build !== BUILD.PORTLY) shells.push(...dutyKit(fit, build | UNIFORM), badge(fit, build | UNIFORM), shoulderPatch(fit, build | UNIFORM | POLICE), collar(fit, build | UNIFORM), blouse(fit, build | UNIFORM));
  if (build !== BUILD.WOMAN) shells.push(collar(fit, build | SUITED), tie(fit, build | SUITED), jacketSkirt(fit, build | SUITED), ...dressShoes(fit, build | DRESS_SHOES));
  return shells;
}

/** How a garment mark is finished: bump height (m, - a groove), colour multiplier, roundness (0 rect to 1 ellipse), border band (0 filled), a palette role painted over it (-1 none), the width at its bottom as a share of its top. */
type Finish = { raise: number; shade: number; round?: number; edge?: number; paint?: number; taper?: number };
const SEAM: Finish = { edge: 0.003, raise: -0.0006, shade: 0.6 };
const STITCH: Finish = { raise: -0.0008, shade: 0.6 };
const FLAP: Finish = { raise: 0.0015, shade: 0.9 };
const BUTTON: Finish = { round: 1, raise: 0.0015, shade: 0.55 };

/** A mark on the front (m, the man's rest frame: x across, y up). */
const front = (x0: number, x1: number, y0: number, y1: number, finish: Finish): Decal => ({ face: "+z", x0, x1, y0, y1, round: 0, edge: 0, paint: -1, taper: 1, ...finish });

/** A uniform shirt's breast pocket on side `side` (+1 his left): its seam, a pointed flap and the flap's button. */
const POCKET_X = 0.085;
const POCKET_HALF_WIDTH = 0.0425;
function pocket(side: number): Decal[] {
  const x = side * POCKET_X;
  const [left, right] = [x - POCKET_HALF_WIDTH, x + POCKET_HALF_WIDTH];
  return [front(left, right, 1.13, 1.205, SEAM), front(left, right, 1.195, 1.228, FLAP), front(left, right, 1.195, 1.228, SEAM), front(left, right, 1.183, 1.196, { ...FLAP, taper: 0 }), front(x - 0.005, x + 0.005, 1.19, 1.2, BUTTON)];
}

/** The uniform's shirt buttons down the placket (m), above the blousing. */
const PLACKET_BUTTONS = [1.38, 1.3, 1.22, 1.14];

/** The cop's and the guard's uniform: breast pockets, the placket and its buttons. */
export const UNIFORM_DECALS: readonly Decal[] = [
  ...pocket(-1),
  ...pocket(1),
  front(-0.014, 0.014, 0.99, 1.43, SEAM),
  ...PLACKET_BUTTONS.map((y) => front(-0.0045, 0.0045, y - 0.0045, y + 0.0045, BUTTON)),
];

/** A suit: the white shirt's V between the lapels (their edges raised), the lapels' outer seam, a welt pocket, the jacket's opening above its skirt and its two buttons. */
export const SUIT_DECALS: readonly Decal[] = [
  front(-0.05, 0.05, 1.15, 1.45, { raise: -0.001, shade: 1, paint: COLLAR, taper: 0 }),
  front(-0.05, 0.05, 1.15, 1.45, { edge: 0.006, raise: 0.002, shade: 0.6, taper: 0 }),
  front(-0.14, 0.14, 1.06, 1.43, { edge: 0.004, raise: -0.0008, shade: 0.5, taper: 0 }),
  front(0.065, 0.135, 1.27, 1.28, STITCH),
  front(-0.0015, 0.0015, 1.0, 1.15, STITCH),
  front(-0.006, 0.006, 1.094, 1.106, BUTTON),
  front(-0.006, 0.006, 1.024, 1.036, BUTTON),
];
