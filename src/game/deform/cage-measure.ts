import type { Cage, Sensor } from "./deform-rig.ts";
import { m3, m3Polar, quatId } from "../kernel/shape-match-core.js";

/** Per cage name: the indices (in sensor order) of the sensors that read that cage. The rig's sensors and cages never change after it is built. */
export function sensorsByPart(cages: readonly Cage[], sensors: readonly Sensor[]): Record<string, Int32Array> {
  const lists: Record<string, number[]> = {};
  for (let si = 0; si < sensors.length; si++) {
    const part = cages[sensors[si]!.partIndex]?.spec.name;
    if (part !== undefined) (lists[part] ??= []).push(si);
  }
  const out: Record<string, Int32Array> = {};
  for (const part of Object.keys(lists)) out[part] = Int32Array.from(lists[part]!);
  return out;
}

/** The largest compression (m) among the sensors `list` names; 0 for none. */
export function maxCompression(sensors: readonly Sensor[], list: Int32Array | undefined): number {
  let max = 0;
  if (list === undefined) return max;
  for (let k = 0; k < list.length; k++) {
    const c = sensors[list[k]!]!.compression;
    if (c > max) max = c;
  }
  return max;
}

/** The corners (ix + 2·iy + 4·iz) that hold a cage's pane: the windscreen's and the rear glass's slanted faces; a door pane rides its whole door. */
const APERTURE: Readonly<Record<string, readonly number[]>> = {
  glassFront: [2, 3, 4, 5],
  glassRear: [0, 1, 6, 7],
  doorLeft: [0, 1, 2, 3, 4, 5, 6, 7],
  doorRight: [0, 1, 2, 3, 4, 5, 6, 7],
};

/**
 * What `CageStrain` keeps for one cage: the corners it last measured (xyz x 8), its answers for them, and the cage's rest
 * corner-to-corner spans (28, a < b). A glazed cage also keeps its aperture's rest corners about their centroid, the rest
 * normal (a four-corner aperture), weighted as below, and the fit's rotation, the next fit's warm start.
 */
interface Memo {
  at: Float64Array;
  strain: number;
  distortion: number;
  valid: boolean;
  rest: Float64Array;
  aperture: readonly number[] | undefined;
  restRel: Float64Array;
  normal: Float64Array;
  q: Float64Array;
}

const _A = m3();
const _R = m3();
const _S = m3();

/**
 * Cage measures, rigid motion reading 0 in both. Strain (m): the largest change of any corner-to-corner distance from rest.
 * Aperture distortion (m): the largest corner displacement the aperture's rigid best fit (Kabsch) leaves over, in any
 * direction. The glass reads them every step of every crashed car, and a cage whose corners have not moved since the last
 * measure (a damaged car driving on) is not measured again: the answers are the same function of the same corners.
 */
export class CageStrain {
  private readonly memos = new WeakMap<Cage, Memo>();

  measure(cage: Cage): number {
    return this.memo(cage).strain;
  }

  aperture(cage: Cage): number {
    return this.memo(cage).distortion;
  }

  private memo(cage: Cage): Memo {
    const c = cage.corners;
    let memo = this.memos.get(cage);
    if (memo === undefined) {
      memo = newMemo(cage);
      this.memos.set(cage, memo);
    }
    const at = memo.at;
    let same = memo.valid;
    for (let i = 0; i < 8 && same; i++) {
      const p = c[i]!;
      same = p.x === at[3 * i]! && p.y === at[3 * i + 1]! && p.z === at[3 * i + 2]!;
    }
    if (same) return memo;
    for (let i = 0; i < 8; i++) {
      const p = c[i]!;
      at[3 * i] = p.x;
      at[3 * i + 1] = p.y;
      at[3 * i + 2] = p.z;
    }
    const rest = memo.rest;
    let max = 0;
    let k = 0;
    for (let a = 0; a < 8; a++) {
      for (let b = a + 1; b < 8; b++) max = Math.max(max, Math.abs(c[a]!.distanceTo(c[b]!) - rest[k++]!));
    }
    memo.strain = max;
    memo.distortion = memo.aperture === undefined ? 0 : fitResidual(at, memo);
    memo.valid = true;
    return memo;
  }
}

function newMemo(cage: Cage): Memo {
  const rest = new Float64Array(28);
  let k = 0;
  for (let a = 0; a < 8; a++) for (let b = a + 1; b < 8; b++) rest[k++] = cage.restCorners[a]!.distanceTo(cage.restCorners[b]!);
  const aperture = APERTURE[cage.spec.name];
  const n = aperture?.length ?? 0;
  const restRel = new Float64Array(3 * n);
  const normal = new Float64Array(3);
  if (aperture !== undefined) {
    const r = cage.restCorners;
    let cx = 0, cy = 0, cz = 0;
    for (const i of aperture) {
      cx += r[i]!.x / n;
      cy += r[i]!.y / n;
      cz += r[i]!.z / n;
    }
    let spread = 0;
    for (let j = 0; j < n; j++) {
      const p = r[aperture[j]!]!;
      restRel[3 * j] = p.x - cx;
      restRel[3 * j + 1] = p.y - cy;
      restRel[3 * j + 2] = p.z - cz;
      spread += (p.x - cx) ** 2 + (p.y - cy) ** 2 + (p.z - cz) ** 2;
    }
    if (n === 4) {
      quadNormal(restRel, normal);
      // The turned normal weighs like the aperture's mean in-plane moment: a flat set of corners alone leaves the fit rank 2.
      for (let a = 0; a < 3; a++) normal[a]! *= spread / 2;
    }
  }
  return { at: new Float64Array(24), strain: 0, distortion: 0, valid: false, rest, aperture, restRel, normal, q: quatId() };
}

const _quad = new Float64Array(12);
const _n = new Float64Array(3);

/** Unit normal of quad `p` (xyz x 4, corners 0 and 3 opposite, 1 and 2 opposite): the cross of its diagonals. */
function quadNormal(p: Float64Array, out: Float64Array): void {
  const ax = p[9]! - p[0]!, ay = p[10]! - p[1]!, az = p[11]! - p[2]!;
  const bx = p[6]! - p[3]!, by = p[7]! - p[4]!, bz = p[8]! - p[5]!;
  const x = ay * bz - az * by, y = az * bx - ax * bz, z = ax * by - ay * bx;
  const l = Math.sqrt(x * x + y * y + z * z) || 1;
  out[0] = x / l;
  out[1] = y / l;
  out[2] = z / l;
}

/** The largest displacement (m) of an aperture corner (`at`, xyz x 8) from the aperture's rigid best fit to its rest corners. */
function fitResidual(at: Float64Array, memo: Memo): number {
  const ids = memo.aperture!;
  const n = ids.length;
  const p = memo.restRel;
  let cx = 0, cy = 0, cz = 0;
  for (let j = 0; j < n; j++) {
    const o = 3 * ids[j]!;
    cx += at[o]!;
    cy += at[o + 1]!;
    cz += at[o + 2]!;
  }
  cx /= n;
  cy /= n;
  cz /= n;
  _A.fill(0);
  for (let j = 0; j < n; j++) {
    const o = 3 * ids[j]!;
    const x = at[o]! - cx, y = at[o + 1]! - cy, z = at[o + 2]! - cz;
    const px = p[3 * j]!, py = p[3 * j + 1]!, pz = p[3 * j + 2]!;
    _A[0]! += x * px;
    _A[1]! += x * py;
    _A[2]! += x * pz;
    _A[3]! += y * px;
    _A[4]! += y * py;
    _A[5]! += y * pz;
    _A[6]! += z * px;
    _A[7]! += z * py;
    _A[8]! += z * pz;
  }
  if (n === 4) {
    for (let j = 0; j < 4; j++) {
      const o = 3 * ids[j]!;
      _quad[3 * j] = at[o]!;
      _quad[3 * j + 1] = at[o + 1]!;
      _quad[3 * j + 2] = at[o + 2]!;
    }
    quadNormal(_quad, _n);
    const w = memo.normal;
    for (let r = 0; r < 3; r++) for (let col = 0; col < 3; col++) _A[3 * r + col]! += _n[r]! * w[col]!;
  }
  m3Polar(_A, memo.q, _R, _S);
  let max = 0;
  for (let j = 0; j < n; j++) {
    const o = 3 * ids[j]!;
    const px = p[3 * j]!, py = p[3 * j + 1]!, pz = p[3 * j + 2]!;
    const dx = at[o]! - cx - (_R[0]! * px + _R[1]! * py + _R[2]! * pz);
    const dy = at[o + 1]! - cy - (_R[3]! * px + _R[4]! * py + _R[5]! * pz);
    const dz = at[o + 2]! - cz - (_R[6]! * px + _R[7]! * py + _R[8]! * pz);
    max = Math.max(max, Math.sqrt(dx * dx + dy * dy + dz * dz));
  }
  return max;
}
