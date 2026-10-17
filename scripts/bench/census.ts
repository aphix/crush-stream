/**
 * The lone-car census (`BENCH_CENSUS=1`, bench `--census`): of the car-steps of the window, how many ran as lone cars (`World.loners`: when a step is cut to several slices, the cars with nothing near
 * run it once), and of the ones that did not, how many were near another car but not closing on it. Read per step from the state before and after it, with no change to the sim:
 *
 *  - near: another car within `CONTACT_REACH + LONE_MARGIN` plus both cars' travel over the step (the lone test's own reach: `loneCars`, `engine/world-step.ts`), by the centres at the step's start;
 *  - hull gap: the larger of the four separating-axis gaps of the two car boxes (`CAR_HALF`, the plan oriented by `fwdFlat`/`rightFlat`): a lower bound of the distance between the hulls;
 *  - closing: the hull gap, less the pair's relative speed over the step (in any direction, a bound on the closing speed whatever the steer), is within `CLOSE_M`;
 *  - not closing: near and not closing, the car-steps a hull-gap lone test could run once;
 *  - false negative: a not-closing car-step after which the car's contact clock moved (a contact of any kind, `lastContact`) while another car's hull gap was under `CLOSE_M`: the contacts a
 *    hull-gap test would have run as one slice instead of three (an upper bound: a prop or wall contact in the same step counts).
 *
 * The rates are counts per sim-second, so load does not touch them. A step the sim ran as one slice (nothing near anything) has every car single already: those steps are counted apart.
 */
import { CONTACT_REACH, LONE_MARGIN } from "../../src/game/engine/world-step.ts";
import { WORK } from "../../src/game/engine/sim-phases.ts";
import { CAR_HALF } from "../../src/game/vehicle/car-mesh.ts";
import type { SimLike } from "./sim.ts";

/** A pair is closing when its hull gap, less the relative travel of one step, is within this (m): the census's own margin for a steer or a push inside the step. */
const CLOSE_M = 0.5;

interface Snap {
  x: number[];
  z: number[];
  vx: number[];
  vz: number[];
  fx: number[];
  fz: number[];
  contact: number[];
  crashed: boolean[];
}

/** The separating-axis gap (m) of two car boxes in plan: positive is clear air along some axis, so a lower bound of the hull distance; negative or zero: overlapping or touching on every axis. */
function hullGap(s: Snap, i: number, j: number): number {
  const dx = s.x[j]! - s.x[i]!;
  const dz = s.z[j]! - s.z[i]!;
  let gap = -Infinity;
  for (const k of [i, j]) {
    for (const along of [true, false]) {
      // The axis: the box k's forward (along) or right (across), in plan.
      const ax = along ? s.fx[k]! : s.fz[k]!;
      const az = along ? s.fz[k]! : -s.fx[k]!;
      const own = along ? CAR_HALF.z : CAR_HALF.x;
      const o = k === i ? j : i;
      // The other box's extent on that axis.
      const ofx = s.fx[o]!;
      const ofz = s.fz[o]!;
      const other = CAR_HALF.z * Math.abs(ax * ofx + az * ofz) + CAR_HALF.x * Math.abs(ax * ofz - az * ofx);
      gap = Math.max(gap, Math.abs(dx * ax + dz * az) - own - other);
    }
  }
  return gap;
}

/** Pair-steps counted as overlapping, and as deeply overlapping, by the boxes' minimum translation (m). */
const OVERLAP_M = 0.05;
const DEEP_OVERLAP_M = 0.3;

export class LoneCensus {
  private readonly sim: SimLike;
  private steps = 0;
  private singleSliceSteps = 0;
  private carSteps = 0;
  private lone = 0;
  private near = 0;
  private closing = 0;
  private notClosing = 0;
  private falseNegative = 0;
  private overlapSteps = 0;
  private deepSteps = 0;
  private maxOverlap = 0;
  private readonly overlapBy: Record<string, { over: number; deep: number; max: number }> = {};
  private readonly deepBySpeed: Record<string, number> = {};
  private readonly slices0: number;
  private readonly fineCuts0: number;

  constructor(sim: SimLike) {
    this.sim = sim;
    this.slices0 = sim.world.phases.work[WORK.slices]!;
    this.fineCuts0 = sim.world.fineCuts;
  }

  private snapshot(): Snap {
    const cars = this.sim.cars;
    return {
      x: cars.map((c) => c.group.position.x),
      z: cars.map((c) => c.group.position.z),
      vx: cars.map((c) => c.velocity.x),
      vz: cars.map((c) => c.velocity.z),
      fx: cars.map((c) => c.fwdFlat.x),
      fz: cars.map((c) => c.fwdFlat.z),
      contact: cars.map((c) => (c.deform as unknown as { lastContact: number }).lastContact),
      crashed: cars.map((c) => c.crashed),
    };
  }

  /** One step of the sim, observed. */
  step(): void {
    const dt = this.sim.stepS;
    const before = this.snapshot();
    const slices0 = this.sim.world.phases.work[WORK.slices]!;
    this.sim.run(dt);
    const after = this.snapshot();
    // Car boxes interpenetrating at the end of the step (every step, every pair): the depth is the box-vs-box minimum translation (a lower bound for deformed wrecks); by pair class and by relative speed.
    for (let i = 0; i < this.sim.cars.length; i++) {
      for (let j = i + 1; j < this.sim.cars.length; j++) {
        if (Math.hypot(after.x[j]! - after.x[i]!, after.z[j]! - after.z[i]!) > 6) continue;
        const depth = -hullGap(after, i, j);
        if (depth > OVERLAP_M) this.overlapSteps++;
        if (depth > DEEP_OVERLAP_M) this.deepSteps++;
        if (depth > this.maxOverlap) this.maxOverlap = depth;
        if (depth <= OVERLAP_M) continue;
        const kind = after.crashed[i]! && after.crashed[j]! ? "wreck-wreck" : after.crashed[i]! || after.crashed[j]! ? "intact-wreck" : "intact-intact";
        const row = (this.overlapBy[kind] ??= { over: 0, deep: 0, max: 0 });
        row.over++;
        if (depth > DEEP_OVERLAP_M) {
          row.deep++;
          const rel = Math.hypot(after.vx[j]! - after.vx[i]!, after.vz[j]! - after.vz[i]!);
          const bucket = rel < 5 ? "relative speed under 5 m/s" : rel < 15 ? "5 to 15 m/s" : "over 15 m/s";
          this.deepBySpeed[bucket] = (this.deepBySpeed[bucket] ?? 0) + 1;
        }
        if (depth > row.max) row.max = depth;
      }
    }
    const sliced = this.sim.world.phases.work[WORK.slices]! - slices0;
    const mask = this.sim.world.loners;
    const n = Math.min(this.sim.cars.length, 32);
    this.steps++;
    if (sliced <= 1) {
      this.singleSliceSteps++;
      return;
    }
    for (let i = 0; i < n; i++) {
      this.carSteps++;
      if (((mask >>> i) & 1) === 1) {
        this.lone++;
        continue;
      }
      let near = false;
      let closing = false;
      let hullAfter = false;
      for (let j = 0; j < n; j++) {
        if (j === i) continue;
        const d = Math.hypot(before.x[j]! - before.x[i]!, before.z[j]! - before.z[i]!);
        const speeds = Math.hypot(before.vx[i]!, before.vz[i]!) + Math.hypot(before.vx[j]!, before.vz[j]!);
        if (d >= CONTACT_REACH + LONE_MARGIN + speeds * dt) continue;
        near = true;
        const relative = Math.hypot(before.vx[j]! - before.vx[i]!, before.vz[j]! - before.vz[i]!);
        if (hullGap(before, i, j) - relative * dt <= CLOSE_M) closing = true;
        if (hullGap(after, i, j) < CLOSE_M) hullAfter = true;
      }
      if (!near) continue;
      this.near++;
      if (closing) this.closing++;
      else {
        this.notClosing++;
        if (hullAfter && after.contact[i] !== before.contact[i]) this.falseNegative++;
      }
    }
  }

  /** The window's counts per sim-second, and the assumptions behind them. */
  result(simS: number): Record<string, unknown> {
    const per = (v: number): number => v / simS;
    return {
      stepsPerS: per(this.steps),
      singleSliceStepsPerS: per(this.singleSliceSteps),
      carStepsPerS: per(this.carSteps),
      loneCarStepsPerS: per(this.lone),
      nearCarStepsPerS: per(this.near),
      closingPerS: per(this.closing),
      notClosingPerS: per(this.notClosing),
      notClosingThenContactPerS: per(this.falseNegative),
      slicesPerS: per(this.sim.world.phases.work[WORK.slices]! - this.slices0),
      fineCutsPerS: per(this.sim.world.fineCuts - this.fineCuts0),
      closeM: CLOSE_M,
      overlapPairStepsPerS: per(this.overlapSteps),
      deepOverlapPairStepsPerS: per(this.deepSteps),
      maxOverlapM: this.maxOverlap,
      overlapBy: Object.fromEntries(Object.entries(this.overlapBy).map(([k, v]) => [k, { overPerS: per(v.over), deepPerS: per(v.deep), maxM: v.max }])),
      deepBySpeed: Object.fromEntries(Object.entries(this.deepBySpeed).map(([k, v]) => [k, per(v)])),
    };
}
}