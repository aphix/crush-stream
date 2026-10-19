import { smooth, type Fit } from "./dummy-rig.ts";

/** Her figure on her fitted body: feet arched onto heels, hips curved out, and her bust measured where the jiggle and the bust shells sit. */

/** Her heel rises this far (m) per metre behind the ball of her foot: its back about 7 cm off the floor. */
const HEEL_PITCH = 0.4;
/** The ball of her foot, as a share of the sole's length from heel to toe. */
const BALL_AT = 0.62;
/** The sole is what lies under this height (m); the lift is whole up to `SOLE_TOP` and gone by the ankle. */
const SOLE_TOP = 0.05;
const LIFT_WHOLE_UNDER = 0.02;
const ANKLE_Y = 0.17;
/** A pointed toe: the toe narrows to this share of its spread at the tip, flattens by `TOE_FLATTEN` of its height there, and reaches `TOE_REACH` m further. */
const TOE_SPREAD = 0.4;
const TOE_FLATTEN = 0.35;
const TOE_REACH = 0.025;

/** Her feet in `rest` arched in place onto high heels: the heel lifted behind the ball, the toe drawn out to a point; the ankle stays. */
export function archFeet(rest: Float32Array): void {
  let [heel, toe] = [Infinity, -Infinity];
  for (let i = 1; i < rest.length; i += 3) {
    if (rest[i]! > SOLE_TOP) continue;
    heel = Math.min(heel, rest[i + 1]!);
    toe = Math.max(toe, rest[i + 1]!);
  }
  const ball = heel + BALL_AT * (toe - heel);
  let [across, n] = [0, 0];
  for (let i = 0; i < rest.length; i += 3) {
    if (rest[i + 1]! > SOLE_TOP || rest[i + 2]! < ball) continue;
    across += Math.abs(rest[i]!);
    n++;
  }
  const axis = across / n;
  for (let i = 0; i < rest.length; i += 3) {
    const [x, y, z] = [rest[i]!, rest[i + 1]!, rest[i + 2]!];
    if (y > ANKLE_Y) continue;
    const toward = Math.max(0, (z - ball) / (toe - ball)) ** 2;
    const side = Math.sign(x);
    rest[i] = side * (axis + (Math.abs(x) - axis) * (1 - (1 - TOE_SPREAD) * toward));
    rest[i + 1] = y * (1 - TOE_FLATTEN * toward) + Math.max(0, ball - z) * HEEL_PITCH * (1 - smooth(LIFT_WHOLE_UNDER, ANKLE_Y, y));
    rest[i + 2] = z + TOE_REACH * toward;
  }
}

/** Her hips widen by up to this share of |x|: the acceptance reference's hourglass (hips about 1.6 times her waist, the baked body's 1.4). */
const HIP_SWELL = 0.12;
/** The swell (m): none down to the belt's bottom (a woman cop's duty kit is laid on the belt's section), whole over her hips, gone by mid-thigh, where her hanging fingertips come within 1 cm of it. */
const SWELL_FROM = 0.93;
const SWELL_WHOLE_FROM = 0.87;
const SWELL_WHOLE_TO = 0.84;
const SWELL_TO = 0.72;

/** Her hips in `fit` curved out (her arms left where they hang); the bones' weights stay, so the ragdoll pins her as before. */
export function curveHips(fit: Fit): void {
  const rest = fit.rest;
  for (let i = 0; i < fit.shoulderWeight.length; i++) {
    if (fit.shoulderWeight[i]! > 0) continue;
    const y = rest[i * 3 + 1]!;
    rest[i * 3] = rest[i * 3]! * (1 + HIP_SWELL * (y > SWELL_WHOLE_FROM ? smooth(SWELL_FROM, SWELL_WHOLE_FROM, y) : smooth(SWELL_TO, SWELL_WHOLE_TO, y)));
  }
}

/** Her bust (m): each orb's centre across (x) and height (y) on her chest, the chest wall's z behind it, its tip's z, and its footprint's reach. */
export type Bust = { x: number; y: number; wall: number; tip: number; r: number };

/** Her bust's peak is her most forward chest vertex between these heights and these |x| (the cleavage, the armpit). */
const CHEST_FROM = 1.05;
const CHEST_TO = 1.42;
const CLEAVAGE = 0.02;
const CHEST_SIDE = 0.16;
/** The chest wall is the sternum: the most forward chest vertex within `MIDLINE` of x = 0 and `WALL_BAND` of the peak's height. */
const MIDLINE = 0.005;
const WALL_BAND = 0.03;
/** The tip stands this far out of the wall (m): the reference's fitted top, fuller than the baked body's 3 cm. */
const PROJECTION = 0.07;
/** The orb's footprint (m): its weight on the chest is gone this far from its centre, past the bust's own half width. */
const FOOTPRINT = 0.12;

const isChest = (fit: Fit, i: number) => fit.shoulderWeight[i] === 0 && fit.hipWeight[i] === 0 && fit.neckWeight[i] === 0;

/** Her bust measured on her fitted body `fit`: the orbs on her breast peaks, not on a guessed point. */
export function bustOf(fit: Fit): Bust {
  const rest = fit.rest;
  let [x, y, peak] = [0, 0, -Infinity];
  for (let i = 0; i < fit.shoulderWeight.length; i++) {
    const [across, height, front] = [Math.abs(rest[i * 3]!), rest[i * 3 + 1]!, rest[i * 3 + 2]!];
    if (!isChest(fit, i) || height < CHEST_FROM || height > CHEST_TO || across < CLEAVAGE || across > CHEST_SIDE || front <= peak) continue;
    [x, y, peak] = [across, height, front];
  }
  let wall = -Infinity;
  for (let i = 0; i < fit.shoulderWeight.length; i++) {
    if (isChest(fit, i) && Math.abs(rest[i * 3]!) <= MIDLINE && Math.abs(rest[i * 3 + 1]! - y) <= WALL_BAND) wall = Math.max(wall, rest[i * 3 + 2]!);
  }
  return { x, y, wall, tip: wall + PROJECTION, r: FOOTPRINT };
}
