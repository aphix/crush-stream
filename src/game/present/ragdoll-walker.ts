import type { ImpulseJoint, RigidBody, World } from "@dimforge/rapier3d-simd";
import type { Rapier } from "../kernel/rapier.ts";
import { hypot2, hypot3 } from "../kernel/physics-core.js";
import { GRAVITY } from "../kernel/constants.ts";
import { type Doll, PARTS } from "./ragdoll-body.ts";
import { joinUp } from "./ragdoll-joints.ts";
import { chooseRoute, GETUP_ROUTES, type GetUpRoute, smooth, STAGE, stageAt, standingBearing } from "./walker-getup.ts";
import { GAIT, planGait, writeGait } from "./walker-gait.ts";
import { nlerp, pitchedQuaternion, spinBetween, turnToward, uprightness, wrapAngle } from "./walker-math.ts";

/**
 * The player's body on foot: a dummy of the ragdoll pool held up and walked by motors. Every limb is a joint motor chasing a gait
 * (`walker-gait.ts`); the torso hangs off a kinematic frame by a joint whose three angular motors are the balance (a virtual gyro: its
 * reaction goes to the frame, which has no mass), and the frame turns to the heading the player asks for. Nothing pushes him along: the legs walk.
 * A hit that changes his speed by more than he can brace for drops his strength, so he stumbles; past a tilt, or struck by a car (`struck`), he
 * goes limp: a ragdoll. Once the player asks to walk again he funnels into a get-up (`walker-getup.ts`): by how he lies he regrounds, rolls onto his
 * stomach first, or pushes up from his hands and knees; the frame leans his torso through the stages while a bounded lift takes most of his weight and
 * the limb motors, ramped up from limp, reach each stage's pose and push on the ground.
 */

/** `RawJointAxis` of the angular axes. */
const ANG = [3, 4, 5] as const;
/** `RawMotorModel.ForceBased`: stiffness in N·m/rad, damping in N·m·s/rad, so a motor's pull does not depend on the mass it moves. */
const FORCE_BASED = 1;

/** `JOINTS` order. */
const NECK = 0;
const SHOULDER_L = 1;
const ELBOW_L = 2;
const SHOULDER_R = 3;
const ELBOW_R = 4;
const HIP_L = 5;
const KNEE_L = 6;
const HIP_R = 7;
const KNEE_R = 8;

/** Torque (N·m/rad) and damping ratio of the hips and knees: stiff enough to carry the body, damped under 0.03 s so a stepping leg is not late. */
const LEG_STIFFNESS = 900;
const LEG_DAMPING_RATIO = 0.03;
/** The hips must swing far past the thrown dummy's limits to walk and to kneel: thigh swing (rad) forward and back, and the thigh roll's inward and outward range. */
const HIP_FORWARD = -1.75;
const HIP_BACK = 0.8;
const ROLL_IN = 0.2;
const ROLL_OUT = 0.5;

/** The balance: torque (N·m/rad) and damping (N·m·s/rad) of the gimbal's angular motors. Without them a 40 N·m·s twist topples the dummy; with them he takes 320 and straightens. */
const GIMBAL_STIFFNESS = 3000;
const GIMBAL_DAMPING = 600;
/** Motors may never be set to zero stiffness and zero damping (the solver locks the axis): the weakest setting. */
const MOTOR_FLOOR = 1;

/** One motor row: joint, angular axis, the gait target it chases (-1: upright, 0), its stiffness and damping at full strength, and whether the get-up's grip multiplies it. */
type MotorRow = { joint: number; axis: number; target: number; stiffness: number; damping: number; arm: boolean };
const LEG = LEG_STIFFNESS;
const LEG_DAMP = LEG_STIFFNESS * LEG_DAMPING_RATIO;
const ARM_STIFFNESS = 40;
const ARM_DAMPING = 8;
const ELBOW_STIFFNESS = 20;
const ELBOW_DAMPING = 4;
const NECK_STIFFNESS = 60;
const NECK_DAMPING = 10;
const MOTORS: readonly MotorRow[] = [
  { joint: HIP_L, axis: ANG[0], target: GAIT.HIP_L, stiffness: LEG, damping: LEG_DAMP, arm: false },
  { joint: HIP_L, axis: ANG[1], target: -1, stiffness: LEG, damping: LEG_DAMP, arm: false },
  { joint: HIP_L, axis: ANG[2], target: GAIT.ROLL_L, stiffness: LEG, damping: LEG_DAMP, arm: false },
  { joint: HIP_R, axis: ANG[0], target: GAIT.HIP_R, stiffness: LEG, damping: LEG_DAMP, arm: false },
  { joint: HIP_R, axis: ANG[1], target: -1, stiffness: LEG, damping: LEG_DAMP, arm: false },
  { joint: HIP_R, axis: ANG[2], target: GAIT.ROLL_R, stiffness: LEG, damping: LEG_DAMP, arm: false },
  { joint: KNEE_L, axis: ANG[0], target: GAIT.KNEE_L, stiffness: LEG, damping: LEG_DAMP, arm: false },
  { joint: KNEE_R, axis: ANG[0], target: GAIT.KNEE_R, stiffness: LEG, damping: LEG_DAMP, arm: false },
  { joint: SHOULDER_L, axis: ANG[0], target: GAIT.ARM_L, stiffness: ARM_STIFFNESS, damping: ARM_DAMPING, arm: true },
  { joint: SHOULDER_L, axis: ANG[1], target: -1, stiffness: ARM_STIFFNESS, damping: ARM_DAMPING, arm: true },
  { joint: SHOULDER_L, axis: ANG[2], target: -1, stiffness: ARM_STIFFNESS, damping: ARM_DAMPING, arm: true },
  { joint: SHOULDER_R, axis: ANG[0], target: GAIT.ARM_R, stiffness: ARM_STIFFNESS, damping: ARM_DAMPING, arm: true },
  { joint: SHOULDER_R, axis: ANG[1], target: -1, stiffness: ARM_STIFFNESS, damping: ARM_DAMPING, arm: true },
  { joint: SHOULDER_R, axis: ANG[2], target: -1, stiffness: ARM_STIFFNESS, damping: ARM_DAMPING, arm: true },
  { joint: ELBOW_L, axis: ANG[0], target: GAIT.ELBOW_L, stiffness: ELBOW_STIFFNESS, damping: ELBOW_DAMPING, arm: true },
  { joint: ELBOW_R, axis: ANG[0], target: GAIT.ELBOW_R, stiffness: ELBOW_STIFFNESS, damping: ELBOW_DAMPING, arm: true },
  { joint: NECK, axis: ANG[0], target: -1, stiffness: NECK_STIFFNESS, damping: NECK_DAMPING, arm: false },
  { joint: NECK, axis: ANG[1], target: -1, stiffness: NECK_STIFFNESS, damping: NECK_DAMPING, arm: false },
  { joint: NECK, axis: ANG[2], target: -1, stiffness: NECK_STIFFNESS, damping: NECK_DAMPING, arm: false },
];
/** A limp limb keeps this share of its stiffness, so a fallen body is not a puddle. */
const LIMP_LIMB_SHARE = 0.08;

/** Turning rate toward the heading (rad/s), and the error (rad) within which he walks: facing first, then going. */
const TURN_RATE = 4;
const FACE_BEFORE_WALK = 0.8;
/** The stride and cadence ease to their plan at this rate (1/s), so legs start and stop smoothly. */
const GAIT_EASE = 5;
/** Knees stay this bent at a walk, more with speed up to the ceiling (rad). */
const KNEE_BASE_AT_REST = 0.1;
const KNEE_BASE_PER_SPEED = 0.1;
const KNEE_BASE_MAX = 0.4;
/** A stride this wide (rad) bends the knees in full; narrower ones in proportion. */
const KNEE_FULL_STRIDE = 0.2;

/** A frame's change in his speed (m/s) beyond what walking and gravity make is a hit; the strength it costs grows over this span. */
const HIT_SPEED = 1;
const HIT_SPAN = 3;
/** The share of strength a full hit takes, and the seconds strength takes to come back. */
const HIT_DROP = 0.9;
const RECOVER_SECONDS = 0.6;
/** The balance fades as he tips: full up to this tilt cosine (18°) and gone at the other (50°). */
const BALANCE_FULL = 0.95;
const BALANCE_GONE = 0.64;
/** Past this tilt cosine (60°), or this torso height (m), he has fallen. */
const FALL_UPRIGHT = 0.5;
const FALL_HEIGHT = 0.75;
/** The player's control is read as held this many seconds after the last ask (the walk reads it each frame). */
const ASK_HOLD = 0.25;
/** A body lies at least this long (s) after going down, and has been still this long (s), before it gets up on the player's ask. */
const MIN_LIE = 1;
const LIE_STILL = 0.3;
/** The get-up's strength ramp (s): limp to full, so the limbs converge on the pose rather than snap to it. */
const GETUP_RAMP = 0.5;
/** The lift's share of his weight, its stiffness (N/m) and damping (N·s/m) toward the stage's height, and the most it pulls (as weights). */
const LIFT_WEIGHT_SHARE = 0.7;
const LIFT_STIFFNESS = 3000;
const LIFT_DAMPING = 600;
const LIFT_MAX_WEIGHTS = 1.25;
const TOTAL_MASS = PARTS.reduce((sum, p) => sum + 8000 * p.h[0] * p.h[1] * p.h[2], 0);
const WEIGHT = TOTAL_MASS * GRAVITY;
/** Standing again needs this tilt cosine (32°) and torso height (m). */
const STANDING_UPRIGHT = 0.85;
const STANDING_HEIGHT = 0.95;
/** The longest control step (s): a hitch does not turn the motors' targets into a jump. */
const MAX_DT = 0.05;

type WalkState = "stand" | "down" | "getUp";

const _rot = { x: 0, y: 0, z: 0, w: 1 };
const _spin = { x: 0, y: 0, z: 0 };
const _force = { x: 0, y: 0, z: 0 };
const ZERO = { x: 0, y: 0, z: 0 };
const GIMBAL_AXIS = { x: 0, y: 0, z: 1 };
/** No axis of the gimbal is locked: only its motors act on the torso. */
const NO_LOCKED_AXES: number = 0;

export class Walker {
  /** Where he is asked to face (rad about the vertical, 0 along +z) and how fast to go (m/s): the engine sets them each frame. */
  heading = 0;
  command = 0;
  state: WalkState = "stand";
  /** 0 limp to 1 at full strength. */
  strength = 1;
  /** Seconds since a car struck him (`struck`). */
  sinceStruck = Infinity;
  /** The route and stage the get-up is on. */
  route: GetUpRoute = "reground";
  stage = 0;
  private doll: Doll | null = null;
  private world: World | null = null;
  private rapier: Rapier | null = null;
  private anchor: RigidBody | null = null;
  private gimbal: ImpulseJoint | null = null;
  private yaw = 0;
  private phase = 0;
  private stride = 0;
  private cadence = 0;
  private asking = 0;
  private downFor = 0;
  private getUpFor = 0;
  private stageFor = 0;
  private hasLastSpeed = false;
  private lifting = false;
  private readonly lastVelocity = new Float64Array(3);
  private readonly reference = new Float64Array(4);
  private readonly next = new Float64Array(4);
  private readonly target = new Float64Array(4);
  private readonly start = new Float64Array(4);
  private readonly spin = new Float64Array(3);
  private readonly gait = new Float64Array(GAIT.COUNT);
  private readonly plan = new Float64Array(2);
  private readonly stageValues = new Float64Array(STAGE.COUNT);

  get active(): boolean {
    return this.doll !== null;
  }

  /** The way he faces (rad about the vertical, 0 along +z) while he stands. */
  get facing(): number {
    return this.yaw;
  }

  /** Take over `doll` (standing, facing `yaw`) in `world`: hang its torso off a frame, widen its hips for a stride and set every motor. */
  attach(rapier: Rapier, world: World, doll: Doll, yaw: number): void {
    this.rapier = rapier;
    this.world = world;
    this.doll = doll;
    doll.driven = true;
    const raw = world.impulseJoints.raw;
    for (const hip of [HIP_L, HIP_R]) raw.jointSetLimits(doll.joints[hip]!.handle, ANG[0], HIP_FORWARD, HIP_BACK);
    raw.jointSetLimits(doll.joints[HIP_L]!.handle, ANG[2], -ROLL_OUT, ROLL_IN);
    raw.jointSetLimits(doll.joints[HIP_R]!.handle, ANG[2], -ROLL_IN, ROLL_OUT);
    this.anchor = world.createRigidBody(rapier.RigidBodyDesc.kinematicVelocityBased());
    this.gimbal = world.createImpulseJoint(rapier.JointData.generic(ZERO, ZERO, GIMBAL_AXIS, NO_LOCKED_AXES), this.anchor, doll.bodies[0]!, true);
    for (const axis of ANG) raw.jointConfigureMotorModel(this.gimbal.handle, axis, FORCE_BASED);
    for (const row of MOTORS) raw.jointConfigureMotorModel(doll.joints[row.joint]!.handle, row.axis, FORCE_BASED);
    this.yaw = this.heading = yaw;
    pitchedQuaternion(this.reference, yaw, 0);
    this.setAnchor(this.reference);
    this.state = "stand";
    this.strength = 1;
    this.stride = this.cadence = this.phase = 0;
    this.downFor = this.getUpFor = this.stageFor = this.asking = 0;
    this.sinceStruck = Infinity;
    this.hasLastSpeed = false;
  }

  /** Let go of the doll: the frame goes and the doll gets its thrown-dummy joints back (limits and motors as the pool built them). */
  detach(): void {
    const doll = this.doll;
    if (doll === null) return;
    doll.bodies[0]!.resetForces(false);
    this.world!.removeRigidBody(this.anchor!);
    for (const joint of doll.joints) this.world!.removeImpulseJoint(joint, false);
    doll.joints = joinUp(this.rapier!, this.world!, doll.bodies);
    doll.driven = false;
    doll.loose = false;
    this.doll = this.world = this.rapier = this.anchor = this.gimbal = null;
  }

  /** The player is asking him to move: a body that has lain long enough gets up. */
  ask(): void {
    this.asking = ASK_HOLD;
  }

  /** Go limp, a ragdoll: a fall, or a blow. */
  drop(): void {
    this.state = "down";
    this.strength = 0;
    this.downFor = 0;
    this.asking = 0;
  }

  /** A car struck him (`RagdollSystem.knockWalker` has launched the bodies): he goes limp, and is not struck again for a moment. */
  struck(): void {
    this.drop();
    this.sinceStruck = 0;
  }

  /** One frame of `dt` sim seconds: read where the body is, decide what he can do, and set the frame, the lift and every motor for the steps to come. */
  control(dt: number): void {
    const doll = this.doll;
    if (doll === null || dt <= 0) return;
    const step = Math.min(dt, MAX_DT);
    const upright = uprightness(doll.cur, 3);
    const speed = hypot2(doll.vel[0]!, doll.vel[2]!);
    this.sinceStruck += step;
    this.asking = Math.max(0, this.asking - step);
    doll.bodies[0]!.wakeUp();
    this.feelHits(doll, step);
    this.decideState(doll, upright, doll.cur[1]!, step);
    this.steer(step);
    this.driveGimbal(upright);
    this.driveLegs(speed, step);
    this.lift(doll);
  }

  /** A change in speed over a frame beyond `HIT_SPEED` (gravity and a stride make none) takes strength in proportion; strength comes back over `RECOVER_SECONDS`. */
  private feelHits(doll: Doll, dt: number): void {
    const v = doll.vel;
    const last = this.lastVelocity;
    if (this.hasLastSpeed) {
      const change = hypot3(v[0]! - last[0]!, v[1]! - last[1]!, v[2]! - last[2]!);
      const hit = Math.max(0, change - HIT_SPEED * Math.max(1, dt * 60));
      this.strength = Math.min(this.strength, 1 - HIT_DROP * Math.min(1, hit / HIT_SPAN));
    }
    last[0] = v[0]!;
    last[1] = v[1]!;
    last[2] = v[2]!;
    this.hasLastSpeed = true;
    if (this.state === "stand") this.strength = Math.min(1, this.strength + dt / RECOVER_SECONDS);
  }

  private decideState(doll: Doll, upright: number, height: number, dt: number): void {
    if (this.state === "stand") {
      if (upright < FALL_UPRIGHT || height < FALL_HEIGHT) this.drop();
      return;
    }
    if (this.state === "down") {
      this.downFor += dt;
      if (this.asking > 0 && this.downFor >= MIN_LIE && doll.still >= LIE_STILL) this.beginGetUp(doll);
      return;
    }
    this.getUpFor += dt;
    this.stageFor += dt;
    this.strength = Math.min(1, this.getUpFor / GETUP_RAMP);
    const stages = GETUP_ROUTES[this.route];
    if (this.stageFor < stages[this.stage]!.seconds) return;
    this.stageFor = 0;
    if (++this.stage < stages.length) return;
    this.finishGetUp(doll, upright, height);
  }

  /** Funnel into a route by how he lies, facing the way his head points: the frame starts from his torso as it is. */
  private beginGetUp(doll: Doll): void {
    this.state = "getUp";
    this.route = chooseRoute(doll.cur, 3);
    this.stage = 0;
    this.getUpFor = this.stageFor = 0;
    this.yaw = standingBearing(doll.cur, 3, this.yaw);
    for (let i = 0; i < 4; i++) this.start[i] = doll.cur[3 + i]!;
    this.reference.set(this.start);
    this.setAnchor(this.start);
  }

  /** The last stage has run: standing means he walks on, anything else is a fall to try again. */
  private finishGetUp(doll: Doll, upright: number, height: number): void {
    if (upright > STANDING_UPRIGHT && height > STANDING_HEIGHT) {
      this.state = "stand";
      this.heading = this.yaw;
      this.stride = this.cadence = this.phase = 0;
      this.hasLastSpeed = false;
      return;
    }
    this.drop();
    this.downFor = MIN_LIE;
    this.yaw = standingBearing(doll.cur, 3, this.yaw);
  }

  /** The frame: it turns toward the heading while he stands, follows the body while he lies, and leans through the get-up's stages. */
  private steer(dt: number): void {
    const doll = this.doll!;
    if (this.state === "down") {
      for (let i = 0; i < 4; i++) this.next[i] = doll.cur[3 + i]!;
    } else if (this.state === "stand") {
      this.yaw = turnToward(this.yaw, this.heading, TURN_RATE * dt);
      pitchedQuaternion(this.next, this.yaw, 0);
    } else {
      this.stageValuesNow();
      pitchedQuaternion(this.target, this.yaw, this.stageValues[STAGE.PITCH]!);
      if (this.stage === 0) nlerp(this.next, this.start, this.target, smooth(0, 1, Math.min(1, this.stageFor / GETUP_ROUTES[this.route][0]!.seconds)));
      else this.next.set(this.target);
    }
    this.setAnchor(this.reference);
    spinBetween(this.spin, this.reference, this.next, dt);
    this.reference.set(this.next);
    _spin.x = this.spin[0]!;
    _spin.y = this.spin[1]!;
    _spin.z = this.spin[2]!;
    this.anchor!.setAngvel(_spin, false);
  }

  /** The get-up's stage values now (pitch, height, limb targets, grip) into `stageValues`. */
  private stageValuesNow(): void {
    const stages = GETUP_ROUTES[this.route];
    stageAt(stages, this.stage, Math.min(1, this.stageFor / stages[this.stage]!.seconds), this.stageValues);
  }

  private setAnchor(q: Float64Array): void {
    _rot.x = q[0]!;
    _rot.y = q[1]!;
    _rot.z = q[2]!;
    _rot.w = q[3]!;
    this.anchor!.setRotation(_rot, false);
  }

  /** The balance's stiffness follows his strength and fades as he tips past recovery; the get-up holds it whatever his tilt, since the frame leans him. */
  private driveGimbal(upright: number): void {
    const raw = this.world!.impulseJoints.raw;
    const handle = this.gimbal!.handle;
    const tipped = this.state === "getUp" ? 1 : Math.max(0, Math.min(1, (upright - BALANCE_GONE) / (BALANCE_FULL - BALANCE_GONE)));
    const k = Math.max(MOTOR_FLOOR, GIMBAL_STIFFNESS * this.strength * tipped);
    const d = Math.max(MOTOR_FLOOR, GIMBAL_DAMPING * this.strength * tipped);
    for (let i = 0; i < ANG.length; i++) raw.jointConfigureMotorPosition(handle, ANG[i]!, 0, k, d);
  }

  /** The legs and arms: a walking gait while he stands, the stage's pose in the get-up, each motor at the strength he has. */
  private driveLegs(speed: number, dt: number): void {
    const raw = this.world!.impulseJoints.raw;
    const joints = this.doll!.joints;
    if (this.state === "getUp") this.poseFromStage();
    else this.walkGait(speed, dt);
    const limb = this.state === "down" ? LIMP_LIMB_SHARE : LIMP_LIMB_SHARE + (1 - LIMP_LIMB_SHARE) * this.strength;
    const grip = this.state === "getUp" ? this.stageValues[STAGE.GRIP]! : 1;
    for (let i = 0; i < MOTORS.length; i++) {
      const row = MOTORS[i]!;
      const target = row.target < 0 ? 0 : this.gait[row.target]!;
      const share = row.arm ? limb * grip : limb;
      raw.jointConfigureMotorPosition(joints[row.joint]!.handle, row.axis, target, Math.max(MOTOR_FLOOR, row.stiffness * share), Math.max(MOTOR_FLOOR, row.damping * share));
    }
  }

  /** The gait's stride and cadence follow the command once he faces the way he is going. */
  private walkGait(speed: number, dt: number): void {
    const facing = Math.abs(wrapAngle(this.heading - this.yaw)) < FACE_BEFORE_WALK;
    planGait(this.state === "stand" && facing ? this.command : 0, this.plan);
    const ease = Math.min(1, dt * GAIT_EASE);
    this.stride += (this.plan[0]! - this.stride) * ease;
    this.cadence += (this.plan[1]! - this.cadence) * ease;
    this.phase = (this.phase + this.cadence * dt) % 1;
    const bend = Math.min(KNEE_BASE_MAX, KNEE_BASE_AT_REST + KNEE_BASE_PER_SPEED * speed) * Math.min(1, this.stride / KNEE_FULL_STRIDE);
    writeGait(this.gait, this.phase, this.stride, bend);
  }

  /** Both arms, both legs at the stage's pose. */
  private poseFromStage(): void {
    const s = this.stageValues;
    const g = this.gait;
    g[GAIT.HIP_L] = g[GAIT.HIP_R] = s[STAGE.HIP]!;
    g[GAIT.KNEE_L] = g[GAIT.KNEE_R] = s[STAGE.KNEE]!;
    g[GAIT.ARM_L] = g[GAIT.ARM_R] = s[STAGE.ARM]!;
    g[GAIT.ELBOW_L] = g[GAIT.ELBOW_R] = s[STAGE.ELBOW]!;
    g[GAIT.ROLL_L] = g[GAIT.ROLL_R] = 0;
  }

  /** In the get-up a bounded force under the torso takes `LIFT_WEIGHT_SHARE` of his weight and pulls him to the stage's height; otherwise none. */
  private lift(doll: Doll): void {
    const torso = doll.bodies[0]!;
    if (this.state !== "getUp") {
      if (this.lifting) torso.resetForces(false);
      this.lifting = false;
      return;
    }
    const pull = LIFT_WEIGHT_SHARE * WEIGHT + LIFT_STIFFNESS * (this.stageValues[STAGE.HEIGHT]! - doll.cur[1]!) - LIFT_DAMPING * doll.vel[1]!;
    _force.y = Math.max(0, Math.min(LIFT_MAX_WEIGHTS * WEIGHT, pull));
    torso.resetForces(false);
    torso.addForce(_force, true);
    this.lifting = true;
  }
}
