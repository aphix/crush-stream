import { BODY_VERTICES } from "./dummy-bodies.ts";
import { RIG_NECK_Y } from "./dummy-fit.ts";
import type { Fit } from "./dummy-rig.ts";

/** A fitted body's head, measured: chin, crown and rings, and where the face, the hairline and a cap's rim sit on it. */

/** The head of a fitted body: chin and crown heights and, from the chin up, rings (y, half width in x, half depth, z of the middle) over the vertices that ride the head bone alone. */
export type Head = { chin: number; top: number; rings: readonly (readonly [number, number, number, number])[] };
/** A face front is at least this far (m) in front of the neck's: the chin is the first height above the neck's joint whose centre line reaches it. */
const JAW_FRONT_Z = 0.07;
const CHIN_SEARCH_STEP = 0.005;
/** The centre line the chin is looked for on is this wide (m, half), and the head's rings are this far (m) apart and thick (half). */
const CENTRE_HALF_WIDTH = 0.03;
const HEAD_RING_STEP = 0.015;
const HEAD_RING_BAND = 0.0075;

export function measureHead(fit: Fit): Head {
  const isHead = (i: number) => fit.neckWeight[i] === 1;
  let top = 0;
  for (let i = 0; i < BODY_VERTICES; i++) if (isHead(i)) top = Math.max(top, fit.rest[i * 3 + 1]!);
  let chin = 0;
  for (let y = RIG_NECK_Y; y < top && chin === 0; y += CHIN_SEARCH_STEP) {
    for (let i = 0; i < BODY_VERTICES; i++) {
      if (isHead(i) && Math.abs(fit.rest[i * 3]!) < CENTRE_HALF_WIDTH && Math.abs(fit.rest[i * 3 + 1]! - y) < HEAD_RING_BAND && fit.rest[i * 3 + 2]! > JAW_FRONT_Z) chin = y;
    }
  }
  const rings: [number, number, number, number][] = [];
  for (let y = chin; y < top; y += HEAD_RING_STEP) {
    let [halfWidth, back, front] = [0, Infinity, -Infinity];
    for (let i = 0; i < BODY_VERTICES; i++) {
      if (!isHead(i) || Math.abs(fit.rest[i * 3 + 1]! - y) > HEAD_RING_BAND) continue;
      halfWidth = Math.max(halfWidth, Math.abs(fit.rest[i * 3]!));
      back = Math.min(back, fit.rest[i * 3 + 2]!);
      front = Math.max(front, fit.rest[i * 3 + 2]!);
    }
    if (back > front) rings.push(rings[rings.length - 1]!);
    else rings.push([y, halfWidth, (front - back) / 2, (front + back) / 2]);
  }
  return { chin, top, rings };
}

/** The head's half width, half depth and middle z at height `y`, between its rings. */
export function headAt(head: Head, y: number): readonly [number, number, number] {
  const rings = head.rings;
  if (y <= rings[0]![0]) return [rings[0]![1], rings[0]![2], rings[0]![3]];
  for (let i = 0; i + 1 < rings.length; i++) {
    const [low, high] = [rings[i]!, rings[i + 1]!];
    if (y > high[0]) continue;
    const t = (y - low[0]) / (high[0] - low[0]);
    return [low[1] + t * (high[1] - low[1]), low[2] + t * (high[2] - low[2]), low[3] + t * (high[3] - low[3])];
  }
  const last = rings[rings.length - 1]!;
  return [last[1], last[2], last[3]];
}

/** The cap's rim sits at this fraction of the head's height above the chin: just over the brows. */
export const RIM_AT = 0.74;

/**
 * Where the eyes and the upper lip sit above the chin, as a fraction of the head's height (an adult face: eyes about half way
 * up, the lip a quarter). The face atlas's eye row (v = 0.61) lands on the eyes: its v runs from the chin up over `FACE_SPAN` of
 * the head's height, its u over `FACE_HALF_WIDTH` m either side of the middle (the atlas's eyes are 0.15 of u off centre:
 * 0.035 m, 0.07 m between the pupils on a head 0.16 m across).
 */
export const EYES_AT = 0.54;
export const LIP_AT = 0.26;
export const FACE_SPAN = 0.885;
export const FACE_HALF_WIDTH = 0.117;
/** A head vertex's (z - middle) / half depth: the face print fades in from `FACE_FRONT_FROM` to whole at `FACE_FRONT_TO`. */
export const FACE_FRONT_FROM = 0.15;
export const FACE_FRONT_TO = 0.45;
/** The hairline's height as a fraction of the head's height above the chin at the forehead and behind the ears; the scalp above it is hair. */
export const HAIRLINE_FRONT = 0.8;
export const HAIRLINE_BACK = 0.3;
/** The hairline is the back's behind this (z - middle) / half depth and the forehead's past `HAIRLINE_FRONT_AT`. */
export const HAIRLINE_BACK_AT = -0.2;
export const HAIRLINE_FRONT_AT = 0.8;
