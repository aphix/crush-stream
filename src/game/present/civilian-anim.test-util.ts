import * as THREE from "three";
import { ACTIVITY, ACTIVITY_OPEN_ENDED, ACTIVITY_SECONDS, type ActivityName } from "../ai/civilians/civilian-activity.ts";
import { neuroticismOf } from "../ai/civilians/civilian-temperament.ts";
import { type ActivityPose, poseActivity } from "./civilian-anim.ts";
import type { PoseSmoothing } from "./civilian-anim-smoothing.ts";
import { FOREARM_LENGTH, type PoseSink } from "./civilian-anim-rig.ts";
import { PARTS } from "./ragdoll-body.ts";

/** Every part's centre and rotation as the rig posed it, in the frame she stands in (at the origin facing +z unless the pose says otherwise). */
export type Capture = PoseSink & { centres: THREE.Vector3[]; turns: THREE.Quaternion[] };

export function newCapture(): Capture {
  const centres = Array.from({ length: PARTS.length }, () => new THREE.Vector3());
  const turns = Array.from({ length: PARTS.length }, () => new THREE.Quaternion());
  return {
    centres,
    turns,
    pose(_slot, part, position, rotation) {
      centres[part]!.copy(position);
      turns[part]!.copy(rotation);
    },
  };
}

export const TORSO = 0;
export const HEAD = 1;
export const UPPER_ARM = [2, 4] as const;
export const FOREARM = [3, 5] as const;
export const THIGH = [6, 8] as const;
export const SHIN = [7, 9] as const;
export const FOOT = [10, 11] as const;
export const MINUS_X = 0;
export const PLUS_X = 1;
export const TIGHT = 1e-6;

export const STANDING: ActivityPose = { x: 0, y: 0, z: 0, yaw: 0, stride: 0, speed: 0, activity: ACTIVITY.none, clock: 0, left: ACTIVITY_OPEN_ENDED, surface: 0, hasPartner: false, bearing: 0, variant: 0, nerve: neuroticismOf(0) };
export const WALKING = { stride: 1.3, speed: 1.2 } as const;

/** A pose from `STANDING` with `changes`; variant 0 is right-handed (her main side is +x), starts loops at their beginning and has no pace or amplitude of her own. */
export const posed = (changes: Partial<ActivityPose>, smoothing?: PoseSmoothing, civilian = 0): Capture => {
  const body = newCapture();
  const variant = changes.variant ?? STANDING.variant;
  poseActivity(body, 0, { ...STANDING, nerve: neuroticismOf(variant), ...changes }, smoothing, civilian);
  return body;
};

/** Clip `name` at `clock` seconds with the time left in it a finite clip has. */
export const clipAt = (name: ActivityName, clock: number, changes: Partial<ActivityPose> = {}): Capture => {
  const seconds = ACTIVITY_SECONDS[name];
  return posed({ activity: ACTIVITY[name], clock, left: seconds > 0 ? seconds - clock : ACTIVITY_OPEN_ENDED, ...changes });
};

export const pointOn = (body: Capture, part: number, local: THREE.Vector3): THREE.Vector3 => local.applyQuaternion(body.turns[part]!).add(body.centres[part]!);
export const handTip = (body: Capture, side: number): THREE.Vector3 => pointOn(body, FOREARM[side]!, new THREE.Vector3(0, -(FOREARM_LENGTH - PARTS[3].h[1]), 0));
export const elbow = (body: Capture, side: number): THREE.Vector3 => pointOn(body, FOREARM[side]!, new THREE.Vector3(0, PARTS[3].h[1], 0));
export const hip = (body: Capture, side: number): THREE.Vector3 => pointOn(body, THIGH[side]!, new THREE.Vector3(0, PARTS[6].h[1], 0));
export const ankle = (body: Capture, side: number): THREE.Vector3 => pointOn(body, SHIN[side]!, new THREE.Vector3(0, -PARTS[7].h[1], 0));
/** Where part `part`'s front (+z) and up (+y) point. */
export const facing = (body: Capture, part: number): THREE.Vector3 => new THREE.Vector3(0, 0, 1).applyQuaternion(body.turns[part]!);
export const leaning = (body: Capture, part: number): THREE.Vector3 => new THREE.Vector3(0, 1, 0).applyQuaternion(body.turns[part]!);

const EVERY_PART = PARTS.map((_, part) => part);

/** The largest a part's centre and rotation (rad) differ between two poses, over `parts` (every part by default). */
export function gap(a: Capture, b: Capture, parts: readonly number[] = EVERY_PART): { distance: number; angle: number } {
  let distance = 0;
  let angle = 0;
  for (const part of parts) {
    distance = Math.max(distance, a.centres[part]!.distanceTo(b.centres[part]!));
    angle = Math.max(angle, a.turns[part]!.angleTo(b.turns[part]!));
  }
  return { distance, angle };
}
