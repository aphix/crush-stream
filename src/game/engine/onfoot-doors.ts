import * as THREE from "three";
import { hypot2 } from "../kernel/physics-core.js";
import type { DeformableCar } from "../vehicle/car.ts";
import { DRIVER_SIDE } from "../vehicle/constants.ts";
import { activeGround, DISC_RADIUS, NO_FLOOR } from "../world/ground.ts";
import type { Pole } from "../present/ragdoll-ground.ts";

/** Where he stands to use the driver's door, in the car's frame (m): out past the open door, level with the seat. */
const SPOT_OUT = 1.75;
const SPOT_ALONG = 0.15;
/** How near (m) his torso must be to that spot to get in. */
const DOOR_REACH = 1.9;
/** Room (m) the spot needs: clear of another car's middle, of a lamp post and of the disc's rim. */
const CAR_CLEARANCE = 2.6;
const POLE_CLEARANCE = 0.9;
const RIM_CLEARANCE = 1;

const _local = new THREE.Vector3();

/** The spot outside `car`'s driver door, on the ground, into `out`. */
export function doorSpot(car: DeformableCar, out: THREE.Vector3): THREE.Vector3 {
  out.set(DRIVER_SIDE * SPOT_OUT, 0, SPOT_ALONG).applyQuaternion(car.group.quaternion).add(car.group.position);
  const ground = activeGround().heightAt(out.x, out.z);
  out.y = ground === NO_FLOOR ? 0 : ground;
  return out;
}

/** Is a car in play: not falling off the disc, put away or blown away? */
function inPlay(car: DeformableCar): boolean {
  return !car.falling && !car.vaporized && !car.stored && car.group.visible;
}

/**
 * The car whose driver door `torso` stands within `DOOR_REACH` of (nearest first), or -1; its speed (m/s) goes to `speed[0]`.
 * Any car in play counts, the one he got out of and the others.
 */
export function nearestDoor(cars: readonly DeformableCar[], torso: THREE.Vector3, speed: Float64Array): number {
  let best = -1;
  let bestGap = DOOR_REACH;
  for (let i = 0; i < cars.length; i++) {
    const car = cars[i]!;
    if (!inPlay(car)) continue;
    doorSpot(car, _local);
    const gap = hypot2(_local.x - torso.x, _local.z - torso.z);
    if (gap >= bestGap) continue;
    bestGap = gap;
    best = i;
    speed[0] = car.velocity.length();
  }
  return best;
}

/** Is the spot outside `car`'s driver door unusable: another car's middle, a standing lamp post or the rim of the ground within reach of it? */
export function doorBlocked(cars: readonly DeformableCar[], car: DeformableCar, poles: readonly Pole[]): boolean {
  doorSpot(car, _local);
  for (let i = 0; i < cars.length; i++) {
    const other = cars[i]!;
    if (other === car || !inPlay(other)) continue;
    if (hypot2(other.group.position.x - _local.x, other.group.position.z - _local.z) < CAR_CLEARANCE) return true;
  }
  for (let i = 0; i < poles.length; i++) {
    const pole = poles[i]!;
    if (!pole.intact || !pole.group.visible) continue;
    if (hypot2(pole.group.position.x - _local.x, pole.group.position.z - _local.z) < POLE_CLEARANCE + pole.radius) return true;
  }
  return activeGround().heightAt(_local.x, _local.z) === NO_FLOOR || hypot2(_local.x, _local.z) > DISC_RADIUS - RIM_CLEARANCE;
}
