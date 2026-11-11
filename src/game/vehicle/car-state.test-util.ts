import type { DeformableCar } from "./car.ts";
import { FLIGHT } from "./car-flight.ts";

/**
 * Every number of `car`'s state a test can tell apart, flat, for a bit-for-bit comparison (`firstMismatch(a, b)`): the flight block
 * (spins, angles, orientation, velocity, position, the clocks the rigid step keeps), the flags, each wheel's pose, the cage's nodes
 * and panels, the face crush, each spring's seat and each wreck mass's place. Not a test file itself.
 */
export function carState(car: DeformableCar): Float64Array {
  const state: number[] = [];
  const flight = new Float64Array(FLIGHT);
  car.flight(flight, 0, false);
  state.push(...flight);
  state.push(car.crashed ? 1 : 0, car.airborne ? 1 : 0, car.asleep ? 1 : 0, car.deform.massActive ? 1 : 0, car.deform.drivetrainAlive ? 1 : 0);
  for (const wheel of car.wheels) {
    const { position, quaternion, scale } = wheel;
    state.push(position.x, position.y, position.z, quaternion.x, quaternion.y, quaternion.z, quaternion.w, scale.x, scale.y, scale.z);
  }
  state.push(...car.cage.fields.pos, ...car.cage.fields.panelOn, ...car.deform.crush, ...car.suspension.seat);
  for (const mass of car.deform.masses) state.push(mass.world.x, mass.world.y, mass.world.z);
  return Float64Array.from(state);
}
