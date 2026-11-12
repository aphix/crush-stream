import * as THREE from "three";
import { ARM, CHANNEL, LEG, armChannel, legChannel } from "./civilian-anim-channels.ts";
import { POSE_FOOT_FOLLOW } from "./civilian-art-constants.ts";
import { ANKLE_Y, JOINTS, PARTS, SHOULDER_Y } from "./ragdoll-body.ts";

/** What the rig's parts are posed on: a `DummyMesh`, or anything that takes a part's centre and rotation. */
export type PoseSink = { pose(slot: number, part: number, position: THREE.Vector3, rotation: THREE.Quaternion): void };

const TORSO_PART = 0;
const HEAD_PART = 1;
const NO_PART = -1;
const NECK_JOINT = JOINTS[0];
const SHOULDER_JOINT = JOINTS[1];
const ELBOW_JOINT = JOINTS[2];
const HIP_JOINT = JOINTS[5];
const KNEE_JOINT = JOINTS[6];
const ANKLE_JOINT = JOINTS[9];
/** Body parts (`PARTS`) by limb, the -x side first. */
const ARM_PARTS = { upper: [2, 4], lower: [3, 5] } as const;
const LEG_PARTS = { upper: [6, 8], lower: [7, 9], foot: [10, 11] } as const;
const FOREARM_PART = PARTS[ARM_PARTS.lower[0]];
/** The drawn hand hangs this far (m) past the forearm box's end. */
const HAND_PAST_FOREARM_BOX = 0.18;

export const HIP_Y = HIP_JOINT[3];
/** How far (m) each hip joint is from the middle line. */
export const HIP_X = Math.abs(HIP_JOINT[2]);
export const SHOULDER_X = Math.abs(SHOULDER_JOINT[2]);
export const THIGH_LENGTH = HIP_JOINT[3] - KNEE_JOINT[3];
export const SHIN_LENGTH = KNEE_JOINT[3] - ANKLE_Y;
export const UPPER_ARM_LENGTH = SHOULDER_Y - ELBOW_JOINT[3];
/** Elbow to fingertip (m). */
export const FOREARM_LENGTH = ELBOW_JOINT[3] - (FOREARM_PART.c[1] - FOREARM_PART.h[1]) + HAND_PAST_FOREARM_BOX;

/** One limb standing: where its joints and its parts' centres are (m, as `People` poses them). */
type LimbGeometry = {
  upperPart: number;
  lowerPart: number;
  footPart: number;
  joint: THREE.Vector3;
  upperFromJoint: THREE.Vector3;
  midFromJoint: THREE.Vector3;
  lowerFromMid: THREE.Vector3;
  ankleFromMid: THREE.Vector3;
  footFromAnkle: THREE.Vector3;
};

const jointPoint = (row: readonly number[], sign: number): THREE.Vector3 => new THREE.Vector3(sign * Math.abs(row[2]!), row[3], row[4]);
const partCentre = (part: number): THREE.Vector3 => new THREE.Vector3(PARTS[part]!.c[0], PARTS[part]!.c[1], PARTS[part]!.c[2]);

function makeLimb(side: number, isArm: boolean): LimbGeometry {
  const sign = side * 2 - 1;
  const top = jointPoint(isArm ? SHOULDER_JOINT : HIP_JOINT, sign);
  const mid = jointPoint(isArm ? ELBOW_JOINT : KNEE_JOINT, sign);
  const ankle = jointPoint(ANKLE_JOINT, sign);
  const parts = isArm ? ARM_PARTS : LEG_PARTS;
  const footPart = isArm ? NO_PART : LEG_PARTS.foot[side]!;
  return {
    upperPart: parts.upper[side]!,
    lowerPart: parts.lower[side]!,
    footPart,
    joint: top,
    upperFromJoint: partCentre(parts.upper[side]!).sub(top),
    midFromJoint: mid.clone().sub(top),
    lowerFromMid: partCentre(parts.lower[side]!).sub(mid),
    ankleFromMid: ankle.clone().sub(mid),
    footFromAnkle: footPart === NO_PART ? new THREE.Vector3() : partCentre(footPart).sub(ankle),
  };
}

const ARMS = [makeLimb(0, true), makeLimb(1, true)] as const;
const LEGS = [makeLimb(0, false), makeLimb(1, false)] as const;
const TORSO_CENTRE = partCentre(TORSO_PART);
const HEAD_CENTRE = partCentre(HEAD_PART);
const NECK = jointPoint(NECK_JOINT, 1);
/** The torso leans and twists about the hips' height on the middle line. */
const WAIST = new THREE.Vector3(0, HIP_Y, 0);

const turn = new THREE.Quaternion();
const root = new THREE.Vector3();
const bodyShift = new THREE.Vector3();
const offset = new THREE.Vector3();
const torso = new THREE.Quaternion();
const headTurn = new THREE.Quaternion();
const headRotation = new THREE.Quaternion();
const upperRotation = new THREE.Quaternion();
const lowerRotation = new THREE.Quaternion();
const upperWorld = new THREE.Quaternion();
const lowerWorld = new THREE.Quaternion();
const footRotation = new THREE.Quaternion();
const step = new THREE.Quaternion();
const anchor = new THREE.Vector3();
const midPoint = new THREE.Vector3();
const ankle = new THREE.Vector3();
const neckPoint = new THREE.Vector3();
const centre = new THREE.Vector3();
const worldCentre = new THREE.Vector3();
const worldRotation = new THREE.Quaternion();

/**
 * The turns below read their angle from `source[at]`, not from an argument: a double passed to a call that is not inlined is boxed on the heap, and forty dummies a frame must allocate nothing.
 * `computed` is where an angle made on the way (the yaw and the body's turn, a foot's follow, a roll's sign) waits.
 */
const computed = new Float64Array(1);

function setAboutX(into: THREE.Quaternion, source: Float64Array, at: number): void {
  const half = source[at]! * 0.5;
  into.set(Math.sin(half), 0, 0, Math.cos(half));
}

function setAboutY(into: THREE.Quaternion, source: Float64Array, at: number): void {
  const half = source[at]! * 0.5;
  into.set(0, Math.sin(half), 0, Math.cos(half));
}

function setAboutZ(into: THREE.Quaternion, source: Float64Array, at: number): void {
  const half = source[at]! * 0.5;
  into.set(0, 0, Math.sin(half), Math.cos(half));
}

/** `into` = the torso's turn: a twist about the vertical over a lean forward over a lean toward +x. */
export function setTorsoRotation(channels: Float64Array, into: THREE.Quaternion): void {
  setAboutY(into, channels, CHANNEL.torsoTwist);
  setAboutX(step, channels, CHANNEL.torsoPitch);
  into.multiply(step);
  computed[0] = -channels[CHANNEL.torsoRoll]!;
  setAboutZ(step, computed, 0);
  into.multiply(step);
}

/** Part `part` of slot `slot` with its centre at body-frame `local`, turned `rotation` in the body frame, carried to where the civilian stands and faces. */
function placePart(sink: PoseSink, slot: number, part: number, local: THREE.Vector3, rotation: THREE.Quaternion): void {
  worldCentre.copy(local).applyQuaternion(turn).add(root);
  worldRotation.multiplyQuaternions(turn, rotation);
  sink.pose(slot, part, worldCentre, worldRotation);
}

/** `into` = a limb's turn in its parent's frame: a sweep about the vertical over an outward hang over a swing about x over a twist about its own length. */
function setLimbRotation(into: THREE.Quaternion, channels: Float64Array, first: number, isArm: boolean): void {
  if (isArm) setAboutY(into, channels, first + ARM.sweep);
  else into.identity();
  setAboutZ(step, channels, first + (isArm ? ARM.out : LEG.out));
  into.multiply(step);
  setAboutX(step, channels, first + (isArm ? ARM.swing : LEG.swing));
  into.multiply(step);
  if (isArm) {
    setAboutY(step, channels, first + ARM.twist);
    into.multiply(step);
  }
  setAboutX(step, channels, first + (isArm ? ARM.elbow : LEG.knee));
  lowerRotation.copy(into).multiply(step);
}

function renderArm(sink: PoseSink, slot: number, channels: Float64Array, side: number): void {
  const limb = ARMS[side]!;
  setLimbRotation(upperRotation, channels, armChannel(side, 0), true);
  upperWorld.multiplyQuaternions(torso, upperRotation);
  lowerWorld.multiplyQuaternions(torso, lowerRotation);
  anchor.copy(limb.joint).sub(WAIST).applyQuaternion(torso).add(WAIST).add(offset);
  centre.copy(limb.upperFromJoint).applyQuaternion(upperWorld).add(anchor);
  placePart(sink, slot, limb.upperPart, centre, upperWorld);
  midPoint.copy(limb.midFromJoint).applyQuaternion(upperWorld).add(anchor);
  centre.copy(limb.lowerFromMid).applyQuaternion(lowerWorld).add(midPoint);
  placePart(sink, slot, limb.lowerPart, centre, lowerWorld);
}

function renderLeg(sink: PoseSink, slot: number, channels: Float64Array, side: number): void {
  const limb = LEGS[side]!;
  const first = legChannel(side, 0);
  setLimbRotation(upperRotation, channels, first, false);
  anchor.copy(limb.joint).add(offset);
  centre.copy(limb.upperFromJoint).applyQuaternion(upperRotation).add(anchor);
  placePart(sink, slot, limb.upperPart, centre, upperRotation);
  midPoint.copy(limb.midFromJoint).applyQuaternion(upperRotation).add(anchor);
  centre.copy(limb.lowerFromMid).applyQuaternion(lowerRotation).add(midPoint);
  placePart(sink, slot, limb.lowerPart, centre, lowerRotation);
  ankle.copy(limb.ankleFromMid).applyQuaternion(lowerRotation).add(midPoint);
  computed[0] = (1 - channels[CHANNEL.plant]!) * POSE_FOOT_FOLLOW * (channels[first + LEG.swing]! + channels[first + LEG.knee]!);
  setAboutZ(footRotation, channels, first + LEG.out);
  setAboutX(step, computed, 0);
  footRotation.multiply(step);
  centre.copy(limb.footFromAnkle).applyQuaternion(footRotation).add(ankle);
  placePart(sink, slot, limb.footPart, centre, footRotation);
}

/** Where a civilian stands and which way she faces (rad, about the vertical). */
type Placement = { x: number; y: number; z: number; yaw: number };

/** Slot `slot` of `sink` posed from `channels` (`CHANNEL`, `ARM`, `LEG`: body-frame values, each side's own) standing as `at` says. Allocates nothing. */
export function renderRig(sink: PoseSink, slot: number, at: Placement, channels: Float64Array): void {
  computed[0] = at.yaw;
  setAboutY(turn, computed, 0);
  root.set(at.x, at.y, at.z);
  bodyShift.set(channels[CHANNEL.shiftSide]!, 0, channels[CHANNEL.shiftForward]!).applyQuaternion(turn);
  root.add(bodyShift);
  computed[0] = at.yaw + channels[CHANNEL.bodyYaw]!;
  setAboutY(turn, computed, 0);
  offset.set(channels[CHANNEL.pelvisSide]!, -channels[CHANNEL.pelvisDrop]!, channels[CHANNEL.pelvisForward]!);
  setTorsoRotation(channels, torso);
  centre.copy(TORSO_CENTRE).sub(WAIST).applyQuaternion(torso).add(WAIST).add(offset);
  placePart(sink, slot, TORSO_PART, centre, torso);
  setAboutY(headTurn, channels, CHANNEL.headYaw);
  setAboutX(step, channels, CHANNEL.headPitch);
  headTurn.multiply(step);
  headRotation.multiplyQuaternions(torso, headTurn);
  neckPoint.copy(NECK).sub(WAIST).applyQuaternion(torso).add(WAIST).add(offset);
  centre.copy(HEAD_CENTRE).sub(NECK).applyQuaternion(headRotation).add(neckPoint);
  placePart(sink, slot, HEAD_PART, centre, headRotation);
  for (let side = 0; side < 2; side++) {
    renderArm(sink, slot, channels, side);
    renderLeg(sink, slot, channels, side);
  }
}
