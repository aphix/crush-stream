import type { DeformableCar } from "../../vehicle/car.ts";

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
