import * as THREE from "three";
import type { DriverLook } from "./driver-look.ts";
import { BODY_VERTICES } from "./dummy-bodies.ts";
import { BONES_ATTRIBUTE, KINDS_ATTRIBUTE } from "./dummy-rig.ts";
import { JOINTS, PARTS } from "./ragdoll-body.ts";
import { DummyMesh } from "./ragdoll-mesh.ts";

/** A part's pose: its centre and its turn. */
export type PartPose = { p: THREE.Vector3; q: THREE.Quaternion };

/** A drawn vertex: its index, role and kinds, where it is, its first bone and the second's weight, and whether it is wear (lofted on, not the body). */
export type Drawn = { index: number; role: number; kinds: number; at: THREE.Vector3; bone: number; weight: number; wear: boolean };

export const turn = (axis: THREE.Vector3, degrees: number) => new THREE.Quaternion().setFromAxisAngle(axis, (degrees * Math.PI) / 180);

/** Every part standing, then part `k` swung by `swings[k]` about its joint to its parent, parents first, so the joints stay closed as Rapier's do. */
export function posture(swings: Partial<Record<number, THREE.Quaternion>>): PartPose[] {
  const centre = (k: number) => new THREE.Vector3(...PARTS[k]!.c);
  const poses = PARTS.map((_, k) => ({ p: centre(k), q: new THREE.Quaternion() }));
  for (let k = 1; k < PARTS.length; k++) {
    const [parent, , x, y, z] = JOINTS.find((joint) => joint[1] === k)!;
    const joint = new THREE.Vector3(x, y, z);
    const above = poses[parent]!;
    const jointNow = joint.clone().sub(centre(parent)).applyQuaternion(above.q).add(above.p);
    poses[k]!.q.copy(above.q).multiply(swings[k] ?? new THREE.Quaternion());
    poses[k]!.p.copy(centre(k)).sub(joint).applyQuaternion(poses[k]!.q).add(jointNow);
  }
  return poses;
}

/** Slot 0 of a one-slot mesh dressed (`cop`, `look`) in `pose`: every vertex it draws. */
export function drawnRows(cop: boolean, look: DriverLook, pose = posture({})): { mesh: DummyMesh; rows: Drawn[] } {
  const mesh = new DummyMesh(1);
  mesh.dress(0, cop, look);
  for (const [k, part] of pose.entries()) mesh.pose(0, k, part.p, part.q);
  const [kinds, bones] = [mesh.geometry.getAttribute(KINDS_ATTRIBUTE), mesh.geometry.getAttribute(BONES_ATTRIBUTE)];
  const rows: Drawn[] = [];
  for (let i = 0; i < kinds.count; i++) {
    const at = new THREE.Vector3();
    if (mesh.posed(0, i, at)) rows.push({ index: i, role: kinds.getX(i), kinds: kinds.getY(i), at, bone: bones.getX(i), weight: bones.getZ(i), wear: i >= BODY_VERTICES });
  }
  return { mesh, rows };
}
