import { bodyIndex } from "./dummy-bodies.ts";
import { smooth, type Fit } from "./dummy-rig.ts";

/** Her figure on her fitted body: feet arched onto heels, hips curved out, and her bust measured, then sculpted into her chest. */

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
type Bust = { x: number; y: number; wall: number; tip: number; r: number };

/** Her bust's peak is her most forward chest vertex between these heights and these |x| (the cleavage, the armpit). */
const CHEST_FROM = 1.05;
const CHEST_TO = 1.42;
const CLEAVAGE = 0.02;
const CHEST_SIDE = 0.16;
/** The chest wall is the sternum: the most forward chest vertex within `MIDLINE` of x = 0 and `WALL_BAND` of the peak's height. */
const MIDLINE = 0.005;
const WALL_BAND = 0.03;
/** The tip stands this far out of the wall (m): the second reference's full fitted top, well past the baked body's 3 cm. */
const PROJECTION = 0.078;
/** The orb's footprint (m): its weight on the chest is gone this far from its centre, past the bust's own half width. */
const FOOTPRINT = 0.13;

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

/**
 * Each dome's footprint on the chest (m) about its orb's centre: `BUST_ABOVE` over it, `BUST_BELOW` under it, `BUST_INNER`
 * toward the cleavage (past the midline, so the two meet and the top bridges them) and `BUST_OUTER` toward the armpit.
 */
const BUST_ABOVE = 0.13;
const BUST_BELOW = 0.092;
const BUST_INNER = 0.1;
const BUST_OUTER = 0.06;
/** A dome's height share is (1 - d²)^p over the footprint's normalised distance d: flatter above, rounder underneath. */
const BUST_POWER_ACROSS = 1;
const BUST_POWER_UP = 1.5;
const BUST_POWER_DOWN = 1.3;
/** From this share of the way out the dome fades to nothing, so it leaves the chest with no rim. */
const BUST_FADE = 0.4;
/** The chest under the domes is fitted to the body's own chest in a ring this far out (footprint distances) around them. */
const CHEST_RING = 1.35;
/** Only the chest's own front gives way to that fit: a vertex this far (m) behind it (the torso's side under the arm) keeps its place. */
const EASE_DEPTH = 0.04;
/**
 * Under her top's scoop (its bottom at `BRIDGE_TOP` m on her) the fabric spans the cleavage at the domes' own height, as a
 * fitted top does; it rises onto that over `BRIDGE_EASE` m so the neckline's edge is a slope, not a cliff. It lets go of the
 * domes from `BRIDGE_LOW` m under their centres, so the bust's under-curve still rises between them.
 */
const BRIDGE_TOP = 1.29;
const BRIDGE_EASE = 0.04;
const BRIDGE_LOW = 0.07;

/** The footprint's normalised distance squared of (x, y) from side `side`'s orb (-1: x < 0), and the share of it that is up or down. */
function footprint(bust: Bust, side: number, x: number, y: number): [d2: number, upShare: number] {
  const out = side * x - bust.x;
  const across = out / (out < 0 ? BUST_INNER : BUST_OUTER);
  const up = (y - bust.y) / (y > bust.y ? BUST_ABOVE : BUST_BELOW);
  const d2 = across * across + up * up;
  return [d2, d2 > 0 ? (up * up) / d2 : 0];
}

/** Side `side`'s dome height share at (x, y): 1 on the orb's centre, 0 with no slope from its footprint's edge. */
function dome(bust: Bust, side: number, x: number, y: number): number {
  const [d2, upShare] = footprint(bust, side, x, y);
  if (d2 >= 1) return 0;
  const power = BUST_POWER_ACROSS + ((y > bust.y ? BUST_POWER_UP : BUST_POWER_DOWN) - BUST_POWER_ACROSS) * upShare;
  return (1 - d2) ** power * (1 - smooth(BUST_FADE, 1, Math.sqrt(d2)));
}

/** How much of the baked chest at (x, y) gives way to the smooth fit: whole over a dome's middle, none past either footprint (a smooth union of the two, no crease between them). */
function easing(bust: Bust, x: number, y: number): number {
  const kept = (side: number) => smooth(BUST_FADE, 1, Math.sqrt(footprint(bust, side, x, y)[0]));
  return 1 - kept(-1) * kept(1);
}

/** The chest's terms, symmetric across her middle: z = a + b y + c y² + d x² + e x² y about the bust's centre height. */
const chestTerms = (bust: Bust, x: number, y: number) => [1, y - bust.y, (y - bust.y) ** 2, x * x, x * x * (y - bust.y)];

/** Least squares: the coefficients of `terms` (a row of term values per sample) fitting `values`, by Gaussian elimination. */
function leastSquares(terms: readonly number[][], values: readonly number[]): number[] {
  const n = terms[0]!.length;
  const normal = Array.from({ length: n }, (_, r) => [...Array.from({ length: n }, (_, c) => terms.reduce((sum, row) => sum + row[r]! * row[c]!, 0)), terms.reduce((sum, row, s) => sum + row[r]! * values[s]!, 0)]);
  for (let p = 0; p < n; p++) {
    for (let r = p + 1; r < n; r++) {
      const f = normal[r]![p]! / normal[p]![p]!;
      for (let c = p; c <= n; c++) normal[r]![c]! -= f * normal[p]![c]!;
    }
  }
  const out = new Array<number>(n).fill(0);
  for (let r = n - 1; r >= 0; r--) out[r] = (normal[r]![n]! - normal[r]!.slice(r + 1, n).reduce((sum, v, k) => sum + v * out[r + 1 + k]!, 0)) / normal[r]![r]!;
  return out;
}

/**
 * Her chest in `fit` sculpted into `bust` (measured before): under the footprints the baked chest (its small faceted bust) is
 * eased onto a smooth fit of the chest around it, then the domes raise it to the tip. One continuous body, so the top over it
 * has no rim; the bones' weights stay.
 */
export function sculptBust(fit: Fit, bust: Bust): void {
  const rest = fit.rest;
  const front = (i: number) => fit.shoulderWeight[i]! < 1 && fit.hipWeight[i] === 0 && rest[i * 3 + 2]! > 0;
  const [terms, values]: [number[][], number[]] = [[], []];
  for (let i = 0; i < fit.shoulderWeight.length; i++) {
    const near = Math.min(footprint(bust, -1, rest[i * 3]!, rest[i * 3 + 1]!)[0], footprint(bust, 1, rest[i * 3]!, rest[i * 3 + 1]!)[0]);
    if (!front(i) || near < 1 || near > CHEST_RING ** 2) continue;
    terms.push(chestTerms(bust, rest[i * 3]!, rest[i * 3 + 1]!));
    values.push(rest[i * 3 + 2]!);
  }
  const chest = leastSquares(terms, values);
  const chestAt = (x: number, y: number) => chestTerms(bust, x, y).reduce((sum, term, k) => sum + term * chest[k]!, 0);
  const rise = bust.tip - chestAt(bust.x, bust.y);
  for (let i = 0; i < fit.shoulderWeight.length; i++) {
    const [x, y] = [rest[i * 3]!, rest[i * 3 + 1]!];
    if (!front(i)) continue;
    const kept = smooth(EASE_DEPTH / 2, EASE_DEPTH, chestAt(x, y) - rest[i * 3 + 2]!);
    const eased = rest[i * 3 + 2]! + (1 - kept) * easing(bust, x, y) * (chestAt(x, y) - rest[i * 3 + 2]!);
    rest[i * 3 + 2] = eased + rise * (dome(bust, -1, x, y) + dome(bust, 1, x, y));
  }
  bridgeCleavage(fit, bust, front);
}

/** Her front's profile down the domes' centre line (|x| = `bust.x`): (y, z) where `front` body edges cross it, top to bottom. */
function centreLine(fit: Fit, bust: Bust, front: (i: number) => boolean): [number, number][] {
  const [rest, index, line] = [fit.rest, bodyIndex(), [] as [number, number][]];
  for (let t = 0; t < index.length; t += 3) {
    for (let e = 0; e < 3; e++) {
      const [a, b] = [index[t + e]!, index[t + ((e + 1) % 3)]!];
      const [xa, xb] = [Math.abs(rest[a * 3]!), Math.abs(rest[b * 3]!)];
      if (!front(a) || !front(b) || xa < bust.x === xb < bust.x) continue;
      const f = (bust.x - xa) / (xb - xa);
      line.push([rest[a * 3 + 1]! + f * (rest[b * 3 + 1]! - rest[a * 3 + 1]!), rest[a * 3 + 2]! + f * (rest[b * 3 + 2]! - rest[a * 3 + 2]!)]);
    }
  }
  return line.sort(([ya], [yb]) => yb - ya);
}

/** Her top across the cleavage under its scoop: each `front` vertex between the domes raised to the domes' height at its own height. */
function bridgeCleavage(fit: Fit, bust: Bust, front: (i: number) => boolean): void {
  const rest = fit.rest;
  const line = centreLine(fit, bust, front);
  const spans: [number, number][] = [];
  for (let i = 0; i < fit.shoulderWeight.length; i++) {
    const [x, y] = [rest[i * 3]!, rest[i * 3 + 1]!];
    const share = (1 - smooth(BRIDGE_TOP - BRIDGE_EASE, BRIDGE_TOP, y)) * smooth(bust.y - BRIDGE_LOW, bust.y - BRIDGE_LOW + 2 * BRIDGE_EASE, y);
    if (!front(i) || Math.abs(x) >= bust.x || share === 0) continue;
    const below = line.findIndex(([at]) => at <= y);
    const [[y0, z0], [y1, z1]] = [line[below - 1]!, line[below]!];
    const column = z0 + ((y - y0) / (y1 - y0)) * (z1 - z0);
    spans.push([i, rest[i * 3 + 2]! + share * Math.max(0, column - rest[i * 3 + 2]!)]);
  }
  for (const [i, z] of spans) rest[i * 3 + 2] = z;
}
