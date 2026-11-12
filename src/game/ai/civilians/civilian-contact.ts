import { hypot2 } from "../../kernel/physics-core.js";
import type { DeformableCar } from "../../vehicle/car.ts";
import { PLAYER_PUNCH_ARC, PLAYER_PUNCH_REACH } from "./civilian-constants.ts";
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

/** How far (m) the point (tx, tz) is from a punch thrown at (x, z) along the unit (dirX, dirZ), or -1 when it is out of `PLAYER_PUNCH_REACH` or outside the arc (cosine under `PLAYER_PUNCH_ARC`). Every punch target is found by this. */
export function punchGap(x: number, z: number, dirX: number, dirZ: number, tx: number, tz: number): number {
  const dx = tx - x;
  const dz = tz - z;
  const d = hypot2(dx, dz);
  return d <= PLAYER_PUNCH_REACH && (d === 0 || (dx * dirX + dz * dirZ) / d >= PLAYER_PUNCH_ARC) ? d : -1;
}
