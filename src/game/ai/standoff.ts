import { MAX_CARS } from "../scenes/fleet.ts";
import { DERBY_RULES } from "./derby-ai.ts";

/** A car pushing on under this speed (m/s) with a car on its nose is in a standoff: the contact guard's own floor, under which nothing else steers it round. */
const STANDOFF_SPEED = DERBY_RULES.hitSpeed;
/** Seconds a car must sit in a standoff before it backs off: long enough that a car about to ease clear is left alone (the owner's 0.5-1 s, the middle). */
const STANDOFF_S = 0.7;
/** The pushing throttle that counts as wanting to go. */
const PUSHING_THROTTLE = 0.2;
/** A standoff timer that is not running falls at this many times real time, so a car that frees itself for an instant is not carried to a back-off by the next touch. */
const COOL_RATE = 2;

/** Per car: how long it has been nose to nose, pushing, at a crawl. */
export class Standoff {
  private readonly held = new Float64Array(MAX_CARS);

  /** Car `i` is backing off or has been put back on the road: the count starts again. */
  forget(i: number): void {
    this.held[i] = 0;
  }

  reset(): void {
    this.held.fill(0);
  }

  /** One step of `dt` s for car `i` at `speed` m/s with `throttle` asked and a car on its nose (`nosed`) that it has a side to go round: true once it has been stuck so for `STANDOFF_S`. */
  watch(i: number, speed: number, throttle: number, nosed: boolean, dt: number): boolean {
    if (nosed && speed < STANDOFF_SPEED && throttle > PUSHING_THROTTLE) this.held[i]! += dt;
    else this.held[i] = Math.max(0, this.held[i]! - dt * COOL_RATE);
    if (this.held[i]! <= STANDOFF_S) return false;
    this.held[i] = 0;
    return true;
  }
}
