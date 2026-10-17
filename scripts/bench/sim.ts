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
import { SimPacer } from "../../src/game/engine/sim-pace.ts";
import { sliceSpeed } from "../../src/game/contact/sat.ts";
import { FINE_HZ } from "../../src/game/kernel/constants.ts";

/** One step a frame: the pacer takes the 1/240 s slice, so no step meets a wall deadline. */
export const STEP_S = 1 / FINE_HZ;

export class Sim {
  readonly cars: DeformableCar[];
  readonly world: World;
  readonly pace = new SimPacer(false);
  readonly pedals = new Map<DeformableCar, DriveInput>();
  /** Sim seconds run. */
  t = 0;

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
    for (const car of this.cars) {
      const pedal = this.pedals.get(car);
      if (pedal) applyDrive(car, pedal, h);
    }
    lap(phases, PHASE.drive);
    stepWorld(this.world, h);
    lap(phases, PHASE.rules);
    settleStep(this.cars, h, true);
    lap(phases, PHASE.settle);
    this.t += h;
  };

  /** `seconds` of sim, one 1/240 s step at a time. */
  run(seconds: number): void {
    const steps = Math.round(seconds / STEP_S);
    for (let i = 0; i < steps; i++) this.pace.run(STEP_S, 1, sliceSpeed(this.cars), true, Infinity, this.slice);
  }

  /** Steps until `done` or `limitS` of sim; the sim seconds it ran. */
  runUntil(done: () => boolean, limitS: number): number {
    const t0 = this.t;
    while (!done() && this.t - t0 < limitS) this.pace.run(STEP_S, 1, sliceSpeed(this.cars), true, Infinity, this.slice);
    return this.t - t0;
  }
}
