import * as THREE from "three";
import type { CrowdPoses } from "../ai/civilians/crowd-poses.ts";
import { FEET_Y, POSE_ARM_OUT, POSE_FOOT_FOLLOW } from "./civilian-art-constants.ts";
import { blankStance, walkStance, type Stance } from "./people.ts";
import { JOINTS, PARTS } from "./ragdoll-body.ts";
import type { DummyMesh } from "./ragdoll-mesh.ts";

const TORSO_PART = 0;
const HEAD_PART = 1;
const NO_PART = -1;
const ARM_JOINTS = { top: JOINTS[1], mid: JOINTS[2] } as const;
const LEG_JOINTS = { top: JOINTS[5], mid: JOINTS[6] } as const;
const ANKLE_JOINT = JOINTS[9];
/** Body parts (`PARTS`) by limb, the -x side first. */
const ARM_PARTS = { upper: [2, 4], lower: [3, 5] } as const;
const LEG_PARTS = { upper: [6, 8], lower: [7, 9], foot: [10, 11] } as const;
const WALK_AT_FORWARD = Math.PI / 2;
const WALK_AT_BACK = -Math.PI / 2;
const WALK_AT_REST = 0;
/** Slots of `angles`: the upper part's swing, the lower part's (swing plus bend), the foot's tip (rad). */
const UPPER_ANGLE = 0;
const LOWER_ANGLE = 1;
const FOOT_ANGLE = 2;
/** Slots of `gait`: the stride's sine, and 1 when the civilian walks, 0 when she stands. */
const SINE = 0;
const WALKING = 1;

/** One limb of the walking dummy: where its joints and part centres stand (m, relative as `People` poses them) and how its angles follow the stride's sine, taken from `walkStance` itself. */
type Limb = {
  upperPart: number;
  lowerPart: number;
  footPart: number;
  joint: THREE.Vector3;
  upperFromJoint: THREE.Vector3;
  midFromJoint: THREE.Vector3;
  lowerFromMid: THREE.Vector3;
  ankleFromMid: THREE.Vector3;
  footFromAnkle: THREE.Vector3;
  outSine: number;
  outCosine: number;
  swing: number;
  bendAtRest: number;
  bendForward: number;
  bendBack: number;
};

const jointPoint = (row: readonly number[], sign: number): THREE.Vector3 => new THREE.Vector3(sign * Math.abs(row[2]!), row[3], row[4]);
const partCentre = (part: number): THREE.Vector3 => new THREE.Vector3(PARTS[part]!.c[0], PARTS[part]!.c[1], PARTS[part]!.c[2]);

/** A limb on `side` (0: the -x one): an arm, or a leg with its foot. */
function makeLimb(side: number, isArm: boolean, forward: Stance, back: Stance, rest: Stance): Limb {
  const sign = side * 2 - 1;
  const joints = isArm ? ARM_JOINTS : LEG_JOINTS;
  const parts = isArm ? ARM_PARTS : LEG_PARTS;
  const joint = jointPoint(joints.top, sign);
  const midJoint = jointPoint(joints.mid, sign);
  const ankle = jointPoint(ANKLE_JOINT, sign);
  const footPart = isArm ? NO_PART : LEG_PARTS.foot[side]!;
  const angle = (stance: Stance): number => (isArm ? stance.arm[side]! : stance.thigh[side]!);
  const bend = (stance: Stance): number => (isArm ? stance.elbow[side]! : stance.knee[side]!);
  const outAngle = isArm ? sign * POSE_ARM_OUT : 0;
  return {
    upperPart: parts.upper[side]!,
    lowerPart: parts.lower[side]!,
    footPart,
    joint,
    upperFromJoint: partCentre(parts.upper[side]!).sub(joint),
    midFromJoint: midJoint.clone().sub(joint),
    lowerFromMid: partCentre(parts.lower[side]!).sub(midJoint),
    ankleFromMid: ankle.clone().sub(midJoint),
    footFromAnkle: footPart === NO_PART ? new THREE.Vector3() : partCentre(footPart).sub(ankle),
    outSine: Math.sin(outAngle / 2),
    outCosine: Math.cos(outAngle / 2),
    swing: angle(forward),
    bendAtRest: bend(rest),
    bendForward: bend(forward) - bend(rest),
    bendBack: bend(back) - bend(rest),
  };
}

/** The four limbs, the walk's swing and bend read off `walkStance` at its widest each way and at rest, so civilians stride as the guards do. */
const LIMBS: readonly Limb[] = (() => {
  const forward = walkStance(WALK_AT_FORWARD, false, blankStance());
  const back = walkStance(WALK_AT_BACK, false, blankStance());
  const rest = walkStance(WALK_AT_REST, false, blankStance());
  return [false, true].flatMap((isArm) => [0, 1].map((side) => makeLimb(side, isArm, forward, back, rest)));
})();

const TORSO_CENTRE = partCentre(TORSO_PART);
const HEAD_CENTRE = partCentre(HEAD_PART);

const UNTURNED = new THREE.Quaternion();
const turn = new THREE.Quaternion();
const root = new THREE.Vector3();
const gait = new Float64Array(2);
const angles = new Float64Array(3);
const centre = new THREE.Vector3();
const midPoint = new THREE.Vector3();
const ankle = new THREE.Vector3();
const worldCentre = new THREE.Vector3();
const worldRotation = new THREE.Quaternion();
const upperRotation = new THREE.Quaternion();
const lowerRotation = new THREE.Quaternion();
const footRotation = new THREE.Quaternion();

/** `into` = a turn about z by the limb's outward hang, then about x by angle `angleIndex` of `angles`: the limb's own frame. */
function setSwung(into: THREE.Quaternion, limb: Limb, angleIndex: number): void {
  const half = angles[angleIndex]! * 0.5;
  const sine = Math.sin(half);
  const cosine = Math.cos(half);
  into.set(limb.outCosine * sine, limb.outSine * sine, limb.outSine * cosine, limb.outCosine * cosine);
}

/** Part `part` of slot `slot` with its centre at body-frame `local`, turned `rotation` in the body frame, carried to where the civilian stands and faces. */
function placePart(mesh: DummyMesh, slot: number, part: number, local: THREE.Vector3, rotation: THREE.Quaternion): void {
  worldCentre.copy(local).applyQuaternion(turn).add(root);
  worldRotation.multiplyQuaternions(turn, rotation);
  mesh.pose(slot, part, worldCentre, worldRotation);
}

function poseLimb(mesh: DummyMesh, slot: number, limb: Limb): void {
  const sine = gait[SINE]!;
  angles[UPPER_ANGLE] = limb.swing * sine;
  angles[LOWER_ANGLE] = angles[UPPER_ANGLE]! + gait[WALKING]! * (limb.bendAtRest + limb.bendForward * Math.max(0, sine) + limb.bendBack * Math.max(0, -sine));
  angles[FOOT_ANGLE] = POSE_FOOT_FOLLOW * angles[LOWER_ANGLE]!;
  setSwung(upperRotation, limb, UPPER_ANGLE);
  setSwung(lowerRotation, limb, LOWER_ANGLE);
  centre.copy(limb.upperFromJoint).applyQuaternion(upperRotation).add(limb.joint);
  placePart(mesh, slot, limb.upperPart, centre, upperRotation);
  midPoint.copy(limb.midFromJoint).applyQuaternion(upperRotation).add(limb.joint);
  centre.copy(limb.lowerFromMid).applyQuaternion(lowerRotation).add(midPoint);
  placePart(mesh, slot, limb.lowerPart, centre, lowerRotation);
  if (limb.footPart === NO_PART) return;
  ankle.copy(limb.ankleFromMid).applyQuaternion(lowerRotation).add(midPoint);
  setSwung(footRotation, limb, FOOT_ANGLE);
  centre.copy(limb.footFromAnkle).applyQuaternion(footRotation).add(ankle);
  placePart(mesh, slot, limb.footPart, centre, footRotation);
}

/** Slot `slot` of `mesh` posed as civilian `civilian` of `poses` stands: on the ground at her place facing her yaw, striding at her phase when she moves, standing straight when she does not. Allocates nothing. */
export function poseCivilian(mesh: DummyMesh, slot: number, poses: CrowdPoses, civilian: number): void {
  const half = poses.yaw[civilian]! * 0.5;
  turn.set(0, Math.sin(half), 0, Math.cos(half));
  root.set(poses.x[civilian]!, FEET_Y, poses.z[civilian]!);
  const walking = poses.speed[civilian]! > 0;
  gait[SINE] = walking ? Math.sin(poses.stride[civilian]!) : 0;
  gait[WALKING] = walking ? 1 : 0;
  placePart(mesh, slot, TORSO_PART, TORSO_CENTRE, UNTURNED);
  placePart(mesh, slot, HEAD_PART, HEAD_CENTRE, UNTURNED);
  for (let limb = 0; limb < LIMBS.length; limb++) poseLimb(mesh, slot, LIMBS[limb]!);
}
