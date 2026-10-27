import { GAIT } from "./walker-gait.ts";

/** `RawJointAxis` of the angular axes. */
export const ANG = [3, 4, 5] as const;
/** `RawJointAxis` of the linear axes: the frame holds the torso's place through them. */
export const LIN = [0, 1, 2] as const;
/** `RawMotorModel.ForceBased`: stiffness in N·m/rad (N/m), damping in N·m·s/rad (N·s/m), so a motor's pull does not depend on the mass it moves. */
export const FORCE_BASED = 1;

/** `JOINTS` order. */
const NECK = 0;
const SHOULDER_L = 1;
const ELBOW_L = 2;
const SHOULDER_R = 3;
const ELBOW_R = 4;
export const HIP_L = 5;
const KNEE_L = 6;
export const HIP_R = 7;
const KNEE_R = 8;

/** The hips must swing far past the thrown dummy's limits to walk and to kneel: thigh swing (rad) forward and back, and the thigh roll's inward and outward range. */
export const HIP_FORWARD = -1.75;
export const HIP_BACK = 0.8;
export const ROLL_IN = 0.2;
export const ROLL_OUT = 0.5;

/** Motors may never be set to zero stiffness and zero damping (the solver locks the axis): the weakest setting. */
export const MOTOR_FLOOR = 1;

/**
 * The balance: torque (N·m/rad) and damping (N·m·s/rad) of the gimbal's angular motors, in the get-up and on his feet. A 40 N·m·s twist topples a body without
 * them; on his feet the legs' swing reaction (2000 N·m at a sprint) must not tilt the torso (it would move every foot), so they are far stiffer.
 */
export const GETUP_GIMBAL = { stiffness: 3000, damping: 600 } as const;
export const STAND_GIMBAL = { stiffness: 60000, damping: 1000 } as const;
/** The frame holds the torso's centre through the gimbal's linear motors on his feet (N/m, N·s/m): 30 kN/m sags a 100 kg body 3 cm, and the weight and push are fed forward. */
export const HOLD = { stiffness: 30000, damping: 3000 } as const;

/** One motor row: joint, angular axis, the target it chases (a `GAIT` index, -1: upright, 0), its stiffness and damping in the get-up and on his feet at full strength, and whether the get-up's grip multiplies it. */
type MotorRow = { joint: number; axis: number; target: number; stiffness: number; damping: number; walkStiffness: number; walkDamping: number; arm: boolean };

const LEG_GETUP = 900;
const LEG_WALK = 16000;
/** Damped under 0.03 s in the get-up (a stepping leg is not late); on his feet a damping ratio of 0.8 (2 sqrt(k I), I about 4.4 kg m² for a swinging leg), so the leg follows its target without ringing. */
const LEG_GETUP_DAMPING = LEG_GETUP * 0.03;
const LEG_WALK_DAMPING = 450;
const ARM_STIFFNESS = 40;
const ARM_DAMPING = 8;
const ELBOW_STIFFNESS = 20;
const ELBOW_DAMPING = 4;
const NECK_STIFFNESS = 60;
const NECK_DAMPING = 10;
/** On his feet the arms and head follow a little firmer but still lag the torso: loose, not limp. */
const ARM_WALK = { stiffness: 120, damping: 12 } as const;
const ELBOW_WALK = { stiffness: 90, damping: 9 } as const;
const NECK_WALK = { stiffness: 160, damping: 14 } as const;

function leg(joint: number, axis: number, target: number): MotorRow {
  return { joint, axis, target, stiffness: LEG_GETUP, damping: LEG_GETUP_DAMPING, walkStiffness: LEG_WALK, walkDamping: LEG_WALK_DAMPING, arm: false };
}

function arm(joint: number, axis: number, target: number): MotorRow {
  return { joint, axis, target, stiffness: ARM_STIFFNESS, damping: ARM_DAMPING, walkStiffness: ARM_WALK.stiffness, walkDamping: ARM_WALK.damping, arm: true };
}

function elbow(joint: number, target: number): MotorRow {
  return { joint, axis: ANG[0], target, stiffness: ELBOW_STIFFNESS, damping: ELBOW_DAMPING, walkStiffness: ELBOW_WALK.stiffness, walkDamping: ELBOW_WALK.damping, arm: true };
}

function neck(axis: number, target: number): MotorRow {
  return { joint: NECK, axis, target, stiffness: NECK_STIFFNESS, damping: NECK_DAMPING, walkStiffness: NECK_WALK.stiffness, walkDamping: NECK_WALK.damping, arm: false };
}

export const MOTORS: readonly MotorRow[] = [
  leg(HIP_L, ANG[0], GAIT.HIP_L),
  leg(HIP_L, ANG[1], -1),
  leg(HIP_L, ANG[2], GAIT.ROLL_L),
  leg(HIP_R, ANG[0], GAIT.HIP_R),
  leg(HIP_R, ANG[1], -1),
  leg(HIP_R, ANG[2], GAIT.ROLL_R),
  leg(KNEE_L, ANG[0], GAIT.KNEE_L),
  leg(KNEE_R, ANG[0], GAIT.KNEE_R),
  arm(SHOULDER_L, ANG[0], GAIT.ARM_L),
  arm(SHOULDER_L, ANG[1], -1),
  arm(SHOULDER_L, ANG[2], -1),
  arm(SHOULDER_R, ANG[0], GAIT.ARM_R),
  arm(SHOULDER_R, ANG[1], -1),
  arm(SHOULDER_R, ANG[2], -1),
  elbow(ELBOW_L, GAIT.ELBOW_L),
  elbow(ELBOW_R, GAIT.ELBOW_R),
  neck(ANG[0], GAIT.NECK_NOD),
  neck(ANG[1], GAIT.NECK_TURN),
  neck(ANG[2], -1),
];
