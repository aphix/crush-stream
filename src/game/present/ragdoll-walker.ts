import type { ImpulseJoint, RigidBody, World } from "@dimforge/rapier3d-simd";
import type { Rapier } from "../kernel/rapier.ts";
import { detCos, detSin, hypot2, hypot3 } from "../kernel/physics-core.js";
import { GRAVITY } from "../kernel/constants.ts";
import { activeGround, NO_FLOOR } from "../world/ground.ts";
import { type Doll, PARTS } from "./ragdoll-body.ts";
import { joinUp } from "./ragdoll-joints.ts";
import { chooseRoute, GETUP_ROUTES, type GetUpRoute, smooth, STAGE, stageAt, standingBearing } from "./walker-getup.ts";
import { Gait, GAIT } from "./walker-gait.ts";
import { Locomotion } from "./walker-locomotion.ts";
import { ANG, FORCE_BASED, GETUP_GIMBAL, HIP_BACK, HIP_FORWARD, HIP_L, HIP_R, HOLD, LIN, MOTOR_FLOOR, MOTORS, ROLL_IN, ROLL_OUT, STAND_GIMBAL } from "./walker-motors.ts";
import { leanedQuaternion, nlerp, pitchedQuaternion, spinBetween, uprightness } from "./walker-math.ts";

/**
 * The player's body on foot: a dummy of the ragdoll pool held up and walked. His root is driven, not simulated: a kinematic frame moves at the speed
 * and facing `Locomotion` gives (a run in 0.3 s, a sprint in a second) and holds the torso through stiff linear and angular motors, with the weight and
 * the push fed forward, while every limb is a joint motor chasing the planted-foot gait of `walker-gait.ts`. The same ten Rapier bodies and nine joints
 * as a thrown driver, so a hit that changes his speed by more than he can brace for drops his strength (the motors weaken, he stumbles), and past a
 * tilt, or struck by a car (`struck`), he goes limp: a ragdoll. Once the player asks to walk again he funnels into a get-up (`walker-getup.ts`): by how he
 * lies he regrounds, rolls onto his stomach first, or pushes up from his hands and knees; the frame leans his torso through the stages while a bounded
 * lift takes most of his weight and the limb motors, ramped up from limp, reach each stage's pose and push on the ground. Then the root is seeded where
 * he stands and he walks on.
 */

/** A limp limb keeps this share of its stiffness, so a fallen body is not a puddle. */
const LIMP_LIMB_SHARE = 0.08;

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
/** The torso may lag the root this far (m) before the root is brought back to it (a wall stops the root with him), and he then runs no faster than he is going plus this (m/s). */
const LEASH = 0.2;
const BLOCKED_MARGIN = 1;

type WalkState = "stand" | "down" | "getUp";

const _rot = { x: 0, y: 0, z: 0, w: 1 };
const _spin = { x: 0, y: 0, z: 0 };
const _linear = { x: 0, y: 0, z: 0 };
const _force = { x: 0, y: 0, z: 0 };
const _point = { x: 0, y: 0, z: 0 };
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
  /** The root's motion and the gait's feet: what he does while he stands. */
  readonly loco = new Locomotion();
  readonly gait = new Gait();
  private doll: Doll | null = null;
  private world: World | null = null;
  private rapier: Rapier | null = null;
  private anchor: RigidBody | null = null;
  private gimbal: ImpulseJoint | null = null;
  private yaw = 0;
  private asking = 0;
  private downFor = 0;
  private getUpFor = 0;
  private stageFor = 0;
  private framesOnFoot = 0;
  private forcing = false;
  private groundLast = 0;
  private readonly reference = new Float64Array(4);
  private readonly next = new Float64Array(4);
  private readonly target = new Float64Array(4);
  private readonly start = new Float64Array(4);
  private readonly spin = new Float64Array(3);
  private readonly stagePose = new Float64Array(GAIT.COUNT);
  private readonly stageValues = new Float64Array(STAGE.COUNT);
  private readonly anchorPos = new Float64Array(3);
  private readonly anchorVel = new Float64Array(3);
  private readonly push = new Float64Array(3);
  /** The ground under (x, z), the last known one where there is none. */
  private readonly groundAt = (x: number, z: number): number => {
    const height = activeGround().heightAt(x, z);
    if (height !== NO_FLOOR) this.groundLast = height;
    return this.groundLast;
  };

  get active(): boolean {
    return this.doll !== null;
  }

  /** The way he faces (rad about the vertical, 0 along +z). */
  get facing(): number {
    return this.state === "stand" ? this.loco.yaw : this.yaw;
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
    for (const axis of [...ANG, ...LIN]) raw.jointConfigureMotorModel(this.gimbal.handle, axis, FORCE_BASED);
    for (const row of MOTORS) raw.jointConfigureMotorModel(doll.joints[row.joint]!.handle, row.axis, FORCE_BASED);
    this.heading = yaw;
    pitchedQuaternion(this.reference, yaw, 0);
    this.setAnchor(this.reference);
    this.enterStand(doll, yaw);
    this.strength = 1;
    this.downFor = this.getUpFor = this.stageFor = this.asking = 0;
    this.sinceStruck = Infinity;
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
    this.forcing = false;
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

  /** One frame of `dt` sim seconds: read where the body is, decide what he can do, and set the frame, the forces and every motor for the steps to come. */
  control(dt: number): void {
    const doll = this.doll;
    if (doll === null || dt <= 0) return;
    const step = Math.min(dt, MAX_DT);
    const upright = uprightness(doll.cur, 3);
    this.sinceStruck += step;
    this.asking = Math.max(0, this.asking - step);
    doll.bodies[0]!.wakeUp();
    this.feelHits(doll, step);
    this.decideState(doll, upright, doll.cur[1]!, step);
    if (this.state === "stand") this.walk(doll, step);
    this.steer(step);
    this.driveGimbal(upright);
    this.driveMotors(step);
    this.holdUp(doll);
  }

  /**
   * On his feet, his torso moving more than `HIT_SPEED` (m/s) differently from the root that holds it is a blow (the root's own acceleration is no hit, and
   * neither is being held back along his way by a wall): it takes strength in proportion, past `HIT_SPAN` more it knocks him down, and strength comes back
   * over `RECOVER_SECONDS`.
   */
  private feelHits(doll: Doll, dt: number): void {
    if (this.state !== "stand") return;
    if (this.framesOnFoot++ > 0) {
      const hit = Math.max(0, this.blowSpeed(doll) - HIT_SPEED * Math.max(1, dt * 60));
      if (hit >= HIT_SPAN) {
        this.drop();
        return;
      }
      this.strength = Math.min(this.strength, 1 - HIT_DROP * Math.min(1, hit / HIT_SPAN));
    }
    this.strength = Math.min(1, this.strength + dt / RECOVER_SECONDS);
  }

  /** How far (m/s) his torso moves from the root's velocity, less what a wall ahead takes off his way (the torso slower than the root along his facing). */
  private blowSpeed(doll: Doll): number {
    const held = this.anchorVel;
    let dx = doll.vel[0]! - held[0]!;
    const dy = doll.vel[1]! - held[1]!;
    let dz = doll.vel[2]! - held[2]!;
    const sin = detSin(this.loco.yaw);
    const cos = detCos(this.loco.yaw);
    const along = dx * sin + dz * cos;
    if (along < 0) {
      dx -= along * sin;
      dz -= along * cos;
    }
    return hypot3(dx, dy, dz);
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

  /** The last stage has run: standing means he walks on from where he stands, anything else is a fall to try again. */
  private finishGetUp(doll: Doll, upright: number, height: number): void {
    if (upright > STANDING_UPRIGHT && height > STANDING_HEIGHT) {
      this.state = "stand";
      this.heading = this.yaw;
      this.enterStand(doll, this.yaw);
      return;
    }
    this.drop();
    this.downFor = MIN_LIE;
    this.yaw = standingBearing(doll.cur, 3, this.yaw);
  }

  /** The root starts from where the torso is, standing still on both feet, facing `yaw`. */
  private enterStand(doll: Doll, yaw: number): void {
    const at = doll.bodies[0]!.translation();
    this.yaw = yaw;
    this.state = "stand";
    this.loco.reset(yaw);
    this.framesOnFoot = 0;
    this.gait.seed(at.x, at.y, at.z, yaw, this.groundAt);
    this.anchorPos[0] = at.x;
    this.anchorPos[1] = at.y;
    this.anchorPos[2] = at.z;
    this.anchorVel.fill(0);
    this.push.fill(0);
    _point.x = at.x;
    _point.y = at.y;
    _point.z = at.z;
    this.anchor!.setTranslation(_point, false);
    this.anchor!.setLinvel(ZERO, false);
  }

  /** On his feet: the root's speed and facing follow the controls, the gait follows the root, and the frame moves to where the gait puts his torso. */
  private walk(doll: Doll, dt: number): void {
    this.holdRootToBody(doll);
    this.loco.update(dt, this.heading, this.command);
    this.gait.update(dt, this.loco, this.groundAt, doll.cur, 3);
    this.moveAnchor(dt);
  }

  /** A torso held back by the world (a wall, a car) brings the root back to within `LEASH` of it, and he goes no faster than he is moving. */
  private holdRootToBody(doll: Doll): void {
    const dx = this.anchorPos[0]! - doll.cur[0]!;
    const dz = this.anchorPos[2]! - doll.cur[2]!;
    const slip = hypot2(dx, dz);
    if (slip < LEASH) return;
    const back = (slip - LEASH) / slip;
    this.gait.shift(-dx * back, -dz * back);
    this.anchorPos[0]! -= dx * back;
    this.anchorPos[2]! -= dz * back;
    _point.x = this.anchorPos[0]!;
    _point.y = this.anchorPos[1]!;
    _point.z = this.anchorPos[2]!;
    this.anchor!.setTranslation(_point, false);
    const along = doll.vel[0]! * detSin(this.loco.yaw) + doll.vel[2]! * detCos(this.loco.yaw);
    this.loco.speed = Math.min(this.loco.speed, Math.max(0, along) + BLOCKED_MARGIN);
  }

  /** The frame's velocity that takes it to the gait's torso centre over `dt`, and the push (m/s²) that velocity changes by, which `holdUp` feeds forward. */
  private moveAnchor(dt: number): void {
    const target = this.gait.anchor;
    for (let i = 0; i < 3; i++) {
      const velocity = (target[i]! - this.anchorPos[i]!) / dt;
      this.push[i] = (velocity - this.anchorVel[i]!) / dt;
      this.anchorVel[i] = velocity;
      this.anchorPos[i] = target[i]!;
    }
    _linear.x = this.anchorVel[0]!;
    _linear.y = this.anchorVel[1]!;
    _linear.z = this.anchorVel[2]!;
    this.anchor!.setLinvel(_linear, false);
  }

  /** The frame's turn: the root's lean and facing on his feet, the body's own while he lies, and the get-up's stages. */
  private steer(dt: number): void {
    const doll = this.doll!;
    if (this.state === "down") {
      for (let i = 0; i < 4; i++) this.next[i] = doll.cur[3 + i]!;
    } else if (this.state === "stand") {
      leanedQuaternion(this.next, this.loco.yaw + this.gait.twist, this.loco.pitch, this.loco.roll);
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

  /** The balance and the hold: the gimbal's stiffness follows his strength (his root's hold is linear, the balance angular), and fades as he tips past recovery; the get-up holds it whatever his tilt, since the frame leans him. */
  private driveGimbal(upright: number): void {
    const raw = this.world!.impulseJoints.raw;
    const handle = this.gimbal!.handle;
    const standing = this.state === "stand";
    const gimbal = standing ? STAND_GIMBAL : GETUP_GIMBAL;
    const tipped = this.state === "getUp" ? 1 : Math.max(0, Math.min(1, (upright - BALANCE_GONE) / (BALANCE_FULL - BALANCE_GONE)));
    const k = Math.max(MOTOR_FLOOR, gimbal.stiffness * this.strength * tipped);
    const d = Math.max(MOTOR_FLOOR, gimbal.damping * this.strength * tipped);
    for (let i = 0; i < ANG.length; i++) raw.jointConfigureMotorPosition(handle, ANG[i]!, 0, k, d);
    const hold = standing ? this.strength : 0;
    for (let i = 0; i < LIN.length; i++) raw.jointConfigureMotorPosition(handle, LIN[i]!, 0, Math.max(MOTOR_FLOOR, HOLD.stiffness * hold), Math.max(MOTOR_FLOOR, HOLD.damping * hold));
  }

  /** Every limb motor: the gait's targets on his feet, the stage's pose in the get-up, each at the strength he has. */
  private driveMotors(dt: number): void {
    const raw = this.world!.impulseJoints.raw;
    const joints = this.doll!.joints;
    const walking = this.state === "stand";
    if (this.state === "getUp") this.poseFromStage();
    const targets = this.state === "getUp" ? this.stagePose : this.gait.targets;
    const limb = this.state === "down" ? LIMP_LIMB_SHARE : LIMP_LIMB_SHARE + (1 - LIMP_LIMB_SHARE) * this.strength;
    const grip = this.state === "getUp" ? this.stageValues[STAGE.GRIP]! : 1;
    for (let i = 0; i < MOTORS.length; i++) {
      const row = MOTORS[i]!;
      const target = row.target < 0 ? 0 : targets[row.target]!;
      const share = row.arm ? limb * grip : limb;
      const stiffness = walking ? row.walkStiffness : row.stiffness;
      const damping = walking ? row.walkDamping : row.damping;
      const lead = walking && row.target >= 0 ? this.gait.rates[row.target]! : 0;
      raw.jointConfigureMotor(joints[row.joint]!.handle, row.axis, target - lead * dt * 0.6, lead, Math.max(MOTOR_FLOOR, stiffness * share), Math.max(MOTOR_FLOOR, damping * share));
    }
  }

  /** Both arms, both legs at the stage's pose. */
  private poseFromStage(): void {
    const s = this.stageValues;
    const g = this.stagePose;
    g[GAIT.HIP_L] = g[GAIT.HIP_R] = s[STAGE.HIP]!;
    g[GAIT.KNEE_L] = g[GAIT.KNEE_R] = s[STAGE.KNEE]!;
    g[GAIT.ARM_L] = g[GAIT.ARM_R] = s[STAGE.ARM]!;
    g[GAIT.ELBOW_L] = g[GAIT.ELBOW_R] = s[STAGE.ELBOW]!;
    g[GAIT.ROLL_L] = g[GAIT.ROLL_R] = 0;
    g[GAIT.NECK_TURN] = g[GAIT.NECK_NOD] = 0;
  }

  /**
   * A force on the torso that carries what the root's motion asks of the body: on his feet his weight and the push of the root's acceleration (the
   * hold then only corrects), in the get-up a bounded lift of `LIFT_WEIGHT_SHARE` of his weight pulling him to the stage's height; otherwise none.
   */
  private holdUp(doll: Doll): void {
    const torso = doll.bodies[0]!;
    if (this.state === "down") {
      if (this.forcing) torso.resetForces(false);
      this.forcing = false;
      return;
    }
    if (this.state === "stand") {
      const share = TOTAL_MASS * this.strength;
      _force.x = share * this.push[0]!;
      _force.y = share * (GRAVITY + this.push[1]!);
      _force.z = share * this.push[2]!;
    } else {
      const pull = LIFT_WEIGHT_SHARE * WEIGHT + LIFT_STIFFNESS * (this.stageValues[STAGE.HEIGHT]! - doll.cur[1]!) - LIFT_DAMPING * doll.vel[1]!;
      _force.x = _force.z = 0;
      _force.y = Math.max(0, Math.min(LIFT_MAX_WEIGHTS * WEIGHT, pull));
    }
    torso.resetForces(false);
    torso.addForce(_force, true);
    this.forcing = true;
  }
}
