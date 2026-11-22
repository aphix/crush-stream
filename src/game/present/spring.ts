import * as THREE from "three";

const _e = new THREE.Vector3();
const _t = new THREE.Vector3();

/** Critically damped spring, exact for any dt: no overshoot, ~98% settled after 6/omega s. Steps return nothing (read `x`): a double returned from a call the camera's frame does not inline is a heap allocation. */
export class Spring {
  x = 0;
  v = 0;

  step(target: number, omega: number, dt: number): void {
    const e = this.x - target;
    const t = (this.v + omega * e) * dt;
    const k = Math.exp(-omega * dt);
    this.v = (this.v - omega * t) * k;
    this.x = target + (e + t) * k;
  }

  /**
   * Spring with damping ratio `zeta`, exact for any dt: below 1 it carries its velocity past the target (overshoot
   * exp(-pi zeta / sqrt(1 - zeta^2))) and settles in ~3.9 / (zeta omega) s; from 1 up it is `step`.
   */
  stepDamped(target: number, omega: number, zeta: number, dt: number): void {
    if (zeta >= 1) {
      this.step(target, omega, dt);
      return;
    }
    const e = this.x - target;
    const wd = omega * Math.sqrt(1 - zeta * zeta);
    const k = Math.exp(-zeta * omega * dt);
    const c = Math.cos(wd * dt);
    const s = Math.sin(wd * dt);
    const b = (this.v + zeta * omega * e) / wd;
    this.x = target + k * (e * c + b * s);
    this.v = k * ((-zeta * omega * e + wd * b) * c + (-zeta * omega * b - wd * e) * s);
  }

  snap(x: number): void {
    this.x = x;
    this.v = 0;
  }
}

/** Vector critically damped spring; `v` is relative to whatever frame the caller carries `x` in. */
export class Spring3 {
  readonly x = new THREE.Vector3();
  readonly v = new THREE.Vector3();

  step(target: THREE.Vector3, omega: number, dt: number): void {
    const k = Math.exp(-omega * dt);
    _e.subVectors(this.x, target);
    _t.copy(this.v).addScaledVector(_e, omega).multiplyScalar(dt);
    this.v.addScaledVector(_t, -omega).multiplyScalar(k);
    this.x.copy(target).addScaledVector(_e.add(_t), k);
  }

  /**
   * One spring per axis of a frame turned to face `facing` (unit, flat): lon along it, lat to its right, up the world's y.
   * Each axis has its own `omega` and damping ratio; `maxSpeed` > 0 caps the speed `v` carries relative to the target (m/s).
   */
  stepBasis(target: THREE.Vector3, omega: Axes, zeta: Axes, maxSpeed: number, dt: number, facing: { readonly x: number; readonly z: number }): void {
    const fx = facing.x;
    const fz = facing.z;
    const ex = this.x.x - target.x;
    const ez = this.x.z - target.z;
    _lon.x = ex * fx + ez * fz;
    _lon.v = this.v.x * fx + this.v.z * fz;
    _lat.x = ex * fz - ez * fx;
    _lat.v = this.v.x * fz - this.v.z * fx;
    _up.x = this.x.y - target.y;
    _up.v = this.v.y;
    _lon.stepDamped(0, omega.lon, zeta.lon, dt);
    _lat.stepDamped(0, omega.lat, zeta.lat, dt);
    _up.stepDamped(0, omega.up, zeta.up, dt);
    this.x.set(target.x + _lon.x * fx + _lat.x * fz, target.y + _up.x, target.z + _lon.x * fz - _lat.x * fx);
    this.v.set(_lon.v * fx + _lat.v * fz, _up.v, _lon.v * fz - _lat.v * fx);
    if (maxSpeed > 0) {
      const speed = this.v.length();
      if (speed > maxSpeed) this.v.multiplyScalar(maxSpeed / speed);
    }
  }

  snap(x: THREE.Vector3): void {
    this.x.copy(x);
    this.v.set(0, 0, 0);
  }
}

/** A value per axis of a turned frame (see `Spring3.stepBasis`). */
export type Axes = { lon: number; lat: number; up: number };

const _lon = new Spring();
const _lat = new Spring();
const _up = new Spring();
