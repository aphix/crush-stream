import * as THREE from "three";
import { FINE_HZ } from "../kernel/constants.ts";
import { generalizeFields } from "../kernel/scalar.ts";
import { fleetClass, fleetStyle } from "../scenes/fleet.ts";
import { DeformableCar } from "../vehicle/car.ts";
import { STOCK_PAINT } from "../vehicle/constants.ts";
import { EjectionWatch } from "../vehicle/ejection.ts";
import { assignClass } from "../vehicle/vehicle-classes.ts";
import { newWorld, settleStep, stepWorld } from "./world-step.ts";

/** Fleet slots whose styles the pile wears: sedan, hatchback, wagon, pickup and monster truck. Not coupe or police: each costs 0.2-0.5 s more at boot for no measured gain. */
const PILE_SLOTS = [6, 7, 8, 10, 11] as const;
/** Each car's x, z (m), yaw (rad, facing the origin, skewed so no two meet square) and speed (m/s). */
const PILE_CARS = [
  [2.07, 6.69, -2.942, 14],
  [7.0, 0.1, -1.435, 12],
  [2.26, -6.63, -0.428, 10],
  [-5.6, -4.19, 1.078, 13],
  [-5.72, 4.03, 2.085, 9],
] as const;
const PILE_SECONDS = 0.6;
/** The rendered frame's share of fixed steps: the skin is written once per frame, not per step. */
const STEPS_PER_FRAME = FINE_HZ / 60;

/** Whether a boot runs the warm-up: always, but in the Vitest app project (`CRASH_WARM=off`), where each file boots one engine and would pay ~0.8 s for nothing. */
export function crashWarmWanted(): boolean {
  return typeof process === "undefined" || process.env.CRASH_WARM !== "off";
}

/**
 * Crashes a pile of fleet cars on a scratch scene during boot, so V8 compiles and types the crash path (stepping, breakage, skin) before the first real crash.
 * Cold, that crash's one step cost 40-50 ms. The cars are built as the engine builds a race's, since feedback only carries over between the same object shapes.
 * Returns whether every car crashed (else it no longer warms what it is for).
 */
export function warmCrashPath(): boolean {
  const scene = new THREE.Scene();
  const cars = PILE_SLOTS.map((slot, k) => {
    const car = new DeformableCar({ ...STOCK_PAINT, name: "warm-up" }, scene, () => false, fleetStyle(slot));
    assignClass(car, fleetClass(slot));
    generalizeFields(car);
    generalizeFields(car.deform);
    const [x, z, yaw, speed] = PILE_CARS[k]!;
    car.spawnFacing(x, z, yaw, speed);
    return car;
  });
  const world = newWorld(cars, null, new EjectionWatch());
  world.lone = true;
  const h = 1 / FINE_HZ;
  for (let step = 0; step < PILE_SECONDS * FINE_HZ; step++) {
    stepWorld(world, h);
    settleStep(cars, h, true);
    if (step % STEPS_PER_FRAME === STEPS_PER_FRAME - 1) for (const car of cars) car.updateSkin();
  }
  const crashed = cars.every((car) => car.crashed && car.deform.massActive);
  for (const car of cars) car.dispose();
  return crashed;
}
