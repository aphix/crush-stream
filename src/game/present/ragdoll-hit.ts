import * as THREE from "three";
import type { RigidBody } from "@dimforge/rapier3d-simd";
import { PARTS } from "./ragdoll-body.ts";

/** The spin (rad/s per metre of lever, from the torso's centre to where a push landed) a push gives the torso. */
const SPIN_PER_METRE = 10;

const _at = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _lever = new THREE.Vector3();
const _spin = new THREE.Vector3();
const _v = { x: 0, y: 0, z: 0 };

/** The part of `bodies` (`PARTS` order) the world `point` is nearest, by each part's own box: the part whose box it is deepest in, or nearest to. */
export function partAt(bodies: readonly RigidBody[], point: THREE.Vector3): number {
  let best = 0;
  let bestReach = Infinity;
  for (let k = 0; k < PARTS.length; k++) {
    const p = bodies[k]!.translation();
    const r = bodies[k]!.rotation();
    _at.set(point.x - p.x, point.y - p.y, point.z - p.z).applyQuaternion(_q.set(r.x, r.y, r.z, r.w).invert());
    const h = PARTS[k]!.h;
    const reach = Math.max(Math.abs(_at.x) / h[0], Math.abs(_at.y) / h[1], Math.abs(_at.z) / h[2]);
    if (reach >= bestReach) continue;
    bestReach = reach;
    best = k;
  }
  return best;
}

/**
 * A push of `speed` m/s along `direction` (a unit vector) landing on the world `point` of a dummy: the part it lands on (a hand, a shin, the head) is
 * sent at that speed, and the torso is given the spin of the lever from its centre to `point`, so a shove high on one shoulder turns him and a
 * blow low on a leg swings the legs out from under him. Returns the part it landed on.
 */
export function strikeAt(bodies: readonly RigidBody[], point: THREE.Vector3, direction: THREE.Vector3, speed: number): number {
  const landed = partAt(bodies, point);
  const target = bodies[landed]!;
  const v = target.linvel();
  _v.x = v.x + direction.x * speed;
  _v.y = v.y + direction.y * speed;
  _v.z = v.z + direction.z * speed;
  target.setLinvel(_v, true);
  const torso = bodies[0]!;
  const centre = torso.translation();
  _lever.set(point.x - centre.x, point.y - centre.y, point.z - centre.z);
  _spin.crossVectors(_lever, direction).multiplyScalar(SPIN_PER_METRE);
  const w = torso.angvel();
  _v.x = w.x + _spin.x;
  _v.y = w.y + _spin.y;
  _v.z = w.z + _spin.z;
  torso.setAngvel(_v, true);
  return landed;
}
