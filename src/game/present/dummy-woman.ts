import type { Bust } from "./dummy-curves.ts";
import { BUST } from "./dummy-fit.ts";
import { fitted, legOf, LIMB_SIDES, TORSO_SIDES, torsoOf, TUCK, type Take } from "./dummy-garments.ts";
import { HAIRLINE_FRONT, type Head } from "./dummy-head.ts";
import { overHead, surfaceZ } from "./dummy-loft.ts";
import { BUILD, HEAD, HEELS, LEFT_ARM, LEFT_LEG, RIGHT_ARM, RIGHT_LEG, ROLE, SHORT_SLEEVES, smooth, TORSO, type Fit, type Ring, type Shell } from "./dummy-rig.ts";

/** The woman's wear on her fitted body: her shoulder-length wavy hair, her bust under the fitted top, its short sleeves, her cut-offs, and stiletto heels under her arched feet. */

/** Her hair stands this far (m) out of her crown: inside a cap's crown (0.02), so a cap covers it. Under her hairline its face half is this share under the skin. */
const CROWN_HAIR_OUT = 0.018;
const HAIRLINE_UNDER_SKIN = 0.5;
/** Under the cap's rim it falls in `FALL_RINGS` rings to `HAIR_END` (m): resting on her shoulders, as the reference's. */
const HAIR_END = 1.42;
const FALL_RINGS = 22;
const HAIR_SIDES = 32;
/** It lies at least this far (m) off her head and neck wherever it covers them. */
const HAIR_THICK = 0.012;
/** It falls about this z (m): inside her head and her neck (the throat's front is near z = 0), so every side's ray leaves her once. */
const HAIR_AXIS_Z = -0.03;
/** Its volume (m): half width beside the face, reach in front of and behind the axis; growing from the rim to the chin, then hanging. */
const VOLUME_AT_RIM = [0.085, 0.1, 0.085] as const;
const VOLUME_AT_CHIN = [0.128, 0.09, 0.098] as const;
/** Her face shows through it within this half width (m) in front, her throat within `THROAT_HALF` under the chin. */
const FACE_HALF = 0.058;
const THROAT_HALF = 0.05;
/** Over the face it dives to this share of the head's radius: a section's sides are pushed out past the nose's flanks, so a shallow tuck shows on the cheeks. */
const OPEN_SINK_SHARE = 0.5;
/** Its ends lie this far (m) under the skin where they close. */
const TUCK_UNDER = 0.008;
/** Its waves: `WAVES` strands round, `WAVE_DEPTH` m deep, twisting a whole turn every `WAVE_TURN` m down. */
const WAVES = 8;
const WAVE_DEPTH = 0.006;
const WAVE_TURN = 0.16;
/** Its ends curl in onto her shoulders over the last `END_BAND` m; the pole under them sits inside her. */
const END_BAND = 0.05;
const END_POLE = 0.01;
/** Her head and neck under the hair: off the arms, within this |x| (m) of her middle (her trapezius under the ends, not her shoulders). */
const UNDER_HAIR_X = 0.1;
/** Beside her head (over the chin) it stands at most this far (m) off her: volume, not a helmet floating clear of her skull. */
const HAIR_STANDS_OFF = 0.048;
/** Its volume is whole by this height (m) over the chin, her cheek: it clears her ears with no bump over each. */
const GROWN_OVER_CHIN = 0.06;

/** Her hair's ring at `y` (m) about the head's middle line: over `body` (her section's radius per side), its volume, opened over her face or throat. */
function hairRing(y: number, body: readonly number[], head: Head, rim: number): Ring {
  const grown = smooth(rim, head.chin + GROWN_OVER_CHIN, y);
  const [halfWidth, front, back] = VOLUME_AT_RIM.map((atRim, i) => atRim + (VOLUME_AT_CHIN[i]! - atRim) * grown);
  const open = y > head.chin ? FACE_HALF : THROAT_HALF;
  const closing = smooth(HAIR_END, HAIR_END + END_BAND, y);
  const radii = body.map((under, k) => {
    const angle = ((k + 0.5) * 2 * Math.PI) / HAIR_SIDES;
    const [across, ahead] = [Math.cos(angle), Math.sin(angle)];
    if (ahead > 0 && Math.abs(under * across) < open) return under * OPEN_SINK_SHARE;
    const volume = Math.min(1 / Math.sqrt((across / halfWidth!) ** 2 + (ahead / (ahead > 0 ? front! : back!)) ** 2), y > head.chin ? under + HAIR_STANDS_OFF : Infinity);
    const wave = WAVE_DEPTH * Math.sin(WAVES * angle + (2 * Math.PI * (rim - y)) / WAVE_TURN);
    return under - TUCK_UNDER + (Math.max(under + HAIR_THICK, volume) + wave - under + TUCK_UNDER) * closing;
  });
  return [y, 1, 1, HAIR_AXIS_Z, ROLE.LOCKS, 1, radii];
}

/** Her hair over `head` (`crownYs`: the cap's crown ring heights, the rim last): her crown under the cap, then the wavy fall framing her face to her shoulders. */
function hair(fit: Fit, head: Head, crownYs: readonly number[]): Shell {
  const hairline = head.chin + HAIRLINE_FRONT * (head.top - head.chin);
  const crown = overHead(head, crownYs, CROWN_HAIR_OUT, ROLE.LOCKS, (y) => (y < hairline ? HAIRLINE_UNDER_SKIN : 1));
  const rim = crownYs[crownYs.length - 1]!;
  const ys = Array.from({ length: FALL_RINGS }, (_, k) => rim - ((k + 1) * (rim - HAIR_END)) / FALL_RINGS);
  const underHair: Take = (vertex) => fit.shoulderWeight[vertex]! < 1 && fit.hipWeight[vertex] === 0 && Math.abs(fit.tpose[vertex * 3]!) < UNDER_HAIR_X;
  const sections = fitted(fit, underHair, ys.map((y) => ({ y, out: 0, role: ROLE.LOCKS })), { bone: HEAD, kinds: BUILD.WOMAN, sides: HAIR_SIDES, axis: [0, HAIR_AXIS_Z] });
  const fall = sections.rings.map((ring) => hairRing(ring[0], ring[6]!, head, rim));
  return { x: 0, sides: HAIR_SIDES, kinds: BUILD.WOMAN, bone: HEAD, rings: [...crown, ...fall], top: head.top + CROWN_HAIR_OUT - crownYs[0]!, bottom: END_POLE };
}

/**
 * Her bust's footprint on the chest (m): from `BUST_ABOVE` over the tip (where the upper slope leaves the chest) to
 * `BUST_BELOW` under it (where the top drapes onto her ribs), `BUST_INNER` past the cleavage (the two overlap there, so the
 * fitted top bridges them as the second reference's) and `BUST_OUTER` to the chest's side, short of the armpit's gap.
 */
const BUST_ABOVE = 0.12;
const BUST_BELOW = 0.085;
const BUST_INNER = 0.11;
const BUST_OUTER = 0.045;
/** The dome's height share is (1 - d²)^p over the footprint's normalised distance d: over 1 it meets the chest tangent, with no ledge; steeper-shouldered upward, rounder underneath. */
const BUST_POWER_ACROSS = 1.5;
const BUST_POWER_UP = 2.5;
const BUST_POWER_DOWN = 1.15;
const BUST_RINGS = 16;
const BUST_SIDES = 24;
/** Points sampled across each ring's footprint: the chest's surface under the dome. */
const BUST_SAMPLES = 33;
/** The dome's rim sinks this far (m) under the skin, so it rises out of the chest with no step; its back lies this far under. */
const BUST_RIM_SINK = 0.004;
const BUST_BACK_SINK = 0.03;
/** The poles stand this far (m) past the end rings, inside the chest. */
const BUST_POLE = 0.004;

/**
 * Radii (m) about (x, z), one per loft side (side k at angle (k + 1/2) 2π/sides), of the closed outline `outline` ((x, z)
 * pairs, star-shaped about the centre): where each side's ray leaves it.
 */
function polarRadii(outline: readonly number[], x: number, z: number, sides: number): number[] {
  return Array.from({ length: sides }, (_, k) => {
    const angle = ((k + 0.5) * 2 * Math.PI) / sides;
    const [dx, dz] = [Math.cos(angle), Math.sin(angle)];
    let reach = 0;
    for (let p = 0; p < outline.length; p += 2) {
      const q = (p + 2) % outline.length;
      const [ax, az] = [outline[p]! - x, outline[p + 1]! - z];
      const [ex, ez] = [outline[q]! - outline[p]!, outline[q + 1]! - outline[p + 1]!];
      const det = ex * dz - ez * dx;
      if (Math.abs(det) < 1e-12) continue;
      const along = (ax * dz - az * dx) / -det;
      if (along >= 0 && along <= 1) reach = Math.max(reach, (ax + along * ex) * dx + (az + along * ez) * dz);
    }
    return reach;
  });
}

/** Her bust on side `side` (-1: x < 0): a dome rising out of the chest's own surface to the tip. */
function bustShell(fit: Fit, bust: Bust, side: number): Shell {
  const x = side * bust.x;
  const rise = bust.tip - (surfaceZ(fit, x, bust.y) - BUST_RIM_SINK);
  const [top, bottom] = [bust.y + BUST_ABOVE, bust.y - BUST_BELOW];
  const rings: Ring[] = [];
  for (let k = 1; k < BUST_RINGS; k++) {
    const y = top - (k / BUST_RINGS) * (top - bottom);
    const up = (y - bust.y) / (y >= bust.y ? BUST_ABOVE : BUST_BELOW);
    const across = Math.sqrt(1 - up ** 2);
    const [front, back]: number[][] = [[], []];
    for (let j = 0; j < BUST_SAMPLES; j++) {
      const out = (2 * j) / (BUST_SAMPLES - 1) - 1;
      const at = x + side * across * out * (out < 0 ? BUST_INNER : BUST_OUTER);
      const skin = surfaceZ(fit, at, y);
      const d2 = (out * across) ** 2 + up ** 2;
      const upShare = d2 > 0 ? up ** 2 / d2 : 0;
      const power = BUST_POWER_ACROSS + ((up >= 0 ? BUST_POWER_UP : BUST_POWER_DOWN) - BUST_POWER_ACROSS) * upShare;
      front.push(at, skin - BUST_RIM_SINK + rise * Math.max(0, 1 - d2) ** power);
      back.unshift(at, skin - BUST_BACK_SINK);
    }
    const middle = surfaceZ(fit, x, y) - BUST_BACK_SINK / 2;
    rings.push([y, 1, 1, middle, ROLE.SHIRT, 1, polarRadii([...front, ...back], x, middle, BUST_SIDES)]);
  }
  return { x, sides: BUST_SIDES, kinds: BUILD.WOMAN, bone: TORSO, rings, top: BUST_POLE, bottom: BUST_POLE };
}

/** The heel is the back `HEEL_LENGTH` m of her foot under `HEEL_ABOVE` m; the stiletto rises `HEEL_SINK` m into it. */
const HEEL_LENGTH = 0.03;
const HEEL_ABOVE = 0.12;
const HEEL_SINK = 0.01;
/** The stiletto's half widths (m) at the heel and at the floor, its tip set this far (m) forward of its top, and its sides. */
const HEEL_TOP = 0.012;
const HEEL_TIP = 0.004;
const HEEL_RAKE = 0.008;
const HEEL_SIDES = 8;

/** Her stiletto on side `side` (-1: x < 0): from inside her raised heel down to the floor, on her shin. */
function stiletto(fit: Fit, side: number): Shell {
  const rest = fit.rest;
  let back = Infinity;
  for (let i = 0; i < fit.shoulderWeight.length; i++) if (rest[i * 3]! * side > 0 && rest[i * 3 + 1]! < HEEL_ABOVE) back = Math.min(back, rest[i * 3 + 2]!);
  let [x, z, n, underside] = [0, 0, 0, Infinity];
  for (let i = 0; i < fit.shoulderWeight.length; i++) {
    if (rest[i * 3]! * side <= 0 || rest[i * 3 + 1]! >= HEEL_ABOVE || rest[i * 3 + 2]! > back + HEEL_LENGTH) continue;
    [x, z, n, underside] = [x + rest[i * 3]!, z + rest[i * 3 + 2]!, n + 1, Math.min(underside, rest[i * 3 + 1]!)];
  }
  const [heelX, heelZ] = [x / n, z / n];
  const rings: Ring[] = [
    [underside + HEEL_SINK, HEEL_TOP, HEEL_TOP, heelZ, ROLE.SHOE],
    [HEEL_TIP, HEEL_TIP, HEEL_TIP, heelZ + HEEL_RAKE, ROLE.SHOE],
  ];
  return { x: heelX, sides: HEEL_SIDES, kinds: BUILD.WOMAN, bone: (side < 0 ? LEFT_LEG : RIGHT_LEG) + 1, rings, bottom: HEEL_TIP };
}

/** Her top's short sleeve ends at her armpit, as the reference's (m; also the cut's sleeve end): the hem lip flares out from under the skin. */
export const SLEEVE_END = 1.245;
const SLEEVE_TOP = 1.272;
const SLEEVE_FLARE = 1.262;
const SLEEVE_OUT = 0.009;
/** The sleeve fits the upper arm down from where it is this much the arm's: above the arm's own triangles, under the deltoid's join to the chest. */
const SLEEVE_ARM_WEIGHT = 0.75;

/** Her sleeve's hem on side `side` (-1: x < 0), riding the upper arm. */
function sleeve(fit: Fit, side: number): Shell {
  const arm: Take = (vertex) => fit.shoulderWeight[vertex]! >= SLEEVE_ARM_WEIGHT && (fit.tpose[vertex * 3]! < 0 ? -1 : 1) === side;
  return fitted(fit, arm, [
    { y: SLEEVE_TOP, out: TUCK, role: ROLE.SHIRT },
    { y: SLEEVE_FLARE, out: SLEEVE_OUT, role: ROLE.SHIRT },
    { y: SLEEVE_END, out: SLEEVE_OUT, role: ROLE.SHIRT },
    { y: SLEEVE_END, out: TUCK, role: ROLE.SHIRT },
  ], { bone: side < 0 ? LEFT_ARM : RIGHT_ARM, kinds: BUILD.WOMAN | SHORT_SLEEVES, sides: LIMB_SIDES });
}

/** Her cut-offs' waistband (m): a denim band over her hips, its lips tucked under the skin, and her top's hem resting on it. */
const WAISTBAND_TOP = 0.985;
const WAISTBAND_BOTTOM = 0.95;
const WAISTBAND_OUT = 0.005;
const TOP_HEM_TOP = 1.005;
const TOP_HEM_LIP = 0.995;
const TOP_HEM_OUT = 0.007;
/** Her cut-offs' legs (m): the reference's hem sits a few cm under the fork (0.81), where the thigh is the thigh's alone; the shell flares out to the frayed hem (`SHORTS_END`, the cut's leg end) and tucks under the denim body above it. */
const SHORTS_FAIR = 0.79;
const SHORTS_BEND = 0.775;
export const SHORTS_END = 0.76;
const SHORTS_BEND_OUT = 0.01;
const SHORTS_FLARE = 0.016;

/** Her cut-offs (waistband and flared leg hems) with her top's hem on the waistband: her outfit's (`HEELS`), not a woman cop's. */
function cutOffs(fit: Fit): Shell[] {
  const kinds = BUILD.WOMAN | HEELS;
  const torso = torsoOf(fit);
  const shells = [
    fitted(fit, torso, [
      { y: WAISTBAND_TOP, out: TUCK, role: ROLE.LEGS },
      { y: WAISTBAND_TOP, out: WAISTBAND_OUT, role: ROLE.LEGS },
      { y: WAISTBAND_BOTTOM, out: WAISTBAND_OUT, role: ROLE.LEGS },
      { y: WAISTBAND_BOTTOM, out: TUCK, role: ROLE.LEGS },
    ], { bone: TORSO, kinds, sides: TORSO_SIDES }),
    fitted(fit, torso, [
      { y: TOP_HEM_TOP, out: TUCK, role: ROLE.SHIRT },
      { y: TOP_HEM_LIP, out: TOP_HEM_OUT, role: ROLE.SHIRT },
      { y: WAISTBAND_TOP, out: TOP_HEM_OUT, role: ROLE.SHIRT },
      { y: WAISTBAND_TOP, out: WAISTBAND_OUT, role: ROLE.SHIRT },
    ], { bone: TORSO, kinds, sides: TORSO_SIDES }),
  ];
  for (const [side, thigh] of [[-1, LEFT_LEG], [1, RIGHT_LEG]] as const) {
    shells.push(
      fitted(fit, legOf(fit, side), [
        { y: SHORTS_FAIR, out: TUCK, role: ROLE.LEGS },
        { y: SHORTS_BEND, out: SHORTS_BEND_OUT, role: ROLE.LEGS },
        { y: SHORTS_END, out: SHORTS_FLARE, role: ROLE.LEGS },
        { y: SHORTS_END, out: TUCK, role: ROLE.LEGS },
      ], { bone: thigh, kinds, sides: LIMB_SIDES }),
    );
  }
  return shells;
}

/** Her wear on her fitted body `fit` with head `head` (`crownYs`: a cap's crown ring heights, the rim last). */
export function womanWear(fit: Fit, head: Head, crownYs: readonly number[]): Shell[] {
  return [
    hair(fit, head, crownYs),
    bustShell(fit, BUST, -1),
    bustShell(fit, BUST, 1),
    sleeve(fit, -1),
    sleeve(fit, 1),
    stiletto(fit, -1),
    stiletto(fit, 1),
    ...cutOffs(fit),
  ];
}
