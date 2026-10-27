import * as THREE from "three";
import type { StreamedDeformation } from "./streamed-deform.ts";

export interface WreckRig {
  d: StreamedDeformation;
  group: THREE.Group;
  vel: THREE.Vector3;
  omega: THREE.Vector3;
}

const _c = new THREE.Vector3();
const _r = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _v = new THREE.Vector3();

/** The body's centre of mass, the masses' centroid (`wreckCentre`): the world point the body turns about. */
function centroid(s: WreckRig, out: THREE.Vector3): THREE.Vector3 {
  let m = 0;
  out.set(0, 0, 0);
  for (const n of s.d.masses) {
    if (!n.dynamic) continue;
    m += n.mass;
    out.addScaledVector(n.world, n.mass);
  }
  return out.divideScalar(m);
}

/**
 * One physics step of a wreck with no car, in the engine's order: the body (this harness's rigid step) turns at its spin about its
 * centre and moves at its velocity, carrying the masses, the masses' own motion relative to it is the crush; the clamp re-reads the
 * pose (`followGroup` with no time), `contact` feeds the hit against where the body put them, the clamp reads again, then the
 * structure step runs and the body seats on its cell (`followGroup`).
 */
export function stepWreck(s: WreckRig, dt: number, contact?: () => void): void {
  const g = s.group;
  g.updateMatrixWorld(false);
  s.d.followGroup(g, s.vel, s.omega, 0);
  const centre = centroid(s, _c);
  s.d.moveRelative(dt, s.vel, s.omega, centre);
  centroid(s, centre);
  for (const m of s.d.masses) m.vel.sub(s.vel).sub(_v.crossVectors(s.omega, _r.copy(m.world).sub(centre)));
  const angle = s.omega.length() * dt;
  if (angle > 0) _q.setFromAxisAngle(_r.copy(s.omega).normalize(), angle);
  else _q.identity();
  for (const m of s.d.masses) m.world.sub(centre).applyQuaternion(_q).add(centre).addScaledVector(s.vel, dt);
  g.position.sub(centre).applyQuaternion(_q).add(centre).addScaledVector(s.vel, dt);
  g.quaternion.premultiply(_q);
  centre.addScaledVector(s.vel, dt);
  for (const m of s.d.masses) m.vel.add(s.vel).add(_v.crossVectors(s.omega, _r.copy(m.world).sub(centre)));
  g.updateMatrixWorld(false);
  s.d.followGroup(g, s.vel, s.omega, 0);
  contact?.();
  s.d.followGroup(g, s.vel, s.omega, 0);
  s.d.stepStructure(dt);
  s.d.followGroup(g, s.vel, s.omega, dt);
}
