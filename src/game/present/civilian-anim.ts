import * as THREE from "three";
import { ACTIVITY, ACTIVITY_SECONDS, type ActivityName } from "../ai/civilians/civilian-activity.ts";
import { CAR_DOOR, carDoorOpennessOf } from "../ai/civilians/civilian-car-door.ts";
import { ARM, armChannel, CHANNEL, CHANNELS, EXPRESSIVE, LEG, legChannel, MIRROR_CHANNEL, MIRROR_SIGN, sideSign } from "./civilian-anim-channels.ts";
import { CLIPS, type TrackSpec } from "./civilian-anim-clips.ts";
import type { PoseSmoothing } from "./civilian-anim-smoothing.ts";
import { FOREARM_LENGTH, HIP_X, HIP_Y, renderRig, setTorsoRotation, SHIN_LENGTH, SHOULDER_X, THIGH_LENGTH, UPPER_ARM_LENGTH, type PoseSink } from "./civilian-anim-rig.ts";
import { DRIVER_SIDE } from "../vehicle/constants.ts";
import type { Stoops } from "../world/openworld/openworld-stoops.ts";
import { WALK_SPEED } from "./walker-locomotion.ts";
import { POSE_ARM_OUT } from "./civilian-art-constants.ts";
import { blankStance, walkStance, type Stance } from "./people.ts";
import { ANKLE_Y, SHOULDER_Y } from "./ragdoll-body.ts";

/** One civilian's drawing state: where she stands, her walk, and the activity (`ACTIVITY`) she is in. */
export type ActivityPose = {
  x: number;
  y: number;
  z: number;
  yaw: number;
  /** Walk phase (rad) and speed (m/s): she strides while it is above 0. */
  stride: number;
  speed: number;
  activity: number;
  /** Seconds since the activity began, and until it ends. */
  clock: number;
  left: number;
  /** Height of the seat top, or the counter top, over her feet (m). */
  surface: number;
  /** Where her partner stands, in her frame: radians from straight ahead, positive toward her +x. */
  hasPartner: boolean;
  bearing: number;
  /** The civilian's look word: her handedness, where in a loop her fidgets start, her pace and her amplitude. */
  variant: number;
  /** How jumpy she is (`neuroticismOf` her look word, 0..1): the flinch's size and pace. */
  nerve: number;
  /** She walks a stoop's door spur, and the stoops that tell the height of the tread under a foot: her feet stand on the treads (`plantOnTreads`). */
  onSpur: boolean;
  stoops: Stoops | null;
};

const ACTIVITY_NAMES = Object.keys(ACTIVITY) as ActivityName[];
const ACTIVITY_CODES = ACTIVITY_NAMES.length;
/** Which side a clip's main limbs take: the civilian's dominant one, the partner's, or her right (-x) always. */
const CLIP_SIDE = { handed: 0, partner: 1, right: 2 } as const;
/** The mirroring that puts a clip's main limbs on her -x side (her right). */
const MAIN_ON_MINUS_X = 0;
const TIME_TOLERANCE = 1e-9;

/** Fails at load on a track that would misbehave: keys out of order, a loop that does not close, a clip's keys past its length. */
function validateTrack(name: ActivityName, spec: TrackSpec): void {
  const where = `${name} clip, channel ${spec.channel}`;
  const { keys, period } = spec;
  if (keys.length === 0) throw new Error(`${where}: no keys`);
  for (let at = 1; at < keys.length; at++) if (keys[at]![0] <= keys[at - 1]![0]) throw new Error(`${where}: key times must rise`);
  const last = keys[keys.length - 1]!;
  if (period !== undefined) {
    if (last[0] !== period || Math.abs(last[1] - keys[0]![1]) > TIME_TOLERANCE) throw new Error(`${where}: a loop's last key must be at its period and equal its first value`);
    return;
  }
  const seconds = ACTIVITY_SECONDS[name];
  if (seconds === 0 && keys.length > 1) throw new Error(`${where}: a looping activity's track must loop or hold one value`);
  if (seconds > 0 && last[0] > seconds + TIME_TOLERANCE) throw new Error(`${where}: key at ${last[0]} s past the clip's ${seconds} s`);
}

/** Every clip's tracks and keys in flat typed arrays, so a frame reads them without a lookup or an allocation. */
function packClips() {
  let trackTotal = 0;
  let keyTotal = 0;
  for (const name of ACTIVITY_NAMES) {
    const clip = CLIPS[name];
    if (clip === undefined) continue;
    trackTotal += clip.tracks.length;
    for (const spec of clip.tracks) keyTotal += spec.keys.length;
  }
  const packed = {
    clipFirstTrack: new Int32Array(ACTIVITY_CODES),
    clipTrackCount: new Int32Array(ACTIVITY_CODES),
    clipBlendIn: new Float64Array(ACTIVITY_CODES),
    clipBlendOut: new Float64Array(ACTIVITY_CODES),
    clipSeconds: new Float64Array(ACTIVITY_CODES),
    clipSide: new Uint8Array(ACTIVITY_CODES),
    trackChannel: new Int32Array(trackTotal),
    trackPeriod: new Float64Array(trackTotal),
    trackAboveSurface: new Uint8Array(trackTotal),
    trackKeyStart: new Int32Array(trackTotal),
    trackKeyCount: new Int32Array(trackTotal),
    keyTime: new Float64Array(keyTotal),
    keyValue: new Float64Array(keyTotal),
  };
  let nextTrack = 0;
  let nextKey = 0;
  for (const name of ACTIVITY_NAMES) {
    const clip = CLIPS[name];
    if (clip === undefined) continue;
    const code = ACTIVITY[name];
    packed.clipFirstTrack[code] = nextTrack;
    packed.clipTrackCount[code] = clip.tracks.length;
    packed.clipBlendIn[code] = clip.blendIn;
    packed.clipBlendOut[code] = clip.blendOut;
    packed.clipSeconds[code] = ACTIVITY_SECONDS[name];
    packed.clipSide[code] = clip.side === undefined ? CLIP_SIDE.handed : CLIP_SIDE[clip.side];
    for (const spec of clip.tracks) {
      validateTrack(name, spec);
      packed.trackChannel[nextTrack] = spec.channel;
      packed.trackPeriod[nextTrack] = spec.period ?? 0;
      packed.trackAboveSurface[nextTrack] = spec.aboveSurface === true ? 1 : 0;
      packed.trackKeyStart[nextTrack] = nextKey;
      packed.trackKeyCount[nextTrack] = spec.keys.length;
      for (const [time, value] of spec.keys) {
        packed.keyTime[nextKey] = time;
        packed.keyValue[nextKey++] = value;
      }
      nextTrack++;
    }
  }
  return packed;
}

const PACKED = packClips();
const { clipFirstTrack: CLIP_FIRST_TRACK, clipTrackCount: CLIP_TRACK_COUNT, clipBlendIn: CLIP_BLEND_IN, clipBlendOut: CLIP_BLEND_OUT, clipSeconds: CLIP_SECONDS, clipSide: CLIP_SIDES } = PACKED;
const { trackChannel: TRACK_CHANNEL, trackPeriod: TRACK_PERIOD, trackAboveSurface: TRACK_ABOVE_SURFACE, trackKeyStart: TRACK_KEY_START, trackKeyCount: TRACK_KEY_COUNT, keyTime: KEY_TIME, keyValue: KEY_VALUE } = PACKED;

/** A limb's walk, read off `walkStance` at its widest each way and at rest (as the guards walk): the swing and the bend's three levels. */
type Gait = { swing: number; bendAtRest: number; bendForward: number; bendBack: number };
const WALK_AT_FORWARD = Math.PI / 2;
const WALK_AT_BACK = -Math.PI / 2;
const WALK_AT_REST = 0;

function makeGait(isArm: boolean, side: number, forward: Stance, back: Stance, rest: Stance): Gait {
  const angle = (stance: Stance): number => (isArm ? stance.arm[side]! : stance.thigh[side]!);
  const bend = (stance: Stance): number => (isArm ? stance.elbow[side]! : stance.knee[side]!);
  return { swing: angle(forward), bendAtRest: bend(rest), bendForward: bend(forward) - bend(rest), bendBack: bend(back) - bend(rest) };
}

const WALK_FORWARD = walkStance(WALK_AT_FORWARD, false, blankStance());
const WALK_BACK = walkStance(WALK_AT_BACK, false, blankStance());
const WALK_REST = walkStance(WALK_AT_REST, false, blankStance());
const ARM_GAITS = [makeGait(true, 0, WALK_FORWARD, WALK_BACK, WALK_REST), makeGait(true, 1, WALK_FORWARD, WALK_BACK, WALK_REST)] as const;
const LEG_GAITS = [makeGait(false, 0, WALK_FORWARD, WALK_BACK, WALK_REST), makeGait(false, 1, WALK_FORWARD, WALK_BACK, WALK_REST)] as const;

/** Where a hand's target sits until a clip names one: at the hip, so a hand's weight rising from 0 starts from a rest. */
const REST_HAND_Z = 0.1;
const REST_HAND_Y = 0.9;
/** A hand's target is this far (m) from the middle line, on its own side, until a clip names another. */
const HAND_TARGET_X = 0.1;
/** Fidgets (a loop's tracks) grow from their rest value over this long (s), so a loop starts on the pose it follows. */
const FIDGET_RAMP_SECONDS = 1.5;
/** Loops start at most this far (s) in, by civilian, so a bar of sitters does not glance together. */
const LOOP_OFFSET_SECONDS = 60;
const LOOP_OFFSET_STEPS = 1023;
const LOOP_OFFSET_SHIFT = 1;
const HANDEDNESS_BIT = 1;
/** A partner this close to straight ahead (rad) does not say which side a clip's main limbs are on. */
const BEARING_DEAD_ZONE = 0.05;
/** The head turns at most this far (rad) toward a partner. */
const LOOK_LIMIT = 1.1;
/** A hand's target this close (m) to straight over its shoulder leaves the arm's sweep where it was: the angle there flips with a hair's move. */
const SWEEP_HELD_RADIUS = 0.08;
/** A channel weight under this is not worth solving. */
const NEGLIGIBLE_WEIGHT = 1e-4;
/** Seated, her thigh's underside rests on the seat: the hip joint sits one thigh half-thickness over its top. */
const THIGH_HALF_THICKNESS = CAR_DOOR.hipOverSeat;
/** The lowest the hips go (m) on a very low seat. */
const LOWEST_SEATED_HIP_Y = 0.25;

/**
 * The leg swing is a sine rounded toward a triangle wave (`asin(FLAT * sin) / asin(FLAT)`): a foot on the ground then goes back at nearly the pace the body goes forward, instead of
 * 1.6 times it mid-stance and none at its ends, so it does not slide. The stride's own length (`STRIDE_METRES`) and the legs' swing match: a foot's whole stance stands 0.75 m behind the last.
 */
const STANCE_FLAT = 0.95;
const STANCE_FLAT_SCALE = 1 / Math.asin(STANCE_FLAT);
/** The shoulders turn this far (rad) against the hips each step, the head half turning back to hold its gaze, the hips fall this far (m) as the legs spread, and the head nods this far (rad) twice a stride. */
const SHOULDER_TWIST = 0.1;
const HEAD_COUNTER_TWIST = 0.7;
const HIP_DROP = 0.03;
const HEAD_NOD = 0.02;
/** An arm swung forward bends its elbow this much more (rad). */
const ELBOW_FORWARD_BEND = 0.3;
/** The knee's bend at its swing through (rad), from the guards' walk. */
const KNEE_SWING_BEND = Math.max(LEG_GAITS[0].bendForward, LEG_GAITS[1].bendBack);

/** Bits of her look word give her her pace (the clip's clock runs this much faster or slower) and amplitude (how far she moves from her walk), a tenth and an eighth either way; none set is neither. */
const PACE_SPREAD = 0.1;
const PACE_LOOK_SHIFT = 12;
const AMPLITUDE_SPREAD = 0.125;
const AMPLITUDE_LOOK_SHIFT = 19;
const SPREAD_BITS = 7;
const SPREAD_SIZE = 1 << SPREAD_BITS;
/** The bits as a number from -1 (the top half set, all of it) to just under 1, 0 for none set. */
const CENTRED = Float64Array.from({ length: SPREAD_SIZE }, (_, raw) => (raw >= SPREAD_SIZE / 2 ? raw - SPREAD_SIZE : raw) / (SPREAD_SIZE / 2));
/** A flinch is quicker and bigger the jumpier the person (`neuroticismOf`): the pace and the amplitude of the calmest and the jumpiest. */
const RECOIL_PACE = { calm: 0.85, jumpy: 1.25 } as const;
const RECOIL_AMPLITUDE = { calm: 0.7, jumpy: 1.3 } as const;

/**
 * The numbers the functions below hand each other. A double passed as an argument or returned is boxed on the heap whenever the call is not inlined, and forty dummies posed a
 * frame must allocate nothing, so doubles go through these slots and the functions take indices and objects: the two-bone solve's reach and answer, a door point's height,
 * the door's openness and the reach's weight, and the pace and the amplitude of the person.
 */
const scratch = new Float64Array(12);
const SOLVE_UPPER = 0;
const SOLVE_LOWER = 1;
const SOLVE_FORWARD = 2;
const SOLVE_DOWN = 3;
const SOLVE_LINE = 4;
const SOLVE_OFFSET = 5;
const SOLVE_BEND = 6;
const REACH_HEIGHT = 7;
const REACH_OPENNESS = 8;
const REACH_WEIGHT = 9;
const PACE = 10;
const AMPLITUDE = 11;

const channels = new Float64Array(CHANNELS);
const torsoInverse = new THREE.Quaternion();
const target = new THREE.Vector3();

/** The walk is the full swing at `WALK_SPEED`; a slower or faster pace scales it (`gait` is the pace over that, to `MAX_GAIT`) between these limits. */
const MAX_GAIT = 2.3;
const LEG_GAIT_FLOOR = 0.3;
/** Under this drawn speed (m/s) the leg swing has no floor: a civilian coming to a stop settles her legs. */
const LEG_FLOOR_ABOVE = 0.3;
const LEG_GAIT_CEILING = 1.6;
const ARM_GAIT_FLOOR = 0.3;
const ARM_GAIT_CEILING = 1.8;
/** The torso leans forward this much (rad) a unit of gait over a walk's, the gait's excess clamped to `MAX_LEAN_GAIT`; the knee bends `KNEE_BEND_FLOOR` of its swing-through at a stand and the rest with gait. */
const LEAN_PER_GAIT = 0.15;
const MAX_LEAN_GAIT = 1.3;
const KNEE_BEND_FLOOR = 0.6;
/** She walks above this pace (m/s): under it she stands. */
const WALKING_ABOVE = 0.05;

/** The stride at `pose.stride` in every limb's channels and the body's counter-turn, bob and nod, on top of the standing channels `fillBase` made; the pace (`pose.speed`) sets how big each is. */
function fillWalk(pose: ActivityPose): void {
  const gait = Math.min(MAX_GAIT, pose.speed / WALK_SPEED);
  const legGain = Math.min(LEG_GAIT_CEILING, Math.max(pose.speed > LEG_FLOOR_ABOVE ? LEG_GAIT_FLOOR : 0, gait));
  const armGain = Math.min(ARM_GAIT_CEILING, Math.max(ARM_GAIT_FLOOR, gait));
  const kneeGain = KNEE_BEND_FLOOR + (1 - KNEE_BEND_FLOOR) * gait;
  const sine = Math.sin(pose.stride);
  const passing = Math.cos(pose.stride);
  const swing = Math.asin(STANCE_FLAT * sine) * STANCE_FLAT_SCALE;
  for (let side = 0; side < 2; side++) {
    const armGait = ARM_GAITS[side]!;
    const arm = armChannel(side, 0);
    channels[arm + ARM.swing] = armGait.swing * sine * armGain;
    channels[arm + ARM.elbow] = armGait.bendAtRest - ELBOW_FORWARD_BEND * Math.max(0, (-armGait.swing * sine) / Math.abs(armGait.swing));
    const legGait = LEG_GAITS[side]!;
    const leg = legChannel(side, 0);
    channels[leg + LEG.swing] = legGait.swing * swing * legGain;
    channels[leg + LEG.knee] = KNEE_SWING_BEND * kneeGain * Math.max(0, side === 0 ? passing : -passing);
  }
  channels[CHANNEL.torsoTwist] = -SHOULDER_TWIST * sine * legGain;
  channels[CHANNEL.headYaw] = HEAD_COUNTER_TWIST * SHOULDER_TWIST * sine * legGain;
  channels[CHANNEL.pelvisDrop] = HIP_DROP * sine * sine * legGain;
  channels[CHANNEL.torsoPitch] = LEAN_PER_GAIT * Math.min(MAX_LEAN_GAIT, Math.max(0, gait - 1));
  channels[CHANNEL.headPitch] = HEAD_NOD * Math.cos(2 * pose.stride);
}

/** Standing in every channel, and walking at `pose.stride` when she moves (`pose.speed` above `WALKING_ABOVE`). */
function fillBase(pose: ActivityPose): void {
  channels.fill(0);
  for (let side = 0; side < 2; side++) {
    const arm = armChannel(side, 0);
    channels[arm + ARM.out] = sideSign(side) * POSE_ARM_OUT;
    channels[arm + ARM.handZ] = REST_HAND_Z;
    channels[arm + ARM.handY] = REST_HAND_Y;
    channels[arm + ARM.handOut] = HAND_TARGET_X;
  }
  if (pose.speed > WALKING_ABOVE) fillWalk(pose);
}

/** Which of the two mirrorings (0: main limbs on -x, 1: on +x) a clip runs in: her right for a right-sided clip, toward a partner it reacts to, else her handedness. */
function mirrorIndexOf(pose: ActivityPose, side: number): number {
  if (side === CLIP_SIDE.right) return MAIN_ON_MINUS_X;
  if (side === CLIP_SIDE.partner && pose.hasPartner && Math.abs(pose.bearing) > BEARING_DEAD_ZONE) return pose.bearing > 0 ? 1 : 0;
  return (pose.variant & HANDEDNESS_BIT) === 0 ? 1 : 0;
}

/** `scratch` holds the pace and the amplitude her look word gives her for activity `code`: the flinch by how jumpy she is. */
function fillPersonal(code: number, pose: ActivityPose): void {
  if (code === ACTIVITY.recoil) {
    scratch[PACE] = RECOIL_PACE.calm + (RECOIL_PACE.jumpy - RECOIL_PACE.calm) * pose.nerve;
    scratch[AMPLITUDE] = RECOIL_AMPLITUDE.calm + (RECOIL_AMPLITUDE.jumpy - RECOIL_AMPLITUDE.calm) * pose.nerve;
    return;
  }
  scratch[PACE] = 1 + PACE_SPREAD * CENTRED[(pose.variant >>> PACE_LOOK_SHIFT) & (SPREAD_SIZE - 1)]!;
  scratch[AMPLITUDE] = 1 + AMPLITUDE_SPREAD * CENTRED[(pose.variant >>> AMPLITUDE_LOOK_SHIFT) & (SPREAD_SIZE - 1)]!;
}

/**
 * Clip `code`'s tracks at the pose's clock (at her pace), each channel moved by the clip's weight (it eases in from the walk and out over its last seconds; more or less by her amplitude, on the channels
 * that are hers to exaggerate) of the way from the walk to the track's value. Keys are eased between; a loop repeats and grows from its rest value.
 */
function applyClip(code: number, pose: ActivityPose): void {
  const first = CLIP_FIRST_TRACK[code]!;
  const end = first + CLIP_TRACK_COUNT[code]!;
  fillPersonal(code, pose);
  const clock = pose.clock * scratch[PACE]!;
  const amplitude = scratch[AMPLITUDE]!;
  const scalesAll = code === ACTIVITY.recoil;
  const blendIn = CLIP_BLEND_IN[code]!;
  const blendOut = CLIP_BLEND_OUT[code]!;
  const seconds = CLIP_SECONDS[code]!;
  const rising = blendIn > 0 ? Math.min(1, Math.max(0, pose.clock / blendIn)) : 1;
  const remaining = seconds > 0 ? Math.min(pose.left, seconds - pose.clock) : pose.left;
  const falling = blendOut > 0 ? Math.min(1, Math.max(0, remaining / blendOut)) : 1;
  const weight = rising * rising * (3 - 2 * rising) * (falling * falling * (3 - 2 * falling));
  const growing = Math.min(1, Math.max(0, pose.clock / FIDGET_RAMP_SECONDS));
  const fidgetRamp = growing * growing * (3 - 2 * growing);
  const loopOffset = (((pose.variant >>> LOOP_OFFSET_SHIFT) & LOOP_OFFSET_STEPS) / LOOP_OFFSET_STEPS) * LOOP_OFFSET_SECONDS;
  const mirrorAt = mirrorIndexOf(pose, CLIP_SIDES[code]!) * CHANNELS;
  for (let track = first; track < end; track++) {
    const period = TRACK_PERIOD[track]!;
    const from = TRACK_KEY_START[track]!;
    const last = from + TRACK_KEY_COUNT[track]! - 1;
    const looped = clock + loopOffset;
    const time = period > 0 ? looped - Math.floor(looped / period) * period : clock;
    let value = KEY_VALUE[last]!;
    if (time <= KEY_TIME[from]!) value = KEY_VALUE[from]!;
    else if (time < KEY_TIME[last]!) {
      let key = from;
      while (KEY_TIME[key + 1]! <= time) key++;
      const progress = (time - KEY_TIME[key]!) / (KEY_TIME[key + 1]! - KEY_TIME[key]!);
      value = KEY_VALUE[key]! + (KEY_VALUE[key + 1]! - KEY_VALUE[key]!) * progress * progress * (3 - 2 * progress);
    }
    if (period > 0) value = KEY_VALUE[from]! + (value - KEY_VALUE[from]!) * fidgetRamp;
    if (TRACK_ABOVE_SURFACE[track] === 1) value += pose.surface;
    const slot = mirrorAt + TRACK_CHANNEL[track]!;
    const channel = MIRROR_CHANNEL[slot]!;
    const strength = EXPRESSIVE[channel] === 1 ? weight * amplitude : scalesAll ? Math.min(1, weight * amplitude) : weight;
    channels[channel] = channels[channel]! + strength * (MIRROR_SIGN[slot]! * value - channels[channel]!);
  }
}

/** Sinks the pelvis onto a seat `pose.surface` high by the `seat` channel's share. */
function seatPelvis(pose: ActivityPose): void {
  const seatedHipY = Math.max(LOWEST_SEATED_HIP_Y, pose.surface + THIGH_HALF_THICKNESS);
  channels[CHANNEL.pelvisDrop] = channels[CHANNEL.pelvisDrop]! + channels[CHANNEL.seat]! * Math.max(0, HIP_Y - seatedHipY);
}

/** A limb of segments `SOLVE_UPPER` and `SOLVE_LOWER` reaching `SOLVE_FORWARD` ahead and `SOLVE_DOWN` below its root: the answer is the straight reach's angle (swing convention: negative is forward), how far off that line the upper segment sits, and the joint's bend, in `SOLVE_LINE`, `SOLVE_OFFSET` and `SOLVE_BEND`. */
function solveTwoBone(): void {
  const upper = scratch[SOLVE_UPPER]!;
  const lower = scratch[SOLVE_LOWER]!;
  const forward = scratch[SOLVE_FORWARD]!;
  const down = scratch[SOLVE_DOWN]!;
  const reach = Math.min(upper + lower, Math.max(Math.abs(upper - lower) + NEGLIGIBLE_WEIGHT, Math.sqrt(forward * forward + down * down)));
  scratch[SOLVE_LINE] = Math.atan2(-forward, down);
  scratch[SOLVE_OFFSET] = Math.acos(Math.max(-1, Math.min(1, (upper * upper + reach * reach - lower * lower) / (2 * upper * reach))));
  scratch[SOLVE_BEND] = Math.PI - Math.acos(Math.max(-1, Math.min(1, (upper * upper + lower * lower - reach * reach) / (2 * upper * lower))));
}

/** The tread heights under a foot: `Stoops.liftFeet` reads a spot out of, and writes its answer into, rows of arrays. */
const footX = new Float32Array(1);
const footZ = new Float32Array(1);
const footY = new Float32Array(1);
/** A rise under this (m) is not worth a solve. */
const NEGLIGIBLE_RISE = 1e-4;

/**
 * On a stoop's spur, each leg's ankle (where the walk put it) stands on the tread under it: the stoops give that tread's height, and the leg is solved again to reach the ankle that much higher (or lower)
 * than the walk had it, straight ahead of its hip as before. A leg that cannot reach is left as it was.
 */
function plantOnTreads(pose: ActivityPose): void {
  const stoops = pose.stoops;
  if (stoops === null) return;
  const sine = Math.sin(pose.yaw);
  const cosine = Math.cos(pose.yaw);
  for (let side = 0; side < 2; side++) {
    const leg = legChannel(side, 0);
    const upper = channels[leg + LEG.swing]!;
    const lower = upper + channels[leg + LEG.knee]!;
    const forward = -(THIGH_LENGTH * Math.sin(upper) + SHIN_LENGTH * Math.sin(lower));
    const down = THIGH_LENGTH * Math.cos(upper) + SHIN_LENGTH * Math.cos(lower);
    const ahead = forward + channels[CHANNEL.pelvisForward]!;
    const across = sideSign(side) * HIP_X + channels[CHANNEL.pelvisSide]!;
    footX[0] = pose.x + cosine * across + sine * ahead;
    footZ[0] = pose.z - sine * across + cosine * ahead;
    stoops.liftFeet(footX, footZ, footY, 0);
    const rise = footY[0]! - pose.y;
    if (Math.abs(rise) < NEGLIGIBLE_RISE) continue;
    const reach = Math.sqrt(forward * forward + (down - rise) * (down - rise));
    if (reach > THIGH_LENGTH + SHIN_LENGTH || reach < Math.abs(THIGH_LENGTH - SHIN_LENGTH) + NEGLIGIBLE_WEIGHT) continue;
    scratch[SOLVE_UPPER] = THIGH_LENGTH;
    scratch[SOLVE_LOWER] = SHIN_LENGTH;
    scratch[SOLVE_FORWARD] = forward;
    scratch[SOLVE_DOWN] = down - rise;
    solveTwoBone();
    channels[leg + LEG.swing] = scratch[SOLVE_LINE]! - scratch[SOLVE_OFFSET]!;
    channels[leg + LEG.knee] = scratch[SOLVE_BEND]!;
  }
}

/** With `plant`, each leg reaches its ankle to the floor `footZ` ahead of the hip: the knee bends as the pelvis sinks, the feet stay put. */
function solveLegs(): void {
  const plant = channels[CHANNEL.plant]!;
  if (plant <= NEGLIGIBLE_WEIGHT) return;
  const hipY = HIP_Y - channels[CHANNEL.pelvisDrop]!;
  for (let side = 0; side < 2; side++) {
    const leg = legChannel(side, 0);
    scratch[SOLVE_UPPER] = THIGH_LENGTH;
    scratch[SOLVE_LOWER] = SHIN_LENGTH;
    scratch[SOLVE_FORWARD] = channels[leg + LEG.footZ]! - channels[CHANNEL.pelvisForward]!;
    scratch[SOLVE_DOWN] = hipY - ANKLE_Y - channels[CHANNEL.footRaise]!;
    solveTwoBone();
    channels[leg + LEG.swing] = channels[leg + LEG.swing]! + plant * (scratch[SOLVE_LINE]! - scratch[SOLVE_OFFSET]! - channels[leg + LEG.swing]!);
    channels[leg + LEG.knee] = channels[leg + LEG.knee]! + plant * (scratch[SOLVE_BEND]! - channels[leg + LEG.knee]!);
  }
}

/** With an arm's `hand` weight, the arm reaches its hand to (`handZ`, `handY`) in the body frame, through the torso's lean and twist. */
function solveHands(): void {
  if (channels[armChannel(0, ARM.hand)]! <= NEGLIGIBLE_WEIGHT && channels[armChannel(1, ARM.hand)]! <= NEGLIGIBLE_WEIGHT) return;
  const waistY = HIP_Y - channels[CHANNEL.pelvisDrop]!;
  setTorsoRotation(channels, torsoInverse);
  torsoInverse.invert();
  for (let side = 0; side < 2; side++) {
    const arm = armChannel(side, 0);
    const weight = channels[arm + ARM.hand]!;
    if (weight <= NEGLIGIBLE_WEIGHT) continue;
    target.set(sideSign(side) * channels[arm + ARM.handOut]! - channels[CHANNEL.pelvisSide]!, channels[arm + ARM.handY]! - waistY, channels[arm + ARM.handZ]! - channels[CHANNEL.pelvisForward]!);
    target.applyQuaternion(torsoInverse);
    const lateral = target.x - sideSign(side) * SHOULDER_X;
    const horizontal = Math.sqrt(lateral * lateral + target.z * target.z);
    scratch[SOLVE_UPPER] = UPPER_ARM_LENGTH;
    scratch[SOLVE_LOWER] = FOREARM_LENGTH;
    scratch[SOLVE_FORWARD] = horizontal;
    scratch[SOLVE_DOWN] = SHOULDER_Y - HIP_Y - target.y;
    solveTwoBone();
    const held = Math.min(1, horizontal / SWEEP_HELD_RADIUS);
    const sweepWeight = weight * held * held * (3 - 2 * held);
    channels[arm + ARM.swing] = channels[arm + ARM.swing]! + weight * (scratch[SOLVE_LINE]! + scratch[SOLVE_OFFSET]! - channels[arm + ARM.swing]!);
    channels[arm + ARM.elbow] = channels[arm + ARM.elbow]! + weight * (-scratch[SOLVE_BEND]! - channels[arm + ARM.elbow]!);
    channels[arm + ARM.sweep] = channels[arm + ARM.sweep]! + sweepWeight * (Math.atan2(lateral, target.z) - channels[arm + ARM.sweep]!);
    channels[arm + ARM.out] = channels[arm + ARM.out]! * (1 - weight);
    channels[arm + ARM.twist] = channels[arm + ARM.twist]! * (1 - weight);
  }
}

/** The arm that reaches the outer handle: the one toward the car's rear; the others reach with the one toward its front. */
const REAR_ARM = DRIVER_SIDE > 0 ? 0 : 1;
const FRONT_ARM = 1 - REAR_ARM;

/**
 * Arm `side`'s hand to the door point `point` (its place from the seat's H-point with the door shut, its height `REACH_HEIGHT`), carried round the hinge by the door's swing (`REACH_OPENNESS`),
 * `REACH_WEIGHT` of the way: the point in her own frame, through where she has stepped (`shift*`) and turned (`bodyYaw`).
 */
function reachForDoorPoint(side: number, point: { across: number; along: number }): void {
  const swing = scratch[REACH_OPENNESS]! * CAR_DOOR.openRad;
  const cosine = Math.cos(swing);
  const sine = Math.sin(swing);
  const fromHingeAcross = point.across - CAR_DOOR.hinge.across;
  const fromHingeAlong = point.along - CAR_DOOR.hinge.along;
  const swungAcross = CAR_DOOR.hinge.across + fromHingeAcross * cosine - fromHingeAlong * sine;
  const swungAlong = CAR_DOOR.hinge.along + fromHingeAlong * cosine + fromHingeAcross * sine;
  const toLeft = DRIVER_SIDE * (swungAlong + CAR_DOOR.behindSeat) - channels[CHANNEL.shiftSide]!;
  const toCar = CAR_DOOR.outFromSeat - swungAcross - channels[CHANNEL.shiftForward]!;
  const turned = channels[CHANNEL.bodyYaw]!;
  const arm = armChannel(side, 0);
  channels[arm + ARM.handOut] = sideSign(side) * (toLeft * Math.cos(turned) - toCar * Math.sin(turned));
  channels[arm + ARM.handZ] = toLeft * Math.sin(turned) + toCar * Math.cos(turned);
  channels[arm + ARM.handY] = scratch[REACH_HEIGHT]!;
  channels[arm + ARM.hand] = Math.max(channels[arm + ARM.hand]!, scratch[REACH_WEIGHT]!);
}

/** The reach weights of a car clip put a hand on the driver's door as it stands at this moment of the clip. */
function reachForDoor(pose: ActivityPose): void {
  const outsideHandle = channels[CHANNEL.reachOutsideHandle]!;
  const insideHandle = channels[CHANNEL.reachInsideHandle]!;
  const outsidePanel = channels[CHANNEL.reachOutsidePanel]!;
  if (outsideHandle <= NEGLIGIBLE_WEIGHT && insideHandle <= NEGLIGIBLE_WEIGHT && outsidePanel <= NEGLIGIBLE_WEIGHT) return;
  carDoorOpennessOf(pose, scratch, REACH_OPENNESS);
  if (outsideHandle > NEGLIGIBLE_WEIGHT) {
    scratch[REACH_HEIGHT] = CAR_DOOR.outsideHandle.up;
    scratch[REACH_WEIGHT] = outsideHandle;
    reachForDoorPoint(REAR_ARM, CAR_DOOR.outsideHandle);
  }
  if (insideHandle > NEGLIGIBLE_WEIGHT) {
    scratch[REACH_HEIGHT] = pose.surface + CAR_DOOR.insideHandle.aboveSeat;
    scratch[REACH_WEIGHT] = insideHandle;
    reachForDoorPoint(FRONT_ARM, CAR_DOOR.insideHandle);
  }
  if (outsidePanel > NEGLIGIBLE_WEIGHT) {
    scratch[REACH_HEIGHT] = CAR_DOOR.outsidePanel.up;
    scratch[REACH_WEIGHT] = outsidePanel;
    reachForDoorPoint(FRONT_ARM, CAR_DOOR.outsidePanel);
  }
}

/** The head turned toward her partner by the `lookAtPartner` channel's share. */
function lookAtPartner(pose: ActivityPose): void {
  if (!pose.hasPartner) return;
  const turn = Math.max(-LOOK_LIMIT, Math.min(LOOK_LIMIT, pose.bearing));
  channels[CHANNEL.headYaw] = channels[CHANNEL.headYaw]! + channels[CHANNEL.lookAtPartner]! * turn;
}

/** Slot `slot` of `sink` posed as `pose` says: the walk or stand, with her activity's clip blended over it; with `smoothing`, civilian `civilian`'s pose does not snap when her activity or her walk changes. Allocates nothing. */
export function poseActivity(sink: PoseSink, slot: number, pose: ActivityPose, smoothing?: PoseSmoothing, civilian = 0): void {
  fillBase(pose);
  const code = pose.activity;
  if (code < ACTIVITY_CODES && CLIP_TRACK_COUNT[code]! > 0) applyClip(code, pose);
  seatPelvis(pose);
  if (pose.onSpur) plantOnTreads(pose);
  solveLegs();
  reachForDoor(pose);
  solveHands();
  lookAtPartner(pose);
  smoothing?.apply(civilian, pose.activity, pose.speed > WALKING_ABOVE ? 1 : 0, channels);
  renderRig(sink, slot, pose, channels);
}
