import * as THREE from "three";
import type { MassNode } from "./deform-rig.ts";
import { MIN_INERTIA, MIN_MASS_SUM } from "./constants.ts";

/** Sim seconds past the last contact where the frame starts taking the masses' tilt: while a face presses, the contact solve's own pose is the truth. */
export const TILT_SEAT_QUIET = 0.045;
/** Sim seconds the frame takes to follow the masses' tilt (each call turns by its step's share), so the drawn body never steps. */
export const TILT_SEAT_TIME = 0.05;
/** The most (rad) one call turns the frame about either axis: a plane through a few lifts is not a pose. */
const TILT_SEAT_MAX = 0.05;

const _centre = new THREE.Vector3();
const _turned = new THREE.Vector3();
const _dq = new THREE.Quaternion();

/**
 * The frame takes the tilt its body masses have in it (mass-weighted plane through their lifts, `local.y - rest.y` over rest x, z): the rigid step poses the frame
 * from tyres and hull while the cloud keeps its heights, which reads as lifted wing and rail points. It turns about the masses' centroid so none moves in the world.
 * Returns whether it turned; `group`'s world matrix is then updated, the caller reads the masses' locals again.
 */
export function seatTilt(masses: readonly MassNode[], group: THREE.Object3D, share: number): boolean {
  let mass = 0;
  let rx = 0;
  let rz = 0;
  let cx = 0;
  let cy = 0;
  let cz = 0;
  let lift = 0;
  for (let i = 0; i < masses.length; i++) {
    const m = masses[i]!;
    if (!m.dynamic || m.hub) continue;
    mass += m.mass;
    rx += m.rest.x * m.mass;
    rz += m.rest.z * m.mass;
    cx += m.local.x * m.mass;
    cy += m.local.y * m.mass;
    cz += m.local.z * m.mass;
    lift += (m.local.y - m.rest.y) * m.mass;
  }
  if (mass < MIN_MASS_SUM) return false;
  rx /= mass;
  rz /= mass;
  lift /= mass;
  let sxx = 0;
  let sxz = 0;
  let szz = 0;
  let sxy = 0;
  let szy = 0;
  for (let i = 0; i < masses.length; i++) {
    const m = masses[i]!;
    if (!m.dynamic || m.hub) continue;
    const dx = m.rest.x - rx;
    const dz = m.rest.z - rz;
    const dy = m.local.y - m.rest.y - lift;
    sxx += m.mass * dx * dx;
    sxz += m.mass * dx * dz;
    szz += m.mass * dz * dz;
    sxy += m.mass * dx * dy;
    szy += m.mass * dz * dy;
  }
  const det = sxx * szz - sxz * sxz;
  if (det < MIN_INERTIA) return false;
  // A lift that rises along x is a turn about z, one that rises along z a turn the other way about x.
  const roll = share * Math.max(-TILT_SEAT_MAX, Math.min(TILT_SEAT_MAX, (sxy * szz - szy * sxz) / det));
  const pitch = share * Math.max(-TILT_SEAT_MAX, Math.min(TILT_SEAT_MAX, -(szy * sxx - sxy * sxz) / det));
  const q = group.quaternion;
  _dq.set(pitch * 0.5, 0, roll * 0.5, 1).normalize();
  _centre.set(cx / mass, cy / mass, cz / mass);
  _turned.copy(_centre).applyQuaternion(_dq);
  group.position.add(_centre.sub(_turned).applyQuaternion(q));
  q.multiply(_dq);
  group.updateWorldMatrix(false, false);
  return true;
}
