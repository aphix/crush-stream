import { fitted, legOf, LIMB_SIDES, TORSO_SIDES, torsoOf, TUCK, type Take } from "./dummy-garments.ts";
import { BUILD, HEELS, LEFT_ARM, LEFT_FOOT, LEFT_LEG, RIGHT_ARM, RIGHT_FOOT, RIGHT_LEG, ROLE, SHORT_SLEEVES, TORSO, type Fit, type Ring, type Shell } from "./dummy-rig.ts";

/** The woman's wear on her fitted body (her bust is her body's own: `sculptBust`): her top's short sleeves, her cut-offs, and stiletto heels under her arched feet. */

/** The heel is the back `HEEL_LENGTH` m of her foot under `HEEL_ABOVE` m; the stiletto rises `HEEL_SINK` m into it. */
const HEEL_LENGTH = 0.03;
const HEEL_ABOVE = 0.12;
const HEEL_SINK = 0.01;
/** The stiletto's half widths (m) at the heel and at the floor, its tip set this far (m) forward of its top, and its sides. */
const HEEL_TOP = 0.012;
const HEEL_TIP = 0.004;
const HEEL_RAKE = 0.008;
const HEEL_SIDES = 8;

/** Her stiletto on side `side` (-1: x < 0): from inside her raised heel down to the floor, on her foot. */
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
  return { x: heelX, sides: HEEL_SIDES, kinds: BUILD.WOMAN, bone: side < 0 ? LEFT_FOOT : RIGHT_FOOT, rings, bottom: HEEL_TIP };
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

/** Her wear on her fitted body `fit`. */
export function womanWear(fit: Fit): Shell[] {
  return [
    sleeve(fit, -1),
    sleeve(fit, 1),
    stiletto(fit, -1),
    stiletto(fit, 1),
    ...cutOffs(fit),
  ];
}
