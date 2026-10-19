import { hypot2, hypot3 } from "../kernel/physics-core.js";
import type * as THREE from "three";

/** The reel's far-overhead flight between clips (docs/HIGHLIGHTS.md). */
const OVERHEAD = {
  /** Eye height over the course (m), and the extra climb at mid-flight per metre flown (capped at `climbMax`). */
  height: 80,
  climb: 0.25,
  climbMax: 60,
  /** The eye trails the look point by this fraction of its height along the flight, so the view is never straight down. */
  trail: 0.35,
  fov: 50,
};

/**
 * Far-overhead pose at `u` ∈ [0, 1] of the flight from (ax, az) to (bx, bz): eased along the line, climbing in the
 * middle of a long flight, looking down on the point it is over. A pure function of its inputs: every peer at the
 * same `u` frames the same shot.
 */
export function overheadPose(camera: THREE.PerspectiveCamera, ax: number, az: number, bx: number, bz: number, u: number): void {
  const t = Math.min(1, Math.max(0, u));
  const s = t * t * (3 - 2 * t);
  const dx = bx - ax;
  const dz = bz - az;
  const d = hypot2(dx, dz);
  const x = ax + dx * s;
  const z = az + dz * s;
  const y = OVERHEAD.height + Math.sin(Math.PI * t) * Math.min(OVERHEAD.climbMax, d * OVERHEAD.climb);
  // Trail along the flight (a hover with no flight trails toward −z).
  const fx = d > 1e-3 ? dx / d : 0;
  const fz = d > 1e-3 ? dz / d : 1;
  const back = y * OVERHEAD.trail;
  camera.position.set(x - fx * back, y, z - fz * back);
  camera.lookAt(x, 0, z);
  if (camera.fov !== OVERHEAD.fov) {
    camera.fov = OVERHEAD.fov;
    camera.updateProjectionMatrix();
  }
}

/** The frame a point of the reel's moment must sit in (`inFrame`, `fovFor`), on every screen the reel plays on. */
const FIT = {
  /**
   * The narrowest screen (width over height): what the reel's lens (`coverLens`) frames in the part of the view the panels
   * leave free, a phone upright under its bottom sheet (0.446 in the judge's layouts). Any wider screen shows the point nearer its middle.
   */
  aspect: 0.44,
  /** Each point lies within this share of the frame's half-extent from its middle (the reel's frame margin is 0.8, a panel takes some). */
  fit: 0.6,
};

type Vec3 = { x: number; y: number; z: number };

/** `look`'s eye frame: forward (unit), right (flat, unit) and up. */
const _f = { x: 0, y: 0, z: 0 };
const _r = { x: 0, y: 0, z: 0 };
const _u = { x: 0, y: 0, z: 0 };

/** The frame of the eye `eye` looking at (ax, ay, az) into `_f`, `_r` and `_u`; false when it looks straight up or down. */
function look(eye: Vec3, ax: number, ay: number, az: number): boolean {
  const len = hypot3(ax - eye.x, ay - eye.y, az - eye.z);
  _f.x = (ax - eye.x) / len;
  _f.y = (ay - eye.y) / len;
  _f.z = (az - eye.z) / len;
  const flat = hypot2(_f.x, _f.z);
  if (flat < 1e-6) return false;
  // Right = forward x up, flat; up = right x forward.
  _r.x = -_f.z / flat;
  _r.z = _f.x / flat;
  _u.x = -_r.z * _f.y;
  _u.y = _r.z * _f.x - _r.x * _f.z;
  _u.z = _r.x * _f.y;
  return true;
}

/**
 * The least tan(half fov) at which `p` lies within `FIT.fit` of the middle of the frame (`FIT.aspect` wide) of the eye
 * `eye` looking along `f` (unit), with `r` its right (flat, unit) and `u` its up; Infinity when `p` is nearer than 4 m or behind it.
 */
function tanNeeded(p: Vec3, eye: Vec3, f: Vec3, r: Vec3, u: Vec3): number {
  const vx = p.x - eye.x;
  const vy = p.y - eye.y;
  const vz = p.z - eye.z;
  const z = vx * f.x + vy * f.y + vz * f.z;
  if (z < 4) return Infinity;
  const x = Math.abs(vx * r.x + vz * r.z) / (FIT.fit * FIT.aspect);
  const y = Math.abs(vx * u.x + vy * u.y + vz * u.z) / FIT.fit;
  return Math.max(x, y) / z;
}

/** `fov` (deg), or the least wider lens in which `p` lies in the frame of the eye `eye` looking at `aim` (`inFrame`'s test; `fov` when it never does). */
export function fovFor(eye: Vec3, aim: Vec3, p: Vec3, fov: number): number {
  if (!look(eye, aim.x, aim.y, aim.z)) return fov;
  const need = tanNeeded(p, eye, _f, _r, _u);
  return Number.isFinite(need) ? Math.max(fov, (2 * Math.atan(need) * 180) / Math.PI) : fov;
}

/** `p` lies in the frame of the eye `eye` looking at `aim` through the lens `fov` (deg) on every screen the reel plays on (`tanNeeded`). */
export function inFrame(eye: Vec3, aim: Vec3, p: Vec3, fov: number): boolean {
  return look(eye, aim.x, aim.y, aim.z) && tanNeeded(p, eye, _f, _r, _u) <= Math.tan((fov * Math.PI) / 360);
}
