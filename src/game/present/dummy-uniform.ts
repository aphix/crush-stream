import { BODY_VERTICES } from "./dummy-bodies.ts";
import { HAND_LENGTH } from "./dummy-fit.ts";
import { armOf, BELT_BOTTOM, BELT_OUT, BELT_TOP, fitted, FOOTPRINT_AT, hangingFit, legOf, LIMB_SIDES, SUIT_HANG, TORSO_SIDES, torsoOf, trouserHem, TUCK, UNIFORM_HANG, type Take } from "./dummy-garments.ts";
import { box, BOX_SIDES, surfaceY, surfaceZ, TUBE_SIDES } from "./dummy-loft.ts";
import { BUILD, DRESS_SHOES, LEFT_ARM, LEFT_LEG, POLICE, RIGHT_ARM, RIGHT_LEG, ROLE, SUITED, TORSO, UNIFORM, type Decal, type Fit, type Ring, type Shell } from "./dummy-rig.ts";
import { PRINT_CELL } from "./dummy-texture.ts";

/**
 * The uniformed kinds' wear, lofted on each build's own body: the cop's and the guard's duty kit (holster, pouches, badge,
 * shoulder patch, shirt collar, the shirt bloused over the belt), the suits' white collar, tie and jacket skirt, and dress
 * shoes under loose trousers; plus the garment marks (pockets, placket, lapels) the cloth bakes for each outfit.
 */

const { SHIRT, SHOE, SOLE, BELT, BADGE, PATCH, TIE, COLLAR } = ROLE;

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

/**
 * A shirt collar: rings dropping under the neck's section at `COLLAR_AT` (m), each wider by the neck's half width plus these
 * (drop, widen, in front, behind). Behind, only its top stands out of the back neckline, the rest under the back, as a
 * collar shows a band over a jacket's. A suit's spreads onto the chest in front under the lapels' white V; a uniform
 * shirt's hugs the neck there, its points marks on the chest under it (`UNIFORM_DECALS`).
 */
const COLLAR_AT = 1.47;
type CollarShape = readonly (readonly [drop: number, widen: number, front: number, behind: number])[];
const SUIT_COLLAR: CollarShape = [
  [0, 0.012, 0.012, 0.012],
  [0.035, 0.03, 0.025, 0],
  [0.07, 0.065, 0.05, 0],
];
const UNIFORM_COLLAR: CollarShape = [
  [0, 0.012, 0.012, 0.012],
  [0.035, 0.03, 0.012, 0],
  [0.07, 0.065, 0.012, 0],
];
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

/** The dress shoe (m): a low polished upper from the ankle over the foot, on a thin sole, the trousers' hem standing on its collar. */
const SHOE_COLLAR = 0.095;
const SHOE_UPPER = [0.075, 0.05, 0.03] as const;
const SHOE_OUT = 0.006;
const SHOE_SOLE_TOP = 0.014;
const SHOE_SOLE_OUT = 0.009;
const SHOE_SOLE_BOTTOM = -0.016;
const DRESS_HEM = 0.105;
/**
 * The uniform shirt bloused over the belt (m), on the hung body: out of the hung shirt at the top, fullest just over the belt
 * (where the body under it no longer hangs), its hem tucked under the belt's top.
 */
const BLOUSE_FULL = 0.02;
const BLOUSE_RINGS = [
  [1.06, TUCK],
  [1.0, 0.006],
  [0.985, BLOUSE_FULL],
] as const;
const BLOUSE_TUCK = BELT_OUT - 0.002;
/** A suit jacket's skirt (m), on the hung body: out of the hung jacket, falling straight from its bottom (over a belly as over the hips) to its hem over the thighs (the reference's at 0.43 of his height). */
const JACKET_RINGS = [
  [1.0, TUCK],
  [0.97, 0.003],
  [0.88, 0.008],
  [0.76, 0.012],
] as const;
const JACKET_TOP = JACKET_RINGS[0][0];
/**
 * The jacket's hip pocket flaps (m): a band round the skirt from `FLAP_TOP` down to `FLAP_BOTTOM`, standing `FLAP_PROUD` out of
 * it over the sides between `FLAP_ANGLES` (rad from +x toward the front, and their mirror) and `FLAP_INSIDE` inside it elsewhere;
 * `FLAP_SIDES` (7.5 degrees each) keep a flap's ends square.
 */
const FLAP_TOP = 0.965;
const FLAP_BOTTOM = 0.93;
const FLAP_PROUD = 0.005;
const FLAP_INSIDE = -0.004;
const FLAP_ANGLES = [Math.PI / 6, Math.PI / 3] as const;
const FLAP_SIDES = 48;
/** A suit's white shirt cuff (m above the build's wrist): tucked under the jacket sleeve's end, standing `CUFF_SHOWS` out over the wrist below it; a fixed height would cut through the portly man's hand (his wrist is 3.6 cm higher). */
const SHIRT_CUFF_TOP = 0.008;
const SHIRT_CUFF_EDGE = -0.002;
const SHIRT_CUFF_END = -0.019;
const CUFF_SHOWS = 0.004;
/**
 * The uniform's epaulettes (m): a strap over each shoulder's ridge from beside the collar (|x| `EPAULETTE_FROM`) out to the
 * shoulder (`EPAULETTE_TO`), `EPAULETTE_PROUD` over the ridge at `EPAULETTE_STEPS` + 1 rings; each ring `EPAULETTE_ACROSS`
 * along x (on the shoulder's slope that is its thickness) and `EPAULETTE_WIDE` along z.
 */
const EPAULETTE_FROM = 0.1;
const EPAULETTE_TO = 0.19;
const EPAULETTE_STEPS = 5;
const EPAULETTE_PROUD = 0.004;
const EPAULETTE_ACROSS = 0.02;
const EPAULETTE_WIDE = 0.045;
/** The shoulder's ridge is the highest of the body's tops sampled this often (m) across z from its back to its front, over the strap's middle. */
const RIDGE_FROM = -0.12;
const RIDGE_TO = 0.06;
const RIDGE_STEP = 0.01;

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

/** The collar about the neck's own section at `COLLAR_AT` (its back flatter than an ellipse's), each ring out by its widen at the sides blending to its front or behind. */
function collar(fit: Fit, kinds: number, shape: CollarShape): Shell {
  const neck = (i: number) => fit.shoulderWeight[i] === 0 && Math.abs(fit.rest[i * 3]!) <= COLLAR_MAX_X;
  const angles = Array.from({ length: TUBE_SIDES }, (_, k) => ((k + 0.5) * 2 * Math.PI) / TUBE_SIDES);
  const steps = shape.map(([drop, widen, front, behind]) => ({ y: COLLAR_AT - drop, at: COLLAR_AT, role: COLLAR, out: angles.map((angle) => widen * Math.cos(angle) ** 2 + (Math.sin(angle) > 0 ? front : behind) * Math.sin(angle) ** 2) }));
  return fitted(fit, neck, steps, { bone: TORSO, kinds, sides: TUBE_SIDES });
}

/** The tie down the chest, each ring resting on the front-most body across its width (a portly chest rounds out either side of the middle). */
function tie(fit: Fit, kinds: number): Shell {
  const corner = 1 / Math.cos(Math.PI / BOX_SIDES);
  const rings = TIE_OUTLINE.map(([y, halfWidth]): Ring => [y, halfWidth * corner, TIE_HALF_DEPTH * corner, frontOver(fit, [-halfWidth, 0, halfWidth], [y]) + TIE_OUT, TIE]);
  return { x: 0, sides: BOX_SIDES, kinds, bone: TORSO, rings, bottom: 0 };
}

/** Each leg's dress shoe lofted about the ankle's middle, under the hem of `trousered`'s hung trouser leg closing onto it. */
function dressShoes(fit: Fit, trousered: Fit, kinds: number): Shell[] {
  const shells: Shell[] = [];
  for (const [side, thigh] of [
    [-1, LEFT_LEG],
    [1, RIGHT_LEG],
  ] as const) {
    const leg = legOf(fit, side);
    const ankle = sectionOf(fit, leg, SHOE_COLLAR);
    const fitting = { bone: thigh + 1, kinds, sides: LIMB_SIDES, axis: [(ankle.left + ankle.right) / 2, (ankle.back + ankle.front) / 2] as const };
    const upper = [SHOE_COLLAR, ...SHOE_UPPER].map((y) => ({ y, out: SHOE_OUT, role: SHOE }));
    shells.push(
      trouserHem(trousered, side, fitting, DRESS_HEM, SHOE_OUT),
      fitted(fit, leg, [{ y: SHOE_COLLAR, out: TUCK, role: SHOE }, ...upper, { y: SHOE_SOLE_TOP, out: SHOE_SOLE_OUT, role: SOLE }, { y: SHOE_SOLE_BOTTOM, out: SHOE_SOLE_OUT, role: SOLE, at: FOOTPRINT_AT }], { ...fitting, bottom: 0 }),
    );
  }
  return shells;
}

function blouse(fit: Fit, kinds: number): Shell {
  return fitted(fit, torsoOf(fit), [...BLOUSE_RINGS.map(([y, out]) => ({ y, out, role: SHIRT })), { y: BELT_TOP, out: BLOUSE_TUCK, role: SHIRT }], { bone: TORSO, kinds, sides: TORSO_SIDES });
}

/** Each shoulder's epaulette: a strap lofted along the shoulder's ridge, each ring at the ridge's top under it (rings run top to bottom, so it steps down outward). */
function epaulettes(fit: Fit, kinds: number): Shell[] {
  const middle = (EPAULETTE_FROM + EPAULETTE_TO) / 2;
  let [ridge, highest] = [0, -Infinity];
  for (let z = RIDGE_FROM; z <= RIDGE_TO; z += RIDGE_STEP) {
    const top = surfaceY(fit, middle, z);
    if (top > highest) [ridge, highest] = [z, top];
  }
  const corner = 1 / Math.cos(Math.PI / BOX_SIDES);
  return [-1, 1].map((side): Shell => {
    const rings: Ring[] = [];
    for (let k = 0; k <= EPAULETTE_STEPS; k++) {
      const along = EPAULETTE_FROM + ((EPAULETTE_TO - EPAULETTE_FROM) * k) / EPAULETTE_STEPS;
      const y = Math.min(surfaceY(fit, side * along, ridge) + EPAULETTE_PROUD, rings[k - 1]?.[0] ?? Infinity);
      rings.push([y, (EPAULETTE_ACROSS / 2) * corner, (EPAULETTE_WIDE / 2) * corner, ridge, SHIRT, 1, undefined, side * (along - EPAULETTE_FROM)]);
    }
    return { x: side * EPAULETTE_FROM, sides: BOX_SIDES, kinds, bone: TORSO, rings, top: 0, bottom: 0 };
  });
}

/** The jacket's skirt over the body below the arms (the hips and the tops of both thighs in one section), and its hip pocket flaps on its front. */
function jacketSkirt(fit: Fit, kinds: number): Shell[] {
  const below = (i: number) => fit.shoulderWeight[i] === 0;
  const skirt = fitted(fit, below, JACKET_RINGS.map(([y, out]) => ({ y, out, role: SHIRT, holds: JACKET_TOP })), { bone: TORSO, kinds, sides: TORSO_SIDES });
  const skirtOut = (y: number) => {
    const under = JACKET_RINGS.findIndex(([at]) => at <= y);
    const [[y0, out0], [y1, out1]] = [JACKET_RINGS[under - 1]!, JACKET_RINGS[under]!];
    return out0 + ((y - y0) / (y1 - y0)) * (out1 - out0);
  };
  const onFlap = Array.from({ length: FLAP_SIDES }, (_, k) => {
    const angle = ((k + 0.5) * 2 * Math.PI) / FLAP_SIDES;
    const fromSide = Math.min(angle, Math.PI - angle);
    return fromSide >= FLAP_ANGLES[0] && fromSide <= FLAP_ANGLES[1];
  });
  const band = (y: number, proud: boolean) => ({ y, out: onFlap.map((flap) => skirtOut(y) + (proud && flap ? FLAP_PROUD : FLAP_INSIDE)), role: SHIRT, holds: JACKET_TOP });
  const flaps = fitted(fit, below, [band(FLAP_TOP, false), band(FLAP_TOP, true), band(FLAP_BOTTOM, true), band(FLAP_BOTTOM, false)], { bone: TORSO, kinds, sides: FLAP_SIDES, axis: [skirt.x, skirt.rings[0]![3]] });
  return [skirt, flaps];
}

/** A suit's white shirt cuff on each wrist, under the jacket sleeve's end. */
function shirtCuffs(fit: Fit, kinds: number): Shell[] {
  const wrist = fit.fingertipY + HAND_LENGTH;
  const arms = [
    [-1, LEFT_ARM],
    [1, RIGHT_ARM],
  ] as const;
  return arms.map(([side, upperArm]) =>
    fitted(fit, armOf(fit, side), [
      { y: wrist + SHIRT_CUFF_TOP, out: TUCK, role: COLLAR },
      { y: wrist + SHIRT_CUFF_EDGE, out: CUFF_SHOWS, role: COLLAR },
      { y: wrist + SHIRT_CUFF_END, out: CUFF_SHOWS, role: COLLAR },
      { y: wrist + SHIRT_CUFF_END, out: TUCK, role: COLLAR },
    ], { bone: upperArm + 1, kinds, sides: LIMB_SIDES }),
  );
}

/**
 * Build `build`'s uniformed wear, each on its body as its clothes hang (a woman's cling): the duty kit, bloused shirt and
 * epaulettes on the builds a cop may have, the suit on the builds that wear it, and the dress shoes under either's trousers
 * (suits and uniforms share their trousers' hang).
 */
export function uniformWear(build: number, fit: Fit): Shell[] {
  const shells: Shell[] = [];
  if (build !== BUILD.PORTLY) {
    const hung = build === BUILD.WOMAN ? fit : hangingFit(fit, UNIFORM_HANG);
    const kinds = build | UNIFORM;
    shells.push(...dutyKit(hung, kinds), badge(hung, kinds), shoulderPatch(hung, kinds | POLICE), collar(hung, kinds, UNIFORM_COLLAR), blouse(hung, kinds), ...epaulettes(hung, kinds));
  }
  if (build !== BUILD.WOMAN) {
    const hung = hangingFit(fit, SUIT_HANG);
    const kinds = build | SUITED;
    shells.push(collar(hung, kinds, SUIT_COLLAR), tie(hung, kinds), ...jacketSkirt(hung, kinds), ...shirtCuffs(hung, kinds), ...dressShoes(fit, hung, build | DRESS_SHOES));
  }
  return shells;
}

/** How a garment mark is finished: bump height (m, - a groove), colour multiplier, roundness (0 rect to 1 ellipse), border band (0 filled), a palette role painted over it (-1 none), the width at its bottom as a share of its top. */
type Finish = { raise: number; shade: number; round?: number; edge?: number; paint?: number; taper?: number };
const SEAM: Finish = { edge: 0.003, raise: -0.0006, shade: 0.6 };
const STITCH: Finish = { raise: -0.0008, shade: 0.6 };
const FLAP: Finish = { raise: 0.003, shade: 0.78 };
const BUTTON: Finish = { round: 1, raise: 0.0015, shade: 0.55 };

/** A mark on the front (m, the man's rest frame: x across, y up). */
const front = (x0: number, x1: number, y0: number, y1: number, finish: Finish): Decal => ({ face: "+z", x0, x1, y0, y1, round: 0, edge: 0, paint: -1, taper: 1, ...finish });

/** A uniform shirt's breast pocket on side `side` (+1 his left): its seam, a box pleat down its middle, a pointed flap and the flap's button, the badge resting just above the left one. */
const POCKET_X = 0.09;
const POCKET_HALF_WIDTH = 0.05;
function pocket(side: number): Decal[] {
  const x = side * POCKET_X;
  const [left, right] = [x - POCKET_HALF_WIDTH, x + POCKET_HALF_WIDTH];
  return [
    front(left, right, 1.1, 1.19, SEAM),
    front(x - 0.002, x + 0.002, 1.1, 1.165, STITCH),
    front(left, right, 1.18, 1.215, FLAP),
    front(left, right, 1.18, 1.215, SEAM),
    front(left, right, 1.163, 1.181, { ...FLAP, taper: 0 }),
    front(x - 0.006, x + 0.006, 1.172, 1.184, BUTTON),
  ];
}

/** The uniform's shirt buttons down the placket (m), above the blousing. */
const PLACKET_BUTTONS = [1.38, 1.3, 1.22, 1.14];

/** A uniform collar's point (m, his left; the right mirrored): a raised flap from the collar's foot down to its tip over the collarbone, edged by a seam, as the reference cop's spread collar. */
const COLLAR_POINT = [0.014, 0.09, 1.36, 1.445] as const;
function collarPoint(side: number): Decal[] {
  const [inner, outer, tip, foot] = COLLAR_POINT;
  const [x0, x1] = side > 0 ? [inner, outer] : [-outer, -inner];
  return [front(x0, x1, tip, foot, { ...FLAP, taper: 0 }), front(x0, x1, tip, foot, { ...SEAM, taper: 0 })];
}

/** The cop's and the guard's uniform: breast pockets, the collar's points, the placket and its buttons. */
export const UNIFORM_DECALS: readonly Decal[] = [
  ...pocket(-1),
  ...pocket(1),
  ...collarPoint(-1),
  ...collarPoint(1),
  front(-0.014, 0.014, 0.99, 1.43, SEAM),
  ...PLACKET_BUTTONS.map((y) => front(-0.0045, 0.0045, y - 0.0045, y + 0.0045, BUTTON)),
];

/**
 * A suit: the lapels (a raised, faintly darker V from the shoulders to the button, its outer edge a seam), the white shirt's V
 * between them (its shade undoing theirs, its raised edges their inner edge), a welt pocket, the jacket's opening under the
 * button above its skirt, and its two buttons.
 */
const LAPEL_SHADE = 0.88;
export const SUIT_DECALS: readonly Decal[] = [
  front(-0.16, 0.16, 1.03, 1.44, { raise: 0.0015, shade: LAPEL_SHADE, taper: 0 }),
  front(-0.16, 0.16, 1.03, 1.44, { edge: 0.004, raise: -0.0008, shade: 0.5, taper: 0 }),
  front(-0.085, 0.085, 1.1, 1.46, { raise: -0.0025, shade: 1 / LAPEL_SHADE, paint: COLLAR, taper: 0 }),
  front(-0.085, 0.085, 1.1, 1.46, { edge: 0.006, raise: 0.002, shade: 0.6, taper: 0 }),
  front(0.075, 0.145, 1.27, 1.28, STITCH),
  front(-0.0015, 0.0015, 1.0, 1.09, STITCH),
  front(-0.006, 0.006, 1.079, 1.091, BUTTON),
  front(-0.006, 0.006, 1.014, 1.026, BUTTON),
];
