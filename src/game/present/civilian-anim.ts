import * as THREE from "three";
import { ACTIVITY, ACTIVITY_SECONDS, type ActivityName } from "../ai/civilians/civilian-activity.ts";
import { ARM, armChannel, CHANNEL, CHANNELS, LEG, legChannel, MIRROR_CHANNEL, MIRROR_SIGN, sideSign } from "./civilian-anim-channels.ts";
import { CLIPS, type TrackSpec } from "./civilian-anim-clips.ts";
import { FOREARM_LENGTH, HIP_Y, renderRig, setTorsoRotation, SHIN_LENGTH, SHOULDER_X, THIGH_LENGTH, UPPER_ARM_LENGTH, type PoseSink } from "./civilian-anim-rig.ts";
import { POSE_ARM_OUT } from "./civilian-art-constants.ts";
import { blankStance, walkStance, type Stance } from "./people.ts";
import { ANKLE_Y, PARTS, SHOULDER_Y } from "./ragdoll-body.ts";

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
  /** The civilian's look word: handedness and where in a loop her fidgets start. */
  variant: number;
};

const ACTIVITY_NAMES = Object.keys(ACTIVITY) as ActivityName[];
const ACTIVITY_CODES = ACTIVITY_NAMES.length;
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
    clipFaces: new Uint8Array(ACTIVITY_CODES),
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
    packed.clipFaces[code] = clip.faces === true ? 1 : 0;
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
const { clipFirstTrack: CLIP_FIRST_TRACK, clipTrackCount: CLIP_TRACK_COUNT, clipBlendIn: CLIP_BLEND_IN, clipBlendOut: CLIP_BLEND_OUT, clipSeconds: CLIP_SECONDS, clipFaces: CLIP_FACES } = PACKED;
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
/** A hand's target is this far (m) from the middle line, on its own side. */
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
/** A channel weight under this is not worth solving. */
const NEGLIGIBLE_WEIGHT = 1e-4;
/** Seated, her thigh's underside rests on the seat: the hip joint sits one thigh half-thickness over its top. */
const THIGH_HALF_THICKNESS = PARTS[6].h[2];
/** The lowest the hips go (m) on a very low seat. */
const LOWEST_SEATED_HIP_Y = 0.25;

const channels = new Float64Array(CHANNELS);
const torsoInverse = new THREE.Quaternion();
const target = new THREE.Vector3();
/** `solveTwoBone`'s answer: slots of `solved`. */
const LINE_ANGLE = 0;
const OFFSET_ANGLE = 1;
const BEND_ANGLE = 2;
const solved = new Float64Array(3);

/** 0 up to `from`'s left of 0, 1 from 1 on, smooth between. */
function easeIn(progress: number): number {
  if (progress <= 0) return 0;
  if (progress >= 1) return 1;
  return progress * progress * (3 - 2 * progress);
}

/** A limb's bend at stride sine `sine`: its rest bend, plus the bend's extra on the side the limb swings to. */
function walkBend(gait: Gait, sine: number): number {
  return gait.bendAtRest + gait.bendForward * Math.max(0, sine) + gait.bendBack * Math.max(0, -sine);
}

/** The walk (striding while she moves, standing when she does not) in every limb's channels, everything else at rest. */
function fillBase(stride: number, speed: number): void {
  const walking = speed > 0;
  const sine = walking ? Math.sin(stride) : 0;
  const bendShare = walking ? 1 : 0;
  channels.fill(0);
  for (let side = 0; side < 2; side++) {
    const armGait = ARM_GAITS[side]!;
    const arm = armChannel(side, 0);
    channels[arm + ARM.swing] = armGait.swing * sine;
    channels[arm + ARM.out] = sideSign(side) * POSE_ARM_OUT;
    channels[arm + ARM.elbow] = bendShare * walkBend(armGait, sine);
    channels[arm + ARM.handZ] = REST_HAND_Z;
    channels[arm + ARM.handY] = REST_HAND_Y;
    const legGait = LEG_GAITS[side]!;
    const leg = legChannel(side, 0);
    channels[leg + LEG.swing] = legGait.swing * sine;
    channels[leg + LEG.knee] = bendShare * walkBend(legGait, sine);
  }
}

/** Track `track` at `time` seconds: the first value before its first key, the last after its last, eased between. */
function sampleTrack(track: number, time: number): number {
  const first = TRACK_KEY_START[track]!;
  const last = first + TRACK_KEY_COUNT[track]! - 1;
  if (time <= KEY_TIME[first]!) return KEY_VALUE[first]!;
  if (time >= KEY_TIME[last]!) return KEY_VALUE[last]!;
  let key = first;
  while (KEY_TIME[key + 1]! <= time) key++;
  const progress = easeIn((time - KEY_TIME[key]!) / (KEY_TIME[key + 1]! - KEY_TIME[key]!));
  return KEY_VALUE[key]! + (KEY_VALUE[key + 1]! - KEY_VALUE[key]!) * progress;
}

/** How much of clip `code` shows `clock` seconds in with `left` to go: it eases in from the walk, and out over its last seconds. */
function clipWeight(code: number, clock: number, left: number): number {
  const blendIn = CLIP_BLEND_IN[code]!;
  const blendOut = CLIP_BLEND_OUT[code]!;
  const seconds = CLIP_SECONDS[code]!;
  const rise = blendIn > 0 ? easeIn(clock / blendIn) : 1;
  const remaining = seconds > 0 ? Math.min(left, seconds - clock) : left;
  const fall = blendOut > 0 ? easeIn(remaining / blendOut) : 1;
  return rise * fall;
}

/** Which of the two mirrorings (0: main limbs on -x, 1: on +x) a clip runs in: toward a partner it reacts to, else the civilian's handedness. */
function mirrorIndexOf(pose: ActivityPose, faces: boolean): number {
  if (faces && pose.hasPartner && Math.abs(pose.bearing) > BEARING_DEAD_ZONE) return pose.bearing > 0 ? 1 : 0;
  return (pose.variant & HANDEDNESS_BIT) === 0 ? 1 : 0;
}

/** Clip `code`'s tracks at the pose's clock, each channel moved `weight` of the way from the walk to the track's value. */
function applyClip(code: number, pose: ActivityPose, mirrorIndex: number, weight: number): void {
  const first = CLIP_FIRST_TRACK[code]!;
  const end = first + CLIP_TRACK_COUNT[code]!;
  const fidgetRamp = easeIn(pose.clock / FIDGET_RAMP_SECONDS);
  const loopOffset = (((pose.variant >>> LOOP_OFFSET_SHIFT) & LOOP_OFFSET_STEPS) / LOOP_OFFSET_STEPS) * LOOP_OFFSET_SECONDS;
  const mirrorAt = mirrorIndex * CHANNELS;
  for (let track = first; track < end; track++) {
    const period = TRACK_PERIOD[track]!;
    let value: number;
    if (period > 0) {
      const time = pose.clock + loopOffset;
      const rest = KEY_VALUE[TRACK_KEY_START[track]!]!;
      value = rest + (sampleTrack(track, time - Math.floor(time / period) * period) - rest) * fidgetRamp;
    } else value = sampleTrack(track, pose.clock);
    if (TRACK_ABOVE_SURFACE[track] === 1) value += pose.surface;
    const slot = mirrorAt + TRACK_CHANNEL[track]!;
    moveToward(MIRROR_CHANNEL[slot]!, MIRROR_SIGN[slot]! * value, weight);
  }
}

/** Sinks the pelvis onto a seat `surface` high by the `seat` channel's share. */
function seatPelvis(surface: number): void {
  const seatedHipY = Math.max(LOWEST_SEATED_HIP_Y, surface + THIGH_HALF_THICKNESS);
  const fullDrop = Math.max(0, HIP_Y - seatedHipY);
  channels[CHANNEL.pelvisDrop] = channels[CHANNEL.pelvisDrop]! + channels[CHANNEL.seat]! * fullDrop;
}

function clampUnit(value: number): number {
  return Math.max(-1, Math.min(1, value));
}

/** Channel `channel` moved `weight` of the way to `goal`. */
function moveToward(channel: number, goal: number, weight: number): void {
  channels[channel] = channels[channel]! + weight * (goal - channels[channel]!);
}

/** A limb of segments `upper` and `lower` reaching `forward` ahead and `down` below its root: `solved` takes the straight reach's angle (swing convention: negative is forward), how far off that line the upper segment sits, and the joint's bend. */
function solveTwoBone(upper: number, lower: number, forward: number, down: number): void {
  const reach = Math.min(upper + lower, Math.max(Math.abs(upper - lower) + NEGLIGIBLE_WEIGHT, Math.sqrt(forward * forward + down * down)));
  solved[LINE_ANGLE] = Math.atan2(-forward, down);
  solved[OFFSET_ANGLE] = Math.acos(clampUnit((upper * upper + reach * reach - lower * lower) / (2 * upper * reach)));
  solved[BEND_ANGLE] = Math.PI - Math.acos(clampUnit((upper * upper + lower * lower - reach * reach) / (2 * upper * lower)));
}

/** With `plant`, each leg reaches its ankle to the floor `footZ` ahead of the hip: the knee bends as the pelvis sinks, the feet stay put. */
function solveLegs(): void {
  const plant = channels[CHANNEL.plant]!;
  if (plant <= NEGLIGIBLE_WEIGHT) return;
  const hipY = HIP_Y - channels[CHANNEL.pelvisDrop]!;
  for (let side = 0; side < 2; side++) {
    const leg = legChannel(side, 0);
    solveTwoBone(THIGH_LENGTH, SHIN_LENGTH, channels[leg + LEG.footZ]! - channels[CHANNEL.pelvisForward]!, hipY - ANKLE_Y);
    moveToward(leg + LEG.swing, solved[LINE_ANGLE]! - solved[OFFSET_ANGLE]!, plant);
    moveToward(leg + LEG.knee, solved[BEND_ANGLE]!, plant);
  }
}

/** With an arm's `hand` weight, the arm reaches its hand to (`handZ`, `handY`) in the body frame, through the torso's lean and twist. */
function solveHands(): void {
  const waistY = HIP_Y - channels[CHANNEL.pelvisDrop]!;
  setTorsoRotation(channels, torsoInverse);
  torsoInverse.invert();
  for (let side = 0; side < 2; side++) {
    const arm = armChannel(side, 0);
    const weight = channels[arm + ARM.hand]!;
    if (weight <= NEGLIGIBLE_WEIGHT) continue;
    target.set(sideSign(side) * HAND_TARGET_X - channels[CHANNEL.pelvisSide]!, channels[arm + ARM.handY]! - waistY, channels[arm + ARM.handZ]! - channels[CHANNEL.pelvisForward]!);
    target.applyQuaternion(torsoInverse);
    const lateral = target.x - sideSign(side) * SHOULDER_X;
    solveTwoBone(UPPER_ARM_LENGTH, FOREARM_LENGTH, Math.sqrt(lateral * lateral + target.z * target.z), SHOULDER_Y - HIP_Y - target.y);
    moveToward(arm + ARM.swing, solved[LINE_ANGLE]! + solved[OFFSET_ANGLE]!, weight);
    moveToward(arm + ARM.elbow, -solved[BEND_ANGLE]!, weight);
    moveToward(arm + ARM.sweep, Math.atan2(lateral, target.z), weight);
    moveToward(arm + ARM.out, 0, weight);
    moveToward(arm + ARM.twist, 0, weight);
  }
}

/** The head turned toward her partner by the `lookAtPartner` channel's share. */
function lookAtPartner(pose: ActivityPose): void {
  if (!pose.hasPartner) return;
  const turn = Math.max(-LOOK_LIMIT, Math.min(LOOK_LIMIT, pose.bearing));
  channels[CHANNEL.headYaw] = channels[CHANNEL.headYaw]! + channels[CHANNEL.lookAtPartner]! * turn;
}

/** Slot `slot` of `sink` posed as `pose` says: the walk or stand, with her activity's clip blended over it. Allocates nothing. */
export function poseActivity(sink: PoseSink, slot: number, pose: ActivityPose): void {
  fillBase(pose.stride, pose.speed);
  const code = pose.activity;
  if (code < ACTIVITY_CODES && CLIP_TRACK_COUNT[code]! > 0) applyClip(code, pose, mirrorIndexOf(pose, CLIP_FACES[code] === 1), clipWeight(code, pose.clock, pose.left));
  seatPelvis(pose.surface);
  solveLegs();
  solveHands();
  lookAtPartner(pose);
  renderRig(sink, slot, pose.x, pose.y, pose.z, pose.yaw, channels);
}
