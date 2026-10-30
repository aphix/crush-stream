import * as THREE from "three";
import type { RigidBody } from "@dimforge/rapier3d-simd";
import { PARTS } from "./ragdoll-body.ts";

/** A point of a limb this far (m) inside a torso's box is through it, not touching it. */
const INSIDE = 0.01;
const TORSO = PARTS[0].h;

const _q = new THREE.Quaternion();
const _r = new THREE.Quaternion();
const _a = new THREE.Vector3();

/** Whether a point of part `k`'s long axis (its ends, quarters and middle) is `INSIDE` m inside `torso`'s box. */
export function limbThrough(limb: RigidBody, k: number, torso: RigidBody): boolean {
  const t = torso.translation();
  const tr = torso.rotation();
  _q.set(tr.x, tr.y, tr.z, tr.w).invert();
  const p = limb.translation();
  const pr = limb.rotation();
  _r.set(pr.x, pr.y, pr.z, pr.w);
  const h = PARTS[k]!.h;
  const long = h[2] > h[1] ? 2 : 1;
  for (let s = -1; s <= 1; s += 0.5) {
    _a.set(0, long === 1 ? s * h[1] : 0, long === 2 ? s * h[2] : 0).applyQuaternion(_r);
    _a.set(p.x + _a.x - t.x, p.y + _a.y - t.y, p.z + _a.z - t.z).applyQuaternion(_q);
    if (Math.abs(_a.x) < TORSO[0] - INSIDE && Math.abs(_a.y) < TORSO[1] - INSIDE && Math.abs(_a.z) < TORSO[2] - INSIDE) return true;
  }
  return false;
}
