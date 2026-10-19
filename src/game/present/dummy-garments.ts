import { BODY_VERTICES } from "./dummy-bodies.ts";
import { HAND_LENGTH } from "./dummy-fit.ts";
import { BODY_INDEX, box, surfaceZ } from "./dummy-loft.ts";
import { BELTED, BUILD, LEFT_ARM, LEFT_LEG, LONG_SLEEVES, RIGHT_ARM, RIGHT_LEG, ROLE, SHORT_SLEEVES, smooth, SNEAKERS, TORSO, type Decal, type Fit, type Ring, type Shell } from "./dummy-rig.ts";
import { LACES_SIZE, PRINT_CELL, TOE_CAP_SIZE } from "./dummy-texture.ts";

/**
 * Garments fitted over a build's own body: `fitted` lofts a shell whose every ring holds the body's exact cross-section at
 * its height, so no body vertex pokes through; `casualWear` is the casual man's belt, tee hem, sleeve hems, cuffs, jeans
 * hems and sneakers. Each shell rides the one bone the body under it is rigid on, so no pose opens a gap.
 */

/** Which body vertices (by index) a garment is fitted over. */
export type Take = (vertex: number) => boolean;

/**
 * One ring of a fitted shell: `out` m off the body's section at `y` (negative: tucked under the skin; or one `out` per side, a
 * patch standing out over part of the ring), or at `at` when the ring stands where the body is not (a sole's underside under
 * the footprint); `holds` widens it to the section at that height too where that is wider (a skirt falling straight from its top).
 */
type Step = { y: number; out: number | readonly number[]; role: number; at?: number; holds?: number };

/**
 * A fitted shell's bone, kinds and sides; `axis` (x, z) its centre line (default: the middle of the first ring's section), or
 * with `centred` each ring about its own section's middle (a foot: a ring's front sides face the toe, not the ankle's front).
 */
type Fitting = { bone: number; kinds: number; sides: number; axis?: readonly [number, number]; centred?: boolean; bottom?: number };

/** Points sampled along each triangle's crossing of a ring's height: a 6 cm edge leaves no gap past 1 cm. */
const SECTION_SAMPLES = 6;
/** A ring holds the sections this far (m) above and below it too: the body bulging between two rings stays inside. */
const SECTION_SPREAD = 0.005;

export const torsoOf = (fit: Fit): Take => (vertex) => fit.shoulderWeight[vertex] === 0 && fit.hipWeight[vertex] === 0;
/** The arm on `side` (-1: x < 0), from where it is the arm's alone down to the fingertips. */
export const armOf = (fit: Fit, side: number): Take => (vertex) => fit.shoulderWeight[vertex]! >= 1 && (fit.tpose[vertex * 3]! < 0 ? -1 : 1) === side;
export const legOf = (fit: Fit, side: number): Take => (vertex) => fit.hipWeight[vertex]! > 0 && fit.shoulderWeight[vertex] === 0 && (fit.tpose[vertex * 3]! < 0 ? -1 : 1) === side;

/** The corners (index triples) of the body triangles whose three corners are all taken. */
function takenTriangles(taken: Take): number[] {
  const triangles: number[] = [];
  for (let t = 0; t < BODY_INDEX.length; t += 3) {
    if (taken(BODY_INDEX[t]!) && taken(BODY_INDEX[t + 1]!) && taken(BODY_INDEX[t + 2]!)) triangles.push(BODY_INDEX[t]!, BODY_INDEX[t + 1]!, BODY_INDEX[t + 2]!);
  }
  return triangles;
}

/** (x, z) pairs into `points` along every crossing of `triangles` (rest positions of `fit`) with height `y`. */
function sectionAt(fit: Fit, triangles: readonly number[], y: number, points: number[]): void {
  const rest = fit.rest;
  const ends: number[] = [];
  for (let t = 0; t < triangles.length; t += 3) {
    ends.length = 0;
    for (let e = 0; e < 3; e++) {
      const [a, b] = [triangles[t + e]!, triangles[t + ((e + 1) % 3)]!];
      const [ya, yb] = [rest[a * 3 + 1]!, rest[b * 3 + 1]!];
      if (ya < y === yb < y) continue;
      const f = (y - ya) / (yb - ya);
      ends.push(rest[a * 3]! + f * (rest[b * 3]! - rest[a * 3]!), rest[a * 3 + 2]! + f * (rest[b * 3 + 2]! - rest[a * 3 + 2]!));
    }
    if (ends.length < 4) continue;
    for (let s = 0; s <= SECTION_SAMPLES; s++) {
      const f = s / SECTION_SAMPLES;
      points.push(ends[0]! + f * (ends[2]! - ends[0]!), ends[1]! + f * (ends[3]! - ends[1]!));
    }
  }
}

/**
 * Radii (m) about (x, z), one per loft side (side k at angle (k + 1/2) 2π/sides), of a polygon holding every (x, z) pair of
 * `points`: each side takes its nearest points' farthest, then each edge a point still pokes past is pushed out to it.
 */
function enclose(points: readonly number[], x: number, z: number, sides: number): number[] {
  const step = (2 * Math.PI) / sides;
  const polar: [number, number][] = [];
  for (let p = 0; p < points.length; p += 2) {
    const [dx, dz] = [points[p]! - x, points[p + 1]! - z];
    polar.push([Math.sqrt(dx * dx + dz * dz), ((((Math.atan2(dz, dx) - step / 2) / step) % sides) + sides) % sides]);
  }
  if (polar.length === 0) throw new RangeError(`no body section about (${x}, ${z}) to fit a garment to`);
  const radii = new Array<number>(sides).fill(Math.min(...polar.map(([reach]) => reach)));
  for (const [reach, at] of polar) {
    const k = Math.round(at) % sides;
    radii[k] = Math.max(radii[k]!, reach);
  }
  for (const [reach, at] of polar) {
    const k = Math.floor(at);
    const next = (k + 1) % sides;
    const across = (at - k) * step;
    const [a, b] = [radii[k]!, radii[next]!];
    const edge = (a * b * Math.sin(step)) / (a * Math.sin(across) + b * Math.sin(step - across));
    if (reach <= edge) continue;
    radii[k] = (a * reach) / edge;
    radii[next] = (b * reach) / edge;
  }
  return radii;
}

/** The middle (x, z) of the section of `triangles` at height `y`. */
function sectionMiddle(fit: Fit, triangles: readonly number[], y: number): [number, number] {
  const points: number[] = [];
  sectionAt(fit, triangles, y, points);
  let [x0, x1, z0, z1] = [Infinity, -Infinity, Infinity, -Infinity];
  for (let p = 0; p < points.length; p += 2) {
    [x0, x1] = [Math.min(x0, points[p]!), Math.max(x1, points[p]!)];
    [z0, z1] = [Math.min(z0, points[p + 1]!), Math.max(z1, points[p + 1]!)];
  }
  return [(x0 + x1) / 2, (z0 + z1) / 2];
}

/** Radii (m, one per side about (x, z)) of a polygon holding the section of `triangles` at `y` and `SECTION_SPREAD` either side of it. */
function sectionRadii(fit: Fit, triangles: readonly number[], y: number, x: number, z: number, sides: number): number[] {
  const points: number[] = [];
  for (const dy of [-SECTION_SPREAD, 0, SECTION_SPREAD]) sectionAt(fit, triangles, y + dy, points);
  return enclose(points, x, z, sides);
}

/** A shell over the `taken` body of `fit`: one ring per step (top to bottom), each holding the body's section at its height `out` off it. */
export function fitted(fit: Fit, taken: Take, steps: readonly Step[], fitting: Fitting): Shell {
  const triangles = takenTriangles(taken);
  const [x, z] = fitting.axis ?? sectionMiddle(fit, triangles, steps[0]!.y);
  const sides = fitting.sides;
  const rings = steps.map((step): Ring => {
    const at = step.at ?? step.y;
    const [middleX, middleZ] = fitting.centred ? sectionMiddle(fit, triangles, at) : [x, z];
    const own = sectionRadii(fit, triangles, at, middleX, middleZ, sides);
    const held = step.holds === undefined ? own : sectionRadii(fit, triangles, step.holds, middleX, middleZ, sides);
    const radii = own.map((radius, k) => Math.max(radius, held[k]!) + (typeof step.out === "number" ? step.out : step.out[k]!));
    return [step.y, 1, 1, middleZ, step.role, 1, radii, middleX - x];
  });
  return { x, sides, kinds: fitting.kinds, bone: fitting.bone, rings, bottom: fitting.bottom };
}

const { SHIRT, LEGS, SHOE, BELT, BUCKLE, SOLE } = ROLE;

/** Sides of a torso band (a 0.15 m radius: 24 keeps a chord within 1.3 mm of its arc) and of a limb's or a foot's ring. */
export const TORSO_SIDES = 24;
export const LIMB_SIDES = 16;

/** Below this (m, the man's rest) the torso is the trousers': just under the belt's top, so the belt or a shirt's hem lip hides the line. */
export const TROUSERS_FROM = 0.97;
/** The belt (m): a band at the trousers' top, standing off the hips, its lips tucked under the skin. */
export const BELT_TOP = 0.975;
export const BELT_BOTTOM = 0.935;
export const BELT_OUT = 0.006;
export const TUCK = -0.002;
/** The builds that wear the belt (a cop may be a woman; every build wears cuffs), and the casual man's tee sleeves and hem, jeans and sneakers. */
const BELT_BUILDS = BUILD.MAN | BUILD.WOMAN;
const CASUAL_BUILDS = BUILD.MAN;
/** The buckle: a plate (m wide, tall, deep) on the belt's front. */
const BUCKLE_SIZE = [0.055, 0.042, 0.008] as const;
/** The tee's untucked hem: a lip resting on the belt, a little proud of it. */
const HEM_TOP = 0.997;
const HEM_LIP = 0.99;
const HEM_OUT = 0.009;

/** Where a short sleeve ends on the arm (m): half way down the upper arm, as the reference tee's. Its hem is a thin lip over the hung sleeve, its top below the shoulder's blend. */
export const SHORT_SLEEVE_END = 1.19;
const SLEEVE_TOP = 1.21;
const SLEEVE_FLARE = 1.2;
const SLEEVE_OUT = 0.006;
/** A long sleeve ends here (m, the man's rest: the cut, vertex for vertex the same wrist on every build). */
export const LONG_SLEEVE_END = 0.79;
/** Its cuff (m from the build's own wrist): a ribbed band over the wrist crease, on the forearm; a fixed height would sink into her hand, her wrist 5 cm higher. */
const CUFF_TOP = 0.068;
const CUFF_RIB = 0.048;
const CUFF_END = -0.012;
const CUFF_OUT = 0.008;
/** A sleeve's hang ends at the cuff's top (m, the man's rest). */
const SLEEVE_HANG_TO = 0.87;

/**
 * A hung trouser leg's hem (m): a tube continuing the hung leg's width from where the leg stops hanging (above a sneaker's
 * collar, so the high-top stays fitted to the foot) down over the shoe's collar, flaring a little at the break, then closing in to the shoe.
 */
const LEG_HANG_TO = 0.165;
/** A hung leg's inner side stays up to this far (m) off the body's middle, growing from none at the thigh to all of it at the hem: pressed thighs part down the leg, as the reference's trouser legs do below the fork. */
const LEG_GAP = 0.03;
const HEM_TUBE_TOP = 0.26;
const HEM_BREAK = 0.18;
const HEM_TUBE_OUT = 0.003;
const HEM_FLARE = 0.009;
/** The jeans' hem stands over the sneaker's collar. */
const JEANS_HEM = 0.12;

/** The sneaker (m): a grey canvas high-top over the foot and a white rubber sole; its laces and toe cap are prints. */
const SNEAKER_COLLAR = 0.15;
const SNEAKER_UPPER = [0.12, 0.09, 0.06, 0.035] as const;
const SNEAKER_OUT = 0.008;
const SOLE_TOP = 0.03;
const SOLE_OUT = 0.012;
const SOLE_BOTTOM = -0.018;
/** The sole's underside takes the footprint: the foot's outline this high (m), just off the floor. */
export const FOOTPRINT_AT = 0.005;
/** The laces print's middle (m up): over the instep, from just above the toe cap to under the collar. */
const LACES_MIDDLE = 0.105;
/** The toe turns out, so the instep's middle runs this far (m) outside the ankle's (its front-most corners measured 7-16 mm out). */
const LACES_OUT = 0.01;
/** The toe cap's band (m off the foot): proud of the canvas, under the sole's lip, from the sole's top up the print's height. */
const TOE_CAP_OUT = 0.011;
/** The toe's middle runs this far (m) outside the ankle's (its section 3.5 cm up spans 52-156 mm against the ankle's 85 mm). */
const TOE_OUT = 0.019;

/**
 * A stretch the casual clothes hang straight over rather than cling to: from height `from` (m, the man's rest) down to `to`,
 * standing `ease` m (at each end) off the sections of the body it `takes`, eased in from nothing over `fade` m above `from`; at
 * the bottom never narrower than `keep` of the top's width, so a sleeve or a jeans leg falls straight instead of tapering to the
 * wrist or ankle. Each body vertex moves its `share` of the way (a sleeve fades out across the shoulder's blend, no ledge at its
 * top), and is never pushed nearer the body's middle than `gap` m (none at `from`, all of it at `to`), so two hung legs falling from pressed thighs part.
 * One that `rests` is never wider at a height than the body's widest from `from` down to there: it falls from a belly instead of standing off the chest above it.
 */
type Hang = { taken: (fit: Fit, side: number) => Take; share: (fit: Fit, side: number) => (vertex: number) => number; sides: readonly number[]; from: number; to: number; fade: number; ease: readonly [number, number]; keep: number; gap: number; rests: boolean };
/** The tee falls from under the pecs to its hem (above them the chest is the shoulders' blend), a sleeve from the shoulder to its cuff (a short one is cut at its end), the jeans from the thigh to the hem. */
const HANGS: readonly Hang[] = [
  { taken: torsoOf, share: (fit) => (vertex) => (torsoOf(fit)(vertex) ? 1 : 0), sides: [0], from: 1.25, to: HEM_TOP, fade: 0.04, ease: [0.004, 0.008], keep: 0, gap: 0, rests: true },
  { taken: armOf, share: (fit, side) => (vertex) => ((fit.tpose[vertex * 3]! < 0 ? -1 : 1) === side ? fit.shoulderWeight[vertex]! : 0), sides: [-1, 1], from: 1.24, to: SLEEVE_HANG_TO, fade: 0.1, ease: [0.008, 0], keep: 0.85, gap: 0, rests: false },
  { taken: legOf, share: (fit, side) => (vertex) => (legOf(fit, side)(vertex) ? 1 : 0), sides: [-1, 1], from: 0.7, to: LEG_HANG_TO, fade: 0.1, ease: [0.01, 0.012], keep: 0.85, gap: LEG_GAP, rests: false },
];
/** Sides of the polygons a hang's width is read off, between which it is interpolated by angle. */
const HANG_SIDES = 32;
/** A hang's top holds the body's widest (per side) down the upper half of its stretch, read this often (m): a tee falls from the pecs and the lats alike, a sleeve over the biceps. */
const HANG_TOP_STEP = 0.02;

/** Radii (one per `HANG_SIDES` side about (x, z)) holding the sections of `triangles` from `from` down to `from - n * HANG_TOP_STEP`, for each n while that stays above `to`. */
function widestDown(fit: Fit, triangles: readonly number[], from: number, to: number, x: number, z: number): number[][] {
  const widest = [sectionRadii(fit, triangles, from, x, z, HANG_SIDES)];
  for (let n = 1; from - n * HANG_TOP_STEP > to; n++) {
    const above = widest[n - 1]!;
    widest.push(sectionRadii(fit, triangles, from - n * HANG_TOP_STEP, x, z, HANG_SIDES).map((radius, k) => Math.max(radius, above[k]!)));
  }
  return widest;
}

/** How far (m, per body vertex: x, y, z) each body vertex of `fit` moves out to where a man's clothes hang (the shader's `hang`, cut by the slot's cuts and scaled by its outfit). */
export function hangOffsets(fit: Fit): Float32Array {
  const offsets = new Float32Array(BODY_VERTICES * 3);
  const step = (2 * Math.PI) / HANG_SIDES;
  for (const hang of HANGS) {
    for (const side of hang.sides) {
      const taken = hang.taken(fit, side);
      const shareOf = hang.share(fit, side);
      const triangles = takenTriangles(taken);
      const middle = (hang.from + hang.to) / 2;
      const [x, z] = sectionMiddle(fit, triangles, middle);
      const widest = widestDown(fit, triangles, hang.from, hang.to, x, z);
      const [top, bottom] = [widest[Math.ceil((hang.from - middle) / HANG_TOP_STEP) - 1]!, sectionRadii(fit, triangles, hang.to, x, z, HANG_SIDES)];
      for (let i = 0; i < BODY_VERTICES; i++) {
        const [y, share] = [fit.rest[i * 3 + 1]!, shareOf(i)];
        if (y < hang.to || y > hang.from + hang.fade || share === 0) continue;
        const [dx, dz] = [fit.rest[i * 3]! - x, fit.rest[i * 3 + 2]! - z];
        const at = (((Math.atan2(dz, dx) / step - 0.5) % HANG_SIDES) + HANG_SIDES) % HANG_SIDES;
        const [k, f] = [Math.floor(at), at - Math.floor(at)];
        const [next, along] = [(k + 1) % HANG_SIDES, Math.min(1, Math.max(0, (hang.from - y) / (hang.from - hang.to)))];
        const width = (radii: readonly number[], ease: number) => radii[k]! * (1 - f) + radii[next]! * f + ease;
        const fallsFrom = width(top, hang.ease[0]);
        let falls = (1 - along) * fallsFrom + along * Math.max(width(bottom, hang.ease[1]), hang.keep * fallsFrom);
        if (hang.rests) {
          const below = Math.max(0, (hang.from - y) / HANG_TOP_STEP);
          const [upper, lower] = [widest[Math.min(widest.length - 1, Math.floor(below))]!, widest[Math.min(widest.length - 1, Math.floor(below) + 1)]!];
          const ease = (1 - along) * hang.ease[0] + along * hang.ease[1];
          falls = Math.min(falls, width(upper, ease) + (below - Math.floor(below)) * (width(lower, ease) - width(upper, ease)));
        }
        const reach = Math.sqrt(dx * dx + dz * dz);
        const out = share * Math.max(0, falls - reach) * (1 - smooth(hang.from, hang.from + hang.fade, y));
        const across = fit.rest[i * 3]!;
        offsets[i * 3] += side === 0 ? (out * dx) / reach : side * Math.max(side * (across + (out * dx) / reach), Math.min(side * across, along * hang.gap)) - across;
        offsets[i * 3 + 2] += (out * dz) / reach;
      }
    }
  }
  return offsets;
}

/**
 * How much of `hang` a suit's and a uniform's torso and sleeves, then trousers, take: a padded, boxy jacket and a bloused
 * uniform shirt stand further off than a tee; both trousers hang as jeans do, so one dress shoe and hem fit under either.
 */
const TROUSERS_HANG = 1;
export const SUIT_HANG = [1.8, TROUSERS_HANG] as const;
export const UNIFORM_HANG = [1.3, TROUSERS_HANG] as const;

/** `fit` with its body hung out by `hangOffsets`, the legs taking `share[1]` of it and the rest `share[0]` (the shader's split): what the clothes over a hung body are fitted over. */
export function hangingFit(fit: Fit, share: readonly [number, number] = [1, 1]): Fit {
  const offsets = hangOffsets(fit);
  return { ...fit, rest: fit.rest.map((v, i) => v + (offsets[i] ?? 0) * (fit.hipWeight[Math.floor(i / 3)]! > 0 ? share[1] : share[0])) };
}

/** The shader's `hang` for `vertices` vertices (the body's first, the wear's zero): each body vertex's level push (x, z) under the man's clothes, then under the portly man's. */
export function hangAttribute(man: Fit, portly: Fit, vertices: number): Float32Array {
  const packed = new Float32Array(vertices * 4);
  for (const [at, fit] of [[0, man], [2, portly]] as const) {
    const offsets = hangOffsets(fit);
    for (let i = 0; i < BODY_VERTICES; i++) {
      packed[i * 4 + at] = offsets[i * 3]!;
      packed[i * 4 + at + 1] = offsets[i * 3 + 2]!;
    }
  }
  return packed;
}

/** The belt with its buckle, and a casual shirt's untucked hem over the hung tee (over the belt or, unbelted, over the jeans' top). */
function beltAndHem(build: number, fit: Fit, hanging: Fit): Shell[] {
  const torso = torsoOf(fit);
  const kinds = build | BELTED;
  const belt = fitted(fit, torso, [
    { y: BELT_TOP, out: TUCK, role: BELT },
    { y: BELT_TOP, out: BELT_OUT, role: BELT },
    { y: BELT_BOTTOM, out: BELT_OUT, role: BELT },
    { y: BELT_BOTTOM, out: TUCK, role: BELT },
  ], { bone: TORSO, kinds, sides: TORSO_SIDES });
  const middle = (BELT_TOP + BELT_BOTTOM) / 2;
  const buckle = box(0, middle, surfaceZ(fit, 0, middle) + BELT_OUT + BUCKLE_SIZE[2] / 2, BUCKLE_SIZE, BUCKLE, kinds, TORSO);
  if ((build & CASUAL_BUILDS) === 0) return [belt, buckle];
  const hem = fitted(hanging, torsoOf(hanging), [
    { y: HEM_TOP, out: TUCK, role: SHIRT },
    { y: HEM_LIP, out: HEM_OUT, role: SHIRT },
    { y: BELT_TOP, out: HEM_OUT, role: SHIRT },
    { y: BELT_TOP, out: BELT_OUT, role: SHIRT },
  ], { bone: TORSO, kinds: build | SNEAKERS, sides: TORSO_SIDES });
  return [belt, buckle, hem];
}

/** Each arm's long-sleeve cuff (on the forearm) and, on the casual man, his tee's short-sleeve hem (on the upper arm). */
function sleeves(build: number, fit: Fit, hanging: Fit): Shell[] {
  const shells: Shell[] = [];
  const wrist = fit.fingertipY + HAND_LENGTH;
  for (const [side, upperArm] of [[-1, LEFT_ARM], [1, RIGHT_ARM]] as const) {
    const arm = armOf(fit, side);
    shells.push(
      fitted(fit, arm, [
        { y: wrist + CUFF_TOP, out: TUCK, role: SHIRT },
        { y: wrist + CUFF_RIB, out: CUFF_OUT, role: SHIRT },
        { y: wrist + CUFF_END, out: CUFF_OUT, role: SHIRT },
        { y: wrist + CUFF_END, out: TUCK, role: SHIRT },
      ], { bone: upperArm + 1, kinds: build | LONG_SLEEVES, sides: LIMB_SIDES }),
    );
    if ((build & CASUAL_BUILDS) === 0) continue;
    shells.push(
      fitted(hanging, armOf(hanging, side), [
        { y: SLEEVE_TOP, out: TUCK, role: SHIRT },
        { y: SLEEVE_FLARE, out: SLEEVE_OUT, role: SHIRT },
        { y: SHORT_SLEEVE_END, out: SLEEVE_OUT, role: SHIRT },
        { y: SHORT_SLEEVE_END, out: TUCK, role: SHIRT },
      ], { bone: upperArm, kinds: build | SHORT_SLEEVES, sides: LIMB_SIDES }),
    );
  }
  return shells;
}

/** The hem of the leg on `side` (-1: x < 0) of `hanging` (a body hung by its trousers' share), down to `hem` (m) and closing in `shoeOut` m off the leg there. */
export function trouserHem(hanging: Fit, side: number, fitting: Fitting, hem: number, shoeOut: number): Shell {
  return fitted(hanging, legOf(hanging, side), [
    { y: HEM_TUBE_TOP, out: TUCK, role: LEGS },
    { y: HEM_BREAK, out: HEM_TUBE_OUT, role: LEGS },
    { y: hem, out: HEM_FLARE, role: LEGS, at: HEM_BREAK },
    { y: hem, out: shoeOut, role: LEGS },
  ], fitting);
}

/** Each leg's sneaker (its laces printed over the instep's front half), the band round its toe the cap is printed on, and the hung jeans' hem over it, all on the shin about the ankle's middle. */
function feet(build: number, fit: Fit, hanging: Fit): Shell[] {
  const shells: Shell[] = [];
  const kinds = build | SNEAKERS;
  for (const [side, thigh] of [[-1, LEFT_LEG], [1, RIGHT_LEG]] as const) {
    const leg = legOf(fit, side);
    const axis = sectionMiddle(fit, takenTriangles(leg), SNEAKER_COLLAR);
    const fitting = { bone: thigh + 1, kinds, sides: LIMB_SIDES, axis };
    const laces = { cell: PRINT_CELL.LACES, centre: [axis[0] + side * LACES_OUT, LACES_MIDDLE], size: LACES_SIZE, along: "z", from: axis[1] } as const;
    const toeCap = { cell: PRINT_CELL.TOE_CAP, centre: [axis[0] + side * TOE_OUT, SOLE_TOP + TOE_CAP_SIZE[1] / 2], size: TOE_CAP_SIZE, along: "z", from: axis[1] } as const;
    shells.push(
      trouserHem(hanging, side, fitting, JEANS_HEM, SNEAKER_OUT),
      {
        ...fitted(fit, leg, [
          { y: SNEAKER_COLLAR, out: TUCK, role: SHOE },
          { y: SNEAKER_COLLAR, out: SNEAKER_OUT, role: SHOE },
          ...SNEAKER_UPPER.map((y) => ({ y, out: SNEAKER_OUT, role: SHOE })),
          { y: SOLE_TOP, out: SOLE_OUT, role: SOLE },
          { y: SOLE_BOTTOM, out: SOLE_OUT, role: SOLE, at: FOOTPRINT_AT },
        ], { ...fitting, centred: true, bottom: 0 }),
        print: laces,
      },
      {
        ...fitted(fit, leg, [
          { y: SOLE_TOP + TOE_CAP_SIZE[1], out: TUCK, role: SHOE },
          { y: SOLE_TOP + TOE_CAP_SIZE[1], out: TOE_CAP_OUT, role: SHOE },
          ...SNEAKER_UPPER.filter((y) => y < SOLE_TOP + TOE_CAP_SIZE[1]).map((y) => ({ y, out: TOE_CAP_OUT, role: SHOE })),
          { y: SOLE_TOP, out: TOE_CAP_OUT, role: SHOE },
        ], { ...fitting, centred: true }),
        print: toeCap,
      },
    );
  }
  return shells;
}

/** Build `build`'s share of the clothes over its own fit: belts and cuffs for any who wear them; the casual man's tee hems, jeans hems and sneakers over his hung body. */
export function casualWear(build: number, fit: Fit): Shell[] {
  const hanging = (build & CASUAL_BUILDS) === 0 ? fit : hangingFit(fit);
  const shells = [...sleeves(build, fit, hanging)];
  if ((build & BELT_BUILDS) !== 0) shells.push(...beltAndHem(build, fit, hanging));
  if ((build & CASUAL_BUILDS) !== 0) shells.push(...feet(build, fit, hanging));
  return shells;
}

/** A stitched seam: overlapping round dots (m across) every `STITCH_STEP` m along a path on face `face`, sunk and shaded as a groove. */
const STITCH_STEP = 0.003;
const STITCH_DOT = 0.006;
const SEAM_SINK = -0.0003;
const SEAM_SHADE = 0.86;
/** Denim's seams and stitching wear paler than the cloth beside them. */
const WORN_SHADE = 1.18;

/** Grooves along the polyline `path` ((across, y) points, m) on `face`. */
function seam(face: Decal["face"], path: readonly (readonly [number, number])[], shade = SEAM_SHADE): Decal[] {
  const dots: Decal[] = [];
  for (let p = 1; p < path.length; p++) {
    const [[ax, ay], [bx, by]] = [path[p - 1]!, path[p]!];
    const steps = Math.max(1, Math.ceil(Math.sqrt((bx - ax) ** 2 + (by - ay) ** 2) / STITCH_STEP));
    for (let s = p === 1 ? 0 : 1; s <= steps; s++) {
      const [x, y] = [ax + ((bx - ax) * s) / steps, ay + ((by - ay) * s) / steps];
      dots.push({ face, x0: x - STITCH_DOT / 2, x1: x + STITCH_DOT / 2, y0: y - STITCH_DOT / 2, y1: y + STITCH_DOT / 2, round: 1, edge: 0, raise: SEAM_SINK, shade, paint: -1, taper: 1 });
    }
  }
  return dots;
}

/** A rivet: a silver dot (m across) at each front pocket's corners. */
const RIVET = 0.007;
const rivet = (x: number, y: number): Decal => ({ face: "+z", x0: x - RIVET / 2, x1: x + RIVET / 2, y0: y - RIVET / 2, y1: y + RIVET / 2, round: 1, edge: 0, raise: 0.0003, shade: 1, paint: ROLE.BUCKLE, taper: 1 });

/** A front pocket's curved opening (m, his right; the left mirrors it) and a back pocket, its outline stitched paler, narrowing to the bottom. */
const FRONT_POCKET = [[0.085, BELT_BOTTOM], [0.1, 0.905], [0.125, 0.885], [0.16, 0.873], [0.2, 0.868]] as const;
const BACK_YOKE = [[0, 0.875], [0.08, 0.895], [0.16, 0.915]] as const;
const BACK_POCKET = { x0: 0.035, x1: 0.15, y0: 0.76, y1: 0.89, taper: 0.88, stitch: 0.004 } as const;
const BOTH_SIDES = [1, -1] as const;

/**
 * A crew neck's cut (the slot's scoop texel: front low, sides high, half width, m): at the man's measured neck base, 1.42 to
 * 1.43 m at the front, rising to the trapezius beside it. Its rib's edge is a seam `CREW_RIB` m under the cut.
 */
export const CREW_NECK = [1.425, 1.455, 0.075] as const;
const CREW_RIB = 0.012;
const CREW_SEAM_REACH = 0.11;
const CREW_SEAM_POINTS = 23;
const crewSeam = Array.from({ length: CREW_SEAM_POINTS }, (_, k) => {
  const x = -CREW_SEAM_REACH + (2 * CREW_SEAM_REACH * k) / (CREW_SEAM_POINTS - 1);
  const across = Math.min(1, Math.abs(x) / CREW_NECK[2]);
  return [x, CREW_NECK[0] + (CREW_NECK[1] - CREW_NECK[0]) * across * across - CREW_RIB] as const;
});

/**
 * The casual outfits' seams in the man's rest metres (the shorts wear the same over their own cut): the tee's crew rib, the
 * jeans' fly (centre seam and J stitch), front pockets' curved openings with rivets, outer and inner leg seams, back yoke and pockets.
 */
export const JEANS_DECALS: readonly Decal[] = [
  ...seam("+z", crewSeam),
  ...seam("+z", [[0, BELT_BOTTOM], [0, 0.79]]),
  ...seam("+z", [[0.032, BELT_BOTTOM], [0.032, 0.83], [0.022, 0.805], [0, 0.795]], WORN_SHADE),
  ...BOTH_SIDES.flatMap((side) => seam("+z", FRONT_POCKET.map(([x, y]) => [side * x, y] as const))),
  ...BOTH_SIDES.flatMap((side) => [rivet(side * FRONT_POCKET[0][0], BELT_BOTTOM - RIVET), rivet(side * FRONT_POCKET[4][0], FRONT_POCKET[4][1])]),
  ...seam("+x", [[-0.01, BELT_BOTTOM], [-0.01, HEM_TUBE_TOP]], WORN_SHADE),
  ...seam("-x", [[-0.01, BELT_BOTTOM], [-0.01, HEM_TUBE_TOP]], WORN_SHADE),
  ...BOTH_SIDES.flatMap((side) => seam("-z", BACK_YOKE.map(([x, y]) => [side * x, y] as const))),
  ...BOTH_SIDES.map((side): Decal => ({ face: "-z", x0: Math.min(side * BACK_POCKET.x0, side * BACK_POCKET.x1), x1: Math.max(side * BACK_POCKET.x0, side * BACK_POCKET.x1), y0: BACK_POCKET.y0, y1: BACK_POCKET.y1, round: 0.2, edge: BACK_POCKET.stitch, raise: SEAM_SINK, shade: WORN_SHADE, paint: -1, taper: BACK_POCKET.taper })),
];
