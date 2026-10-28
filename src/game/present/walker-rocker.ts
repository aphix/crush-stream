import { detCos, detSin } from "../kernel/physics-core.js";
import { ANKLE_Y, PARTS } from "./ragdoll-body.ts";
import { smoothstep } from "./walker-math.ts";

/** The foot's geometry for the gait: it rolls over the ground on its heel or on its toe, and the ankle rides above the pivot. */

/** The sole's back and front edges (m) behind and ahead of the ankle's line (`PARTS` 10). */
const FOOT = PARTS[10];
const HEEL_BEHIND = FOOT.h[2] - FOOT.c[2];
const TOE_AHEAD = FOOT.c[2] + FOOT.h[2];
export const FOOT_LENGTH = HEEL_BEHIND + TOE_AHEAD;
/** A planted sole hovers this far (m) over the ground: the frame carries his weight, so a foot that touched would fight the lock. */
export const HOVER = 0.04;

/** The two points a planted foot turns on. */
export const HEEL = 0;
export const TOE = 1;
const PIVOT_AHEAD = [-HEEL_BEHIND, TOE_AHEAD] as const;

/** The ankle's offset from the foot's `pivot` (forward, up: m) into `out`, with the foot tipped `pitch` rad toes up about it. */
export function ankleFromPivot(out: Float64Array, pivot: number, pitch: number): void {
  const c = detCos(pitch);
  const s = detSin(pitch);
  const ahead = PIVOT_AHEAD[pivot]!;
  out[0] = -(ahead * c + ANKLE_Y * s);
  out[1] = -(ahead * s - ANKLE_Y * c);
}

/** The lowest the foot's sole reaches (m, negative: under the ankle) when the foot is tipped `pitch` rad toes up: its back edge or its front edge. */
export function soleBelowAnkle(pitch: number): number {
  const c = detCos(pitch);
  const s = detSin(pitch);
  return Math.min(-HEEL_BEHIND * s - ANKLE_Y * c, TOE_AHEAD * s - ANKLE_Y * c);
}

/** How a stance rolls the foot (`FootRoll` of a speed): the toes-up pitch (rad) at touchdown, the share of the stance the heel has come down by (the sole is flat from it), the share the heel starts rising at, and the toes-down pitch (rad) at toe-off. */
export type FootRoll = { strike: number; flatFrom: number; heelUp: number; toeOff: number };

/** The foot's toes-up pitch (rad) `u` (0 to 1) of the way through its stance: heel down onto the sole, flat, then the heel rising ever faster onto the toe. */
export function stancePitch(u: number, roll: FootRoll): number {
  if (u < roll.flatFrom) return roll.strike * (1 - smoothstep(u / roll.flatFrom));
  if (u < roll.heelUp) return 0;
  const t = (u - roll.heelUp) / (1 - roll.heelUp);
  return -roll.toeOff * t * t;
}

/** The share of the swing the toes are level by, and the share the foot starts reaching for its landing pitch at. */
const TOES_UP_BY = 0.35;
const REACH_FROM = 0.4;

/** The foot's toes-up pitch (rad) `s` (0 to 1) of the way through its swing, from `lifted` at toe-off to `strike` at touchdown: the toes come up first (so they clear the ground the heel left), then the foot reaches for its landing. */
export function swingPitch(s: number, lifted: number, strike: number): number {
  return lifted * (1 - smoothstep(s / TOES_UP_BY)) + strike * smoothstep((s - REACH_FROM) / (1 - REACH_FROM));
}
