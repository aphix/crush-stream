import { detSin, detCos } from "../kernel/physics-core.js";
import type { DriveInput } from "../vehicle/car-drive.ts";
import type { AiCar } from "./derby-ai.ts";

/** Nose point (front wheel / radiator) ahead of a car's origin (m). */
const NOSE = 1.7;
/** Wheel lock of a swing: full enough to whip the tail out, short of the steering's end stop (the derby's measured value). */
export const SWING_STEER = 0.85;
/** Seconds a swing is held once started: the tail's arc to the nose beside it takes about this long. */
export const SWING_FOR = 0.45;
/** Seconds after a swing starts before the same unit may swing again, so one pass is one hit. */
export const SWING_COOL = 3;
/** A hunter swings only at a target that gains on it by more than this (m/s) along its heading: one level or falling back is not passing. */
const OVERTAKE = 0.5;
/** A swing needs this much speed (m/s): a handbrake at a crawl does not whip the tail. */
const SWING_MIN_SPEED = 4;
/** A swing that spins the car this far below this speed (m/s) is abandoned: it has stopped being a swing. */
const SWING_DEAD_SPEED = 1.5;

/**
 * The e-brake swipe's geometry, shared by the derby driver and the hunters: whether `o`'s nose sits beside `self`'s rear wheel (0.6-3.2 m
 * behind its origin, 0.9-3.2 m off its line) and points at its side, with `self` between `minSpeed` and `maxSpeed` m/s along its heading.
 * Returns the steer sign that whips the tail into that nose (-1 right, +1 left), 0 for no swing.
 */
export function tailSwing(self: AiCar, o: AiCar, minSpeed: number, maxSpeed: number): number {
  const fx = detSin(self.yaw);
  const fz = detCos(self.yaw);
  const fwd = self.vx * fx + self.vz * fz;
  if (fwd < minSpeed || fwd >= maxSpeed) return 0;
  const ofx = detSin(o.yaw);
  const ofz = detCos(o.yaw);
  const nx = o.x - self.x + ofx * NOSE;
  const nz = o.z - self.z + ofz * NOSE;
  const na = nx * fx + nz * fz;
  const nl = nx * fz - nz * fx;
  const facing = -Math.sign(nl) * (ofx * fz - ofz * fx);
  return na > -3.2 && na < -0.6 && Math.abs(nl) > 0.9 && Math.abs(nl) < 3.2 && facing > 0.3 ? -Math.sign(nl) : 0;
}

/** Per-unit swing state of a pack: the committed swing (seconds left, its steer) and the cool-down (seconds left). */
export class TailSwings {
  private readonly left: Float64Array;
  private readonly steer: Float64Array;
  private readonly cool: Float64Array;

  constructor(count: number) {
    this.left = new Float64Array(count);
    this.steer = new Float64Array(count);
    this.cool = new Float64Array(count);
  }

  /** Unit `u` starts fresh (put on the road): no swing under way, no cool-down. */
  clear(u: number): void {
    this.left[u] = 0;
    this.cool[u] = 0;
  }

  /**
   * Unit `u`'s step of `dt` s: a swing under way holds its pedals in `out` (handbrake, throttle 0, brake 0, wheel away from the target) and returns
   * true; otherwise, if `ready` (the caller is in its attack, the target under its PIT cap) and `tg`'s nose sits by `self`'s rear wheel while it
   * gains on `self` (which bounds `self`'s speed under the target's), a swing starts and the cool-down with it.
   */
  step(u: number, self: AiCar, tg: AiCar, ready: boolean, dt: number, out: DriveInput): boolean {
    this.cool[u] = Math.max(0, this.cool[u]! - dt);
    if (this.left[u]! > 0) {
      this.left[u]! -= dt;
      if (self.vx * self.vx + self.vz * self.vz < SWING_DEAD_SPEED * SWING_DEAD_SPEED) this.left[u] = 0;
      else return this.hold(u, out);
    }
    if (!ready || this.cool[u]! > 0) return false;
    const s = tailSwing(self, tg, SWING_MIN_SPEED, Infinity);
    if (s === 0) return false;
    const gain = (tg.vx - self.vx) * detSin(self.yaw) + (tg.vz - self.vz) * detCos(self.yaw);
    if (gain <= OVERTAKE) return false;
    this.steer[u] = s * SWING_STEER;
    this.left[u] = SWING_FOR;
    this.cool[u] = SWING_COOL;
    return this.hold(u, out);
  }

  private hold(u: number, out: DriveInput): boolean {
    out.steer = this.steer[u]!;
    out.ebrake = true;
    out.throttle = 0;
    out.brake = 0;
    out.boost = false;
    return true;
  }
}
