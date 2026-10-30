import * as THREE from "three";
import { armTops, C_DEPTH, C_H, C_OWNER, HIT_SIZE, pointContact, PQ_BODY, PQ_FLANK, PQ_SIZE, PQ_TOP_CAP, PQ_X, PQ_Y, PQ_Z } from "../world/surfaces.ts";
import { NO_FLOOR } from "../world/ground.ts";
import type { DeformableCar } from "./car.ts";
import type { LooseBody } from "./car-core.ts";

/** A car's side is met to within this (m): a point of a loose body ends no deeper in it. */
export const HULL_TOL = 0.05;

const q = new Float64Array(PQ_SIZE);
q[PQ_BODY] = 1;
q[PQ_FLANK] = 1;
q[PQ_TOP_CAP] = Infinity;
const out = new Float64Array(HIT_SIZE);
const v = new THREE.Vector3();

/** How far (m) the world point (`x`, `y`, `z`) is inside `car`'s body by the car's own surfaces, as a loose part's point asks them (`pointContact`, `PQ_FLANK`): its flank's depth, 0 where its top answers (on it, within `SKIN`) or nothing of it does. */
export function insideCar(car: DeformableCar, x: number, y: number, z: number): number {
  q[PQ_X] = x;
  q[PQ_Y] = y;
  q[PQ_Z] = z;
  armTops(car["surfaces"]!);
  try {
    pointContact(q, -1, out);
  } finally {
    armTops(null);
  }
  return out[C_H] === NO_FLOOR && out[C_OWNER] === car.slot ? out[C_DEPTH]! : 0;
}

/** How far (m) the deepest point of `b` is inside `car`'s body (`insideCar`; 0: none). */
export function insideHull(car: DeformableCar, b: LooseBody): number {
  let d = 0;
  for (let k = 0; k < b.shape.count; k++) {
    v.fromArray(b.shape.points, 3 * k).add(b.shape.centre).applyQuaternion(b.object.quaternion).add(b.object.position);
    d = Math.max(d, insideCar(car, v.x, v.y, v.z));
  }
  return d;
}
