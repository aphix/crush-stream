import type { DriveInput } from "../vehicle/car-drive.ts";
import { MAX_CARS } from "../scenes/fleet.ts";
import { clamp } from "../kernel/scalar.ts";
import { FEEL } from "../vehicle/drive-input.ts";

/** Gas rise (share of the pedal a second): a driver rolls onto the throttle over a few tenths, not in one step. */
const THROTTLE_RISE = 8;
/** Gas fall (1/s): a lift is quick (a tenth of a second) so a brake is never fought by the engine. */
const THROTTLE_FALL = 10;
/** Brake rate (1/s), down and up: a foot moves in about a tenth of a second; the plan's stops count on the brake arriving that fast. */
export const BRAKE_RISE = 10;
/** Guard brake fall (1/s): the contact guard's brake eases off over a quarter second, so its 0.1 s look-ahead grid does not pulse the lamps and the nose. */
const GUARD_BRAKE_FALL = 10;
/** Wheel rate (lock a second) of a driver's hands: a pad player's (`FEEL.steerPad`), the fastest the drive turns an AI wheel, so the planner's wobble reaches it at no more than that. */
const STEER_RATE = FEEL.steerPad;
/** Seconds a boost burst runs once begun (the button is held, not tapped), unless the meter runs out or the way is not for boosting. */
const BOOST_MIN_BURST_S = 0.6;
/** Seconds the boost stays off once let go, so a plan sitting on its edge does not chatter the button. */
const BOOST_MIN_REST_S = 0.4;

/**
 * The hands every AI brain's output passes through, per car id: a brake latch with a band (on above the target by `on`, off only
 * once under it by `off`), the pedals and the wheel slewed at human rates, and the boost button held for a minimum burst and rest.
 * Reverse (a back-off) and a car with no driver pass untouched and the state follows them.
 */
export class Pedals {
  private readonly throttle = new Float64Array(MAX_CARS);
  private readonly brake = new Float64Array(MAX_CARS);
  private readonly steer = new Float64Array(MAX_CARS);
  private readonly braking = new Uint8Array(MAX_CARS);
  private readonly boosting = new Uint8Array(MAX_CARS);
  /** Seconds since the boost button last changed. */
  private readonly boostFor = new Float64Array(MAX_CARS).fill(BOOST_MIN_REST_S);
  /** Per car: no step shaped since a reset, so its first one starts at what the driver asks (hands with no history have nothing to slew from). */
  private readonly fresh = new Uint8Array(MAX_CARS).fill(1);
  /** Per car: the contact guard's brake as `holdGuardBrake` holds it. */
  private readonly guardBrake = new Float64Array(MAX_CARS);

  /** Whether car `i` is braking: the latch the last `latch` call left, which a brain reads to pick the band edge it is on. */
  isBraking(i: number): boolean {
    return this.braking[i] === 1;
  }

  /** Every car's hands back to rest (a new race). */
  reset(): void {
    this.throttle.fill(0);
    this.brake.fill(0);
    this.steer.fill(0);
    this.braking.fill(0);
    this.boosting.fill(0);
    this.boostFor.fill(BOOST_MIN_REST_S);
    this.fresh.fill(1);
    this.guardBrake.fill(0);
  }

  /** The brake latch of car `i` for a speed `excess` (m/s) over its target: on above `on`, off under `-off`, held between. */
  latch(i: number, excess: number, on: number, off: number): boolean {
    if (this.braking[i] === 1) {
      if (excess < -off) this.braking[i] = 0;
    } else if (excess > on) this.braking[i] = 1;
    return this.braking[i] === 1;
  }

  /** `out`'s pedals and wheel as car `i`'s hands make them over `dt` s (the boost button is `holdBoost`'s); a call of no time (a one-off read) leaves `out` as it is. */
  shape(i: number, out: DriveInput, dt: number): void {
    if (dt <= 0) return;
    if (out.throttle < 0) {
      this.follow(i, out);
      return;
    }
    if (this.fresh[i] === 1) {
      this.fresh[i] = 0;
      this.follow(i, out);
      return;
    }
    this.braking[i] = out.brake > 0 ? 1 : 0;
    this.throttle[i] = slew(this.throttle[i]!, out.throttle, THROTTLE_RISE, THROTTLE_FALL, dt);
    this.brake[i] = slew(this.brake[i]!, out.brake, BRAKE_RISE, BRAKE_RISE, dt);
    this.steer[i] = slew(this.steer[i]!, out.steer, STEER_RATE, STEER_RATE, dt);
    out.throttle = this.throttle[i]!;
    out.brake = this.brake[i]!;
    out.steer = this.steer[i]!;
  }

  /** Car `i`'s hands have no history (a respawn teleport): its next step starts at what the driver asks. */
  forget(i: number): void {
    this.fresh[i] = 1;
  }

  /** The contact guard's brake on `out` held through its look-ahead's on/off flicker: it comes on at once and goes off at `GUARD_BRAKE_FALL`; while it is held above what the guard asks now, the gas stays off. */
  holdGuardBrake(i: number, out: DriveInput, dt: number): void {
    if (dt <= 0) return;
    const held = out.brake >= this.guardBrake[i]! ? out.brake : Math.max(out.brake, this.guardBrake[i]! - GUARD_BRAKE_FALL * dt);
    this.guardBrake[i] = held;
    if (held > out.brake) out.throttle = 0;
    out.brake = held;
  }

  /** Car `i`'s boost button over `dt` s of asking (`want`): pressed `BOOST_MIN_BURST_S` at least, rested `BOOST_MIN_REST_S` at least; `cut` lets go now, whatever the burst. */
  holdBoost(i: number, want: boolean, dt: number, cut: boolean): boolean {
    this.boostFor[i]! += dt;
    const on = this.boosting[i] === 1;
    if (on && (cut || (!want && this.boostFor[i]! >= BOOST_MIN_BURST_S))) this.stopBoost(i);
    else if (!on && want && !cut && this.boostFor[i]! >= BOOST_MIN_REST_S) {
      this.boosting[i] = 1;
      this.boostFor[i] = 0;
    }
    return this.boosting[i] === 1;
  }

  /** Car `i`'s button comes off now (the contact guard took the boost). */
  stopBoost(i: number): void {
    this.boosting[i] = 0;
    this.boostFor[i] = 0;
  }

  /** Car `i` is driven by something else this step (a hold, a back-off, a parked unit): the hands are where `out` has them. */
  follow(i: number, out: DriveInput): void {
    this.fresh[i] = 0;
    this.throttle[i] = Math.max(0, out.throttle);
    this.brake[i] = out.brake;
    this.steer[i] = out.steer;
    this.braking[i] = out.brake > 0 ? 1 : 0;
    this.boosting[i] = out.boost ? 1 : 0;
    this.boostFor[i] = BOOST_MIN_REST_S;
  }
}

/** `value` moved toward `target` by at most `rise` (growing in size) or `fall` (shrinking) per second over `dt`. */
function slew(value: number, target: number, rise: number, fall: number, dt: number): number {
  const rate = Math.abs(target) > Math.abs(value) || target * value < 0 ? rise : fall;
  return value + clamp(target - value, -rate * dt, rate * dt);
}
