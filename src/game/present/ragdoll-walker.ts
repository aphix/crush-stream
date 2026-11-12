import type { ImpulseJoint, Ray, RigidBody, World } from "@dimforge/rapier3d-simd";
import type { Rapier } from "../kernel/rapier.ts";
import { detCos, detSin, hypot2, hypot3 } from "../kernel/physics-core.js";
import { GRAVITY } from "../kernel/constants.ts";
import { NO_FLOOR } from "../world/ground.ts";
import { type Doll, PARTS, TOTAL_MASS } from "./ragdoll-body.ts";
import { joinUp } from "./ragdoll-joints.ts";
import { chooseRoute, GETUP_ROUTES, type GetUpRoute, smooth, STAGE, stageAt, standingBearing } from "./walker-getup.ts";
import { Gait, GAIT } from "./walker-gait.ts";
import { FootLocks } from "./walker-feet.ts";
import { WalkFloor } from "./walker-floor.ts";
import { Locomotion, WALK_SPEED } from "./walker-locomotion.ts";
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
/** A punch's length (s), and how much stronger (times) his two punching arm motors are for it. */
const PUNCH_SECONDS = 0.45;
const PUNCH_STRENGTH = 4;
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
const WEIGHT = TOTAL_MASS * GRAVITY;
/** Standing again needs this tilt cosine (32°) and torso height (m). */
const STANDING_UPRIGHT = 0.85;
const STANDING_HEIGHT = 0.95;
/** The longest control step (s): a hitch does not turn the motors' targets into a jump. */
const MAX_DT = 0.05;
/** The torso may lag the root this far (m) before the root is brought back to it (a wall stops the root with him), and he then runs no faster than he is going plus this (m/s). */
const LEASH = 0.08;
const BLOCKED_MARGIN = 1;
/** The hold's spring rate (rad/s) on his whole mass: displacement times it is the speed a displaced torso springs back at. */
const HOLD_RATE = Math.sqrt(HOLD.stiffness / TOTAL_MASS);
/** A hop out goes on at most this far (m, a stride) past the way out to find ground clear of everything to come down on. */
const HOP_ON = 0.5;
/** His feet's parts (`PARTS`), and a foot's half extents. */
const FEET = [10, 11] as const;
const FOOT_HALF = PARTS[10].h;

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
  /** How much of his torso's lag behind the root (m) his own travel explains: it grows as far as the root moves and is never more than the lag itself. */
  private slack = 0;
  /** Set each frame by the pool: another body stands within reach of him, so a lean can stagger but not fell him (`meetWalkers` decides). */
  beside = false;

  /** A shove he stays on his feet through: his strength is at most `share` at once and comes back as after any blow (`RECOVER_SECONDS`). */
  stagger(share: number): void {
    if (this.state === "stand") this.strength = Math.min(this.strength, share);
  }

  /** His root's own speed (m/s) along the level direction (nx, nz): his locomotion's, since the anchor's velocity jitters with each step. */
  rootSpeedAlong(nx: number, nz: number): number {
    return this.loco.speed * (detSin(this.loco.yaw) * nx + detCos(this.loco.yaw) * nz);
  }

  /** Seconds since a car struck him (`struck`). */
  sinceStruck = Infinity;
  /** The route and stage the get-up is on. */
  route: GetUpRoute = "reground";
  stage = 0;
  /** The root's motion and the gait's feet: what he does while he stands. */
  readonly loco = new Locomotion();
  readonly gait = new Gait();
  /** What his feet stand on: steps up to `WALK_STEP` are floor, and a building streams its boxes in through `floor.boxes`. */
  readonly floor = new WalkFloor();
  private readonly feet = new FootLocks();
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
  /** Seconds since his punch began; at or past `PUNCH_SECONDS` he is not punching. */
  private punchFor = PUNCH_SECONDS;
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
  /** The hop out of what he stands in (`out`): how high (m; 0: none) his feet rise, and the way (x, z m) still to go over it before they come down. */
  private hopUp = 0;
  private readonly hopWay = new Float64Array(2);
  /** How far (m) he has gone on past the way out looking for clear ground to come down on (`HOP_ON`). */
  private hopOn = 0;
  private ray: Ray | null = null;
  /** The floor under (x, z), the last known one where there is none. */
  private readonly groundAt = (x: number, z: number): number => {
    const height = this.floor.under(x, z);
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
    this.feet.attach(rapier, world, doll.bodies);
    this.ray = new rapier.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: -1, z: 0 });
    for (const row of MOTORS) raw.jointConfigureMotorModel(doll.joints[row.joint]!.handle, row.axis, FORCE_BASED);
    this.heading = yaw;
    pitchedQuaternion(this.reference, yaw, 0);
    this.setAnchor(this.reference);
    this.enterStand(doll, yaw);
    this.strength = 1;
    this.punchFor = PUNCH_SECONDS;
    this.downFor = this.getUpFor = this.stageFor = this.asking = 0;
    this.sinceStruck = Infinity;
  }

  /** Let go of the doll: the frame goes and the doll gets its thrown-dummy joints back (limits and motors as the pool built them). */
  detach(): void {
    const doll = this.doll;
    if (doll === null) return;
    doll.bodies[0]!.resetForces(false);
    this.world!.removeRigidBody(this.anchor!);
    this.feet.detach();
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
    this.punchFor = PUNCH_SECONDS;
  }

  /** He throws a punch with his right arm; false when he cannot (not on his feet, or one is under way). */
  punch(): boolean {
    if (this.doll === null || this.state !== "stand" || this.punchFor < PUNCH_SECONDS) return false;
    this.punchFor = 0;
    return true;
  }

  /** A car struck him (`RagdollSystem.knockWalker` has launched the bodies): he goes limp, and is not struck again for a moment. */
  struck(): void {
    this.drop();
    this.sinceStruck = 0;
  }

  /** One frame of `dt` sim seconds: read where the body is, decide what he can do, and set the frame, the forces and every motor for the steps to come. `out` (x, z m at `at`: `Untangle.carry`) is his stuck part's way out. */
  control(dt: number, out: ArrayLike<number>, at: number): void {
    const doll = this.doll;
    if (doll === null || dt <= 0) return;
    const step = Math.min(dt, MAX_DT);
    const upright = uprightness(doll.cur, 3);
    this.sinceStruck += step;
    this.asking = Math.max(0, this.asking - step);
    doll.bodies[0]!.wakeUp();
    this.feelHits(doll, step);
    this.decideState(doll, upright, doll.cur[1]!, step);
    if (this.state === "stand") this.walk(doll, step, out, at);
    this.steer(step);
    this.driveGimbal(upright);
    this.driveMotors(step);
    this.feet.update(step, this.gait, this.state === "stand", this.strength);
    this.holdUp(doll);
  }

  /**
   * On his feet, his torso moving more than `HIT_SPEED` (m/s) differently from the root that holds it is a blow (the root's own acceleration is no hit, and
   * neither is being held back along his way by a wall): it takes strength in proportion, past `HIT_SPAN` more it knocks him down, and strength comes back
   * over `RECOVER_SECONDS`. Lag his own travel explains (`slack`) is no blow, and beside another body a lean cannot fell him.
   */
  private feelHits(doll: Doll, dt: number): void {
    if (this.state !== "stand") return;
    if (this.framesOnFoot++ > 0) {
      const own = hypot3(this.anchorVel[0]!, this.anchorVel[1]!, this.anchorVel[2]!);
      let hit = Math.max(0, this.blowSpeed(doll, own * dt) - HIT_SPEED * Math.max(1, dt * 60));
      if (this.beside) hit = Math.min(hit, 0.8 * HIT_SPAN);
      if (hit >= HIT_SPAN) {
        this.drop();
        return;
      }
      this.strength = Math.min(this.strength, 1 - HIT_DROP * Math.min(1, hit / HIT_SPAN));
    }
    this.strength = Math.min(1, this.strength + dt / RECOVER_SECONDS);
  }

  /**
   * How hard (m/s) his torso is moved off the root: its speed relative to the root plus the hold's spring speed for how far it is displaced (a stiff hold takes a
   * blow's speed out of the torso inside a frame and leaves a displacement), less what a wall ahead takes off his way (the torso behind the root along his facing).
   * `travelled`: how far (m) the root moved this frame; the lag grows forgiven by that much.
   */
  private blowSpeed(doll: Doll, travelled: number): number {
    const held = this.anchorVel;
    const lx = doll.cur[0]! - this.anchorPos[0]!;
    const ly = doll.cur[1]! - this.anchorPos[1]!;
    const lz = doll.cur[2]! - this.anchorPos[2]!;
    const lag = hypot3(lx, ly, lz);
    this.slack = Math.min(lag, this.slack + travelled);
    const keep = lag > 0 ? (lag - this.slack) / lag : 0;
    let dx = doll.vel[0]! - held[0]! + HOLD_RATE * lx * keep;
    const dy = doll.vel[1]! - held[1]! + HOLD_RATE * ly * keep;
    let dz = doll.vel[2]! - held[2]! + HOLD_RATE * lz * keep;
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
      // On his feet his height is read over the floor under them (`WalkFloor.level`), so a fall on an upper floor is seen as one on the street is; a foot planted a tread up raises that floor before his torso follows (`rise`).
      if (upright < FALL_UPRIGHT || height - this.floor.level < FALL_HEIGHT - this.floor.rise) this.drop();
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
    this.hopUp = 0;
    this.floor.reset(at.x, at.y, at.z);
    this.gait.seed(at.x, at.y, at.z, yaw, this.groundAt);
    this.anchorPos[0] = at.x;
    this.anchorPos[1] = at.y;
    this.anchorPos[2] = at.z;
    this.anchorVel.fill(0);
    this.slack = 0;
    this.push.fill(0);
    _point.x = at.x;
    _point.y = at.y;
    _point.z = at.z;
    this.anchor!.setTranslation(_point, false);
    this.anchor!.setLinvel(ZERO, false);
  }

  /** On his feet: the root's speed and facing follow the controls, the gait follows the root, and the frame moves to where the gait puts his torso. `out` at `at`: `control`'s. */
  private walk(doll: Doll, dt: number, out: ArrayLike<number>, at: number): void {
    this.holdRootToBody(doll);
    this.getOut(dt, out, at);
    this.loco.update(dt, this.heading, this.floor.pace(this.anchorPos[0]!, this.anchorPos[2]!, this.loco.yaw, this.command));
    this.gait.update(dt, this.loco, this.groundAt, doll.cur, 3);
    this.punchArm(dt);
    this.floor.stand(this.gait.planted, this.gait.plant);
    this.moveAnchor(dt);
  }

  /** The punch's arm and elbow targets over the gait's: cocked for 0.12 s, thrown until 0.22 s, then eased back to the gait's by `PUNCH_SECONDS`; their rates are zeroed so the motors do not lead a target that jumps. */
  private punchArm(dt: number): void {
    if (this.punchFor >= PUNCH_SECONDS) return;
    this.punchFor += dt;
    const targets = this.gait.targets;
    const cocked = this.punchFor < 0.12;
    const back = this.punchFor < 0.22 ? 0 : Math.min(1, (this.punchFor - 0.22) / (PUNCH_SECONDS - 0.22));
    const arm = cocked ? -0.6 : -1.45;
    const elbow = cocked ? -1.7 : -0.1;
    targets[GAIT.ARM_R] = arm + (targets[GAIT.ARM_R]! - arm) * back;
    targets[GAIT.ELBOW_R] = elbow + (targets[GAIT.ELBOW_R]! - elbow) * back;
    this.gait.rates[GAIT.ARM_R] = 0;
    this.gait.rates[GAIT.ELBOW_R] = 0;
  }

  /**
   * A part stuck in something (`out` at `at`: `Untangle.carry`, the way along the ground and the lift over it) is carried out at a walk, root and planted
   * feet together (his anchors are kinematic: a push on the part dies in them). Where it can be lifted over, he hops: feet up, over, and down where
   * nothing lies under them, for a foot dragged along the ground levers whatever limb lies in its way. Else he steps out along the ground.
   */
  private getOut(dt: number, out: ArrayLike<number>, at: number): void {
    const pace = WALK_SPEED * dt;
    let x = out[at]!;
    let z = out[at + 1]!;
    // Found, or still rising: as high and as far as any of his parts found stuck so far needs.
    if (out[at + 2]! > 0 && (x !== 0 || z !== 0) && (this.hopUp === 0 || this.gait.hop < this.hopUp)) {
      if (this.hopUp === 0) this.hopOn = 0;
      this.hopUp = Math.max(this.hopUp, out[at + 2]!);
      if (hypot2(x, z) > hypot2(this.hopWay[0]!, this.hopWay[1]!)) {
        this.hopWay[0] = x;
        this.hopWay[1] = z;
      }
    }
    let y = 0;
    if (this.hopUp > 0) {
      x = this.hopWay[0]!;
      z = this.hopWay[1]!;
      const far = hypot2(x, z);
      if (far > 0 && this.gait.hop < this.hopUp) {
        y = Math.min(pace, this.hopUp - this.gait.hop);
        x = z = 0;
      } else if (far > 0) {
        const share = Math.min(1, pace / far);
        x *= share;
        z *= share;
        this.hopWay[0]! -= x;
        this.hopWay[1]! -= z;
        // Over: on to where his feet come down on nothing but the ground.
        if (share === 1 && this.hopOn < HOP_ON && this.landsOnSomething()) {
          this.hopWay[0] = (x / far) * pace;
          this.hopWay[1] = (z / far) * pace;
          this.hopOn += pace;
        }
      } else {
        y = -Math.min(pace, this.gait.hop);
        x = z = 0;
        if (this.gait.hop + y <= 0) this.hopUp = 0;
      }
    } else {
      const far = hypot2(x, z);
      const share = far > 0 ? Math.min(1, pace / far) : 0;
      x *= share;
      z *= share;
    }
    this.gait.hop += y;
    this.gait.shift(x, z);
    this.feet.shift(x, y, z, dt);
  }

  /** Whether a foot set down from its hop would land on something but the ground: rays down from points along each sole. */
  private landsOnSomething(): boolean {
    const ray = this.ray!;
    const flags = this.rapier!.QueryFilterFlags.EXCLUDE_FIXED | this.rapier!.QueryFilterFlags.EXCLUDE_SENSORS;
    const groups = this.doll!.bodies[FEET[0]]!.collider(0).collisionGroups();
    // Everything his feet hit but him: the filter half without his own bit.
    const query = groups & ~(groups >>> 16);
    for (const k of FEET) {
      const foot = this.doll!.bodies[k]!;
      const p = foot.translation();
      const q = foot.rotation();
      // The foot's long axis (its local z) in the world.
      const ax = 2 * (q.x * q.z + q.w * q.y);
      const ay = 2 * (q.y * q.z - q.w * q.x);
      const az = 1 - 2 * (q.x * q.x + q.y * q.y);
      for (let s = -1; s <= 1; s += 0.5) {
        ray.origin.x = p.x + ax * s * FOOT_HALF[2];
        ray.origin.y = p.y + ay * s * FOOT_HALF[2] - FOOT_HALF[1];
        ray.origin.z = p.z + az * s * FOOT_HALF[2];
        // Down to a sole's thickness over where it lands: lower than that is the ground's own bumps.
        if (this.world!.castRay(ray, this.gait.hop - FOOT_HALF[1], true, flags, query) !== null) return true;
      }
    }
    return false;
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
    const tipped = this.state === "getUp" || (standing && this.strength >= 1) ? 1 : Math.max(0, Math.min(1, (upright - BALANCE_GONE) / (BALANCE_FULL - BALANCE_GONE)));
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
      const punching = walking && this.punchFor < PUNCH_SECONDS && (row.target === GAIT.ARM_R || row.target === GAIT.ELBOW_R);
      const share = (row.arm ? limb * grip : limb) * (punching ? PUNCH_STRENGTH : 1);
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
