import type * as THREE from "three";

/** Numbers of a camera basis (`cameraBasis`): the right, up and forward columns of its rotation. */
export const BASIS_SIZE = 9;

/** `attr`'s array as the Float32Array an instance matrix buffer is made as: the pools write it directly. */
export function float32Of(attr: THREE.BufferAttribute): Float32Array {
  if (!(attr.array instanceof Float32Array)) throw new Error("an FX instance buffer is not a Float32Array");
  return attr.array;
}

/** The rotation block of `Matrix4.compose` for `q`, as three columns: a pool reads it once a frame and stamps every billboard from it. */
export function cameraBasis(q: THREE.Quaternion, out: Float64Array): void {
  const { x, y, z, w } = q;
  const x2 = x + x;
  const y2 = y + y;
  const z2 = z + z;
  const xx = x * x2;
  const xy = x * y2;
  const xz = x * z2;
  const yy = y * y2;
  const yz = y * z2;
  const zz = z * z2;
  const wx = w * x2;
  const wy = w * y2;
  const wz = w * z2;
  out[0] = 1 - (yy + zz);
  out[1] = xy + wz;
  out[2] = xz - wy;
  out[3] = xy - wz;
  out[4] = 1 - (xx + zz);
  out[5] = yz + wx;
  out[6] = xz + wy;
  out[7] = yz - wx;
  out[8] = 1 - (xx + yy);
}

/** Instance matrix at `at` in `out`: a unit quad turned by `basis` (`cameraBasis`), scaled `s`, at (x, y, z): what `Matrix4.compose` gives for the camera's quaternion. */
export function writeBillboard(out: Float32Array, at: number, basis: Float64Array, s: number, x: number, y: number, z: number): void {
  out[at] = basis[0]! * s;
  out[at + 1] = basis[1]! * s;
  out[at + 2] = basis[2]! * s;
  out[at + 3] = 0;
  out[at + 4] = basis[3]! * s;
  out[at + 5] = basis[4]! * s;
  out[at + 6] = basis[5]! * s;
  out[at + 7] = 0;
  out[at + 8] = basis[6]! * s;
  out[at + 9] = basis[7]! * s;
  out[at + 10] = basis[8]! * s;
  out[at + 11] = 0;
  out[at + 12] = x;
  out[at + 13] = y;
  out[at + 14] = z;
  out[at + 15] = 1;
}
