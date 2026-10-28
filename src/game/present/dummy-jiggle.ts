import * as THREE from "three";
import { FRAME_HZ, GRAVITY } from "../kernel/constants.ts";
import { store3f } from "../kernel/store.ts";
import { BUST } from "./dummy-fit.ts";
import { ORBS_AT, ROLE, ROW_TEXELS, smooth } from "./dummy-rig.ts";

/**
 * Her bust as two cosmetic particles a slot (Dead or Alive's bounce), each on an underdamped spring from where the torso's
 * pose carries its orb; every vertex moves by its `bustWeights` share of its orb's lag (`roleKind`'s zw: shader and `DummyMesh.posed`).
 */

/** The bounce (Hz) and its damping ratio: just under the default walk's 1.05 Hz stride rate (a step is 2.1 Hz), damped to one clear swing and a small second. */
const BOUNCE_HZ = 0.95;
const DAMPING_RATIO = 0.55;
/** The pull (m/s²) on an orb: a little under the sim's gravity, the owner's "very slightly reduced". */
const ORB_GRAVITY = 0.9 * GRAVITY;
const STIFF = (2 * Math.PI * BOUNCE_HZ) ** 2;
const DAMP = 2 * DAMPING_RATIO * 2 * Math.PI * BOUNCE_HZ;
/** The jiggle's gain over the original 0.039 m reach (the owner's "about 25-30%" more bounce). */
const JIGGLE_GAIN = 1.28;
/** The most an orb trails its anchor (m), half the bust's 7.8 cm projection, times the gain: a knock saturates it, so this is the bounce the eye sees. */
const REACH = 0.039 * JIGGLE_GAIN;
/** How far (m) above its rest an orb's standing sag has faded to nothing: a fade, not a step, so a settling orb does not chatter on the edge. */
const SAG_FADE = 0.25;
/** Longest integration step (s), a quarter of a display frame: small enough that a bust steps alike at 60 and at 144 Hz, and far under the 2 / ω (0.17 s here) that semi-implicit Euler needs. */
const MAX_STEP = 1 / (4 * FRAME_HZ);
/** Under this lag (m) and relative speed (m/s) an orb snaps to its anchor: a settled slot writes zeros and uploads nothing. */
const REST_LAG = 1e-4;
const REST_SPEED = 1e-3;
const ORBS = 2;
/** The torso bone's first texel in a slot's row (translation, then rotation). */
const TORSO_AT = 0;
/** The orb's footprint on the chest: full share inside this share of `BUST.r`, none past `BUST.r`: the dome moves as one mass and eases only near its base. */
const FULL_WITHIN = 0.7;
/** The weight eases in over this share of the dome's projection off the chest wall (not peaked at the apex). */
const CHEST_EASE = 0.3;
/** The orbs stay at least this far (m) short of their rest separation: the domes' inner surfaces never meet. */
const SEPARATION_SLACK = 0.004;
/** A sim that steps in jumps (slow-mo) has its anchor speed averaged over this long (s): about two display frames at a quarter speed. */
const SPEED_SMOOTH = 0.08;
/** A torso turning faster than `SPIN_FROM` (rad/s) pulls its orbs' lag back with this time constant (s), fully weighted by `SPIN_FULL`: a throw's tumble would whip them, yet they always trail the chest. */
const SPIN_FROM = 5;
const SPIN_FULL = 10;
const SPIN_TAU = 0.008;

const _q = new THREE.Quaternion();
const _inverse = new THREE.Quaternion();
const pair = () => [new THREE.Vector3(), new THREE.Vector3()] as const;
const [_anchors, _prevs, _xs, _vs, _anchorVs, _ats] = [pair(), pair(), pair(), pair(), pair(), pair()];
const _axis = new THREE.Vector3();
const _rel = new THREE.Vector3();
const _relV = new THREE.Vector3();
const _up = new THREE.Vector3();
const _turn = new THREE.Quaternion();
const _pulls = pair();

export class BustSprings {
  /** Per slot and orb (3 floats each): the particle's position and velocity (world) and the anchor it last hung from. */
  private readonly at: Float32Array;
  private readonly vel: Float32Array;
  private readonly anchors: Float32Array;
  private readonly seeded: Uint8Array;
  /** Per orb: the anchor's smoothed velocity; per slot: the torso's last turn (a quaternion) and its smoothed spin rate (rad/s). */
  private readonly anchorSpeeds: Float32Array;
  private readonly turns: Float32Array;
  private readonly spin: Float32Array;

  constructor(slots: number) {
    this.at = new Float32Array(slots * ORBS * 3);
    this.vel = new Float32Array(slots * ORBS * 3);
    this.anchors = new Float32Array(slots * ORBS * 3);
    this.seeded = new Uint8Array(slots);
    this.anchorSpeeds = new Float32Array(slots * ORBS * 3);
    this.turns = new Float32Array(slots * 4);
    this.spin = new Float32Array(slots);
  }

  /** Slot `s` hangs at rest from wherever its torso is at its next step (hidden, re-dressed or put somewhere new). */
  reset(s: number): void {
    this.seeded[s] = 0;
    this.spin[s] = 0;
  }

  /** Slot `s` stepped `dt` s against its torso's pose in `rows`, each orb's lag (torso frame) written into its row: whether a lag changed. */
  step(rows: Float32Array, s: number, dt: number): boolean {
    if (dt <= 0) return false;
    const torso = (s * ROW_TEXELS + TORSO_AT) * 4;
    _q.fromArray(rows, torso + 4);
    _inverse.copy(_q).invert();
    const steps = Math.ceil(dt / MAX_STEP);
    _up.set(0, 1, 0).applyQuaternion(_q);
    const h = dt / steps;
    let changed = false;
    _turn.fromArray(this.turns, s * 4).invert().multiply(_q);
    const rate = this.seeded[s] === 0 ? 0 : (2 * Math.acos(Math.min(1, Math.abs(_turn.w)))) / dt;
    this.spin[s] = this.spin[s]! + (rate - this.spin[s]!) * (1 - Math.exp(-dt / SPEED_SMOOTH));
    _q.toArray(this.turns, s * 4);
    for (let side = 0; side < ORBS; side++) {
      const o = (s * ORBS + side) * 3;
      _anchors[side]!.set(side === 0 ? -BUST.x : BUST.x, BUST.y, (BUST.wall + BUST.tip) / 2).applyQuaternion(_q);
      _anchors[side]!.x += rows[torso]!;
      _anchors[side]!.y += rows[torso + 1]!;
      _anchors[side]!.z += rows[torso + 2]!;
      if (this.seeded[s] === 0) {
        store3f(this.at, o, _anchors[side]!);
        store3f(this.anchors, o, _anchors[side]!);
        this.vel.fill(0, o, o + 3);
      }
      _prevs[side]!.fromArray(this.anchors, o);
      _xs[side]!.fromArray(this.at, o);
      _vs[side]!.fromArray(this.vel, o);
      _anchorVs[side]!.subVectors(_anchors[side]!, _prevs[side]!).divideScalar(dt);
      // A sim that steps only some frames moves the anchor in jumps: its speed is the running average, so the spring's damping sees no spikes.
      _pulls[side]!.fromArray(this.anchorSpeeds, o);
      _anchorVs[side]!.lerpVectors(_pulls[side]!, _anchorVs[side]!, this.seeded[s] === 0 ? 1 : 1 - Math.exp(-dt / SPEED_SMOOTH));
    }
    _axis.set(1, 0, 0).applyQuaternion(_q);
    // A spinning torso pulls its orbs' lag back by this share a substep: a time constant, so the same at any frame rate.
    const hold = (1 - Math.exp(-h / SPIN_TAU)) * smooth(SPIN_FROM, SPIN_FULL, this.spin[s]!);
    for (let k = 1; k <= steps; k++) {
      for (let side = 0; side < ORBS; side++) {
        const [x, v] = [_xs[side]!, _vs[side]!];
        _ats[side]!.lerpVectors(_prevs[side]!, _anchors[side]!, k / steps);
        _rel.subVectors(x, _ats[side]!);
        _relV.subVectors(v, _anchorVs[side]!);
        v.addScaledVector(_rel, -STIFF * h).addScaledVector(_relV, -DAMP * h);
        // Gravity pulls the orb down in the world; the standing sag (up the torso's own axis) cancels it at and below the rest point and fades out over `SAG_FADE` above it.
        v.y -= ORB_GRAVITY * h;
        v.addScaledVector(_up, ORB_GRAVITY * h * Math.min(1, Math.max(0, 1 - _rel.y / SAG_FADE)));
        x.addScaledVector(v, h);
        holdWithinReach(x, v, _ats[side]!, _anchorVs[side]!);
      }
      keepApart(_xs[0]!, _vs[0]!, _xs[1]!, _vs[1]!, _ats[0]!, _ats[1]!);
      for (let side = 0; side < ORBS; side++) {
        _xs[side]!.lerp(_ats[side]!, hold);
        _vs[side]!.lerp(_anchorVs[side]!, hold);
      }
    }
    for (let side = 0; side < ORBS; side++) {
      const o = (s * ORBS + side) * 3;
      const [x, v] = [_xs[side]!, _vs[side]!];
      _rel.subVectors(x, _anchors[side]!);
      if (_rel.length() < REST_LAG && _relV.subVectors(v, _anchorVs[side]!).length() < REST_SPEED) {
        x.copy(_anchors[side]!);
        v.copy(_anchorVs[side]!);
        _rel.set(0, 0, 0);
      }
      store3f(this.at, o, x);
      store3f(this.vel, o, v);
      store3f(this.anchors, o, _anchors[side]!);
      store3f(this.anchorSpeeds, o, _anchorVs[side]!);
      _rel.applyQuaternion(_inverse);
      const lag = (s * ROW_TEXELS + ORBS_AT + side) * 4;
      changed ||= rows[lag] !== _rel.x || rows[lag + 1] !== _rel.y || rows[lag + 2] !== _rel.z;
      store3f(rows, lag, _rel);
    }
    this.seeded[s] = 1;
    return changed;
  }
}

/** The share of wall time the busts jiggle at: the eased slow-mo and warp, which is smooth, or a reel clip's own step against the wall frame (never the sim's per-frame step, which is 0 on frames it does not advance). */
export function presentedRate(reelDt: number | null, wallDt: number, timeScale: number, timeWarp: number): number {
  return reelDt === null ? timeScale * timeWarp : wallDt > 0 ? reelDt / wallDt : 1;
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

/** Orbs `a` and `b` (velocities `va`, `vb`; anchors `atA`, `atB`) pushed apart along the torso's x until they are at least their rest separation less `SEPARATION_SLACK` apart, their closing speed spent. */
function keepApart(a: THREE.Vector3, va: THREE.Vector3, b: THREE.Vector3, vb: THREE.Vector3, atA: THREE.Vector3, atB: THREE.Vector3): void {
  const least = _rel.subVectors(atB, atA).dot(_axis) - SEPARATION_SLACK;
  const squeeze = least - _relV.subVectors(b, a).dot(_axis);
  if (squeeze <= 0) return;
  a.addScaledVector(_axis, -squeeze / 2);
  b.addScaledVector(_axis, squeeze / 2);
  const closing = _relV.subVectors(vb, va).dot(_axis);
  if (closing >= 0) return;
  va.addScaledVector(_axis, closing / 2);
  vb.addScaledVector(_axis, -closing / 2);
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
    const depth = smooth(BUST.wall, BUST.wall + CHEST_EASE * (BUST.tip - BUST.wall), rest.getZ(i));
    for (let side = 0; side < ORBS; side++) {
      const across = Math.sqrt((rest.getX(i) - (side === 0 ? -BUST.x : BUST.x)) ** 2 + (rest.getY(i) - BUST.y) ** 2);
      weights[i * ORBS + side] = depth * (1 - smooth(FULL_WITHIN * BUST.r, BUST.r, across));
    }
    const total = weights[i * ORBS]! + weights[i * ORBS + 1]!;
    // Between the domes both orbs claim a vertex: their shares together never move it past one orb's full lag.
    if (total > 1) for (let side = 0; side < ORBS; side++) weights[i * ORBS + side]! /= total;
  }
  return weights;
}
