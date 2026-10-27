import { detCos, detSin } from "../kernel/physics-core.js";

const TWO_PI = 2 * Math.PI;

/** `angle` (rad) wrapped into [-π, π]. */
export function wrapAngle(angle: number): number {
  let a = angle % TWO_PI;
  if (a > Math.PI) a -= TWO_PI;
  else if (a < -Math.PI) a += TWO_PI;
  return a;
}

/** The quaternion of a lean by `pitch` about the body's own x axis (positive: chest toward the ground, head toward +z), then a turn by `yaw` about the vertical, into `out` (x, y, z, w). */
export function pitchedQuaternion(out: Float64Array, yaw: number, pitch: number): void {
  const sy = detSin(yaw / 2);
  const cy = detCos(yaw / 2);
  const sx = detSin(pitch / 2);
  const cx = detCos(pitch / 2);
  out[0] = cy * sx;
  out[1] = cx * sy;
  out[2] = -sy * sx;
  out[3] = cy * cx;
}

/** The quaternion of a turn by `yaw` about the vertical after a lean by `pitch` about the body's x axis and a bank by `roll` about its z axis (positive roll tilts the head toward -x), into `out` (x, y, z, w). */
export function leanedQuaternion(out: Float64Array, yaw: number, pitch: number, roll: number): void {
  const sy = detSin(yaw / 2);
  const cy = detCos(yaw / 2);
  const sx = detSin(pitch / 2);
  const cx = detCos(pitch / 2);
  const sz = detSin(roll / 2);
  const cz = detCos(roll / 2);
  const x = cx * sz * sy + sx * cz * cy;
  const y = cx * cz * sy - sx * sz * cy;
  const z = cx * sz * cy - sx * cz * sy;
  const w = cx * cz * cy + sx * sz * sy;
  out[0] = x;
  out[1] = y;
  out[2] = z;
  out[3] = w;
}

/** How upright a body is: the vertical component of its up axis, 1 standing and -1 on its head, from its rotation `(x, y, z, w)` read at `o` in `pose`. */
export function uprightness(pose: ArrayLike<number>, o: number): number {
  const x = pose[o]!;
  const z = pose[o + 2]!;
  return 1 - 2 * (x * x + z * z);
}

/** `a` eased toward `b` by the share `t` (0 to 1) along the short arc, normalised, into `out` (quaternions x, y, z, w; `out` may be `a`). */
export function nlerp(out: Float64Array, a: ArrayLike<number>, b: ArrayLike<number>, t: number): void {
  const dot = a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]! + a[3]! * b[3]!;
  const sign = dot < 0 ? -1 : 1;
  let x = a[0]! * (1 - t) + sign * b[0]! * t;
  let y = a[1]! * (1 - t) + sign * b[1]! * t;
  let z = a[2]! * (1 - t) + sign * b[2]! * t;
  let w = a[3]! * (1 - t) + sign * b[3]! * t;
  const length = Math.sqrt(x * x + y * y + z * z + w * w);
  x /= length;
  y /= length;
  z /= length;
  w /= length;
  out[0] = x;
  out[1] = y;
  out[2] = z;
  out[3] = w;
}

/** The angular velocity (rad/s, world) that turns rotation `from` into `to` in `seconds`, small-angle form, into `out` (x, y, z). */
export function spinBetween(out: Float64Array, from: ArrayLike<number>, to: ArrayLike<number>, seconds: number): void {
  // to * from⁻¹, vector part
  const fx = -from[0]!;
  const fy = -from[1]!;
  const fz = -from[2]!;
  const fw = from[3]!;
  const tx = to[0]!;
  const ty = to[1]!;
  const tz = to[2]!;
  const tw = to[3]!;
  const x = tw * fx + tx * fw + ty * fz - tz * fy;
  const y = tw * fy - tx * fz + ty * fw + tz * fx;
  const z = tw * fz + tx * fy - ty * fx + tz * fw;
  const w = tw * fw - tx * fx - ty * fy - tz * fz;
  const k = (w < 0 ? -2 : 2) / seconds;
  out[0] = x * k;
  out[1] = y * k;
  out[2] = z * k;
}
