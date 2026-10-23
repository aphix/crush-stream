import * as THREE from "three";
import { launch, makeCar } from "../contact/crash-scenarios.test-util.ts";
import { satCars } from "../contact/sat.ts";
import type { DeformableCar } from "../vehicle/car.ts";
import { FINE_HZ, QUIET_HZ } from "../kernel/constants.ts";
import { WORK } from "./sim-phases.ts";
import { stepWorld, type World } from "./world-step.ts";

/** The pacer's coarse step and its 1/240 s floor (s): the step a phone runs, and the slice a step in contact is cut to. */
export const COARSE = 1 / QUIET_HZ;
export const FINE = 1 / FINE_HZ;

/** Car-slices the world has stepped so far (live, wreck and sleeping cars alike). */
function carSlices(w: World): number {
  const work = w.phases.work;
  return work[WORK.liveCarSlices]! + work[WORK.wreckCarSlices]! + work[WORK.asleepCarSlices]!;
}

/** The parked pair's mirrors overlap this far (m), far off: their hulls meet, so every step of the world is cut to its fine slices whatever else is in it. */
const PARKED_OVERLAP = 0.06;
export function parkedPair(): DeformableCar[] {
  const a = makeCar("shape");
  const b = makeCar("shape");
  launch(a, 2000, 0, 0, 0, 0);
  launch(b, 2000 + 2 * (a.mirrorBaseX + a.style.door.mirrorReach) - PARKED_OVERLAP, 0, 0, 0, 0);
  return [a, b];
}

/** `car` with a door ajar: the plan hull no longer describes it (`readHull`), so the contact reach of its centre does. Call it after `launch` (a spawn shuts the doors). */
export function ajar(car: DeformableCar): DeformableCar {
  car["doorParts"][0]!.swing!.latched = false;
  return car;
}

export function dispose(cars: readonly DeformableCar[]): void {
  for (const car of cars) car.dispose();
}

/** One step's account: its slice count, the lone mask, the car-slices it stepped and the pairs with a lone car whose bodies overlap once it has run (`missedByLone`). */
export interface Row {
  slices: number;
  loners: number;
  carSlices: number;
  missed: number;
}

const _n = new THREE.Vector3();
const _p = new THREE.Vector3();

/** The shadow count of the lone verdict: pairs with a lone member in the step just run (`World.loners`) whose bodies overlap at its end, each a contact the pair pass skipped; 0 is what the test promises. */
export function missedByLone(w: World): number {
  let missed = 0;
  for (let i = 0; i < w.cars.length; i++) {
    for (let j = i + 1; j < w.cars.length; j++) {
      if (!((w.loners >>> i) & 1) && !((w.loners >>> j) & 1)) continue;
      if ((satCars(w.cars[i]!, w.cars[j]!, _n, _p, 0) ?? 0) > 0) missed++;
    }
  }
  return missed;
}

/** `steps` steps of `dt` of `w`, `before` run ahead of each. */
export function run(w: World, steps: number, dt: number, before: (step: number) => void = () => {}): Row[] {
  const rows: Row[] = [];
  for (let s = 0; s < steps; s++) {
    before(s);
    const n0 = carSlices(w);
    stepWorld(w, dt);
    rows.push({ slices: w.shape + 1, loners: w.loners, carSlices: carSlices(w) - n0, missed: missedByLone(w) });
  }
  return rows;
}
