import { applyDrive, idleDrive, type DriveInput } from "./car-drive.ts";
import type { DeformableCar } from "./car.ts";
import { carState } from "./car-state.test-util.ts";
import { FLIGHT } from "./car-flight.ts";
import { makeCar } from "./ground-probe.test-util.ts";
import { PART_STATE } from "./part-state.ts";
import type { VehicleClassId } from "./vehicle-classes.ts";
import { newWorld, stepWorld, type World } from "../engine/world-step.ts";
import { firstMismatch } from "../kernel/compare-arrays.test-util.ts";
import { QUIET_HZ } from "../kernel/constants.ts";

/** Not a test file itself: a car put back by the game's respawn (`spawnFacing`) against a car built new and placed the same. */

const SLICE_S = 1 / QUIET_HZ;
const IDLE = idleDrive();
const DRIVE: DriveInput = { throttle: 1, steer: 0.4, brake: 0, ebrake: false, boost: false };
/** Where a life starts and where the respawn puts the car back (off the first spot, with a heading and a speed). */
const LIFE_AT = { x: 3, z: -5 };
export const RESPAWN = { x: -4, z: 6, yaw: 0.5, speed: 12 };
const ASLEEP_WITHIN_SLICES = 10 * QUIET_HZ;

/** `slices` slices of `input` on `car` in `world`, the drawn skin kept up as the game does. */
function run(car: DeformableCar, world: World, input: DriveInput, slices: number): void {
  for (let slice = 0; slice < slices; slice++) {
    applyDrive(car, input, SLICE_S);
    stepWorld(world, SLICE_S);
    car.stepBreakage(SLICE_S);
    car.updateSkin();
  }
}

function placed(cls: VehicleClassId, speed: number): DeformableCar {
  const car = makeCar(cls);
  car.spawnFacing(LIFE_AT.x, LIFE_AT.z, 0, speed);
  car.group.updateMatrixWorld(true);
  car.updateSkin();
  return car;
}

function noseHit(car: DeformableCar, strength: number): void {
  car.applyImpact(car.group.position.clone().addScaledVector(car.forward, 2.05), car.forward.clone().negate(), strength, strength);
}

/** A life a car lives before its respawn: what it leaves in the car is what the respawn must wipe. */
export interface Life {
  name: string;
  live(cls: VehicleClassId): DeformableCar;
}

export const LIVES: readonly Life[] = [
  {
    name: "a wreck that slept",
    live(cls) {
      const car = placed(cls, 0);
      noseHit(car, 0.5);
      const world = newWorld([car], null);
      for (let slice = 0; slice < ASLEEP_WITHIN_SLICES && !car.asleep; slice++) run(car, world, IDLE, 1);
      if (!car.asleep) throw new Error(`the ${cls} wreck never slept`);
      return car;
    },
  },
  {
    name: "a wreck still moving",
    live(cls) {
      const car = placed(cls, 15);
      noseHit(car, 14);
      run(car, newWorld([car], null), DRIVE, QUIET_HZ);
      return car;
    },
  },
  {
    name: "a car driven hard with a door hanging loose",
    live(cls) {
      const car = placed(cls, 20);
      car.setDoorOpen(-1, 0.3);
      run(car, newWorld([car], null), DRIVE, QUIET_HZ);
      return car;
    },
  },
];

/** `car` put back where the respawn puts every car. */
export function respawn(car: DeformableCar): DeformableCar {
  car.spawnFacing(RESPAWN.x, RESPAWN.z, RESPAWN.yaw, RESPAWN.speed);
  return car;
}

/** A car built new and put where the respawn puts every car. */
export function freshCar(cls: VehicleClassId): DeformableCar {
  return respawn(makeCar(cls));
}

interface Section {
  name: string;
  from: number;
}

/** Every number of the car's state a keyframe or a bit-for-bit comparison tells apart: `carState`, then the part state (door motion and drive) and the solver state (the deform's and the cage's fit history). */
function storedState(car: DeformableCar): { values: Float64Array; sections: Section[] } {
  const base = carState(car);
  const part = new Float64Array(PART_STATE);
  car.partState(part, false);
  const solver = new Float64Array(car.solverSize());
  car.solverState(solver, false);
  const sections: Section[] = [
    { name: "flight block", from: 0 },
    { name: "flags and wheels, cage, crush, seats, masses", from: FLIGHT },
    { name: "part state", from: base.length },
    { name: "solver state", from: base.length + part.length },
  ];
  return { values: Float64Array.from([...base, ...part, ...solver]), sections };
}

/** "" when the two cars hold the same numbers to the bit, else the first that differs (its section, number and both values). */
export function stateDifference(a: DeformableCar, b: DeformableCar): string {
  const x = storedState(a);
  const y = storedState(b);
  const mismatch = firstMismatch(x.values, y.values);
  if (!mismatch) return "";
  let section = x.sections[0]!;
  for (const s of x.sections) if (s.from <= mismatch.index) section = s;
  return `${section.name} number ${mismatch.index - section.from}: ${String(mismatch.actual)} against ${String(mismatch.expected)}`;
}

/** Half a second a stretch: the first on the pedals, the rest idle. */
const AFTERMATH_STRETCH = QUIET_HZ / 2;
const AFTERMATH_STRETCHES = 4;
const DOOR_AJAR = 0.3;
/** Yaw spin (rad/s) the cars carry into the hit: the first wreck step turns it by the change of the yaw inertia. */
const SPIN = 2;

/** Both cars, a door ajar, spun and hit on the nose before either has stepped, then left to settle; "" when `stateDifference` finds none after any stretch. */
export function aftermathDifference(a: DeformableCar, b: DeformableCar): string {
  const cars = [a, b] as const;
  const worlds = [newWorld([a], null), newWorld([b], null)] as const;
  for (const car of cars) {
    car.setDoorOpen(-1, DOOR_AJAR);
    car.angular.y = SPIN;
    noseHit(car, 8);
  }
  for (let stretch = 0; stretch < AFTERMATH_STRETCHES; stretch++) {
    for (const [i, car] of cars.entries()) run(car, worlds[i]!, stretch === 0 ? DRIVE : IDLE, AFTERMATH_STRETCH);
    const difference = stateDifference(a, b);
    if (difference) return `after stretch ${stretch}: ${difference}`;
  }
  return "";
}
