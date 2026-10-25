import * as THREE from "three";
import type { DeformableCar } from "./car.ts";
import { G } from "./car-air-body.ts";
import { rigidCentre } from "./car-air.ts";

const _centre = new THREE.Vector3();
const _spin = new THREE.Vector3();
const _inverse = new THREE.Quaternion();

/** The car's mechanical energy per unit mass (J/kg): its velocity and spin about its rigid centre, and that centre's height (a monster's stands 1.4 m over its origin, so a pitching one lifts it). */
export function energyOf(car: DeformableCar): number {
  _centre.copy(rigidCentre(car)).applyQuaternion(car.group.quaternion);
  _spin.copy(car.angular).applyQuaternion(_inverse.copy(car.group.quaternion).invert());
  const inverseInertia = car.frame.invI;
  const spin = 0.5 * (_spin.x * _spin.x / inverseInertia.x + _spin.y * _spin.y / inverseInertia.y + _spin.z * _spin.z / inverseInertia.z);
  return 0.5 * car.velocity.lengthSq() + spin + G * (car.group.position.y + _centre.y);
}
