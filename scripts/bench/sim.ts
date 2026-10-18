/**
 * The scenario benches' world: the engine's own slice over a bare `World` (no engine, no render, no AI): each car takes its scripted pedal, the world steps
 * (plan, integrate, wreck, pairs, structure, course, bake), the settle step follows the crash (breakage, drag of a dead drivetrain), and the pacer is
 * pinned to the 1/240 s slice with one step a frame, as `benchRaceEngine` runs the city bench, so the work a second of sim does never depends on the machine.
 * Not a test file: `run-scenario.ts` (one arm of one scenario) and `scenarios.ts` (the named configs) use it.
 */
import "../../src/game/kernel/rapier-node.test-util.ts";
import { DeformableCar } from "../../src/game/vehicle/car.ts";
import { applyDrive, type DriveInput } from "../../src/game/vehicle/car-drive.ts";
import { newWorld, settleStep, stepWorld, type World } from "../../src/game/engine/world-step.ts";
import { lap, PHASE, startLaps } from "../../src/game/engine/sim-phases.ts";
import { PoseBlend } from "../../src/game/present/pose-blend.ts";
import { SimPacer } from "../../src/game/engine/sim-pace.ts";
import { sliceSpeed } from "../../src/game/contact/sat.ts";
import { FINE_HZ, FRAME_HZ, QUIET_HZ } from "../../src/game/kernel/constants.ts";

/** One step a frame: the pacer takes the 1/240 s slice, so no step meets a wall deadline. */
export const STEP_S = 1 / FINE_HZ;

/** What `run-scenario.ts` needs of a scenario's sim: the world whose phase clock it reads, the cars, the sim clock and a way to step it (the bare `Sim`, or the engine's city). */
export interface SimLike {
  readonly world: World;
  readonly cars: readonly DeformableCar[];
  /** Sim seconds run. */
  readonly t: number;
  run(seconds: number): void;
  /** The step (s) a `run` of one step advances: 1/240 s at the fine floor, 1/80 s on the race's schedule. */
  readonly stepS: number;
  /** A sim that draws frames (`Sim.drawFrames`): the window's frame count and ms, zeroed by the runner as the window starts. */
  readonly drawn?: { frames: number; ms: number; slices: number; stepMs: number };
}

export class Sim implements SimLike {
  readonly cars: DeformableCar[];
  readonly world: World;
  readonly pace = new SimPacer(false);
  readonly pedals = new Map<DeformableCar, DriveInput>();
  /** Sim seconds run. */
  t = 0;
  private step = STEP_S;

  /** The step (s) `run` advances by. */
  get stepS(): number {
    return this.step;
  }

  /** `lone`: the race's lone-car schedule (`World.lone`, on in a race and off in the Fleet and the derby). */
  constructor(cars: DeformableCar[], lone: boolean) {
    this.cars = cars;
    this.world = newWorld(cars, null, null);
    this.world.lone = lone;
    this.pace.pin = false;
  }

  private readonly slice = (h: number): void => {
    const phases = this.world.phases;
    startLaps(phases);
    if (this.blend) {
      const t0 = performance.now();
      this.blend.begin(this.cars);
      this.drawn.stepMs += performance.now() - t0;
    }
    for (const car of this.cars) {
      const pedal = this.pedals.get(car);
      if (pedal) applyDrive(car, pedal, h);
    }
    lap(phases, PHASE.drive);
    stepWorld(this.world, h);
    lap(phases, PHASE.rules);
    settleStep(this.cars, h, true);
    lap(phases, PHASE.settle);
    if (this.blend) {
      const t0 = performance.now();
      this.blend.end(this.cars);
      this.drawn.stepMs += performance.now() - t0;
      this.drawn.slices++;
    }
    this.t += h;
  };

  /**
   * The race's step schedule from here on (`QUIET_HZ`, the pacer's coarse floor: one 1/80 s step cut to 1/240 s slices only where a car is in contact), so the lone-car cut (`World.lone`)
   * has slices to skip: at the fine floor every step is one slice and a lone car skips nothing. Staging runs at the fine floor either way, so both schedules start from the same bytes.
   */
  useRaceSchedule(): this {
    this.pace.pin = true;
    this.step = 1 / QUIET_HZ;
    return this;
  }

  /**
   * The frames a rendered second would draw (`FRAME_HZ` of them), as the engine draws them: `PoseBlend` begins and ends around every slice (`stepMs` counts what that costs), and after the step that
   * reaches a frame every car's `updateSkin` (the skin, lamps, panels, glass and the parts' pose), then the blend presents the cars between their last two poses and restores them. `drawn` counts the
   * frames and the ms those took; the rows of a still scene (`present`) read them with the calls per frame the scenario probe counts.
   */
  drawFrames(): this {
    this.drawing = true;
    this.blend = new PoseBlend();
    return this;
  }

  /** Frames drawn, the ms of their updateSkin + present + restore, and the slices the blend ran its begin/end for with their ms, since the runner last zeroed them (the window starts there). */
  readonly drawn = { frames: 0, ms: 0, slices: 0, stepMs: 0 };
  private drawing = false;
  private drawDue = 0;
  private blend: PoseBlend | null = null;

  private draw(): void {
    this.drawDue += this.step;
    while (this.drawDue >= 1 / FRAME_HZ) {
      this.drawDue -= 1 / FRAME_HZ;
      const t0 = performance.now();
      for (const car of this.cars) car.updateSkin();
      this.blend!.present(this.cars, this.pace.alpha);
      this.blend!.restore();
      this.drawn.ms += performance.now() - t0;
      this.drawn.frames++;
    }
  }

  /** `seconds` of sim, one step at a time (1/240 s, or 1/80 s after `useRaceSchedule`). */
  run(seconds: number): void {
    const steps = Math.round(seconds / this.step);
    for (let i = 0; i < steps; i++) {
      this.pace.run(this.step, 1, sliceSpeed(this.cars), true, Infinity, this.slice);
      if (this.drawing) this.draw();
    }
  }

  /** Steps until `done` or `limitS` of sim; the sim seconds it ran. */
  runUntil(done: () => boolean, limitS: number): number {
    const t0 = this.t;
    while (!done() && this.t - t0 < limitS) this.pace.run(this.step, 1, sliceSpeed(this.cars), true, Infinity, this.slice);
    return this.t - t0;
  }
}
