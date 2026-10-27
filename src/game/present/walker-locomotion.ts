import { detAtan } from "../kernel/physics-core.js";
import { GRAVITY } from "../kernel/constants.ts";
import { wrapAngle } from "./walker-math.ts";

/** The speeds (m/s) the controls ask for: community GTA V / RDR2 / Watch Dogs estimates are walk 1.3-1.6, run 2.3-3.5, sprint 6-8.5 (onfoot-speeds research). */
export const WALK_SPEED = 1.5;
export const RUN_SPEED = 3.5;
export const SPRINT_SPEED = 7;

/** Pushing up to the run speed takes 0.3 s; past it the sprint builds over about a second (research: 1-2 s to full sprint). */
const ACCEL_TO_RUN = 12;
const ACCEL_TO_SPRINT = 4.5;
/** Braking (m/s²): quick stops from a run, a sprint's (research: sprint braking 5-10) a little gentler. */
const BRAKE_AT_RUN = 14;
const BRAKE_AT_SPRINT = 10;
/** Under this command (m/s) he is not asked to move. */
const STAND_COMMAND = 0.05;

/** Most sideways acceleration (m/s²) a turn may ask: the turn rate is this over the speed, so a sprint curves wide and a walk turns on the spot. */
const LATERAL_ACCEL = 10;
/** Fastest he turns on the spot (rad/s) and how fast his turn rate may change (rad/s²). */
const TURN_RATE_MAX = 8;
const TURN_RATE_CHANGE = 60;
/** The speed (m/s) under which the turn rate is the on-the-spot one. */
const TURN_SPEED_FLOOR = 1.2;

/** Heading errors (rad) where the turn changes kind, each with its way back out 0.2 rad earlier (hysteresis): past the first he slows to a pivot, past the second he stops and turns. */
const CURVE_END = 0.52;
const SLOW_END = 1.3;
const PIVOT_IN = SLOW_END;
const STOP_IN = 2.1;
const BAND_HYSTERESIS = 0.2;
/** A turn between 30° and 75° costs up to this share of the speed; a pivot (75°-120°) runs at this speed (m/s). */
const SLOW_TURN_LOSS = 0.3;
const PIVOT_SPEED = 2;

/** Forward lean (rad) per m/s of speed, its ceiling, and the share of the lean the acceleration adds (a push leans in, a brake leans back). */
const LEAN_PER_SPEED = 0.038;
const LEAN_MAX = 0.3;
const LEAN_PER_ACCEL = 0.018;
const LEAN_BACK_MAX = 0.12;
/** The share of a turn's ideal bank (atan of the sideways acceleration over gravity) he shows, and the most (rad): 5-20° of whole-body lean in a cut. */
const BANK_SHARE = 0.9;
const BANK_MAX = 0.45;
/** The lean and bank follow their targets over this many seconds, so a stick flick does not snap the body. */
const LEAN_EASE_SECONDS = 0.1;

export type TurnBand = "curve" | "pivot" | "stop";

/**
 * The root's motion on foot: speed along his facing, the facing, and the lean they ask for. A capsule-style controller, not physics: the speed
 * rises and falls at set rates (so he reaches a run in 0.3 s), the facing turns at a rate that falls with speed, and a heading far from the
 * facing slows him first (a curve, a pivot, a stop-and-turn). Nothing allocates.
 */
export class Locomotion {
  /** The way he faces (rad about the vertical, 0 along +z) and his speed along it (m/s). */
  yaw = 0;
  speed = 0;
  /** Turn rate (rad/s) and acceleration along the facing (m/s²) this frame. */
  turnRate = 0;
  accel = 0;
  /** Forward lean and bank (rad) the body shows. */
  pitch = 0;
  roll = 0;
  band: TurnBand = "curve";

  reset(yaw: number): void {
    this.yaw = yaw;
    this.speed = this.turnRate = this.accel = this.pitch = this.roll = 0;
    this.band = "curve";
  }

  /** One step of `dt` s toward facing `heading` at `command` m/s. */
  update(dt: number, heading: number, command: number): void {
    const error = wrapAngle(heading - this.yaw);
    this.pickBand(Math.abs(error));
    const before = this.speed;
    this.speed = approachSpeed(this.speed, this.targetSpeed(command, Math.abs(error)), dt);
    this.accel = (this.speed - before) / dt;
    this.turn(dt, error);
    this.lean(dt);
  }

  private pickBand(aError: number): void {
    const stopOut = STOP_IN - BAND_HYSTERESIS;
    const pivotOut = PIVOT_IN - BAND_HYSTERESIS;
    if (aError > STOP_IN || (this.band === "stop" && aError > stopOut)) this.band = "stop";
    else if (aError > PIVOT_IN || (this.band === "pivot" && aError > pivotOut)) this.band = "pivot";
    else this.band = "curve";
  }

  private targetSpeed(command: number, aError: number): number {
    if (command < STAND_COMMAND || this.band === "stop") return 0;
    if (this.band === "pivot") return Math.min(command, PIVOT_SPEED);
    const slow = Math.max(0, Math.min(1, (aError - CURVE_END) / (SLOW_END - CURVE_END)));
    return command * (1 - SLOW_TURN_LOSS * slow);
  }

  /** Turn toward the heading at the rate the speed allows, easing the rate so it neither jumps nor overshoots the heading. */
  private turn(dt: number, error: number): void {
    const limit = Math.min(TURN_RATE_MAX, LATERAL_ACCEL / Math.max(this.speed, TURN_SPEED_FLOOR));
    const stopping = Math.sqrt(2 * TURN_RATE_CHANGE * Math.abs(error));
    const wanted = Math.sign(error) * Math.min(limit, stopping);
    const change = TURN_RATE_CHANGE * dt;
    this.turnRate += Math.max(-change, Math.min(change, wanted - this.turnRate));
    const step = this.turnRate * dt;
    this.yaw = Math.abs(step) >= Math.abs(error) ? wrapAngle(this.yaw + error) : wrapAngle(this.yaw + step);
  }

  private lean(dt: number): void {
    const push = Math.max(-LEAN_BACK_MAX, Math.min(LEAN_MAX, LEAN_PER_ACCEL * this.accel));
    const pitchTarget = Math.max(-LEAN_BACK_MAX, Math.min(LEAN_MAX, Math.min(LEAN_MAX, LEAN_PER_SPEED * this.speed) + push));
    const bank = -BANK_SHARE * detAtan((this.speed * this.turnRate) / GRAVITY);
    const rollTarget = Math.max(-BANK_MAX, Math.min(BANK_MAX, bank));
    const ease = Math.min(1, dt / LEAN_EASE_SECONDS);
    this.pitch += (pitchTarget - this.pitch) * ease;
    this.roll += (rollTarget - this.roll) * ease;
  }
}

/** `speed` moved toward `target` (m/s) by one step of `dt` s at the push or brake rate its size allows. */
function approachSpeed(speed: number, target: number, dt: number): number {
  const rising = target > speed;
  const sprintShare = Math.max(0, Math.min(1, (speed - RUN_SPEED) / (SPRINT_SPEED - RUN_SPEED)));
  const rate = rising ? (speed < RUN_SPEED ? ACCEL_TO_RUN : ACCEL_TO_SPRINT) : BRAKE_AT_RUN + (BRAKE_AT_SPRINT - BRAKE_AT_RUN) * sprintShare;
  const step = rate * dt;
  return Math.max(0, speed + Math.max(-step, Math.min(step, target - speed)));
}
