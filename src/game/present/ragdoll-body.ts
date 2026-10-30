import { hypot2, hypot3 } from "../kernel/physics-core.js";
import * as THREE from "three";
import type { Collider, ImpulseJoint, RigidBody } from "@dimforge/rapier3d-simd";
import { readAngvel, readLinvel, readRotation, readTranslation } from "../kernel/rapier.ts";

/**
 * The thrown dummy's body (`RagdollSystem` builds and steps it): its parts and joints, its damping, and the only
 * velocity edits it makes, which take energy out and never add any.
 */

/**
 * Dummy parts standing (feet at y = 0): centre, half extents (m). Torso first: the throw places it.
 * A 1.62 m crash-test dummy, about 100 kg at water's density. The drawn hands hang past the forearm boxes' ends (see the
 * hand allowance in ragdoll-mesh.test.ts): the boxes are the physics, and they stay as they were.
 * The shins end at the ankles, `ANKLE_Y` up; the feet (parts 10 and 11, the -x leg's first) are 0.25 m from heel to toe, the heel 0.03 m behind the ankle.
 */
export const PARTS = [
  { c: [0, 1.11, 0], h: [0.18, 0.27, 0.11] },
  { c: [0, 1.63, 0], h: [0.1, 0.11, 0.11] },
  { c: [-0.24, 1.21, 0], h: [0.05, 0.14, 0.05] },
  { c: [-0.24, 0.93, 0], h: [0.05, 0.14, 0.05] },
  { c: [0.24, 1.21, 0], h: [0.05, 0.14, 0.05] },
  { c: [0.24, 0.93, 0], h: [0.05, 0.14, 0.05] },
  { c: [-0.09, 0.63, 0], h: [0.075, 0.21, 0.075] },
  { c: [-0.09, 0.25, 0], h: [0.075, 0.17, 0.075] },
  { c: [0.09, 0.63, 0], h: [0.075, 0.21, 0.075] },
  { c: [0.09, 0.25, 0], h: [0.075, 0.17, 0.075] },
  { c: [-0.09, 0.04, 0.095], h: [0.05, 0.04, 0.125] },
  { c: [0.09, 0.04, 0.095], h: [0.05, 0.04, 0.125] },
] as const;
/** Water's density (kg/m³): every part's but the lower legs'. */
const DENSITY = 1000;
/** A foot's (parts 10 and 11, 5 kg): one of water under a shin four times its mass is pressed into the ground by the solver's few passes (5-6 cm at the Range's landings), and lighter ones than this left a throw at the high jump's net sitting up against it. */
const FOOT_DENSITY = 2500;
/** The footless shin's mass (kg: its 0.42 m box at water's density). Shin and foot together keep it, so a throw carries the mass, and the leg the inertia, it was tuned on. */
const LOWER_LEG_KG = DENSITY * 8 * 0.075 * 0.21 * 0.075;
const volume = (k: number): number => 8 * PARTS[k]!.h[0] * PARTS[k]!.h[1] * PARTS[k]!.h[2];
const SHIN_DENSITY = (LOWER_LEG_KG - FOOT_DENSITY * volume(10)) / volume(7);
export const partDensity = (k: number): number => (k >= 10 ? FOOT_DENSITY : k === 7 || k === 9 ? SHIN_DENSITY : DENSITY);
/** Each part's mass (kg) and largest principal inertia (kg m²): `isCalm`'s kinetic energy. */
export const MASS = PARTS.map((p, k) => 8 * partDensity(k) * p.h[0] * p.h[1] * p.h[2]);
const INERTIA = PARTS.map((p, k) => {
  const [a, b] = [p.h[0] ** 2, p.h[1] ** 2, p.h[2] ** 2].sort((x, y) => y - x);
  return (MASS[k]! * (a! + b!)) / 3;
});
/** Arms (parts 2–5) start raised over the head: the superman dive out of the car. */
export const ARM = (k: number) => k >= 2 && k <= 5;
export const SHOULDER_Y = 1.35;
/** The ankle joints' height (m) over the sole, and how far (rad) an ankle brings the toes up and down: the joint's range. */
export const ANKLE_Y = 0.08;
export const ANKLE_TOES_UP = (20 * Math.PI) / 180;
export const ANKLE_TOES_DOWN = (30 * Math.PI) / 180;
/** Spherical joints: parent, child, the joint point standing. Neck, shoulders, elbows, hips, knees, ankles. */
export const JOINTS = [
  [0, 1, 0, 1.39, 0],
  [0, 2, -0.24, SHOULDER_Y, 0],
  [2, 3, -0.24, 1.07, 0],
  [0, 4, 0.24, SHOULDER_Y, 0],
  [4, 5, 0.24, 1.07, 0],
  [0, 6, -0.09, 0.84, 0],
  [6, 7, -0.09, 0.42, 0],
  [0, 8, 0.09, 0.84, 0],
  [8, 9, 0.09, 0.42, 0],
  [7, 10, -0.09, ANKLE_Y, 0],
  [9, 11, 0.09, ANKLE_Y, 0],
] as const;

/** Dummy damping (per s) in the air, and from his first touch of the ground on: he lies down and stays down. */
export const AIR_LINEAR = 0.05;
export const AIR_ANGULAR = 0.8;
export const GROUND_LINEAR = 2.5;
export const GROUND_ANGULAR = 6;
/**
 * Once he lies on the ground and his torso has been under `REST_SPEED` for `SETTLE_AFTER` sim seconds, every part is
 * damped this hard (per s): a limb still flopping over settles in a few tenths of a second instead of creeping on
 * (range probe, jittered 240 Hz run: a leg moving at 0.9 m/s 3 s after his first ground contact).
 */
export const SETTLE_AFTER = 0.25;
export const SETTLE_LINEAR = 10;
export const SETTLE_ANGULAR = 10;
/**
 * Fleshy, not a rigid toy (owner, 2026-10-03): skin is a crumple zone. A hit on a part (`hits` in engine-ragdoll.ts, once per hit) sheds `1 − KEEP`
 * of the motion across each joint of that part, linear and spin (`give`), and no part turns about its joint faster
 * than `JOINT_SPIN` rad/s (`limit`: Rapier's spherical joints take no limit in JS; a limb whips at hundreds of rad/s
 * when it hits at 30 m/s). Both go through equal and opposite impulses between the two parts, so energy only leaves,
 * whatever the velocities (the old per-frame edits set absolute velocities and could add it).
 */
const KEEP = 0.5;
const JOINT_SPIN = 12;
/**
 * Asleep once the whole dummy's kinetic energy has stayed under `CALM_ENERGY` (J: 100 kg at 0.4 m/s) for `CALM_FOR`
 * sim seconds. Rapier's own thresholds cannot be set from JS, and a head rocking on its edge at 10 rad/s (4–6 J) kept
 * the old per-part speed rule awake for 2 s after he lay still (range probe, jittered 240 Hz run).
 */
const CALM_ENERGY = 8;
export const CALM_FOR = 0.5;

const _v = { x: 0, y: 0, z: 0 };
const _w = { x: 0, y: 0, z: 0 };
/** `limit`'s spins, 3 per part: each part read once, again only after a shed changed it. */
const SPIN = new Float64Array(PARTS.length * 3);

function readSpin(bodies: readonly RigidBody[], k: number): void {
  readAngvel(bodies[k]!, SPIN, 3 * k);
}

/** Part `k` of the dummy `bodies` was just hit: the skin gives at each joint of it. */
export function give(bodies: readonly RigidBody[], k: number): void {
  for (const [a, b] of JOINTS) if (a === k || b === k) shed(bodies[a]!, bodies[b]!, 1 - KEEP, 1 - KEEP);
}

/** Holds every joint of the dummy `bodies` to `JOINT_SPIN` rad/s of relative spin. */
export function limit(bodies: readonly RigidBody[]): void {
  for (let k = 0; k < PARTS.length; k++) readSpin(bodies, k);
  for (let j = 0; j < JOINTS.length; j++) {
    const a = 3 * JOINTS[j]![0];
    const b = 3 * JOINTS[j]![1];
    const spin = hypot3(SPIN[a]! - SPIN[b]!, SPIN[a + 1]! - SPIN[b + 1]!, SPIN[a + 2]! - SPIN[b + 2]!);
    if (spin <= JOINT_SPIN) continue;
    shed(bodies[JOINTS[j]![0]]!, bodies[JOINTS[j]![1]]!, 0, 1 - JOINT_SPIN / spin);
    readSpin(bodies, JOINTS[j]![0]);
    readSpin(bodies, JOINTS[j]![1]);
  }
}

/** `isCalm`'s part velocities: linear xyz, angular xyz. */
const MOTION = new Float64Array(6);

/** Is the whole dummy's kinetic energy under `CALM_ENERGY`? */
export function isCalm(bodies: readonly RigidBody[]): boolean {
  let energy = 0;
  for (let k = 0; energy < CALM_ENERGY && k < PARTS.length; k++) {
    readLinvel(bodies[k]!, MOTION, 0);
    readAngvel(bodies[k]!, MOTION, 3);
    const m = MOTION;
    energy += 0.5 * MASS[k]! * (m[0]! * m[0]! + m[1]! * m[1]! + m[2]! * m[2]!) + 0.5 * INERTIA[k]! * (m[3]! * m[3]! + m[4]! * m[4]! + m[5]! * m[5]!);
  }
  return energy < CALM_ENERGY;
}

/**
 * Shed the fractions `lin` and `spin` (0–1) of part `b`'s motion relative to its parent `a`: equal and opposite
 * impulses at the centres, so momentum stays and kinetic energy only drops. Linear: μ(1 − (1 − lin)²)|Δv|²/2 leaves (μ
 * the reduced mass). Spin: the impulse is scaled by the smaller inertias' reduced inertia, under which the energy
 * change stays negative.
 */
export function shed(a: RigidBody, b: RigidBody, lin: number, spin: number): void {
  if (lin > 0) {
    const va = a.linvel();
    const vb = b.linvel();
    const ma = a.mass();
    const mb = b.mass();
    const j = (lin * ma * mb) / (ma + mb);
    _v.x = (va.x - vb.x) * j;
    _v.y = (va.y - vb.y) * j;
    _v.z = (va.z - vb.z) * j;
    b.applyImpulse(_v, false);
    _w.x = -_v.x;
    _w.y = -_v.y;
    _w.z = -_v.z;
    a.applyImpulse(_w, false);
  }
  if (spin <= 0) return;
  const wa = a.angvel();
  const wb = b.angvel();
  const ia = a.principalInertia();
  const ib = b.principalInertia();
  const s = spin / (1 / Math.min(ia.x, ia.y, ia.z) + 1 / Math.min(ib.x, ib.y, ib.z));
  _v.x = (wa.x - wb.x) * s;
  _v.y = (wa.y - wb.y) * s;
  _v.z = (wa.z - wb.z) * s;
  b.applyTorqueImpulse(_v, false);
  _w.x = -_v.x;
  _w.y = -_v.y;
  _w.z = -_v.z;
  a.applyTorqueImpulse(_w, false);
}

/**
 * Spin (rad/s about the torso's lateral axis) a thrown driver's joints leave with, `JOINTS` order: shoulders swing the raised arms down in front,
 * elbows fold (the hinge's sign is negative), knees bend. His parts otherwise all leave at one velocity and his 3 rad/s tumble holds a limb straight
 * out like a pendulum, so under about 6 rad/s a kicked limb swings back (lane probe, four ejections).
 */
const ARM_DROP = 10;
const ELBOW_FOLD = 3;
/** Knees bend at 8 rad/s on the footless leg (its 9.45 kg 0.21 m below the knee). The feet put the lower leg's mass farther down, so the rate shrinks by as much and the kick carries the momentum it was tuned at. */
const KNEE_Y = JOINTS[6][3];
const LOWER_LEG_MOMENT = MASS[7]! * (KNEE_Y - PARTS[7].c[1]) + MASS[10]! * hypot2(KNEE_Y - PARTS[10].c[1], PARTS[10].c[2]);
const KNEE_BEND = (8 * LOWER_LEG_KG * 0.21) / LOWER_LEG_MOMENT;
const LIMP = [0, ARM_DROP, -ELBOW_FOLD, ARM_DROP, -ELBOW_FOLD, 0, KNEE_BEND, 0, KNEE_BEND, 0, 0] as const;
/** Each joint's child and everything below it: what turns when that joint does. */
const SUBTREE = JOINTS.map(([, b]) => {
  const parts: number[] = [b];
  for (const part of parts) for (const [parent, child] of JOINTS) if (parent === part) parts.push(child);
  return parts;
});
export const TOTAL_MASS = MASS.reduce((sum, m) => sum + m, 0);
const _pivot = new THREE.Vector3();
const _r = new THREE.Vector3();
const _dw = new THREE.Vector3();
const _lost = new THREE.Vector3();
const _qr = new THREE.Quaternion();

/**
 * Give each joint of the dummy `bodies` its `LIMP` spin about world axis `axis`, its child and all below it turning about the joint's point (a
 * joint pulled apart has the solver cancel the spin), then every part the same shift so the whole dummy's linear momentum is what it was.
 */
export function limp(bodies: readonly RigidBody[], axis: THREE.Vector3): void {
  _lost.set(0, 0, 0);
  for (const [j, rate] of LIMP.entries()) {
    if (rate === 0) continue;
    const [a, , x, y, z] = JOINTS[j]!;
    const q = bodies[a]!.rotation();
    _pivot.set(x - PARTS[a]!.c[0], y - PARTS[a]!.c[1], z - PARTS[a]!.c[2]).applyQuaternion(_qr.set(q.x, q.y, q.z, q.w)).add(bodies[a]!.translation());
    _dw.copy(axis).multiplyScalar(rate);
    for (const k of SUBTREE[j]!) {
      const body = bodies[k]!;
      _r.copy(body.translation()).sub(_pivot).cross(_dw);
      _lost.addScaledVector(_r, MASS[k]!);
      body.setLinvel(_r.add(body.linvel()), false);
      body.setAngvel(_r.copy(body.angvel()).add(_dw), false);
    }
  }
  _lost.divideScalar(-TOTAL_MASS);
  for (const body of bodies) body.setLinvel(_r.copy(body.linvel()).add(_lost), false);
}

const _qb = new THREE.Quaternion();

/** `body`'s pose into `into` at `o`: position xyz, rotation xyzw (what the dummies, purses and props capture after a step). */
export function readPose(body: RigidBody, into: Float32Array, o: number): void {
  readTranslation(body, into, o);
  readRotation(body, into, o + 3);
}

/** The pose `alpha` (0–1) of the way from the one at `o` in `a` to the one at `o` in `c` (position lerped, rotation slerped) into `p` and `q`: a body drawn between its last two steps. */
export function blendPose(a: Float32Array, c: Float32Array, o: number, alpha: number, p: THREE.Vector3, q: THREE.Quaternion): void {
  p.set(a[o]! + (c[o]! - a[o]!) * alpha, a[o + 1]! + (c[o + 1]! - a[o + 1]!) * alpha, a[o + 2]! + (c[o + 2]! - a[o + 2]!) * alpha);
  q.set(a[o + 3]!, a[o + 4]!, a[o + 5]!, a[o + 6]!).slerp(_qb.set(c[o + 3]!, c[o + 4]!, c[o + 5]!, c[o + 6]!), alpha);
}

const _poseQuat = new THREE.Quaternion();
const _poseInverse = new THREE.Quaternion();
const _localUp = new THREE.Vector3();
const _corner = new THREE.Vector3();

/** The lowest point of any part's box in `pose` (`PARTS` order, 7 floats each: position xyz, rotation xyzw) into `out`. */
export function lowestPoint(pose: Float32Array, out: THREE.Vector3): void {
  out.y = Infinity;
  for (let k = 0; k < PARTS.length; k++) {
    const o = 7 * k;
    const half = PARTS[k]!.h;
    _poseQuat.set(pose[o + 3]!, pose[o + 4]!, pose[o + 5]!, pose[o + 6]!);
    _localUp.set(0, 1, 0).applyQuaternion(_poseInverse.copy(_poseQuat).invert());
    _corner.set(_localUp.x > 0 ? -half[0] : half[0], _localUp.y > 0 ? -half[1] : half[1], _localUp.z > 0 ? -half[2] : half[2]).applyQuaternion(_poseQuat);
    if (pose[o + 1]! + _corner.y < out.y) out.set(pose[o]! + _corner.x, pose[o + 1]! + _corner.y, pose[o + 2]! + _corner.z);
  }
}

export type Doll = {
  bodies: RigidBody[];
  /** Its joints, `JOINTS` order. */
  joints: ImpulseJoint[];
  /** His joints give (`loosen`: a driver thrown out of a car); a stiff dummy in the slot after him gets them built afresh. */
  loose: boolean;
  /** A loose driver's joints held (`brace`) until anything first stops a part of him (`hits`), so his launch roll turns him whole. */
  braced: boolean;
  live: boolean;
  age: number;
  /** Sim seconds he lies about before he goes: `LIFE` for a thrown driver, as long as the scene wants for a placed one (`place`). */
  life: number;
  /** Sim seconds the torso has been under `REST_SPEED`. */
  still: number;
  patch: Collider[];
  /** The car he was thrown from. */
  car: number;
  /** The ride-along may frame him (`launch`'s `rides`). */
  rides: boolean;
  /** Each part's pose (position xyz, rotation xyzw) after the last step and the one before it: the draw blends them. */
  prev: Float32Array;
  cur: Float32Array;
  /** Touched the ground (`hits`): damped harder from then on. */
  ground: boolean;
  /** Lying settled (`calm`): damped harder still. */
  settled: boolean;
  /** Sim seconds he has been under `CALM_ENERGY` (`calm`). */
  calm: number;
  /** Torso speed (m/s) at the end of the last frame: how far he may travel toward a pane in the next (`glassNear`). */
  speed: number;
  /** Torso velocity (m/s, world) at the end of the last frame: the ride-along's pick and shot read it. */
  vel: Float32Array;
  /** The player's walker holds his joints and torso (on foot): the pool does not damp, sleep or retire him. */
  driven: boolean;
};
