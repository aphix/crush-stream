/**
 * The slice log (`BENCH_SLICES=<file>`, bench `--slices`): after every car's rigid step of the whole run (warm-up and window) one record of what that step left: the contact rows it solved, `hardTouch`,
 * whether the car is frozen, its velocity and spin and its pose. Two arms of an A/B that claim to do the same physics with less work (an exact cut) are compared slice by slice
 * (`compareSlices`): the first record that differs in anything physical is the answer, where a digest only says the run differs at its end. `hardTouch` is a derived bit nothing
 * of a wreck's behaviour reads, so it is counted apart. The log is plain numbers in one growing array; a run for the comparison, never for ms.
 */
import { writeFileSync } from "node:fs";
import { DeformableCar } from "../../src/game/vehicle/car.ts";

/** Numbers per record. */
export const SLICE_FIELDS = ["slot", "contacts", "hardTouch", "frozen", "vx", "vy", "vz", "wx", "wy", "wz", "px", "py", "pz", "qx", "qy", "qz", "qw"] as const;
const R = SLICE_FIELDS.length;
const HARD = SLICE_FIELDS.indexOf("hardTouch");

export function recordSlices(file: string): void {
  const log: number[] = [];
  const integrate = DeformableCar.prototype.integrate;
  DeformableCar.prototype.integrate = function (this: DeformableCar, dt: number): void {
    integrate.call(this, dt);
    const p = this.group.position;
    const q = this.group.quaternion;
    log.push(this.slot, this.contacts, this.hardTouch ? 1 : 0, this.deform.frozen ? 1 : 0, this.velocity.x, this.velocity.y, this.velocity.z, this.angular.x, this.angular.y, this.angular.z, p.x, p.y, p.z, q.x, q.y, q.z, q.w);
  };
  process.on("exit", () => writeFileSync(file, Buffer.from(new Float64Array(log).buffer)));
}

/** The first record at which two logs differ in a physical field (`hardTouch` apart), -1 if none, with the field names that differ there and how many records differ in `hardTouch` alone before it. */
export function compareSlices(a: Float64Array, b: Float64Array): { records: [number, number]; first: number; fields: string[]; hardOnly: number } {
  const n = Math.min(a.length, b.length) / R;
  let hardOnly = 0;
  for (let i = 0; i < n; i++) {
    const bad: string[] = [];
    for (let k = 0; k < R; k++) if (!Object.is(a[i * R + k], b[i * R + k])) bad.push(SLICE_FIELDS[k]!);
    if (bad.length === 0) continue;
    if (bad.length === 1 && bad[0] === SLICE_FIELDS[HARD]) {
      hardOnly++;
      continue;
    }
    return { records: [a.length / R, b.length / R], first: i, fields: bad, hardOnly };
  }
  return { records: [a.length / R, b.length / R], first: a.length === b.length ? -1 : n, fields: a.length === b.length ? [] : ["length"], hardOnly };
}
