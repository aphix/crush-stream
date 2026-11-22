import * as THREE from "three";
import { type AnimalShape, LEG_SWING, LIE_FRONT_FOLD, LIE_HIND_FOLD, PART, SIT_HIND_FOLD, sitPitchOf, turnAboutX } from "./animal-figure.ts";

/** The instance's pose: walk phase (rad), gait (0 still to 1 a full walk), sit and lie weights (0-1). */
export type AnimalPose = { phase: number; gait: number; sit: number; lie: number };

/** The angle (rad) a leg turns about its top: its swing (the diagonal pairs opposite, a trot), stilled as the animal rests, plus its fold for sitting and lying; 0 for any other part. */
export function legAngle(part: number, pose: AnimalPose): number {
  if (part < PART.frontLeft) return 0;
  const front = part <= PART.frontRight;
  const diagonal = part === PART.frontLeft || part === PART.hindRight ? 1 : -1;
  const swing = diagonal * pose.gait * LEG_SWING * Math.sin(pose.phase) * (1 - Math.max(pose.sit, pose.lie));
  return swing + (front ? pose.lie * LIE_FRONT_FOLD : pose.sit * SIT_HIND_FOLD + pose.lie * LIE_HIND_FOLD);
}

/** Where the shader puts a vertex at `x, y, z` (the figure's own frame) of `part`, whose leg pivots at (`pivotY`, `pivotZ`), in `pose` for `shape`: into `out`. */
export function animalPoint(x: number, y: number, z: number, part: number, pivotY: number, pivotZ: number, pose: AnimalPose, shape: AnimalShape, out: THREE.Vector3): THREE.Vector3 {
  out.set(x, y, z);
  turnAboutX(out, legAngle(part, pose), pivotY, pivotZ);
  if (part !== PART.frontLeft && part !== PART.frontRight) turnAboutX(out, -pose.sit * sitPitchOf(shape), shape.leg, shape.legZ);
  out.y -= pose.lie * (shape.leg - shape.legHalf);
  return out;
}
