import { MAX_CARS } from "../scenes/fleet.ts";
import { PLAN_PHASE_STEP, THINK_DUE_SLACK, THINK_HZ } from "./constants.ts";

/**
 * When each AI car plans again: about `THINK_HZ` times a second of sim time, the cars' first plans spread by id over one interval so the
 * field's planning lands on different steps. A car never planned, or one `hurry` marks (newly in danger, just backed out), plans on its next step.
 */
export class PlanClock {
  private readonly every = new Float64Array(MAX_CARS).fill(1 / THINK_HZ.hard[0]);
  /** Per car: sim time toward its next plan (the remainder carries on, so the rate holds) and since its last plan (what a plan's timers age by). */
  private readonly since = new Float64Array(MAX_CARS);
  private readonly age = new Float64Array(MAX_CARS);
  private readonly ready = new Uint8Array(MAX_CARS);
  private readonly urgent = new Uint8Array(MAX_CARS);

  /** Car `i` plans `hz` times a second from now on. */
  setRate(i: number, hz: number): void {
    this.every[i] = 1 / hz;
  }

  /** Car `i` has no plan (a new race, a respawn): its next step plans. */
  forget(i: number): void {
    this.ready[i] = 0;
  }

  forgetAll(): void {
    this.ready.fill(0);
    this.urgent.fill(0);
  }

  /** Car `i` plans on its next step whatever the clock says. */
  hurry(i: number): void {
    this.urgent[i] = 1;
  }

  /** A step of `dt` s passed for car `i`: whether it plans now. */
  due(i: number, dt: number): boolean {
    this.age[i]! += dt;
    this.since[i]! += dt;
    return this.ready[i] === 0 || this.urgent[i] === 1 || this.since[i]! >= this.every[i]! - THINK_DUE_SLACK;
  }

  /** Sim time (s) since car `i` last planned: the `dt` its plan's timers age by. */
  ageOf(i: number): number {
    return this.age[i]!;
  }

  /** Car `i` has planned: its clock carries the remainder on; a first plan starts at the car's own phase of the interval. */
  planned(i: number): void {
    const every = this.every[i]!;
    if (this.ready[i] === 0) {
      this.ready[i] = 1;
      this.since[i] = every * ((i * PLAN_PHASE_STEP) % 1);
    } else if (this.since[i]! >= every - THINK_DUE_SLACK) this.since[i] = Math.min(this.since[i]! - every, every);
    this.age[i] = 0;
    this.urgent[i] = 0;
  }
}
