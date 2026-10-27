import { detCos, detSin } from "../kernel/physics-core.js";
import { HIP_DROP, HIP_HALF, LEG, solveLeg } from "./walker-leg.ts";
import { type Locomotion, RUN_SPEED, SPRINT_SPEED, WALK_SPEED } from "./walker-locomotion.ts";
import { leanedQuaternion } from "./walker-math.ts";

/** Index of each joint target the gait fills (rad): thigh swing (negative is forward), thigh roll (positive swings the foot toward +x), knee bend, arm swing, elbow bend, neck turn and nod. */
export const GAIT = { HIP_L: 0, HIP_R: 1, ROLL_L: 2, ROLL_R: 3, KNEE_L: 4, KNEE_R: 5, ARM_L: 6, ARM_R: 7, ELBOW_L: 8, ELBOW_R: 9, NECK_TURN: 10, NECK_NOD: 11, COUNT: 12 } as const;

/** The gait's numbers at standing, a walk, a run and a sprint, between which it blends linearly (natural-gait research: cadence 100-130 steps/min walking, 150-210 running; stance 60 % walking, 35-50 % running; knee 20° in walking stance, 40°+ running). */
const SPEED_STOPS = [0, WALK_SPEED, RUN_SPEED, SPRINT_SPEED] as const;
/** Gait cycles a second (two steps each). */
const CADENCE = [1.3, 1.3, 1.7, 2.0] as const;
/** The share of the cycle a foot is on the ground: past a half the feet overlap (a walk), under it there is a flight phase (a run). */
const STANCE = [0.6, 0.58, 0.38, 0.25] as const;
/** The foot's most lift (m) in swing. */
const CLEARANCE = [0.04, 0.06, 0.12, 0.17] as const;
/** The leg's length (m) from hip to ankle in stance: shorter bends the knee more (a jogging stance flexes 35°+). */
const STANCE_LEG = [0.835, 0.833, 0.83, 0.828] as const;
/** The elbow's bend (rad, negative: forward): hanging at a walk, held near a right angle running. */
const ELBOW_BASE = [-0.25, -0.3, -1.45, -1.55] as const;

/** The fastest a joint is asked to turn (rad/s): a sprinting thigh swings at about 25. */
const RATE_MAX = 40;
/** Cycles a second while he is not moving but a foot is still to be brought in. */
const SETTLE_CADENCE = 1.6;
/** Steps come quicker while he is pushing up to speed: cycles a second more per m/s² of acceleration, and the most (cycles a second). */
const CADENCE_PER_PUSH = 0.07;
const CADENCE_MAX = 2.2;
/** Under this speed (m/s) and turn rate (rad/s) he is standing. */
const MOVING_SPEED = 0.15;
const MOVING_TURN = 0.4;
/** Under this speed (m/s) a foot out of reach lifts even while the other is in the air: a pivot on the spot steps round, with no flight to fall in. */
const PIVOT_FREE_SPEED = 2.5;
/** A foot within this far (m) of where a standing foot goes is home. */
const HOME_RADIUS = 0.05;
/** Where the swing foot stops, beside the hip: the hip's width times this, so the feet do not cross in a turn. */
const FOOT_WIDTH = 1.15;
/** A foot lands this much further ahead per m/s² of braking (m): a braking step reaches out. */
const BRAKE_REACH = 0.02;
/** The ankle's height over the ground (m): the shin's end is a box, not a point. */
const FOOT_RISE = 0.07;
/** The latest cycle share a stance can be cut short at, when a foot goes out of reach. */
const LATEST_LIFT = 0.85;
/** A planted foot lifts when it is this far (m) behind or ahead of the hip, or crosses under the body, or reaches out sideways. */
const REACH_ALONG = 0.55;
const REACH_ACROSS = 0.16;
const REACH_OUT = 0.35;
/** The pelvis rides its stance legs: it follows the height they allow with this natural frequency (rad/s, a sprint's vault is cut to about 5 m/s² per cm of dip) in this many sub-steps a frame; a leg that cannot quite reach stretches its foot off the ground a few cm, as a toe-off does. */
const HEIGHT_FREQUENCY = 16;
const HEIGHT_SUBSTEPS = 4;
/** A foot this near (m) over the spot it lands on already carries the pelvis. */
const NEAR_GROUND = 0.03;
/** The leg is never asked to reach under this share of its stance length down (a foot almost under the hip). */
const MIN_DROP_SHARE = 0.4;
/** Torso turn (rad) per rad of difference between the thighs' swings (a walking pelvis turns about 10° peak to peak), and the neck turning back against it and levelling against the lean. */
const TWIST_GAIN = 0.3;
const NECK_COUNTER_TURN = 0.8;
const NECK_LEVEL = 0.9;
/** Sideways sway (m) toward the stance foot. */
const SWAY = 0.03;
/** Arm swing as a share of the opposite thigh's, and the elbow's bend added per rad of swing. */
const ARM_SHARE = 1;
const ELBOW_PER_SWING = 0.15;
/** The arms hang off a leaning torso: they swing about the vertical, so they rest back by this share of the lean; the swing is the opposite thigh's about its own mean (a lowpass over this rate, 1/s). */
const ARM_REST_PER_LEAN = 1.6;
/** The arms' extra rest back (rad) at standing, a walk, a run and a sprint: the swing is centred behind the shoulder so the back hand ends behind the hip. */
const ARM_BACK_BIAS = [0, 0.05, 0.3, 0.2] as const;
const ARM_MEAN_EASE = 2;
/** The elbow closes no further (rad, negative: forward): the hand stays under the shoulder. */
const ELBOW_MOST = -1.75;
/** Rates (1/s) at which the twist and the stance weights follow their targets. */
const TWIST_EASE = 20;
const WEIGHT_EASE = 12;

const LIFT_AT_STANDING = STANCE[0];
const SIDES = [-1, 1] as const;
const CYCLE_OFFSET = [0, 0.5] as const;

/** `values` (one per `SPEED_STOPS` entry) at `speed`. */
function atSpeed(speed: number, values: readonly number[]): number {
  for (let i = 1; i < SPEED_STOPS.length; i++) {
    if (speed > SPEED_STOPS[i]!) continue;
    const from = SPEED_STOPS[i - 1]!;
    return values[i - 1]! + ((values[i]! - values[i - 1]!) * (speed - from)) / (SPEED_STOPS[i]! - from);
  }
  return values[values.length - 1]!;
}

const smoothstep = (s: number) => s * s * (3 - 2 * s);

/** The ground height under (x, z), m. */
type GroundAt = (x: number, z: number) => number;

/**
 * The walker's legs and upper body: a gait of feet set down in the world and walked over. Each foot is planted at a spot the pelvis will pass
 * over, stays there (no sliding) while the pelvis rides over it, then swings to the next, in a cycle whose cadence and stance share follow speed:
 * a walk overlaps its stances, a run has a flight. The pelvis stands as high as its planted legs allow (so it bobs as a person's does and dips
 * as a foot lands), each leg's hip and knee come from a two-bone solve to its foot, and the arms, torso turn and head follow the legs.
 * Nothing allocates.
 */
export class Gait {
  /** The joint targets (`GAIT` order) and the torso's centre (x, y, z) the root is to be at. */
  readonly targets = new Float64Array(GAIT.COUNT);
  /** How fast each target is moving (rad/s, `GAIT` order): the motors lead their targets by it, so a limb does not trail its pose. */
  readonly rates = new Float64Array(GAIT.COUNT);
  readonly anchor = new Float64Array(3);
  /** The torso's turn from the facing (rad): the pelvis and shoulders turn against the legs. */
  twist = 0;
  /** Both feet are home and he stands: the cycle is parked. */
  standing = true;
  private pathX = 0;
  private pathZ = 0;
  private hipY = 0;
  private hipRise = 0;
  private sway = 0;
  private phase = 0;
  private cadence = 0;
  private readonly planted = new Uint8Array(2).fill(1);
  private readonly liftAt = new Float64Array(2).fill(LIFT_AT_STANDING);
  private readonly cycle = new Float64Array(2);
  private readonly weight = new Float64Array(2).fill(1);
  private readonly plant = new Float64Array(6);
  private readonly start = new Float64Array(6);
  private readonly foot = new Float64Array(6);
  private readonly legs = new Float64Array(6);
  private readonly quat = new Float64Array(4);
  private readonly rot = new Float64Array(9);
  private readonly spot = new Float64Array(2);
  private readonly aboveLanding = new Float64Array(2);
  private readonly landY = new Float64Array(2);
  private readonly landSpan = new Float64Array(2);
  private readonly lastTargets = new Float64Array(GAIT.COUNT);
  private needsBaseline = true;
  private readonly hipMean = new Float64Array(2);
  private readonly local = new Float64Array(3);

  /** He stands at (`x`, `z`) with his torso centre `y` up, facing `yaw`, feet under him on `ground`. */
  seed(x: number, y: number, z: number, yaw: number, ground: GroundAt): void {
    this.pathX = x;
    this.pathZ = z;
    this.twist = this.sway = this.hipRise = 0;
    this.hipY = y - HIP_DROP;
    this.park();
    for (let f = 0; f < 2; f++) {
      this.weight[f] = 1;
      this.homeSpot(f, yaw, x, z);
      this.plant[f * 3] = this.spot[0]!;
      this.plant[f * 3 + 1] = ground(this.spot[0]!, this.spot[1]!) + FOOT_RISE;
      this.plant[f * 3 + 2] = this.spot[1]!;
    }
    this.foot.set(this.plant);
    this.needsBaseline = true;
  }

  /** Move the gait by (`dx`, `dz`) m: the root was held back by the world and the feet go with it. */
  shift(dx: number, dz: number): void {
    this.pathX += dx;
    this.pathZ += dz;
    for (let f = 0; f < 2; f++) {
      this.plant[f * 3]! += dx;
      this.plant[f * 3 + 2]! += dz;
    }
  }

  /** One step of `dt` s with the root at `loc`'s speed and facing, over `ground`; `observed` (rotation x, y, z, w at `at`) is the torso as it really lies, null: as the root asks. */
  update(dt: number, loc: Locomotion, ground: GroundAt, observed: ArrayLike<number> | null = null, at = 0): void {
    const speed = loc.speed;
    const moving = speed > MOVING_SPEED || Math.abs(loc.turnRate) > MOVING_TURN || !this.standing;
    this.pathX += detSin(loc.yaw) * speed * dt;
    this.pathZ += detCos(loc.yaw) * speed * dt;
    this.orient(loc, observed, at);
    const hipX = this.pathX + this.sway * detCos(loc.yaw);
    const hipZ = this.pathZ - this.sway * detSin(loc.yaw);
    this.cadence = speed > MOVING_SPEED ? Math.min(CADENCE_MAX, atSpeed(speed, CADENCE) + CADENCE_PER_PUSH * Math.max(0, loc.accel)) : SETTLE_CADENCE;
    if (moving) this.phase = (this.phase + this.cadence * dt) % 1;
    for (let f = 0; f < 2; f++) this.stepFoot(f, loc, hipX, hipZ, ground);
    this.rideHeight(dt, speed, hipX, hipZ);
    this.pose(dt, loc, speed, hipX, hipZ);
    this.checkStanding(loc, hipX, hipZ);
  }

  private park(): void {
    this.phase = 0;
    this.standing = true;
    for (let f = 0; f < 2; f++) {
      this.planted[f] = 1;
      this.liftAt[f] = LIFT_AT_STANDING;
      this.cycle[f] = CYCLE_OFFSET[f]!;
    }
  }

  private orient(loc: Locomotion, observed: ArrayLike<number> | null, at: number): void {
    if (observed === null) leanedQuaternion(this.quat, loc.yaw + this.twist, loc.pitch, loc.roll);
    else for (let i = 0; i < 4; i++) this.quat[i] = observed[at + i]!;
    const x = this.quat[0]!;
    const y = this.quat[1]!;
    const z = this.quat[2]!;
    const w = this.quat[3]!;
    const r = this.rot;
    r[0] = 1 - 2 * (y * y + z * z);
    r[1] = 2 * (x * y - z * w);
    r[2] = 2 * (x * z + y * w);
    r[3] = 2 * (x * y + z * w);
    r[4] = 1 - 2 * (x * x + z * z);
    r[5] = 2 * (y * z - x * w);
    r[6] = 2 * (x * z - y * w);
    r[7] = 2 * (y * z + x * w);
    r[8] = 1 - 2 * (x * x + y * y);
  }

  /** Where foot `f` stands when he does, into `spot` (x, z): beside the pelvis at (`px`, `pz`) facing `yaw`. */
  private homeSpot(f: number, yaw: number, px: number, pz: number): void {
    const across = SIDES[f]! * HIP_HALF * FOOT_WIDTH;
    this.spot[0] = px + across * detCos(yaw);
    this.spot[1] = pz - across * detSin(yaw);
  }

  /** Foot `f`'s hip joint (world x, z) into `spot` and its height into the return value. */
  private hipOf(f: number, hipX: number, hipZ: number): number {
    const half = SIDES[f]! * HIP_HALF;
    this.spot[0] = hipX + this.rot[0]! * half;
    this.spot[1] = hipZ + this.rot[6]! * half;
    return this.hipY + this.rot[3]! * half;
  }

  /** The foot's offset from its hip (world) into `local`, in the torso's own frame. */
  private offsetFromHip(f: number, hipX: number, hipZ: number, x: number, y: number, z: number): void {
    const hipHeight = this.hipOf(f, hipX, hipZ);
    const dx = x - this.spot[0]!;
    const dy = y - hipHeight;
    const dz = z - this.spot[1]!;
    const r = this.rot;
    this.local[0] = r[0]! * dx + r[3]! * dy + r[6]! * dz;
    this.local[1] = r[1]! * dx + r[4]! * dy + r[7]! * dz;
    this.local[2] = r[2]! * dx + r[5]! * dy + r[8]! * dz;
  }

  /** The foot's cycle moves on: it lifts when its stance is up or it is out of reach, swings to where the pelvis will pass over, and lands. */
  private stepFoot(f: number, loc: Locomotion, hipX: number, hipZ: number, ground: GroundAt): void {
    const before = this.cycle[f]!;
    const now = (this.phase + CYCLE_OFFSET[f]!) % 1;
    this.cycle[f] = now;
    const wrapped = now < before;
    if (this.planted[f]! === 1 && (now >= this.liftAt[f]! || ((this.planted[1 - f]! === 1 || loc.speed < PIVOT_FREE_SPEED) && this.outOfReach(f, hipX, hipZ)))) this.liftOff(f, now);
    if (this.planted[f]! === 0) {
      this.swingFoot(f, wrapped ? 1 : Math.min(1, (now - this.liftAt[f]!) / (1 - this.liftAt[f]!)), now, loc, hipX, hipZ, ground);
      if (wrapped) this.land(f, loc.speed, ground);
    } else {
      this.foot[f * 3] = this.plant[f * 3]!;
      this.foot[f * 3 + 1] = this.plant[f * 3 + 1]!;
      this.foot[f * 3 + 2] = this.plant[f * 3 + 2]!;
    }
  }

  private outOfReach(f: number, hipX: number, hipZ: number): boolean {
    this.offsetFromHip(f, hipX, hipZ, this.plant[f * 3]!, this.plant[f * 3 + 1]!, this.plant[f * 3 + 2]!);
    const outward = this.local[0]! * SIDES[f]!;
    return Math.abs(this.local[2]!) > REACH_ALONG || outward < -REACH_ACROSS || outward > REACH_OUT;
  }

  private liftOff(f: number, now: number): void {
    this.planted[f] = 0;
    if (now < this.liftAt[f]!) this.liftAt[f] = Math.min(now, LATEST_LIFT);
    for (let i = 0; i < 3; i++) this.start[f * 3 + i] = this.plant[f * 3 + i]!;
  }

  private land(f: number, speed: number, ground: GroundAt): void {
    this.planted[f] = 1;
    this.liftAt[f] = atSpeed(speed, STANCE);
    this.plant[f * 3] = this.foot[f * 3]!;
    this.plant[f * 3 + 2] = this.foot[f * 3 + 2]!;
    this.plant[f * 3 + 1] = ground(this.foot[f * 3]!, this.foot[f * 3 + 2]!) + FOOT_RISE;
  }

  /** Foot `f` `s` (0 to 1) of the way through its swing, from where it lifted to where the pelvis will pass over it when it lands, lifted between. */
  private swingFoot(f: number, s: number, now: number, loc: Locomotion, hipX: number, hipZ: number, ground: GroundAt): void {
    const speed = loc.speed;
    const remaining = s >= 1 ? 0 : (1 - now) / Math.max(this.cadence, 0.5);
    const yawThen = loc.yaw + loc.turnRate * remaining;
    const ahead = (speed * atSpeed(speed, STANCE)) / (2 * Math.max(this.cadence, 0.5)) + BRAKE_REACH * Math.max(0, -loc.accel);
    const across = SIDES[f]! * HIP_HALF * FOOT_WIDTH;
    const sinThen = detSin(yawThen);
    const cosThen = detCos(yawThen);
    const targetX = hipX + detSin(loc.yaw) * speed * remaining + sinThen * ahead + cosThen * across;
    const targetZ = hipZ + detCos(loc.yaw) * speed * remaining + cosThen * ahead - sinThen * across;
    const targetY = ground(targetX, targetZ) + FOOT_RISE;
    const e = smoothstep(s);
    const o = f * 3;
    this.foot[o] = this.start[o]! + (targetX - this.start[o]!) * e;
    this.foot[o + 2] = this.start[o + 2]! + (targetZ - this.start[o + 2]!) * e;
    this.foot[o + 1] = this.start[o + 1]! + (targetY - this.start[o + 1]!) * e + atSpeed(speed, CLEARANCE) * detSin(Math.PI * s);
    this.aboveLanding[f] = this.foot[o + 1]! - targetY;
    this.landY[f] = targetY;
    this.landSpan[f] = Math.sqrt(ahead * ahead + across * across);
  }

  /** How far down the pelvis stands from a foot `span` m off (horizontally) its hip, for a leg of `length`: never less than `MIN_DROP_SHARE` of the leg. */
  private dropFor(length: number, span2: number): number {
    return Math.sqrt(Math.max(length * length - span2, (MIN_DROP_SHARE * length) ** 2));
  }

  /**
   * The height the pelvis may stand at: as high as the legs on the ground (or about to land) let it. In a flight, with no foot down, the foot that lands first
   * does: the pelvis eases toward the height it will have there, so it neither falls free nor jumps at the landing.
   */
  private allowedHeight(speed: number, hipX: number, hipZ: number): number {
    const length = atSpeed(speed, STANCE_LEG);
    let supported = Infinity;
    let landing = Infinity;
    for (let f = 0; f < 2; f++) {
      const hipHeight = this.hipOf(f, hipX, hipZ);
      if (this.planted[f]! === 1 || this.aboveLanding[f]! <= NEAR_GROUND) {
        const dx = this.foot[f * 3]! - this.spot[0]!;
        const dz = this.foot[f * 3 + 2]! - this.spot[1]!;
        supported = Math.min(supported, this.foot[f * 3 + 1]! + this.dropFor(length, dx * dx + dz * dz) + this.hipY - hipHeight);
      } else {
        landing = Math.min(landing, this.landY[f]! + this.dropFor(length, this.landSpan[f]! ** 2) + this.hipY - hipHeight);
      }
    }
    return supported !== Infinity ? supported : landing;
  }

  /** The pelvis's height follows what the legs allow with a damped spring. */
  private rideHeight(dt: number, speed: number, hipX: number, hipZ: number): void {
    const allowed = this.allowedHeight(speed, hipX, hipZ);
    const step = dt / HEIGHT_SUBSTEPS;
    for (let i = 0; i < HEIGHT_SUBSTEPS; i++) {
      this.hipRise += (HEIGHT_FREQUENCY * HEIGHT_FREQUENCY * (allowed - this.hipY) - 2 * HEIGHT_FREQUENCY * this.hipRise) * step;
      this.hipY += this.hipRise * step;
    }
  }

  /** Legs from the feet, then the arms, neck and torso turn from the legs, and the torso's centre from the pelvis. */
  private pose(dt: number, loc: Locomotion, speed: number, hipX: number, hipZ: number): void {
    const t = this.targets;
    for (let f = 0; f < 2; f++) {
      this.offsetFromHip(f, hipX, hipZ, this.foot[f * 3]!, this.foot[f * 3 + 1]!, this.foot[f * 3 + 2]!);
      solveLeg(this.legs, f * 3, this.local[0]!, this.local[1]!, this.local[2]!, SIDES[f]!);
    }
    t[GAIT.HIP_L] = this.legs[LEG.SWING]!;
    t[GAIT.HIP_R] = this.legs[3 + LEG.SWING]!;
    t[GAIT.ROLL_L] = this.legs[LEG.ROLL]!;
    t[GAIT.ROLL_R] = this.legs[3 + LEG.ROLL]!;
    t[GAIT.KNEE_L] = this.legs[LEG.KNEE]!;
    t[GAIT.KNEE_R] = this.legs[3 + LEG.KNEE]!;
    const elbow = atSpeed(speed, ELBOW_BASE);
    const mean = this.hipMean;
    const meanEase = Math.min(1, dt * ARM_MEAN_EASE);
    mean[0]! += (t[GAIT.HIP_L]! - mean[0]!) * meanEase;
    mean[1]! += (t[GAIT.HIP_R]! - mean[1]!) * meanEase;
    const rest = ARM_REST_PER_LEAN * loc.pitch + atSpeed(speed, ARM_BACK_BIAS);
    t[GAIT.ARM_L] = rest + ARM_SHARE * (t[GAIT.HIP_R]! - mean[1]!);
    t[GAIT.ARM_R] = rest + ARM_SHARE * (t[GAIT.HIP_L]! - mean[0]!);
    t[GAIT.ELBOW_L] = Math.max(ELBOW_MOST, elbow + ELBOW_PER_SWING * t[GAIT.ARM_L]!);
    t[GAIT.ELBOW_R] = Math.max(ELBOW_MOST, elbow + ELBOW_PER_SWING * t[GAIT.ARM_R]!);
    const twistTarget = (TWIST_GAIN * (t[GAIT.HIP_R]! - t[GAIT.HIP_L]!)) / 2;
    this.twist += (twistTarget - this.twist) * Math.min(1, dt * TWIST_EASE);
    t[GAIT.NECK_TURN] = -NECK_COUNTER_TURN * this.twist;
    t[GAIT.NECK_NOD] = -NECK_LEVEL * loc.pitch;
    this.swayToStance(dt);
    this.writeRates(dt);
    const r = this.rot;
    this.anchor[0] = hipX + r[1]! * HIP_DROP;
    this.anchor[1] = this.hipY + r[4]! * HIP_DROP;
    this.anchor[2] = hipZ + r[7]! * HIP_DROP;
  }

  /** `rates` from how far each target moved since the last step, held to what a joint may be asked to do (and none on the first step, which has nothing to compare to). */
  private writeRates(dt: number): void {
    for (let i = 0; i < GAIT.COUNT; i++) {
      const rate = this.needsBaseline ? 0 : (this.targets[i]! - this.lastTargets[i]!) / dt;
      this.rates[i] = Math.max(-RATE_MAX, Math.min(RATE_MAX, rate));
      this.lastTargets[i] = this.targets[i]!;
    }
    this.needsBaseline = false;
  }

  /** The pelvis sways toward the foot it stands on, the share of each stance weighted smoothly. */
  private swayToStance(dt: number): void {
    const ease = Math.min(1, dt * WEIGHT_EASE);
    for (let f = 0; f < 2; f++) this.weight[f]! += (this.planted[f]! - this.weight[f]!) * ease;
    this.sway += (SWAY * (this.weight[1]! - this.weight[0]!) - this.sway) * ease;
  }

  /** Both feet home and he is not moving: the cycle is parked at its start. */
  private checkStanding(loc: Locomotion, hipX: number, hipZ: number): void {
    let home = loc.speed <= MOVING_SPEED && Math.abs(loc.turnRate) <= MOVING_TURN;
    for (let f = 0; f < 2 && home; f++) {
      this.homeSpot(f, loc.yaw, hipX, hipZ);
      const dx = this.plant[f * 3]! - this.spot[0]!;
      const dz = this.plant[f * 3 + 2]! - this.spot[1]!;
      home = this.planted[f]! === 1 && dx * dx + dz * dz < HOME_RADIUS * HOME_RADIUS;
    }
    if (home) this.park();
    else this.standing = false;
  }
}
