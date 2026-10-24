import * as THREE from "three";
import { hypot2 } from "../kernel/physics-core.js";
import type { DeformableCar } from "../vehicle/car.ts";
import { DRIVER_SIDE } from "../vehicle/constants.ts";
import { activeGround, NO_FLOOR } from "../world/ground.ts";
import type { Pole } from "../present/ragdoll-ground.ts";

/** Where he stands to use the driver's door, in the car's frame (m): out past the open door, level with the seat. */
const SPOT_OUT = 1.75;
const SPOT_ALONG = 0.15;
/** How near (m) his torso must be to that spot to get in. */
const DOOR_REACH = 1.9;
/** Room (m) the spot needs: clear of another car's middle, of a lamp post and of the edge of the ground. */
const CAR_CLEARANCE = 2.6;
const POLE_CLEARANCE = 0.9;
const RIM_CLEARANCE = 1;
/** A car tipped past this far (its up axis's height) is on its side or roof: no door to step out of. */
const UPRIGHT_MIN = 0.5;

const _local = new THREE.Vector3();

/** The spot outside `car`'s driver door, on the ground, into `out`. */
export function doorSpot(car: DeformableCar, out: THREE.Vector3): THREE.Vector3 {
  out.set(DRIVER_SIDE * SPOT_OUT, 0, SPOT_ALONG).applyQuaternion(car.group.quaternion).add(car.group.position);
  const ground = activeGround().heightAt(out.x, out.z);
  out.y = ground === NO_FLOOR ? 0 : ground;
  return out;
}

/** Is a car in play: not falling off the ground, put away or blown away? */
export function inPlay(car: DeformableCar): boolean {
  return !car.falling && !car.vaporized && !car.stored && car.group.visible;
}

/** Is `torso` within `DOOR_REACH` of `car`'s driver door (a car in play)? Its speed (m/s) goes to `speed[0]`. */
export function doorInReach(car: DeformableCar, torso: THREE.Vector3, speed: Float64Array): boolean {
  if (!inPlay(car)) return false;
  doorSpot(car, _local);
  if (hypot2(_local.x - torso.x, _local.z - torso.z) >= DOOR_REACH) return false;
  speed[0] = car.velocity.length();
  return true;
}

/** Is ground under (`x`, `z`) and a metre round it on each side? */
function groundAround(x: number, z: number): boolean {
  const ground = activeGround();
  return (
    ground.heightAt(x, z) !== NO_FLOOR &&
    ground.heightAt(x + RIM_CLEARANCE, z) !== NO_FLOOR &&
    ground.heightAt(x - RIM_CLEARANCE, z) !== NO_FLOOR &&
    ground.heightAt(x, z + RIM_CLEARANCE) !== NO_FLOOR &&
    ground.heightAt(x, z - RIM_CLEARANCE) !== NO_FLOOR
  );
}

/** Is `car` unfit to step out of: on its side or roof, or the spot outside its driver door another car's middle, a standing lamp post, or without ground round it? */
export function doorBlocked(cars: readonly DeformableCar[], car: DeformableCar, poles: readonly Pole[]): boolean {
  const q = car.group.quaternion;
  if (1 - 2 * (q.x * q.x + q.z * q.z) < UPRIGHT_MIN) return true;
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
  return !groundAround(_local.x, _local.z);
}
