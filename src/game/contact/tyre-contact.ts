import * as THREE from "three";
import type { DeformableCar } from "../vehicle/car.ts";
import { hypot2 } from "../deform/physics-util.ts";
import { placeTyres, tyreIn, tyresOverlap, TYRE_MASS, TYRE_STRIDE } from "./sat.ts";
import { OUTLINE_REACH } from "./cage-outline.ts";

const _tn = new THREE.Vector3();
const _tp = new THREE.Vector3();
/** Each car's tyres as `meetTyres` placed them (`placeTyres`). */
const _tyresA = new Float64Array(4 * TYRE_STRIDE);
const _tyresB = new Float64Array(4 * TYRE_STRIDE);
/** `meetTyres`' rigid contacts, `RIGID_ROW` each: how deep (`satCars`' terms), the point (x, y, z), the normal (x, z, b → a). */
const RIGID_ROW = 6;
/** Room for every tyre pair's and every tyre-in-body contact of a pair of four-wheeled cars. */
const RIGID_ROOM = 4 * 4 + 4 + 4;
const _rigid = new Float64Array(RIGID_ROOM * RIGID_ROW);
/** How many of `_rigid`'s rows `meetTyres` filled this call. */
const _rigidRows = { count: 0 };
/** `planTyrePushes`' depth (m) each rigid contact has left to clear. */
const _left = new Float64Array(RIGID_ROOM);
/** `planTyrePushes`' pushes, `TYRE_PUSH` each: the unit direction (x, z) and the distance (m). */
export const TYRE_PUSH = 3;
export const tyrePushes = new Float64Array(RIGID_ROOM * TYRE_PUSH);

/** How far (m) a car's structure has crushed in the hit that is still on (`crushing`: a contact within the last 0.28 s), 0 for a car with none. */
export function crushedSoFar(d: DeformableCar["deform"]): number {
  return d.massActive && d.crushing ? d.hitStroke() * d.strokeUsed() : 0;
}

/** How far (m) `car`'s tyre on mass `mi` may still go back into its well: as far as the hit still on has crushed its structure (`crushedSoFar`), less what it has already gone back; an intact car's tyre holds rigid. */
function tyreRoom(car: DeformableCar, mi: number): number {
  const hub = car.deform.masses[mi]!;
  return Math.max(0, crushedSoFar(car.deform) - hypot2(hub.shoveX, hub.shoveZ));
}

/**
 * `car`'s tyre on mass `mi` goes back into its well with its hub (`pushMass`: the shove its pop rule reads) by the part of `depth` m of
 * overlap on the unit (`nx`, `nz`) (the way it is pushed out) that lies along its car's axis, where the well opens, as far as its room
 * (`tyreRoom`); the part across it holds (pushed sideways, a sedan's front hub went 13 cm into its body and the narrowed wreck rolled over
 * off a 5.6 m/s side hit). Returns the depth it cleared along (`nx`, `nz`).
 */
function goBack(car: DeformableCar, mi: number, nx: number, nz: number, depth: number): number {
  const along = car.fwdFlat.x * nx + car.fwdFlat.z * nz;
  const travel = Math.min(depth * Math.abs(along), tyreRoom(car, mi));
  if (!(travel > 0)) return 0;
  const shove = Math.sign(along) * travel;
  car.deform.pushMass(mi, car.fwdFlat.x * shove, car.fwdFlat.z * shove);
  return travel * Math.abs(along);
}

/** `_rigid` takes the rigid contact `rigid` deep (`satCars`' terms) at `_tp` on the normal `_tn` turned b → a by `side`. */
function addRigid(rigid: number, look: number, side: number): void {
  if (!(rigid + look > 0)) return;
  const o = _rigidRows.count++ * RIGID_ROW;
  _rigid[o] = rigid;
  _rigid[o + 1] = _tp.x;
  _rigid[o + 2] = _tp.y;
  _rigid[o + 3] = _tp.z;
  _rigid[o + 4] = side * _tn.x;
  _rigid[o + 5] = side * _tn.z;
}

/**
 * `car`'s tyres (`tyres`, `count` of them) in `other`'s body (`tyreIn`), as the body meets it: a tyre goes back into its well by its
 * depth as far as it can (`goBack`); the rest holds rigid (`addRigid`, turned b → a by `side`).
 */
function tyresInBody(car: DeformableCar, tyres: Float64Array, count: number, other: DeformableCar, look: number, side: number): void {
  for (let k = 0; k < count; k++) {
    const hit = tyreIn(car, tyres, k, other, _tn, _tp, look);
    if (hit === null) continue;
    const back = goBack(car, tyres[k * TYRE_STRIDE + TYRE_MASS]!, _tn.x, _tn.z, hit - OUTLINE_REACH);
    addRigid(hit - back, look, side);
  }
}

/**
 * The pair's tyres against the other car's tyres and body: no tyre is in its car's cage, so the cages' outlines alone let them pass
 * through each other. Two overlapping tyres go back by their overlap, half each as far as each can (`goBack`), the rest holding rigid
 * (`tyresInBody`'s rule; each kept for `planTyrePushes`). Returns the deepest rigid tyre contact in `satCars`' terms, with the
 * normal (b → a) and centre of the patch they make in `normalOut` and `contactOut`; -Infinity for none. Both cars' world matrices are fresh.
 */
export function meetTyres(carA: DeformableCar, carB: DeformableCar, look: number, normalOut: THREE.Vector3, contactOut: THREE.Vector3): number {
  let countA = placeTyres(carA, _tyresA);
  let countB = placeTyres(carB, _tyresB);
  _rigidRows.count = 0;
  let moved = false;
  for (let ka = 0; ka < countA; ka++) {
    for (let kb = 0; kb < countB; kb++) {
      const depth = tyresOverlap(carA, _tyresA, ka, carB, _tyresB, kb, _tn, _tp);
      if (depth === -Infinity) continue;
      const miA = _tyresA[ka * TYRE_STRIDE + TYRE_MASS]!;
      const miB = _tyresB[kb * TYRE_STRIDE + TYRE_MASS]!;
      const overlap = Math.max(0, depth);
      let back = goBack(carA, miA, _tn.x, _tn.z, overlap / 2);
      back += goBack(carB, miB, -_tn.x, -_tn.z, overlap - back);
      back += goBack(carA, miA, _tn.x, _tn.z, overlap - back);
      moved ||= back > 0;
      addRigid(depth - back + OUTLINE_REACH, look, 1);
    }
  }
  if (moved) {
    countA = placeTyres(carA, _tyresA);
    countB = placeTyres(carB, _tyresB);
  }
  tyresInBody(carA, _tyresA, countA, carB, look, 1);
  tyresInBody(carB, _tyresB, countB, carA, look, -1);
  return rigidPatch(look, normalOut, contactOut);
}

/**
 * The deepest of `_rigid`'s contacts (-Infinity for none), and the patch they make: every contact within the look-ahead, each weighted by
 * how far it reaches into it, as `satCars` takes its nodes (its normal into `normalOut`, its centre into `contactOut`). A mirror
 * head-on's two front tyre contacts, one per side, went one-sided to the deeper by a hair and turned the pair (noses 0.763 / 0.774 m at
 * 100 km/h); weighted by depth alone, a contact still within the look but not yet touching left it one-sided too.
 */
function rigidPatch(look: number, normalOut: THREE.Vector3, contactOut: THREE.Vector3): number {
  if (_rigidRows.count === 0) return -Infinity;
  let deepest = 0;
  let w = 0;
  let nx = 0;
  let nz = 0;
  contactOut.set(0, 0, 0);
  for (let o = 0; o < _rigidRows.count * RIGID_ROW; o += RIGID_ROW) {
    if (_rigid[o]! > _rigid[deepest]!) deepest = o;
    const reach = _rigid[o]! + look;
    w += reach;
    contactOut.x += reach * _rigid[o + 1]!;
    contactOut.y += reach * _rigid[o + 2]!;
    contactOut.z += reach * _rigid[o + 3]!;
    nx += reach * _rigid[o + 4]!;
    nz += reach * _rigid[o + 5]!;
  }
  contactOut.multiplyScalar(1 / w);
  const len = hypot2(nx, nz);
  // Contacts pressing from opposite sides cancel: the deepest says which way the pair parts.
  if (len > 1e-9) normalOut.set(nx / len, 0, nz / len);
  else normalOut.set(_rigid[deepest + 4]!, 0, _rigid[deepest + 5]!);
  return _rigid[deepest]!;
}

/**
 * The pushes (into `tyrePushes`, returning how many) that clear the last `meetTyres`' rigid contacts by position, deepest first, each on
 * its own normal (b → a) by what is left of it past `OUTLINE_REACH` once the pushes before it (and `pushed` m on (`nx`, `nz`), the
 * cages') have cleared their share of it along it, no push more than `cap` m.
 */
export function planTyrePushes(nx: number, nz: number, pushed: number, cap: number): number {
  for (let k = 0; k < _rigidRows.count; k++) {
    const o = k * RIGID_ROW;
    _left[k] = _rigid[o]! - OUTLINE_REACH - pushed * Math.max(0, nx * _rigid[o + 4]! + nz * _rigid[o + 5]!);
  }
  let pushes = 0;
  for (;;) {
    let next = -1;
    for (let k = 0; k < _rigidRows.count; k++) if (_left[k]! > 0 && (next < 0 || _left[k]! > _left[next]!)) next = k;
    if (next < 0) return pushes;
    const ux = _rigid[next * RIGID_ROW + 4]!;
    const uz = _rigid[next * RIGID_ROW + 5]!;
    const amount = Math.min(_left[next]! + 0.006, cap);
    tyrePushes[pushes * TYRE_PUSH] = ux;
    tyrePushes[pushes * TYRE_PUSH + 1] = uz;
    tyrePushes[pushes * TYRE_PUSH + 2] = amount;
    pushes++;
    for (let k = 0; k < _rigidRows.count; k++) _left[k] = _left[k]! - amount * Math.max(0, ux * _rigid[k * RIGID_ROW + 4]! + uz * _rigid[k * RIGID_ROW + 5]!);
    _left[next] = 0;
  }
}
