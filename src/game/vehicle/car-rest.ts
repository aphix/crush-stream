import { stirNear } from "../world/surfaces.ts";
import type { DeformableCar } from "./car.ts";
import { REACH } from "./car-surfaces.ts";

/** Seconds an intact car must be still before it sleeps: the wrecks' rest time (`WRECK_REST_S`, which a restored keyframe reads `restS` against). */
export const INTACT_REST_S = 1;
/** An intact car's speed (m/s) and spin (rad/s) under which it is still: its settle jitter on its springs is 1e-17, a creep is far over. */
const STILL = 1e-3;
const ALL_WHEELS = 15;

/** The drive's slip and handbrake states have died away (a spin, a slide, a lock-up, a handbrake just let go would not). */
function driveAtRest(car: DeformableCar): boolean {
  const d = car.drive;
  return Math.abs(d.spin) + Math.abs(d.spinSpeed) + Math.abs(d.lock) + Math.abs(d.slide) + Math.abs(d.drift) + d.ebrakeK + d.boostK < STILL;
}

/**
 * Whether sleeping intact `car` stays asleep this slice (the rigid step is skipped): nothing wrote it a velocity or spin since it slept, no pedal was
 * applied to it (a driver, a hold), nothing that moves came within `REACH` of where it sleeps. Otherwise it is woken, and steps.
 */
export function keepsSleeping(car: DeformableCar): boolean {
  if (car.restSleep && !car.drove && car.velocity.lengthSq() === 0 && car.angular.lengthSq() === 0 && !stirNear(car.sleepX, car.sleepZ, REACH, car.slot, car.surfaces?.cars ?? null)) return true;
  car.drove = false;
  car.wake();
  return false;
}

/** The drive state of sleeping `car` under a brake held on it (`applyDrive`): pedals as given, nothing else moves. */
export function restHold(car: DeformableCar, brake: number): void {
  const d = car.drive;
  d.throttle = 0;
  d.steer = 0;
  d.brake = brake;
  d.ebrake = false;
  d.boost = false;
}

/**
 * After the rigid step of an intact car: where the world lets cars rest (`restSleep`), a car that has stood on all four tyres, still, undriven, with its springs and
 * latches settled for `INTACT_REST_S` falls asleep where it stands (`keepsSleeping`).
 */
export function settleIntact(car: DeformableCar, dt: number): void {
  const driven = car.drove;
  car.drove = false;
  const v = car.velocity;
  const w = car.angular;
  if (!car.restSleep || driven || car.crashed || car.falling || car.airborne || car.wheelsDown !== ALL_WHEELS || car.restsOn !== null || car.yielding || !car.suspension.still || !driveAtRest(car) || v.lengthSq() >= STILL * STILL || w.lengthSq() >= STILL * STILL || !car.hingesLatched || car.hasLoosePart()) {
    car.restS = 0;
    return;
  }
  car.restS += dt;
  if (car.restS < INTACT_REST_S) return;
  v.set(0, 0, 0);
  w.set(0, 0, 0);
  car.asleep = true;
  car.sleepX = car.group.position.x;
  car.sleepZ = car.group.position.z;
}
