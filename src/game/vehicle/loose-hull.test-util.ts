import * as THREE from "three";
import { FL_DEPTH, HIT_SIZE, PQ_SIZE, PQ_X, PQ_Y, PQ_Z } from "../world/surfaces.ts";
import type { DeformableCar } from "./car.ts";
import type { LooseBody } from "./car-core.ts";
import { crownY } from "./car-cage-rig.ts";
import { SKIN } from "./car-surfaces.ts";

/** A car's side is met to within this (m): a point of a loose body ends no deeper in it. */
export const HULL_TOL = 0.05;

const q = new Float64Array(PQ_SIZE);
const out = new Float64Array(HIT_SIZE);
const v = new THREE.Vector3();

/**
 * How far (m) the deepest point of `b` is inside `car`'s body (0: none), by the contact code's own hull (`CarSurfaces.flank`: the cage's
 * plan field and underside). A point within a roof's skin (`SKIN`) of the car's top is on it, not in it, as the contact code reads it.
 */
export function insideHull(car: DeformableCar, b: LooseBody): number {
  const roof = car.group.position.y + crownY(car) - SKIN;
  let d = 0;
  for (let k = 0; k < b.shape.count; k++) {
    v.fromArray(b.shape.points, 3 * k).add(b.shape.centre).applyQuaternion(b.object.quaternion).add(b.object.position);
    if (v.y > roof) continue;
    q[PQ_X] = v.x;
    q[PQ_Y] = v.y;
    q[PQ_Z] = v.z;
    if (car["surfaces"]!.flank(car.slot, q, out)) d = Math.max(d, out[FL_DEPTH]!);
  }
  return d;
}
