import * as THREE from "three";
import { JOINTS } from "./ragdoll-body.ts";
import { bodyPositions } from "./dummy-bodies.ts";
import { archFeet, bustOf, curveHips, sculptBust } from "./dummy-curves.ts";
import { MAN, PORTLY, shape, WOMAN } from "./dummy-physique.ts";
import { smooth, type Fit } from "./dummy-rig.ts";

/** The three baked bodies bent into the rig's arms-down rest, with the blend weights the bending and the skinning share. */

/** The rig's right-side joints (`JOINTS` rows: parent, child, x, y, z): the fitted body is bent and shifted onto these. */
const RIG_SHOULDER = new THREE.Vector3(JOINTS[3][2], JOINTS[3][3], JOINTS[3][4]);
const RIG_ELBOW_Y = JOINTS[4][3];
const RIG_HIP = new THREE.Vector3(JOINTS[7][2], JOINTS[7][3], JOINTS[7][4]);
export const RIG_KNEE_Y = JOINTS[8][3];
export const RIG_NECK_Y = JOINTS[0][3];

/** Rig head top (m): head centre plus its half height. The baked bodies are scaled to this. */
const RIG_TOP = 1.74;
/** The woman is shorter, so the shared height scale widens her past the man. This puts her shoulders back inside his. */
const WOMAN_NARROW = 0.9;

/**
 * The shoulder's weight is one continuous function of where a vertex lies about the shoulder pivot: along the upper arm's axis
 * (`ALONG`, m from the pivot) and across it (`ACROSS`, m, negative under the arm). The baked edges are 5 to 6.7 cm at the
 * shoulder and the swing is 40 degrees, so the bands are wide: a weight falling over 0.10 m stretched a 5 cm edge to 12 cm, over 0.20 m to 9 cm.
 * The arm is 0.05 m in radius: its own vertices read ACROSS >= -0.06 and the chest under the armpit below -0.14.
 */
const SHOULDER_ALONG_FROM = -0.1;
const SHOULDER_ALONG_TO = 0.1;
const SHOULDER_ACROSS_FROM = -0.14;
const SHOULDER_ACROSS_TO = -0.06;
/** Half widths (m) of the elbow's and the wrist's blend along the arm (the elbow's is the skin band too). */
const ELBOW_HALF_BAND = 0.05;
const WRIST_HALF_BAND = 0.05;
/** An adult hand, wrist crease to fingertip (m): the wrist is this far back along the arm from the fitted fingertip. */
export const HAND_LENGTH = 0.19;
/**
 * The thigh's weight climbs from 0 at `HIP_TOP` to 1 at `HIP_BOTTOM` (m; the hip joint sits in the middle). The crotch's
 * centre is lifted by `CROTCH_LIFT` into the torso's side of that over `CROTCH_WIDTH` of |x|, so the two legs do not tear the fork apart.
 */
const HIP_TOP = 0.92;
const HIP_BOTTOM = 0.76;
const CROTCH_LIFT = 0.06;
const CROTCH_WIDTH = 0.1;
/** The knee's blend half width (m): the shin's weight climbs across it. */
export const KNEE_HALF_BAND = 0.05;
/**
 * The head's weight climbs over `NECK_FROM`..`NECK_TO` (m) in a height that sheds `NECK_SLANT` m per metre of |x| beyond the
 * neck's half width `NECK_HALF_WIDTH`, so the trapezius beside the neck never rides the head while the jaw is rigid on it.
 */
const NECK_FROM = 1.4;
const NECK_TO = 1.48;
const NECK_HALF_WIDTH = 0.07;
const NECK_SLANT = 1.2;
/** The fingers (m above the fitted fingertip) curl toward the palm, `FINGER_CURL` rad at the tip: the reference's relaxed hands. */
const FINGERS = 0.09;
const FINGER_CURL = 0.9;
/** The knuckles' line is read off the hand's vertices this close (m) to its height. */
const KNUCKLE_BAND = 0.004;

const vec3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const DOWN = vec3(0, -1, 0);
const NO_TURN = new THREE.Quaternion();

type Line = { at: THREE.Vector3; direction: THREE.Vector3 };
/** Only the arm (not the legs or the belly) is above this height (m) in an |x| slice out at the arm. */
const ARM_MIN_Y = 0.9;

/** The mean (x, y, z) of the vertices in each |x| slice from `from` to `to` (m, `step` wide): the arm's path. */
function slicePath(tpose: Float32Array, from: number, to: number, step: number): THREE.Vector3[] {
  const path: THREE.Vector3[] = [];
  for (let low = from; low < to - 1e-9; low += step) {
    const sum = vec3();
    let count = 0;
    for (let i = 0; i < tpose.length; i += 3) {
      const out = Math.abs(tpose[i]!);
      if (out < low || out >= low + step || tpose[i + 1]! < ARM_MIN_Y) continue;
      sum.add(vec3(out, tpose[i + 1]!, tpose[i + 2]!));
      count++;
    }
    if (count === 0) throw new RangeError(`no arm in the slice at |x| = ${low}`);
    path.push(sum.multiplyScalar(1 / count));
  }
  return path;
}

/** The least-squares line through `points`, y and z as linear functions of x. */
function fitLine(points: readonly THREE.Vector3[]): Line {
  const mean = points.reduce((sum, point) => sum.add(point), vec3()).multiplyScalar(1 / points.length);
  let [xx, xy, xz] = [0, 0, 0];
  for (const point of points) {
    xx += (point.x - mean.x) ** 2;
    xy += (point.x - mean.x) * (point.y - mean.y);
    xz += (point.x - mean.x) * (point.z - mean.z);
  }
  return { at: mean, direction: vec3(1, xy / xx, xz / xx).normalize() };
}

const pointAtX = (line: Line, x: number) => line.at.clone().addScaledVector(line.direction, (x - line.at.x) / line.direction.x);

type ArmMeasure = { shoulder: THREE.Vector3; elbow: THREE.Vector3; wrist: THREE.Vector3; fingertip: THREE.Vector3; upper: THREE.Vector3; fore: THREE.Vector3; hand: THREE.Vector3 };

/** The arm's path starts this far (m) out: past the belly of the portly man (0.27 m), where only the arm is. */
const ARM_PATH_FROM = 0.275;
/** The path ends this far (m) short of the farthest |x|: the hand's reach across x (the fingers fan out along the arm). */
const HAND_REACH_X = 0.17;
const ARM_PATH_STEP = 0.025;
/** The fingertip is the mean of the vertices this close (m) to the farthest |x|. */
const FINGERTIP_BAND = 0.02;
const WRIST_SEARCH_STEPS = 40;

/**
 * The arm of the scaled T-pose (mirrored to |x|), measured off its own vertices: its path is the mean of the vertices in each
 * |x| slice. The elbow is the path's sharpest turn (the angle between the path two slices before and two after); the upper
 * arm's and the forearm's axes are lines through the path either side of it; the shoulder pivot is the rig's upper arm length
 * back from the elbow along the upper axis (so the fitted elbow lands on the rig's); the wrist is `HAND_LENGTH` back from the
 * fingertip along the forearm's line.
 */
function measureArm(tpose: Float32Array): ArmMeasure {
  let farthest = 0;
  for (let i = 0; i < tpose.length; i += 3) farthest = Math.max(farthest, Math.abs(tpose[i]!));
  const path = slicePath(tpose, ARM_PATH_FROM, farthest - HAND_REACH_X, ARM_PATH_STEP);
  let [bend, sharpest] = [2, 0];
  for (let k = 2; k + 2 < path.length; k++) {
    const turn = path[k]!.clone().sub(path[k - 2]!).angleTo(path[k + 2]!.clone().sub(path[k]!));
    if (turn > sharpest) [bend, sharpest] = [k, turn];
  }
  const upper = fitLine(path.slice(0, bend + 1));
  const fore = fitLine(path.slice(bend));
  const elbow = pointAtX(upper, path[bend]!.x);
  const fingertip = vec3();
  let count = 0;
  for (let i = 0; i < tpose.length; i += 3) {
    if (Math.abs(tpose[i]!) < farthest - FINGERTIP_BAND) continue;
    fingertip.add(vec3(Math.abs(tpose[i]!), tpose[i + 1]!, tpose[i + 2]!));
    count++;
  }
  fingertip.multiplyScalar(1 / count);
  let [near, far] = [ARM_PATH_FROM, fingertip.x];
  for (let step = 0; step < WRIST_SEARCH_STEPS; step++) {
    const middle = (near + far) / 2;
    if (pointAtX(fore, middle).distanceTo(fingertip) > HAND_LENGTH) near = middle;
    else far = middle;
  }
  const wrist = pointAtX(fore, (near + far) / 2);
  const upperLength = RIG_SHOULDER.y - RIG_ELBOW_Y;
  return { shoulder: elbow.clone().addScaledVector(upper.direction, -upperLength), elbow, wrist, fingertip, upper: upper.direction, fore: fore.direction, hand: fingertip.clone().sub(wrist).normalize() };
}

type LegMeasure = { hip: THREE.Vector3; direction: THREE.Vector3 };

/** The leg is a line through the centres of its slices between these heights (m, `LEG_STEP` apart, `LEG_BAND` thick): from above the ankle to the thigh. */
const LEG_FROM = 0.2;
const LEG_TO = 0.72;
const LEG_STEP = 0.04;
const LEG_BAND = 0.02;

/** The leg of the scaled T-pose (the |x| mirror): the pivot is where its line crosses the rig's hip height. */
function measureLeg(tpose: Float32Array): LegMeasure {
  const centres: THREE.Vector3[] = [];
  for (let y = LEG_FROM; y <= LEG_TO + 1e-9; y += LEG_STEP) {
    let xRange: [number, number] = [Infinity, -Infinity];
    let zRange: [number, number] = [Infinity, -Infinity];
    for (let i = 0; i < tpose.length; i += 3) {
      if (tpose[i]! <= 0 || Math.abs(tpose[i + 1]! - y) > LEG_BAND) continue;
      xRange = [Math.min(xRange[0], tpose[i]!), Math.max(xRange[1], tpose[i]!)];
      zRange = [Math.min(zRange[0], tpose[i + 2]!), Math.max(zRange[1], tpose[i + 2]!)];
    }
    centres.push(vec3((xRange[0] + xRange[1]) / 2, y, (zRange[0] + zRange[1]) / 2));
  }
  const mean = centres.reduce((sum, centre) => sum.add(centre), vec3()).multiplyScalar(1 / centres.length);
  let [yy, yx, yz] = [0, 0, 0];
  for (const centre of centres) {
    yy += (centre.y - mean.y) ** 2;
    yx += (centre.y - mean.y) * (centre.x - mean.x);
    yz += (centre.y - mean.y) * (centre.z - mean.z);
  }
  const hipHeight = RIG_HIP.y - mean.y;
  return { hip: vec3(mean.x + (yx / yy) * hipHeight, RIG_HIP.y, mean.z + (yz / yy) * hipHeight), direction: vec3(-yx / yy, -1, -yz / yy).normalize() };
}

/**
 * `raw` (the baked T-pose, feet at 0) fitted to the rig: scaled so the crown meets `RIG_TOP`, then bent about the body's own
 * measured pivots, never blended, so every vertex keeps its distance to its pivot (no collapse, no sheet). The arm swings
 * down about the shoulder by the turn that lays its upper axis along -y, the forearm about the elbow and the hand about the
 * wrist by what is left of theirs, each by one smooth weight; each leg swings about its hip to hang straight. The
 * shoulder is then shifted onto the rig's shoulder and the hip onto its hip.
 */
function fitBody(raw: Float32Array, width = 1): Fit {
  const count = raw.length / 3;
  let height = 0;
  for (let i = 1; i < raw.length; i += 3) height = Math.max(height, raw[i]!);
  const scale = RIG_TOP / height;
  const tpose = new Float32Array(raw.length);
  for (let i = 0; i < raw.length; i += 3) {
    tpose[i] = raw[i]! * scale * width;
    tpose[i + 1] = raw[i + 1]! * scale;
    tpose[i + 2] = raw[i + 2]! * scale;
  }
  const arm = measureArm(tpose);
  const leg = measureLeg(tpose);
  const turnToDown = (from: THREE.Vector3) => new THREE.Quaternion().setFromUnitVectors(from, DOWN);
  const shoulderTurn = turnToDown(arm.upper);
  const forearmAbsolute = turnToDown(arm.fore);
  const handAbsolute = turnToDown(arm.hand);
  const elbowTurn = shoulderTurn.clone().invert().multiply(forearmAbsolute);
  const wristTurn = forearmAbsolute.clone().invert().multiply(handAbsolute);
  const hipTurn = turnToDown(leg.direction);
  const upperAxis = arm.upper;
  const underNormal = vec3(-upperAxis.y, upperAxis.x, 0).normalize();
  const elbowAxis = arm.upper.clone().add(arm.fore).normalize();
  const wristAxis = arm.fore.clone().add(arm.hand).normalize();
  const rest = new Float32Array(raw.length);
  const shoulderWeight = new Float32Array(count);
  const elbowWeight = new Float32Array(count);
  const hipWeight = new Float32Array(count);
  const neckWeight = new Float32Array(count);
  const point = vec3();
  const offset = vec3();
  const partial = new THREE.Quaternion();
  const swing = (pivot: THREE.Vector3, turn: THREE.Quaternion, weight: number): void => {
    if (weight <= 0) return;
    point.sub(pivot).applyQuaternion(partial.copy(NO_TURN).slerp(turn, weight)).add(pivot);
  };
  let fingertipY = Infinity;
  for (let i = 0; i < count; i++) {
    const [x, y, z] = [tpose[i * 3]!, tpose[i * 3 + 1]!, tpose[i * 3 + 2]!];
    const side = x < 0 ? -1 : 1;
    const out = side * x;
    point.set(out, y, z);
    offset.copy(point).sub(arm.shoulder);
    const shoulder = smooth(SHOULDER_ALONG_FROM, SHOULDER_ALONG_TO, offset.dot(upperAxis)) * smooth(SHOULDER_ACROSS_FROM, SHOULDER_ACROSS_TO, offset.dot(underNormal));
    const elbow = shoulder * smooth(-ELBOW_HALF_BAND, ELBOW_HALF_BAND, offset.copy(point).sub(arm.elbow).dot(elbowAxis));
    const wrist = shoulder * smooth(-WRIST_HALF_BAND, WRIST_HALF_BAND, offset.copy(point).sub(arm.wrist).dot(wristAxis));
    const hip = smooth(HIP_TOP, HIP_BOTTOM, y + CROTCH_LIFT * (1 - smooth(0, CROTCH_WIDTH, out)));
    swing(arm.wrist, wristTurn, wrist);
    swing(arm.elbow, elbowTurn, elbow);
    swing(arm.shoulder, shoulderTurn, shoulder);
    point.addScaledVector(offset.copy(RIG_SHOULDER).sub(arm.shoulder), shoulder);
    swing(leg.hip, hipTurn, hip);
    point.addScaledVector(offset.copy(RIG_HIP).sub(leg.hip), hip);
    rest[i * 3] = side * point.x;
    rest[i * 3 + 1] = point.y;
    rest[i * 3 + 2] = point.z;
    shoulderWeight[i] = shoulder;
    elbowWeight[i] = elbow;
    hipWeight[i] = hip;
    neckWeight[i] = smooth(NECK_FROM, NECK_TO, y - NECK_SLANT * Math.max(0, out - NECK_HALF_WIDTH));
    if (shoulder >= 1) fingertipY = Math.min(fingertipY, point.y);
  }
  return { tpose, rest, shoulderWeight, elbowWeight, hipWeight, neckWeight, fingertipY };
}

/**
 * `fit`'s fingers bent in place toward the palms (in, toward the thighs), the hand below the knuckles laid round an arc so every
 * vertex keeps its distance along it; `fingertipY`, and so the wrist, stays the straight hand's.
 */
function curlFingers(fit: Fit): Fit {
  const [rest, knuckle, radius] = [fit.rest, fit.fingertipY + FINGERS, FINGERS / FINGER_CURL];
  const [sum, count] = [[0, 0], [0, 0]];
  for (let i = 0; i < fit.shoulderWeight.length; i++) {
    if (fit.shoulderWeight[i]! < 1 || Math.abs(rest[i * 3 + 1]! - knuckle) > KNUCKLE_BAND) continue;
    const hand = rest[i * 3]! < 0 ? 0 : 1;
    sum[hand] += rest[i * 3]!;
    count[hand]++;
  }
  for (let i = 0; i < fit.shoulderWeight.length; i++) {
    if (fit.shoulderWeight[i]! < 1 || rest[i * 3 + 1]! >= knuckle) continue;
    const side = rest[i * 3]! < 0 ? -1 : 1;
    const pivot = sum[(side + 1) / 2]! / count[(side + 1) / 2]!;
    const [arc, angle] = [radius + side * (rest[i * 3]! - pivot), (knuckle - rest[i * 3 + 1]!) / radius];
    rest[i * 3] = pivot + side * (arc * Math.cos(angle) - radius);
    rest[i * 3 + 1] = knuckle - arc * Math.sin(angle);
  }
  return fit;
}

const woman = curlFingers(shape(fitBody(bodyPositions("slenderWoman"), WOMAN_NARROW), WOMAN));
archFeet(woman.rest);
curveHips(woman);
const fits = { man: curlFingers(shape(fitBody(bodyPositions("slenderMan")), MAN)), woman, portly: curlFingers(shape(fitBody(bodyPositions("obeseMan")), PORTLY)) };
/** The three baked bodies fitted to the rig (computed once, on load) and given their physiques, the woman's feet arched onto her heels, her hips curved and her bust sculpted. */
export function restFits(): { man: Fit; woman: Fit; portly: Fit } {
  return fits;
}

/** Her bust on her fitted body, measured before it is sculpted: where the jiggle's orbs hang and the domes rise to. */
export const BUST = bustOf(woman);
sculptBust(woman, BUST);
