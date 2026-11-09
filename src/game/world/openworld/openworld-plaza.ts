import { detCos, detSin } from "../../kernel/physics-core.js";
import type { Brick } from "../landmarks.ts";
import { PARK } from "./openworld-constants.ts";

/**
 * The park's round plaza at its middle (Rittenhouse Square's): a low curved stone bench (its seat ring and a taller back ring behind it) round a paved circle, open where
 * the four paths come in, and a small bronze animal on a stone plinth in one quarter, off the paths. Bricks (`landmarks.ts`): what is drawn is exactly what a car meets.
 */
const PLAZA = {
  /** Middle of the seat ring (m from the plaza's middle), its thickness and the seat's height. */
  seatRadius: 6,
  seatThickness: 0.5,
  seatHeight: 0.45,
  /** The back ring just outside the seat, thinner and up to a back's height. */
  backThickness: 0.25,
  backHeight: 0.85,
  /** Segments a quarter's arc is cut into: 10 degrees each. */
  segmentsPerArc: 6,
  /** The opening each path comes in through: its width and a walker's shoulder room each side (m). */
  opening: PARK.pathWidth + 0.8,
  /** The statue: its plinth (half side, height), where it stands (m from the middle, at 45 degrees between two paths) and its bronze dog's size. */
  plinthHalf: 0.45,
  plinthHeight: 0.9,
  statueRadius: 4.2,
} as const;

/** Each segment's plan reaches this much (m) past its share of the arc, so neighbours close at the ring's outer edge. */
const SEGMENT_OVERLAP = 0.03;

/** The bronze dog's head top over its plinth (m). */
const DOG_HEIGHT = 0.5;
/** The plaza's highest point: the dog's head. */
export const PLAZA_TOP = PLAZA.plinthHeight + DOG_HEIGHT;

/** The ring's paved circle reaches to the back ring's outer face. */
export const PLAZA_RADIUS = PLAZA.seatRadius + PLAZA.seatThickness / 2 + PLAZA.backThickness;

/** One ring of `thickness` at `radius` to `height`: per quarter, segments between two openings on the axes. */
function ring(radius: number, thickness: number, y0: number, height: number): Brick[] {
  const gap = PLAZA.opening / radius;
  const arc = Math.PI / 2 - gap;
  const step = arc / PLAZA.segmentsPerArc;
  const bricks: Brick[] = [];
  for (let quarter = 0; quarter < 4; quarter++) {
    for (let segment = 0; segment < PLAZA.segmentsPerArc; segment++) {
      const angle = (quarter * Math.PI) / 2 + gap / 2 + (segment + 0.5) * step;
      // The brick's local x runs out from the middle (yaw turns local x to (cos yaw, -sin yaw)), its local z along the arc.
      bricks.push({ hx: thickness / 2, hz: radius * detSin(step / 2) + SEGMENT_OVERLAP, x: radius * detCos(angle), z: -radius * detSin(angle), y0, y1: height, yaw: angle, stone: true });
    }
  }
  return bricks;
}

/** The bronze dog (m): its body's half width and half length and height, its head's half side and its offset ahead, its muzzle and its tail's half sizes. */
const DOG = { bodyHalf: 0.12, bodyHalfLength: 0.18, bodyHeight: 0.32, headHalf: 0.1, headAhead: 0.14, muzzleHalf: 0.045, tailHalf: 0.04, tailBehind: 0.2, tailHeight: 0.1 } as const;

/** A seated dog in bronze on a stone plinth at `x`, `z`, looking toward -z. */
function statue(x: number, z: number): Brick[] {
  const top = PLAZA.plinthHeight;
  const half = PLAZA.plinthHalf;
  return [
    { hx: half, hz: half, x, z, y0: 0, y1: top, stone: true },
    { hx: DOG.bodyHalf, hz: DOG.bodyHalfLength, x, z, y0: top, y1: top + DOG.bodyHeight },
    { hx: DOG.headHalf, hz: DOG.headHalf, x, z: z - DOG.headAhead, y0: top + DOG.bodyHeight - 0.02, y1: top + DOG_HEIGHT },
    { hx: DOG.muzzleHalf, hz: DOG.muzzleHalf, x, z: z - DOG.headAhead - DOG.headHalf, y0: top + DOG.bodyHeight + 0.04, y1: top + DOG.bodyHeight + 0.12 },
    { hx: DOG.tailHalf, hz: DOG.tailHalf, x, z: z + DOG.tailBehind, y0: top, y1: top + DOG.tailHeight },
  ];
}

/** The plaza's bricks: the seat ring, the back ring and the statue. */
export function plazaBricks(): Brick[] {
  const diagonal = Math.SQRT1_2 * PLAZA.statueRadius;
  return [
    ...ring(PLAZA.seatRadius, PLAZA.seatThickness, 0, PLAZA.seatHeight),
    ...ring(PLAZA.seatRadius + (PLAZA.seatThickness + PLAZA.backThickness) / 2, PLAZA.backThickness, 0, PLAZA.backHeight),
    ...statue(diagonal, -diagonal),
  ];
}

/** How far (m) the farthest corner of a plaza brick stands from the middle along x or z: the half side of the prefab's box, and its clearance. */
export const PLAZA_REACH = Math.max(
  ...plazaBricks().flatMap((brick) => {
    const cos = detCos(brick.yaw ?? 0);
    const sin = detSin(brick.yaw ?? 0);
    const reach: number[] = [];
    for (const u of [-brick.hx, brick.hx]) for (const v of [-brick.hz, brick.hz]) reach.push(Math.abs(brick.x + u * cos + v * sin), Math.abs(brick.z - u * sin + v * cos));
    return reach;
  }),
);
