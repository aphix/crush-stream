import * as THREE from "three";
import type { LooseBody } from "./car-core.ts";

const _p = new THREE.Vector3();

/** A box lies on what it rests on within this (m): a settled body's lowest point is on the surface to a centimetre. */
export const RESTS = 0.01;
/** A flat box's thin axis is this near up (cos of the angle). */
export const LIES_FLAT = 0.95;

/** Point `k` of `part`'s box as it lies, into a shared vector: the point about its middle, in the part's own axes, turned and put where the part is. */
export function corner(part: LooseBody, k: number): THREE.Vector3 {
  const s = part.shape;
  return _p.set(s.points[k * 3]!, s.points[k * 3 + 1]!, s.points[k * 3 + 2]!).add(s.centre).applyQuaternion(part.object.quaternion).add(part.object.position);
}

/** The lowest point (m) of `part`'s shape (its box's, or its shell's own points) as it lies. */
export function lowest(part: LooseBody): number {
  let low = Infinity;
  for (let k = 0; k < part.shape.count; k++) low = Math.min(low, corner(part, k).y);
  return low;
}

/** The highest point (m) of `part`'s shape as it lies. */
export function highest(part: LooseBody): number {
  let high = -Infinity;
  for (let k = 0; k < part.shape.count; k++) high = Math.max(high, corner(part, k).y);
  return high;
}

/** How far up the box's thin axis (its shortest half extent) points as the part lies, as a cosine in 0..1. */
export function thinAxisUp(part: LooseBody): number {
  const s = part.shape;
  let thin = 0;
  for (let a = 1; a < 3; a++) if (s.half.getComponent(a) < s.half.getComponent(thin)) thin = a;
  return Math.abs(_p.set(thin === 0 ? 1 : 0, thin === 1 ? 1 : 0, thin === 2 ? 1 : 0).applyQuaternion(part.object.quaternion).y);
}
