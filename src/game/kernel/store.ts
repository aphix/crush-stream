import type { Quaternion, Vector3 } from "three";

/*
 * A vector's or quaternion's components into a typed array, for the stores made every step or frame: one function per array kind.
 * Not three's `toArray`: building the cars feeds that one shared function every array kind (plain arrays, Float32Array,
 * Float64Array), so its keyed stores go megamorphic, and every per-step caller pays the generic store (87 ns a call against 1.6,
 * CarPerf2 8f7832a1). One kind per function keeps each store monomorphic.
 */

/** `v` into `out` at `at`. */
export function store3f(out: Float32Array, at: number, v: Vector3): void {
  out[at] = v.x;
  out[at + 1] = v.y;
  out[at + 2] = v.z;
}

/** `v` into `out` at `at`. */
export function store3d(out: Float64Array, at: number, v: Vector3): void {
  out[at] = v.x;
  out[at + 1] = v.y;
  out[at + 2] = v.z;
}

/** `q` into `out` at `at` (x, y, z, w). */
export function store4f(out: Float32Array, at: number, q: Quaternion): void {
  out[at] = q.x;
  out[at + 1] = q.y;
  out[at + 2] = q.z;
  out[at + 3] = q.w;
}

/** `q` into `out` at `at` (x, y, z, w). */
export function store4d(out: Float64Array, at: number, q: Quaternion): void {
  out[at] = q.x;
  out[at + 1] = q.y;
  out[at + 2] = q.z;
  out[at + 3] = q.w;
}
