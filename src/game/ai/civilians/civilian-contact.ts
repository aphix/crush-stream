import type { DeformableCar } from "../../vehicle/car.ts";
import { DANGER_BRAKING, DANGER_MIN_SPEED, DANGER_MISS_METRES, DANGER_REACTION_SECONDS } from "./civilian-crowd-constants.ts";

/** How far (m) the ground point (x, z) lies outside `car`'s plan box as crushed; zero or less inside it. Not Euclidean at the corners. */
export function carGap(car: DeformableCar, x: number, z: number): number {
  const { x: qx, y: qy, z: qz, w: qw } = car.group.quaternion;
  const dx = x - car.group.position.x;
  const dz = z - car.group.position.z;
  const across = dx * (1 - 2 * (qy * qy + qz * qz)) + dz * 2 * (qx * qz - qw * qy);
  const ahead = dx * 2 * (qx * qz + qw * qy) + dz * (1 - 2 * (qx * qx + qy * qy));
  const plan = car.cage.fields.planBox;
  return Math.max(plan[0]! - across, across - plan[1]!, plan[2]! - ahead, ahead - plan[3]!);
}

/** Whether a car at `speed` with velocity (vx, vz) is coming at a civilian whose way from it is (toX, toZ): ahead of it, its path passing within `DANGER_MISS_METRES` of them, and nearer than it can stop in. */
export function comingAt(toX: number, toZ: number, vx: number, vz: number, speed: number): boolean {
  if (speed < DANGER_MIN_SPEED) return false;
  const ahead = (vx * toX + vz * toZ) / speed;
  if (ahead <= 0 || ahead > speed * DANGER_REACTION_SECONDS + (speed * speed) / (2 * DANGER_BRAKING)) return false;
  return Math.abs(vx * toZ - vz * toX) / speed <= DANGER_MISS_METRES;
}
