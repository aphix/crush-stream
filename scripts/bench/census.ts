/**
 * The lone-car census (`BENCH_CENSUS=1`, bench `--census`): of the car-steps of the window, how many ran as lone cars (`World.loners`: when a step is cut to several slices, the cars with nothing near
 * run it once), and of the ones that did not, how many were near another car but not closing on it. Read per step from the state before and after it, with no change to the sim:
 *
 *  - near: another car within `CONTACT_REACH + LONE_MARGIN` plus both cars' travel over the step (the lone test's own reach: `loneCars`, `engine/world-step.ts`), by the centres at the step's start;
 *  - hull gap: the larger of the four separating-axis gaps of the two car boxes (`FLEET_HALF`, the largest style's box, the plan oriented by `fwdFlat`/`rightFlat`): a lower bound of the distance between the hulls;
 *  - closing: the hull gap, less the pair's relative speed over the step (in any direction, a bound on the closing speed whatever the steer), is within `CLOSE_M`;
 *  - not closing: near and not closing, the car-steps a hull-gap lone test could run once;
 *  - false negative: a not-closing car-step after which the car's contact clock moved (a contact of any kind, `lastContact`) while another car's hull gap was under `CLOSE_M`: the contacts a
 *    hull-gap test would have run as one slice instead of three (an upper bound: a prop or wall contact in the same step counts).
 *
 * The rates are counts per sim-second, so load does not touch them. A step the sim ran as one slice (nothing near anything) has every car single already: those steps are counted apart.
 */
import * as THREE from "three";
import { bandsMeet } from "../../src/game/contact/cage-outline.ts";
import { satCars } from "../../src/game/contact/sat.ts";
import { CONTACT_REACH, LONE_MARGIN } from "../../src/game/engine/world-step.ts";
import { HULL_STRIDE, readHull } from "../../src/game/contact/hull-gap.ts";
import { WORK } from "../../src/game/engine/sim-phases.ts";
import { FLEET_HALF } from "../../src/game/vehicle/car-rig.ts";
import type { SimLike } from "./sim.ts";

/** A pair is closing when its hull gap, less the relative travel of one step, is within this (m): the census's own margin for a steer or a push inside the step. */
const CLOSE_M = 0.5;
/** A change of a car's single-slice or sliced state within this many steps of its last one is a flicker. */
const FLICKER_STEPS = 4;
/** Pairs further apart than this (m, squared) are not tested for overlap: past the hulls' diagonals. */
const OVERLAP_SCAN_M2 = 6 * 6;

/** The `q` quantile of `values` (nearest rank); 0 for none. */
function percentile(values: readonly number[], q: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]!;
}

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
      const own = along ? FLEET_HALF.z : FLEET_HALF.x;
      const o = k === i ? j : i;
      // The other box's extent on that axis.
      const ofx = s.fx[o]!;
      const ofz = s.fz[o]!;
      const other = FLEET_HALF.z * Math.abs(ax * ofx + az * ofz) + FLEET_HALF.x * Math.abs(ax * ofz - az * ofx);
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
  /** Whether each car's last step ran sliced, the step it last changed, and the changes counted: `flips` all, `flickers` those within `FLICKER_STEPS` of the last. */
  private readonly wasSliced: boolean[] = [];
  private readonly lastFlip: number[] = [];
  private stepNo = 0;
  private flips = 0;
  private flickers = 0;
  /** The depth (m) of every overlapping car pair at the end of a step (`satCars`), one entry per pair-step. */
  private readonly overlaps: number[] = [];
  private readonly overlapsLone: number[] = [];
  private readonly overlapsIntact: number[] = [];
  /** The depth at the end of the step of each pair that was clear at its start: a first contact's penetration. */
  private readonly firstContacts: number[] = [];
  private readonly firstContactsLone: number[] = [];
  private readonly firstContactsIntact: number[] = [];
  private readonly normal = new THREE.Vector3();
  private readonly point = new THREE.Vector3();
  private readonly slices0: number;
  private readonly fineCuts0: number;
  private readonly collapses0: number;
  /** Near and not closing car-steps whose hull `readHull` cannot describe: the old circle keeps them in the slices. */
  private ineligible = 0;
  private readonly hull = new Float64Array(HULL_STRIDE);

  constructor(sim: SimLike) {
    this.sim = sim;
    this.slices0 = sim.world.phases.work[WORK.slices]!;
    this.fineCuts0 = sim.world.fineCuts;
    this.collapses0 = sim.world.quietCollapses;
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
    const started = this.overlapping();
    const eligible = this.sim.cars.map((c) => readHull(c, this.hull, 0));
    const slices0 = this.sim.world.phases.work[WORK.slices]!;
    this.sim.run(dt);
    const after = this.snapshot();
    // Car boxes interpenetrating at the end of the step: box-vs-box minimum translation (a lower bound for deformed wrecks), by pair class and relative speed.
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
    for (let i = 0; i < n; i++) {
      const slicedNow = sliced > 1 && ((mask >>> i) & 1) === 0;
      if (this.stepNo > 0 && slicedNow !== this.wasSliced[i]) {
        this.flips++;
        if (this.stepNo - this.lastFlip[i]! <= FLICKER_STEPS) this.flickers++;
        this.lastFlip[i] = this.stepNo;
      }
      this.wasSliced[i] = slicedNow;
    }
    this.stepNo++;
    this.measureOverlaps(mask, started);
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
        if (!eligible[i]) this.ineligible++;
        if (hullAfter && after.contact[i] !== before.contact[i]) this.falseNegative++;
      }
    }
  }

  /** The depth (m) of every pair of cars whose cage outlines overlap now, by pair key (`i * 64 + j`). */
  private overlapping(): Map<number, number> {
    const cars = this.sim.cars;
    const out = new Map<number, number>();
    for (let i = 0; i < cars.length; i++) {
      for (let j = i + 1; j < cars.length; j++) {
        const dx = cars[i]!.group.position.x - cars[j]!.group.position.x;
        const dz = cars[i]!.group.position.z - cars[j]!.group.position.z;
        if (dx * dx + dz * dz > OVERLAP_SCAN_M2 || !bandsMeet(cars[i]!, cars[j]!)) continue;
        const depth = satCars(cars[i]!, cars[j]!, this.normal, this.point, 0) ?? 0;
        if (depth > 0) out.set(i * 64 + j, depth);
      }
    }
    return out;
  }

  /** The step's overlaps into `overlaps` (`overlapsLone` with a lone car in `mask`, `overlapsIntact` of two intact cars); pairs clear when it began (`started`) also into the first-contact lists. */
  private measureOverlaps(mask: number, started: ReadonlyMap<number, number>): void {
    const cars = this.sim.cars;
    for (const [key, depth] of this.overlapping()) {
      const i = key >> 6;
      const j = key & 63;
      const lone = i < 32 && j < 32 && (((mask >>> i) & 1) === 1 || ((mask >>> j) & 1) === 1);
      const intact = !cars[i]!.deform.massActive && !cars[j]!.deform.massActive;
      this.overlaps.push(depth);
      if (lone) this.overlapsLone.push(depth);
      if (intact) this.overlapsIntact.push(depth);
      if (started.has(key)) continue;
      this.firstContacts.push(depth);
      if (lone) this.firstContactsLone.push(depth);
      if (intact) this.firstContactsIntact.push(depth);
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
      flipsPerCarPerS: per(this.flips) / Math.max(1, this.sim.cars.length),
      flickersPerCarPerS: per(this.flickers) / Math.max(1, this.sim.cars.length),
      cageOverlapPairStepsPerS: per(this.overlaps.length),
      cageOverlapMaxM: this.overlaps.reduce((a, b) => Math.max(a, b), 0),
      cageOverlapP95M: percentile(this.overlaps, 0.95),
      firstContactsPerS: per(this.firstContacts.length),
      firstContactMaxM: this.firstContacts.reduce((a, b) => Math.max(a, b), 0),
      firstContactP95M: percentile(this.firstContacts, 0.95),
      firstContactLonePerS: per(this.firstContactsLone.length),
      firstContactLoneMaxM: this.firstContactsLone.reduce((a, b) => Math.max(a, b), 0),
      firstContactIntactPerS: per(this.firstContactsIntact.length),
      firstContactIntactMaxM: this.firstContactsIntact.reduce((a, b) => Math.max(a, b), 0),
      firstContactIntactP95M: percentile(this.firstContactsIntact, 0.95),
      overlapLoneStepsPerS: per(this.overlapsLone.length),
      overlapLoneMaxM: this.overlapsLone.reduce((a, b) => Math.max(a, b), 0),
      overlapIntactStepsPerS: per(this.overlapsIntact.length),
      overlapIntactMaxM: this.overlapsIntact.reduce((a, b) => Math.max(a, b), 0),
      overlapIntactP95M: percentile(this.overlapsIntact, 0.95),
      quietCollapsesPerS: per(this.sim.world.quietCollapses - this.collapses0),
      nearNotLoneIneligiblePerS: per(this.ineligible),
      closeM: CLOSE_M,
      overlapPairStepsPerS: per(this.overlapSteps),
      deepOverlapPairStepsPerS: per(this.deepSteps),
      maxOverlapM: this.maxOverlap,
      overlapBy: Object.fromEntries(Object.entries(this.overlapBy).map(([k, v]) => [k, { overPerS: per(v.over), deepPerS: per(v.deep), maxM: v.max }])),
      deepBySpeed: Object.fromEntries(Object.entries(this.deepBySpeed).map(([k, v]) => [k, per(v)])),
    };
}
}