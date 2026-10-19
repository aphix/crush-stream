import * as THREE from "three";
import { FRAME_HZ } from "../kernel/constants.ts";
import { BUST } from "./dummy-fit.ts";
import { ORBS_AT, ROLE, ROW_TEXELS, smooth } from "./dummy-rig.ts";

/**
 * Her bust as two cosmetic particles a slot (Dead or Alive's bounce), each on an underdamped spring from where the torso's
 * pose carries its orb; every vertex moves by its `bustWeights` share of its orb's lag (shader and `DummyMesh.posed`).
 */

/** Each vertex's (left, right) share of its orb's lag; the shader declares it by this name. */
export const BUST_ATTRIBUTE = "bust";

/** The bounce (Hz) and its damping ratio: a knock leaves a few big bounces, gone within a couple of seconds. */
const BOUNCE_HZ = 2.5;
const DAMPING_RATIO = 0.1;
const STIFF = (2 * Math.PI * BOUNCE_HZ) ** 2;
const DAMP = 2 * DAMPING_RATIO * 2 * Math.PI * BOUNCE_HZ;
/** The most an orb trails its anchor (m): a knock saturates it, so this is the bounce the eye sees. */
const REACH = 0.035;
/** Longest integration step (s), half a display frame: semi-implicit Euler stays stable under 2 / ω (0.13 s here) and smooth well below it. */
const MAX_STEP = 1 / (2 * FRAME_HZ);
/** Under this lag (m) and relative speed (m/s) an orb snaps to its anchor: a settled slot writes zeros and uploads nothing. */
const REST_LAG = 1e-4;
const REST_SPEED = 1e-3;
const ORBS = 2;
/** The torso bone's first texel in a slot's row (translation, then rotation). */
const TORSO_AT = 0;
/** The orb's footprint on the chest: full share inside this share of `BUST.r`, none past `BUST.r`. */
const FULL_WITHIN = 0.35;

const _q = new THREE.Quaternion();
const _inverse = new THREE.Quaternion();
const _anchor = new THREE.Vector3();
const _prev = new THREE.Vector3();
const _x = new THREE.Vector3();
const _v = new THREE.Vector3();
const _anchorV = new THREE.Vector3();
const _at = new THREE.Vector3();
const _rel = new THREE.Vector3();
const _relV = new THREE.Vector3();

export class BustSprings {
  /** Per slot and orb (3 floats each): the particle's position and velocity (world) and the anchor it last hung from. */
  private readonly at: Float32Array;
  private readonly vel: Float32Array;
  private readonly anchors: Float32Array;
  private readonly seeded: Uint8Array;

  constructor(slots: number) {
    this.at = new Float32Array(slots * ORBS * 3);
    this.vel = new Float32Array(slots * ORBS * 3);
    this.anchors = new Float32Array(slots * ORBS * 3);
    this.seeded = new Uint8Array(slots);
  }

  /** Slot `s` hangs at rest from wherever its torso is at its next step (hidden, re-dressed or put somewhere new). */
  reset(s: number): void {
    this.seeded[s] = 0;
  }

  /** Slot `s` stepped `dt` s against its torso's pose in `rows`, each orb's lag (torso frame) written into its row: whether a lag changed. */
  step(rows: Float32Array, s: number, dt: number): boolean {
    if (dt <= 0) return false;
    const torso = (s * ROW_TEXELS + TORSO_AT) * 4;
    _q.fromArray(rows, torso + 4);
    _inverse.copy(_q).invert();
    const steps = Math.ceil(dt / MAX_STEP);
    const h = dt / steps;
    let changed = false;
    for (let side = 0; side < ORBS; side++) {
      const o = (s * ORBS + side) * 3;
      _anchor.set(side === 0 ? -BUST.x : BUST.x, BUST.y, (BUST.wall + BUST.tip) / 2).applyQuaternion(_q);
      _anchor.x += rows[torso]!;
      _anchor.y += rows[torso + 1]!;
      _anchor.z += rows[torso + 2]!;
      if (this.seeded[s] === 0) {
        _anchor.toArray(this.at, o);
        _anchor.toArray(this.anchors, o);
        this.vel.fill(0, o, o + 3);
      }
      _prev.fromArray(this.anchors, o);
      _x.fromArray(this.at, o);
      _v.fromArray(this.vel, o);
      _anchorV.subVectors(_anchor, _prev).divideScalar(dt);
      for (let k = 1; k <= steps; k++) {
        _at.lerpVectors(_prev, _anchor, k / steps);
        _rel.subVectors(_x, _at);
        _relV.subVectors(_v, _anchorV);
        _v.addScaledVector(_rel, -STIFF * h).addScaledVector(_relV, -DAMP * h);
        _x.addScaledVector(_v, h);
        holdWithinReach(_x, _v, _at, _anchorV);
      }
      _rel.subVectors(_x, _anchor);
      if (_rel.length() < REST_LAG && _relV.subVectors(_v, _anchorV).length() < REST_SPEED) {
        _x.copy(_anchor);
        _v.copy(_anchorV);
        _rel.set(0, 0, 0);
      }
      _x.toArray(this.at, o);
      _v.toArray(this.vel, o);
      _anchor.toArray(this.anchors, o);
      _rel.applyQuaternion(_inverse);
      const lag = (s * ROW_TEXELS + ORBS_AT + side) * 4;
      changed ||= rows[lag] !== _rel.x || rows[lag + 1] !== _rel.y || rows[lag + 2] !== _rel.z;
      _rel.toArray(rows, lag);
    }
    this.seeded[s] = 1;
    return changed;
  }
}

/** Particle `x` (velocity `v`) held within `REACH` of anchor `at` (moving at `anchorV`): pulled back onto the bound, its outward speed spent. */
function holdWithinReach(x: THREE.Vector3, v: THREE.Vector3, at: THREE.Vector3, anchorV: THREE.Vector3): void {
  _rel.subVectors(x, at);
  const length = _rel.length();
  if (length <= REACH) return;
  _rel.divideScalar(length);
  x.copy(at).addScaledVector(_rel, REACH);
  const outward = _relV.subVectors(v, anchorV).dot(_rel);
  if (outward > 0) v.addScaledVector(_rel, -outward);
}

type Attribute = THREE.BufferAttribute | THREE.InterleavedBufferAttribute;

/**
 * Each vertex's share (left, right) of its orb's lag from her rest position `rest` and its role (`roleKind`'s x): full at the
 * bust's front, none at its rim or behind the chest wall; skin moves with it (her cleavage), hair over it does not.
 */
export function bustWeights(rest: Attribute, roleKind: Attribute): Float32Array {
  const weights = new Float32Array(rest.count * ORBS);
  for (let i = 0; i < rest.count; i++) {
    if (roleKind.getX(i) !== ROLE.SHIRT && roleKind.getX(i) !== ROLE.SKIN) continue;
    const depth = smooth(BUST.wall, BUST.tip, rest.getZ(i));
    for (let side = 0; side < ORBS; side++) {
      const across = Math.sqrt((rest.getX(i) - (side === 0 ? -BUST.x : BUST.x)) ** 2 + (rest.getY(i) - BUST.y) ** 2);
      weights[i * ORBS + side] = depth * (1 - smooth(FULL_WITHIN * BUST.r, BUST.r, across));
    }
  }
  return weights;
}
