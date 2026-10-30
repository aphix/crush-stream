import * as THREE from "three";
import type { DeformableCar } from "../vehicle/car.ts";
import { REARM_QUIET_S } from "../vehicle/car-core.ts";
import { armPairWithRows, rewindRows, wreckCentre, wreckInvI } from "../vehicle/car-air.ts";
import { MU_BODY, REST_SPEED, WALL_CRUSH } from "../vehicle/car-air-body.ts";
import { leftoverCrumple, satPushCap, hypot2, CRASH } from "../deform/physics-util.ts";
import { patch, satCars } from "./sat.ts";
import { bandsMeet, OUTLINE_REACH } from "./cage-outline.ts";
import { strikeCar, faceDepth, faceExit, carRow, takeRow, moveAsOneBody, bodyHit, type ContactBox } from "./external-contact.ts";
import { bodyContact, BODY_SIZE, BODY_VX, BODY_VZ, BODY_W, BODY_X, BODY_Z, CT_DEPTH, CT_E, CT_JMAX, CT_MU, CT_NX, CT_NZ, CT_SIZE, CT_X, CT_Z, OUT_EBS_A, OUT_EBS_B, OUT_PUSH_A, OUT_PUSH_B, OUT_SIZE } from "./body-contact.ts";
import { ARM_CLOSING, PAIR_MU, SOLID_E } from "./constants.ts";
import { SOLID_AT_REST } from "../world/constants.ts";
import { detSin, detCos } from "../kernel/physics-core.js";
import { FINE_HZ, QUIET_HZ } from "../kernel/constants.ts";
import { PUSH_SPEED } from "../deform/push-budget.ts";

const _v = new THREE.Vector3();
const _w = new THREE.Vector3();
const _n = new THREE.Vector3();
const _p = new THREE.Vector3();
const _massPoint = new THREE.Vector3();
const _aim = new THREE.Vector3();
const _tn = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _turnCentre = new THREE.Vector3();
const _slide = new THREE.Vector3();
const _slideB = new THREE.Vector3();
const _arm = new THREE.Vector3();
const _inward = new THREE.Vector3();

/** A striker sliding along the other car slower than this (m/s) cuts no scratch: a head-on or a resting pile slides about 0. */
const SCRATCH_MIN_SLIP = 1.5;

/** The world velocity of `car`'s body at world point `p` into `out`. */
function pointVelocity(car: DeformableCar, p: THREE.Vector3, out: THREE.Vector3): THREE.Vector3 {
  return out.crossVectors(car.angular, _arm.subVectors(p, car.group.position)).add(car.velocity);
}

/**
 * Each car of a touching pair takes the scratch the other's slide cuts at the patch `p` (`DeformableCar.scrape`): `n` the plan normal
 * from B to A, `strength` how hard they press (m/s: the hit's `impulse`), `half` the patch's half length (m). Nothing the sim reads is written.
 */
function scrapePair(carA: DeformableCar, carB: DeformableCar, n: THREE.Vector3, p: THREE.Vector3, strength: number, half: number): void {
  pointVelocity(carA, p, _slide).sub(pointVelocity(carB, p, _slideB));
  _slide.addScaledVector(n, -_slide.dot(n));
  _slide.y = 0;
  if (hypot2(_slide.x, _slide.z) < SCRATCH_MIN_SLIP) return;
  const cutByA = carA.cutAt(p);
  const cutByB = carB.cutAt(p);
  carB.scrape(p, _inward.copy(n).negate(), _slide, half, strength, cutByA);
  carA.scrape(p, n, _slide.negate(), half, strength, cutByB);
}

type PairHit = {
  impulse: number;
  /** What the pair met with along the normal this slice (m/s): the larger of its centres' closing and the rigid step's rows'. */
  closing: number;
  contact: THREE.Vector3;
  normal: THREE.Vector3;
};
/** `resolveCarPair`'s result, rewritten by every call: read or copy it (`StrongestContact`) before the next. */
const _hit: PairHit = { impulse: 0, closing: 0, contact: new THREE.Vector3(), normal: new THREE.Vector3() };

export function impulseCar(car: DeformableCar, nx: number, ny: number, nz: number, j: number): void {
  if (j === 0) return;
  if (car.deform.massActive) {
    car.deform.markMotion();
    car.deform.applyImpulse(nx, ny, nz, j);
    car.deform.takeMotion(car.velocity, car.angular);
    return;
  }
  const inv = 1 / car.deform.totalMass;
  car.velocity.x += nx * j * inv;
  car.velocity.y += ny * j * inv;
  car.velocity.z += nz * j * inv;
}

/**
 * Move `car` `amount` m along the unit (nx, ny, nz) to clear an overlap. A wreck's body moves the whole amount and its masses by their
 * share (`separateAlong`: the crumple zone's masses stay on the contact plane, so the leftover penetration is plastic crush in the body
 * frame); it takes no speed.
 */
export function pushCar(car: DeformableCar, nx: number, ny: number, nz: number, amount: number): void {
  if (car.deform.massActive) {
    const d = Math.min(amount, 0.09);
    car.group.position.x += nx * d;
    car.group.position.y += ny * d;
    car.group.position.z += nz * d;
    car.deform.separateAlong(nx, ny, nz, d);
    car.refreshBasis();
    return;
  }
  car.group.position.x += nx * amount;
  car.group.position.y += ny * amount;
  car.group.position.z += nz * amount;
  car.refreshBasis();
  car.deform.bindKinematic(car.group, car.velocity, car.angular);
}

/**
 * How deep (m) a rigid car's footprint may sit in a solid with its hull not on the face yet; and how deep (m) a wreck's footprint may,
 * the most a crushed nose is shorter than the box it was built in (a wreck driven in further, by a car ramming it, is put back). The
 * rebound of a light touch is `SOLID_E` (a crash is past `WALL_CRUSH`).
 */
const WALL_HOLD = 0.4;
const WALL_REACH = 1.2;
/** How deep (m) a wreck's crush hulls may sit in a solid it has stopped driving into (the speed it has stopped at is `SOLID_AT_REST`). */
const WALL_SKIN = 0.015;

/**
 * Seconds of travel ahead of a car driving hard into a fixed solid or another car at which its step is a hit step (`nearHit`): a quiet
 * step and a fine slice more, so no step carries it from clear of the face to inside it (0.69 m a step at 55 m/s and 80 Hz).
 */
export const HIT_AHEAD = 1 / QUIET_HZ + 1 / FINE_HZ;
/**
 * A car `gap` m from a face (a fixed solid's or another car's; negative: in it) and closing on it at `closing` m/s is about to
 * land a hard hit (`WALL_CRUSH`) when the face is within `HIT_AHEAD` s of travel: whether the crush then kills the engine no longer
 * depends on where the step grid falls on the contact (`stepWorld` cuts such a step to the pacer's fine slice).
 */
export function markApproach(car: DeformableCar, gap: number, closing: number): void {
  if (closing > WALL_CRUSH && gap < closing * HIT_AHEAD) car.nearHit = true;
}

/** `markApproach` for each near pair (`pairs[0..count)` as index pairs, stepWorld's `collectNear` list, 7 m: more than a
 *  1/60 s look-ahead of any closing speed a car reaches) on one level: each one's gap to the other's nose or flank and their
 *  closing speed along the line of centres. The course marks the solids (`RaceField`). */
export function markApproaches(cars: readonly DeformableCar[], pairs: Int32Array, count: number): void {
  for (let k = 0; k < count; k += 2) {
    const ca = cars[pairs[k]!]!;
    const cb = cars[pairs[k + 1]!]!;
    const dx = cb.group.position.x - ca.group.position.x;
    const dz = cb.group.position.z - ca.group.position.z;
    const d2 = dx * dx + dz * dz;
    if (d2 === 0 || !bandsMeet(ca, cb) || ca.falling || cb.falling) continue;
    const d = Math.sqrt(d2);
    const closing = ((ca.velocity.x - cb.velocity.x) * dx + (ca.velocity.z - cb.velocity.z) * dz) / d;
    const gap = d - (ca.frame.footHalfL + cb.frame.footHalfL);
    markApproach(ca, gap, closing);
    markApproach(cb, gap, closing);
  }
}

/** A fixed solid moves a wreck, every mass and its group, `d` m out along the unit (nx, nz): it holds the wreck there (`holdBySolid`). */
function shoveWreck(car: DeformableCar, nx: number, nz: number, d: number): void {
  car.deform.translateMasses(nx * d, nz * d, 0, 0);
  car.deform.holdBySolid(nx, nz);
  car.group.position.x += nx * d;
  car.group.position.z += nz * d;
}

/** A wreck held out of a face by position alone stops driving into it: every dynamic mass loses its speed into the unit (nx, nz), and the body takes the change. */
function stopInto(car: DeformableCar, nx: number, nz: number): void {
  const d = car.deform;
  d.markMotion();
  for (const m of d.masses) {
    if (!m.dynamic) continue;
    const vn = m.vel.x * nx + m.vel.z * nz;
    if (vn >= 0) continue;
    m.vel.x -= nx * vn;
    m.vel.z -= nz * vn;
  }
  d.takeMotion(car.velocity, car.angular);
}

/**
 * The drawn body rides the rigid body, so a shove also answers what the body's turn swept in, which `strikeCar` (the centre's closing) never
 * reads: the face takes it at the deepest vertex (`faceExit`), the rigid plastic impulse that leaves that point closing no faster than the centre.
 * A centre leaving the face carries the vertex out with it, so only the closing the sweep still has beyond that is stopped (none where the vertex
 * opens): stopping the sweep alone kicked a wreck wrapping a post on every slice and it exited at either of two spins.
 */
function stopTurnInto(car: DeformableCar, nx: number, nz: number): void {
  const centre = _turnCentre.copy(wreckCentre(car)).applyQuaternion(car.group.quaternion);
  const rx = faceExit.offX - centre.x;
  const rz = faceExit.offZ - centre.z;
  const lever = rz * nx - rx * nz;
  const closing = car.angular.y * lever + Math.max(0, car.velocity.x * nx + car.velocity.z * nz);
  if (closing >= 0) return;
  const dvn = -closing / (1 + lever * lever * wreckInvI.y);
  const pos = car.group.position;
  car.deform.shiftBody(car.velocity, car.angular, nx * dvn, nz * dvn, dvn * lever * wreckInvI.y, pos.x + centre.x, pos.z + centre.z, nx, nz, Infinity);
}

/**
 * How far (m) a slice may push a wreck out along the unit (nx, nz), out of a face: what the slice could have sunk it by (the fastest
 * footprint corner's speed into the face, the car's turn included, and the slice's other position corrections into it) and the
 * solver's push-out speed (`PUSH_SPEED`).
 */
function sinkReach(car: DeformableCar, nx: number, nz: number, dt: number, inboundFloor = 0): number {
  const v = car.velocity;
  const w = car.angular.y;
  const f = car.fwdFlat;
  const r = car.rightFlat;
  let corner = inboundFloor;
  const { footHalfL } = car.frame;
  const halfW = car.frame.half.x;
  for (let k = 0; k < 4; k++) {
    const sl = k & 1 ? footHalfL : -footHalfL;
    const sw = k & 2 ? halfW : -halfW;
    const rx = f.x * sl + r.x * sw;
    const rz = f.z * sl + r.z * sw;
    corner = Math.max(corner, -((v.x + w * rz) * nx + (v.z - w * rx) * nz));
  }
  return (corner + PUSH_SPEED) * dt + Math.max(0, -car.deform.pushedAlong(nx, nz));
}

/** The fastest a dynamic mass of the wreck drives into the face with the unit normal (nx, nz) (m/s): a hard hit crushes the nose at the closing speed, faster than the body that carries it. */
function massesInto(car: DeformableCar, nx: number, nz: number): number {
  let fastest = 0;
  for (const m of car.deform.masses) if (m.dynamic) fastest = Math.max(fastest, -(m.vel.x * nx + m.vel.z * nz));
  return fastest;
}

/** Cosine within which a contact's normal presses on the face a car's hit struck (`impactInward`, the hit's inward direction in the car's frame). */
const STRUCK_FACE_COS = 0.5;

/** The crush stroke (m) `car`'s hit has left (`hitStroke` less `strokeUsed`) where a contact presses into it along the unit (nx, nz): on the face the hit struck, else none. */
function strokeLeftOn(car: DeformableCar, nx: number, nz: number): number {
  const inward = car.deform.impactInward;
  const onFace = inward.x * (nx * car.rightFlat.x + nz * car.rightFlat.z) + inward.z * (nx * car.fwdFlat.x + nz * car.fwdFlat.z) > STRUCK_FACE_COS;
  return onFace ? car.deform.hitStroke() * (1 - car.deform.strokeUsed()) : 0;
}

/** Cosine within which a contact's normal runs along a car's length: a struck end, as against a flank. */
const END_FACE_COS = 0.7;

/** Reports the end of `car` the contact presses on (`noteContactEnd`), as the press and the pistons do; `sx` is +1 for the car the normal points at and -1 for the other. */
function reportEnd(car: DeformableCar, nx: number, nz: number, sx: 1 | -1, px: number, pz: number): void {
  const dot = (nx * car.fwdFlat.x + nz * car.fwdFlat.z) * sx;
  if (Math.abs(dot) <= END_FACE_COS) return;
  const reach = Math.abs((px - car.group.position.x) * car.fwdFlat.x + (pz - car.group.position.z) * car.fwdFlat.z);
  car.noteContactEnd(dot < 0 ? 1 : -1, reach);
}

/**
 * The closing speed (m/s) a face's crush feed is sized by (`feedOverlap`): while the pair closes faster than a graze and the face the hit struck has stroke left, its
 * hit's (`impulseValue`, the closing that armed it), not the slice's, which the exchange takes away as the structure yields. The force that crushes the face (`crushForce`)
 * is the hit's whole stroke long, so the crush it feeds must be: a feed that fell with the closing left the faces at 0.6-0.7 of their stroke when the cars had taken their common speed.
 */
function feedClosing(car: DeformableCar, nx: number, nz: number, closing: number): number {
  return closing > CRASH.grazeMps && strokeLeftOn(car, nx, nz) > 0 ? Math.max(closing, car.deform.impulseValue) : Math.max(0, closing);
}

/**
 * `car` met a fixed solid (a race wall, a prop, a ramp's flank) whose car-side face is `face` (`solidFace`), its footprint
 * `pen` deep along the unit normal (nx, nz). A hard hit (past `WALL_CRUSH` into the face) or a wreck meets it as the range's
 * jersey slab does (`bodyContact`): the first touch starts the crash, a fresh hard one re-arms a wreck's, the masses are held
 * on the face and the crush force spends the hit's stroke, so the car goes on into the face at its own speed until the stroke
 * is gone (the wall used to cancel and bounce the whole closing speed in one step, before the crush had anything to take).
 * A light touch of a whole car, or a hard one whose hull is still `WALL_HOLD` short of the face while the footprint is in it
 * (a corner the face does not reach), pushes out and bounces by `WALL_E`; the car's tyres and its body's friction on the face
 * hold it where it touched or let it slide along the face. `held`: the wall's plane was met already this slice by another face of it
 * (the pieces of one wall share one hold face), so a hard hit has nothing left to do here. `sunkCap`: the most a wreck's shove counts the drawn
 * body in the face (m): a ramp's side is a wall under the ramp's top only, and its plan box counted the whole body above it (a wreck that landed
 * on a descent ramp's high end, its tail a few cm in the back face, was shoved 5 cm a frame out of it and crept uphill onto the slab).
 */
export function wallBounce(car: DeformableCar, face: ContactBox, nx: number, nz: number, pen: number, dt: number, held: boolean, wreckAtStart = false, top = Infinity, sunkCap = Infinity): void {
  const v = car.velocity;
  const pos = car.group.position;
  const fx = detSin(face.yaw);
  // `solidFace`'s box is a plan face with no height of its own: it stands at the car's.
  face.y = pos.y + 0.48;
  const fz = detCos(face.yaw);
  const into = -(v.x * fx + v.z * fz);
  if (into > WALL_CRUSH || car.deform.massActive) {
    if (held) return;
    // A car that was a wreck as the slice began moves out of a solid by what it could have sunk in (`sinkReach`: its fastest footprint corner
    // and fastest mass into the face read before the hit takes speed off it) and no more: the whole overlap of a plan footprint (a wreck
    // that came down on a tyre stack, or crushed 3 cm under a rail's top, is 0.5-1 m over its plan) is cleared over the slices that
    // follow, as the pair pushes are (`takePush`). Cleared at once it moved a derby wreck 0.4-1.3 m in a step (zip bound 3·v·h + 5 cm).
    // A car that is no wreck yet is not capped, nor one the slice's first prism armed (a monument's arms are several prisms): its first
    // crash starts with the whole depth the body drove in before its masses were armed (below).
    const arrival = wreckAtStart ? sinkReach(car, fx, fz, dt, massesInto(car, fx, fz)) : Infinity;
    strikeCar(car, face, dt, true, true, false, top);
    if (car.deform.massActive) {
      if (bodyHit.held) car.deform.holdBySolid(fx, fz);
      const over = pen - WALL_REACH;
      if (over > 0) shoveWreck(car, nx, nz, Math.min(over, arrival));
      // The drawn body (the cage's vertices, `faceDepth`) is pushed out as the slab pushes it: while the car drives in as far as the
      // crumple of the face it is struck on (`faceTravel`, as the pair's own crush reads it) left allows (`0.4 · leftover`), at rest to
      // the skin, so a wreck a car pins against the solid is never left in it. A slice pushes out what the slice could sink the body by
      // (its fastest footprint corner's speed into the face, the car's turn included, and what the slice's other corrections moved it
      // in) and the solver's push-out speed (`PUSH_SPEED`) for the rest: the room falls to the skin the slice the car stops driving in,
      // and that whole depth pushed out at once moved a derby wreck 0.43 m in 6 ms at 6.6 m/s (zip bound 3·v·h + 5 cm). Held to the
      // centroid's speed alone, a swung car's corner went 0.11 m past a prop's far face.
      const deepest = faceDepth(car, face);
      const exitX = faceExit.nx;
      const exitZ = faceExit.nz;
      const drive = Math.max(0, Math.min(1, (-(v.x * exitX + v.z * exitZ) - SOLID_AT_REST) / (WALL_CRUSH - SOLID_AT_REST)));
      const room = WALL_SKIN + (0.4 * leftoverCrumple(car.deform.faceTravel()) - WALL_SKIN) * drive;
      const sunk = Math.min(deepest, sunkCap) - room;
      // A hit armed this slice starts with what the car drove in before the face was met (a truck at 55 m/s: 0.39 m of its drawn body
      // in a 0.79 m deep footprint), pushed out as far as the footprint is in.
      const reach = sinkReach(car, exitX, exitZ, dt);
      if (!(sunk > 0)) return;
      shoveWreck(car, exitX, exitZ, Math.min(sunk + 0.004, car.deform.sinceHit() <= 0 ? Math.min(Math.max(pen, reach), Math.max(reach, arrival)) : reach));
      stopTurnInto(car, exitX, exitZ);
      // `strikeCar` reads closing along the face's normal only: round an open end the shove is the only hold, so it is plastic. Through
      // the face the crush takes the speed, though this prism holds no mass (a monument's tip slice, while the slice behind it holds the car).
      if (!bodyHit.held && faceExit.atEnd) stopInto(car, exitX, exitZ);
      return;
    }
    if (pen < WALL_HOLD) return;
  }
  const closing = Math.max(0, -(v.x * nx + v.z * nz));
  const along0 = v.z * nx - v.x * nz;
  let j = closing * (1 + SOLID_E);
  // A car on its wheels goes where its nose points as far as the sideways grip its tyres have left this step holds it
  // (`drive.hold`): the face and the tyres meet the closing speed together, and the face takes what the tyres leave.
  const r = car.rightFlat;
  const k = nx * r.x + nz * r.z;
  if (closing > 0 && car.drive.hold > 0 && k * k < 1) {
    const side = v.x * r.x + v.z * r.z;
    const held = (j + k * side) / (1 - k * k);
    if (held >= 0) {
      const b = Math.max(-car.drive.hold, Math.min(car.drive.hold, -side - held * k));
      j = Math.max(0, j - b * k);
      car.drive.hold -= Math.abs(b);
      v.x += r.x * b;
      v.z += r.z * b;
    }
  }
  v.x += nx * j;
  v.z += nz * j;
  // The body scrapes the face: its friction takes at most `MU_BODY` of the face's push from the speed along it. A face that
  // takes all of it holds the car where it touched, so the push out takes it back the way it came in. Met one after the
  // other, the tyres kept the share of the face's along speed that lies along the nose, which drives into the face again,
  // and pushed out square to the face, a held car kept each slice's move along it and each crossing of the push's skin: a
  // car driven at a face 30° off it crept along it at 0.2–0.4 m/s.
  const along = v.z * nx - v.x * nz;
  const stuck = Math.abs(along) <= MU_BODY * j;
  const rub = stuck ? along : Math.sign(along) * MU_BODY * j;
  v.x += nz * rub;
  v.z -= nx * rub;
  // Back the way it came: the share of the slice's move that took it `pen` in (`pen / closing` of the slice), never more than the whole slice's
  // move along the face. A car turned into the face at rest (closing all but 0, the overlap from its yaw) read `along0 · pen / closing` as metres:
  // a stopped cop slid 0.45 m a frame along a wall into its stakeout partner.
  const back = stuck && closing > 0 ? along0 * Math.min(dt, pen / closing) : 0;
  pos.x += nx * pen + nz * back;
  pos.z += nz * pen - nx * back;
}

/**
 * A pair's shove of one slice: the overlap `depth` (m) cleared along the unit (nx, nz), car A out along it and car B against it,
 * each by the kernel's share (`bodyContact`'s push-out: the depth in inverse proportion to mass) and within its wreck's per-slice
 * budget (`takePush`): the three SAT passes of one slice each pushing a full `satPushCap` moved a wedged wreck 0.11 m in 6 ms
 * (derby group pops), and one cap a slice, shared with the sphere shifts and wall translations, still put 0.04–0.05 m a step on
 * a slow wedged wreck against a zip bound of 3·v·h + 0.05 m: each car's cap is a push-out speed that grows only with its own
 * speed (the pose jump a pop bound of 3·v·h + 2 cm reads is that car's). A car a fixed solid held out against its share in the slice
 * before (`solidHolds`) takes none: the solid would put it back, so the other car takes the whole push. A shove is a position correction alone: the pair's momentum is the exchange's
 * (`exchangePair`), never a push's (a pusher kept its drive speed while its shoves moved the car it drove into 3.6–8.4 m/s at a
 * reported speed under 1 m/s: derby 10 cars, 40 s, 791 car-frames over 0.06 m in 1/60 s at under 1 m/s on main ef6611a).
 */
function pushApart(carA: DeformableCar, carB: DeformableCar, nx: number, nz: number, depth: number, dt: number): void {
  _dir.set(nx, 0, nz);
  loadPair(carA, carB, _dir, carA.group.position, 0, 0, 0);
  pairContact[CT_DEPTH] = depth;
  bodyContact(pairRows, 0, BODY_SIZE, pairContact, pairResult);
  const pinnedA = carA.deform.solidHolds(nx, nz);
  const pinnedB = carB.deform.solidHolds(-nx, -nz);
  const pushA = pairResult[OUT_PUSH_A]!;
  const pushB = pairResult[OUT_PUSH_B]!;
  const aAmt = pinnedA === pinnedB ? pushA : pinnedA ? 0 : pushA + pushB;
  const bAmt = pinnedA === pinnedB ? pushB : pinnedB ? 0 : pushA + pushB;
  const okA = carA.deform.massActive ? carA.deform.takePush(nx, nz, aAmt, dt, hypot2(carA.velocity.x, carA.velocity.z)) : aAmt;
  const okB = carB.deform.massActive ? carB.deform.takePush(-nx, -nz, bAmt, dt, hypot2(carB.velocity.x, carB.velocity.z)) : bAmt;
  pushCar(carA, nx, 0, nz, okA);
  pushCar(carB, -nx, 0, -nz, okB);
}

/**
 * The packed structure's floor: a rigid 2.15 m centre gap launches crushed cars whose noses already occupy that space, so it holds
 * only once the crush along the contact is spent on both cars (`spent`, from `strokeUsed`: the struck face's stroke, a door on a
 * flank, not the nose the hit never touched; the minimum gap too reads the struck face's travel, `faceTravel`), and while they are
 * still closing. The pair's momentum is the exchange's (rigid then); this position push only takes the pair out of the floor.
 */
function holdComGap(carA: DeformableCar, carB: DeformableCar, leftoverA: number, leftoverB: number, dist: number, dt: number): void {
  const minSep = 2.15 + leftoverA * 0.28 + leftoverB * 0.28;
  if (dist >= minSep) return;
  _w.copy(carA.group.position).sub(carB.group.position).setY(0);
  if (_w.lengthSq() < 1e-8) return;
  _w.normalize();
  const extra = Math.min((minSep - dist) * 0.5, satPushCap(dt));
  pushApart(carA, carB, _w.x, _w.z, 2 * extra, dt);
}

/** Share of a hit's stroke (`strokeUsed`) both noses must have crushed before the packed structure (B1) stops a pair's closing. */
const PACKED_STROKE = 0.9;

// The kernel's rows (`contact/body-contact.ts`) of the pair's exchange: car A, car B, the contact and the result, reused by every call.
const pairRows = new Float64Array(2 * BODY_SIZE);
const pairContact = new Float64Array(CT_SIZE);
const pairResult = new Float64Array(OUT_SIZE);

/** The pair's face speeds along the normal (A along `n`, B along `-n`): where the plastic exchange at the contact point leaves each car's point (`faceSpeeds`). */
const faces = new Float64Array(2);

/**
 * Both cars of the pair as rows of `pairRows` (`carRow`: each a rigid body in plan, its velocity the mean of the masses still closing
 * on the other's, those moving along the normal slower than that car's face speed `faceA`, `faceB`) and the contact at `p` along the
 * unit `n` (out of B into A), plastic, with the friction of sheet metal on sheet metal and at most `maxJ` of normal impulse.
 */
function loadPair(carA: DeformableCar, carB: DeformableCar, n: THREE.Vector3, p: THREE.Vector3, faceA: number, faceB: number, maxJ: number): void {
  carRow(pairRows, 0, carA, n.x, n.z, faceA);
  carRow(pairRows, BODY_SIZE, carB, -n.x, -n.z, faceB);
  pairContact[CT_X] = p.x;
  pairContact[CT_Z] = p.z;
  pairContact[CT_NX] = n.x;
  pairContact[CT_NZ] = n.z;
  pairContact[CT_DEPTH] = 0;
  pairContact[CT_E] = 0;
  pairContact[CT_MU] = PAIR_MU;
  pairContact[CT_JMAX] = maxJ;
}

/**
 * `faces` ← the speed each car's contact point has after the pair's whole plastic exchange at `p` (every mass one body), along the
 * normal into the car: the speed the contact masses are driven to, the point's own, not the centres' common speed (a hit off a car's
 * centre trades less of that car's centre speed, and the point leaves at the speed the spin adds to it).
 */
function faceSpeeds(carA: DeformableCar, carB: DeformableCar, n: THREE.Vector3, p: THREE.Vector3): void {
  loadPair(carA, carB, n, p, Infinity, Infinity, Infinity);
  bodyContact(pairRows, 0, BODY_SIZE, pairContact, pairResult);
  for (let c = 0; c < 2; c++) {
    const o = c * BODY_SIZE;
    const rx = p.x - pairRows[o + BODY_X]!;
    const rz = p.z - pairRows[o + BODY_Z]!;
    const w = pairRows[o + BODY_W]!;
    faces[c] = (c === 0 ? 1 : -1) * ((pairRows[o + BODY_VX]! + w * rz) * n.x + (pairRows[o + BODY_VZ]! - w * rx) * n.z);
  }
}

/**
 * The crush force (N) a car's armed hit yields at: the energy of its barrier speed over the stroke that speed crushes
 * (`m·ebs²/(2·stroke)`, the rigs' `strikeCar` reads the same); 0 before the hit is armed.
 */
function crushForce(d: DeformableCar["deform"]): number {
  const ebs = Math.max(0, d.hitSpeedValue);
  return (d.totalMass * ebs * ebs) / (2 * Math.max(0.05, d.hitStroke()));
}

/**
 * The pair's one momentum exchange: `bodyContact` between the two cars at the patch `p`, normal `n` out of B into A, the normal
 * impulse at most `maxJ`. Each car's change of speed and spin goes onto every mass (or onto the car of a body that is no wreck), as
 * the rigs' strike does (`takeRow`). A rigid contact (`maxJ` infinite: the crush is spent, packed, or too slow to crush) leaves each
 * car one body: every mass at the rigid motion of its car, as a spent structure is, so no internal speed is left to crush the
 * structure further (200 km/h head-on: clamped masses at ±8 m/s that a quiet wreck let go 0.2 s later).
 */
function exchangePair(carA: DeformableCar, carB: DeformableCar, n: THREE.Vector3, p: THREE.Vector3, maxJ: number): void {
  loadPair(carA, carB, n, p, faces[0]!, faces[1]!, maxJ);
  const axv = pairRows[BODY_VX]!;
  const azv = pairRows[BODY_VZ]!;
  const aw = pairRows[BODY_W]!;
  const bxv = pairRows[BODY_SIZE + BODY_VX]!;
  const bzv = pairRows[BODY_SIZE + BODY_VZ]!;
  const bw = pairRows[BODY_SIZE + BODY_W]!;
  if (bodyContact(pairRows, 0, BODY_SIZE, pairContact, pairResult) === 0) return;
  takeRow(carA, pairRows, 0, axv, azv, aw, n.x, n.z, faces[0]!);
  takeRow(carB, pairRows, BODY_SIZE, bxv, bzv, bw, -n.x, -n.z, faces[1]!);
  if (maxJ === Infinity) {
    moveAsOneBody(carA, pairRows, 0);
    moveAsOneBody(carB, pairRows, BODY_SIZE);
  }
}

/** The pair's momentum before the crush layer's feed (`pairMomentum`: x, z, and the mass it is over). */
const _momentum = new Float64Array(3);

/** `out` ← the momentum (kg m/s, x then z) and mass (kg) of the two cars' dynamic masses; a car that is no wreck is its own velocity and mass. */
function pairMomentum(carA: DeformableCar, carB: DeformableCar, out: Float64Array): void {
  out.fill(0);
  for (let c = 0; c < 2; c++) {
    const car = c === 0 ? carA : carB;
    if (car.deform.massActive) {
      const masses = car.deform.masses;
      for (let k = 0; k < masses.length; k++) {
        const q = masses[k]!;
        if (!q.dynamic) continue;
        out[0] += q.mass * q.vel.x;
        out[1] += q.mass * q.vel.z;
        out[2] += q.mass;
      }
    } else {
      const m = car.deform.totalMass;
      out[0] += m * car.velocity.x;
      out[1] += m * car.velocity.z;
      out[2] += m;
    }
  }
}

/** Give every dynamic mass of both cars (a car that is no wreck: its velocity) the one velocity change that brings the pair's momentum back to `before`. */
function restoreMomentum(carA: DeformableCar, carB: DeformableCar, before: Float64Array): void {
  pairMomentum(carA, carB, _after);
  const dvx = (before[0]! - _after[0]!) / before[2]!;
  const dvz = (before[1]! - _after[1]!) / before[2]!;
  for (let c = 0; c < 2; c++) {
    const car = c === 0 ? carA : carB;
    car.velocity.x += dvx;
    car.velocity.z += dvz;
    if (!car.deform.massActive) continue;
    const masses = car.deform.masses;
    for (let k = 0; k < masses.length; k++) {
      const q = masses[k]!;
      if (!q.dynamic) continue;
      q.vel.x += dvx;
      q.vel.z += dvz;
    }
  }
}
const _after = new Float64Array(3);

/** A car's momentum (kg m/s) along the unit (nx, nz): its dynamic masses' (a car that is no wreck: its own velocity's). */
function momentumAlong(car: DeformableCar, nx: number, nz: number): number {
  if (!car.deform.massActive) return car.deform.totalMass * (car.velocity.x * nx + car.velocity.z * nz);
  let p = 0;
  const masses = car.deform.masses;
  for (let k = 0; k < masses.length; k++) {
    const q = masses[k]!;
    if (q.dynamic) p += q.mass * (q.vel.x * nx + q.vel.z * nz);
  }
  return p;
}

/** How far (m) a car's structure has crushed in the hit that is still on (`crushing`: a contact within the last 0.28 s), 0 for a car with none. */
function crushedSoFar(d: DeformableCar["deform"]): number {
  return d.massActive && d.crushing ? d.hitStroke() * d.strokeUsed() : 0;
}

/**
 * Share (0-1) of the next slice's stroke travel that fits in the room a crashed car's struck face has left before `PACKED_STROKE`, read off
 * its masses as they stand now, this slice's feed in (`strokeAt`). The travel is its masses' at their velocities and the next slice's feed,
 * as deep as this one's at `closingLeft` of its closing: that feed crushes before the next slice's exchange can stop the pair.
 */
function roomShare(car: DeformableCar, dt: number, closingLeft: number): number {
  const d = car.deform;
  if (!car.crashed || !d.massActive) return 1;
  const q = car.group.quaternion;
  const now = d.strokeAt(q, 0);
  const room = PACKED_STROKE * d.hitStroke() - now;
  if (room <= 0) return 0;
  const fed = Math.max(0, now - d.strokeUsed() * d.hitStroke());
  const travel = d.strokeAt(q, dt) - now + fed * closingLeft;
  return travel > room ? room / travel : 1;
}

/** A split exchange's scratch velocities (`holdVelocities`): at its start, and after its rigid half. Grown once to the largest pair. */
const split = { start: new Float64Array(0), rigid: new Float64Array(0) };

/** Vector `i` of the pair's velocities: per car its velocity, its spin, then each mass's velocity (4 + both cars' masses in all). */
function pairVector(carA: DeformableCar, carB: DeformableCar, i: number): THREE.Vector3 {
  const nA = 2 + carA.deform.masses.length;
  const car = i < nA ? carA : carB;
  const k = i < nA ? i : i - nA;
  return k === 0 ? car.velocity : k === 1 ? car.angular : car.deform.masses[k - 2]!.vel;
}

function holdVelocities(carA: DeformableCar, carB: DeformableCar, out: Float64Array): void {
  const count = 4 + carA.deform.masses.length + carB.deform.masses.length;
  for (let i = 0; i < count; i++) {
    const v = pairVector(carA, carB, i);
    out[3 * i] = v.x;
    out[3 * i + 1] = v.y;
    out[3 * i + 2] = v.z;
  }
}

/** Every pair velocity ← `base` + `share` × (itself − `base`): share 0 puts `base` back, 1 leaves the cars as they are. */
function blendVelocities(carA: DeformableCar, carB: DeformableCar, base: Float64Array, share: number): void {
  const count = 4 + carA.deform.masses.length + carB.deform.masses.length;
  for (let i = 0; i < count; i++) {
    const v = pairVector(carA, carB, i);
    v.x = base[3 * i]! + share * (v.x - base[3 * i]!);
    v.y = base[3 * i + 1]! + share * (v.y - base[3 * i + 1]!);
    v.z = base[3 * i + 2]! + share * (v.z - base[3 * i + 2]!);
  }
}

/**
 * The exchange of the slice in which the pair packs: the share of the next slice's stroke travel that fits in the room left before
 * `PACKED_STROKE` (`roomShare`, read after the crush-limited exchange, at the share of this slice's `closing` that exchange left) stays
 * crush-limited (`maxJ`), the rest is rigid, so the pair stops at the packed stroke, not up to one slice's travel past it (the check reads
 * the stroke the last slice left). A face the stop packs counts its block travel as the hit's energy (`notePacked`).
 */
function splitExchange(carA: DeformableCar, carB: DeformableCar, n: THREE.Vector3, p: THREE.Vector3, maxJ: number, dt: number, closing: number): void {
  const need = 12 + 3 * (carA.deform.masses.length + carB.deform.masses.length);
  if (split.start.length < need) {
    split.start = new Float64Array(need);
    split.rigid = new Float64Array(need);
  }
  holdVelocities(carA, carB, split.start);
  exchangePair(carA, carB, n, p, Infinity);
  holdVelocities(carA, carB, split.rigid);
  blendVelocities(carA, carB, split.start, 0);
  exchangePair(carA, carB, n, p, maxJ);
  const left = Math.max(0, -_v.copy(carA.velocity).sub(carB.velocity).dot(n)) / closing;
  const roomA = roomShare(carA, dt, left);
  const roomB = roomShare(carB, dt, left);
  if (roomA < 1) carA.deform.notePacked();
  if (roomB < 1) carB.deform.notePacked();
  blendVelocities(carA, carB, split.rigid, Math.max(roomA, roomB));
}

/**
 * Pair SAT + crumple. Persistent overlap after the zone is spent must not
 * keep dumping cancelClosing (that is the 10s / 120 km/h zip). Every contact
 * offers each car a hit: the first one starts its crash, a fresh hard one on
 * a wreck re-arms a new hit (`DeformableCar.applyImpact`). The closing impulse is capped by `closingCap`.
 */
export function resolveCarPair(carA: DeformableCar, carB: DeformableCar, dt: number): PairHit | null {
  const pa = carA.group.position;
  const pb = carB.group.position;
  const gx = pa.x - pb.x;
  const gy = pa.y - pb.y;
  const gz = pa.z - pb.z;
  const dist = Math.sqrt(gx * gx + gy * gy + gz * gz);
  if (dist > 5.2) return null;

  // The contact begins before the overlap, as the rigs' does (`strikeCar`): while the bodies are apart by less than the travel the
  // pair closes in this slice, and, once the hit is on, by less than the crush has taken both faces back (a crush that keeps up with
  // the closing leaves the faces apart by what it has eaten: the contact does not end where it works), the hit goes on.
  const eaten = crushedSoFar(carA.deform) + crushedSoFar(carB.deform);
  const hit = satCars(carA, carB, _n, _p, hypot2(carA.velocity.x - carB.velocity.x, carA.velocity.z - carB.velocity.z) * dt + eaten);
  const half = patch.half;
  const n = _n;
  n.y = 0;
  if (n.lengthSq() > 1e-8) n.normalize();
  let closing = -_v.copy(carA.velocity).sub(carB.velocity).dot(n);
  if (hit === null || hit < -(Math.max(0, closing) * dt + eaten)) return null;

  // The rows of the rigid step that met this pair this slice (a nose corner on the other's sloped bonnet) traded part of the approach already: it is the pair's to take whole.
  if (rewindRows(carA, carB, n, ARM_CLOSING)) closing = -_v.copy(carA.velocity).sub(carB.velocity).dot(n);

  // Where the contact masses of both cars are driven to along the normal: the speed each car's contact point has once the plastic
  // exchange at the patch is done (the pair's common speed when the hit goes through both centres).
  faceSpeeds(carA, carB, n, _p);
  if (closing > ARM_CLOSING) {
    reportEnd(carA, n.x, n.z, 1, _p.x, _p.z);
    reportEnd(carB, n.x, n.z, -1, _p.x, _p.z);
  }
  // A wreck that had been quiet and refused the hit (a brush too soft to re-arm, `rearmHit`): its quiet clock is left running, so the
  // harder hit the same contact grows into (a car shoved on past it) still finds the wreck quiet and arms. Notified, it would be a
  // contact already on and never arm: the contact would stay as soft as its first slice.
  let brushA = false;
  let brushB = false;
  if (closing > ARM_CLOSING) {
    // Equivalent barrier speed: each car takes the share of the pair's plastic exchange the kernel gives it at the contact point (a hit
    // through both centres: the closing times the other's mass share). The rows that met this pair arm with it, once, at the larger
    // reading (`armPairWithRows`).
    // Before notifyContact: a wreck's re-arm reads how long it has been quiet.
    loadPair(carA, carB, n, _p, faces[0]!, faces[1]!, 0);
    bodyContact(pairRows, 0, BODY_SIZE, pairContact, pairResult);
    const shareA = pairResult[OUT_EBS_A]!;
    const shareB = pairResult[OUT_EBS_B]!;
    const idleA = carA.deform.quietTime() >= REARM_QUIET_S;
    const idleB = carB.deform.quietTime() >= REARM_QUIET_S;
    if (!armPairWithRows(carA, carB, _p, n, closing, shareA, shareB)) {
      brushA = !carA.applyImpact(carA.deform.massPoint(_p, _massPoint, carA.group.position.y), n, closing, shareA, false, true) && idleA;
      brushB = !carB.applyImpact(carB.deform.massPoint(_p, _massPoint, carB.group.position.y), _w.copy(n).negate(), closing, shareB, false, true) && idleB;
    }
  }

  // Overlap after the wreck has settled is not a new hit — notifying every
  // slice zeroed quietTime and disabled damping for the whole clip.
  if (closing > CRASH.grazeMps) {
    if (!brushA) carA.deform.notifyContact();
    if (!brushB) carB.deform.notifyContact();
  }

  pairMomentum(carA, carB, _momentum);
  const preA = momentumAlong(carA, n.x, n.z);
  const preB = momentumAlong(carB, -n.x, -n.z);
  // Each car's contact masses are driven to its contact point's speed along the normal (a fixed face at 0 stopped a T-bone bullet's nose
  // dead while the struck car got no momentum).
  // The crush a hit feeds scales with the depth of the overlap, and the drawn bodies' contact begins where their surfaces do (the
  // cage): a hit's first slice is as deep as the closing travelled after the touch, anywhere up to the slice's whole travel, so the
  // feed is never less than that travel (`closing * dt`). The overlap is the two faces' together: each structure crushes its half.
  const fed = Math.max(hit, closing * dt) / 2;
  if (carA.deform.massActive) carA.deform.markMotion();
  const pointA = carA.deform.massPoint(_p, _massPoint, carA.group.position.y);
  carA.deform.aimHit(carA.worldToLocalPoint(pointA, _aim));
  carA.deform.feedOverlap(pointA, n, fed, feedClosing(carA, n.x, n.z, closing), dt, faces[0]!, false, undefined, half);
  if (carA.deform.massActive) carA.deform.takeMotion(carA.velocity, carA.angular);
  if (carB.deform.massActive) carB.deform.markMotion();
  const pointB = carB.deform.massPoint(_p, _massPoint, carB.group.position.y);
  carB.deform.aimHit(carB.worldToLocalPoint(pointB, _aim));
  carB.deform.feedOverlap(pointB, _w.copy(n).negate(), fed, feedClosing(carB, -n.x, -n.z, closing), dt, faces[1]!, false, undefined, half);
  if (carB.deform.massActive) carB.deform.takeMotion(carB.velocity, carB.angular);
  // The momentum (N·s) the feed took off each car's closing along the normal: the structure's force already at work this slice.
  const killed = 0.5 * (momentumAlong(carA, n.x, n.z) - preA + momentumAlong(carB, -n.x, -n.z) - preB);
  const spent = carA.crashed && carB.crashed && Math.min(carA.deform.strokeUsed(), carB.deform.strokeUsed()) >= PACKED_STROKE;
  // A face whose crumple travel is used up (`leftoverCrumple`) is stiff: it takes whatever the pair's other face passes on.
  const leftoverA = leftoverCrumple(carA.deform.faceTravel());
  const leftoverB = leftoverCrumple(carB.deform.faceTravel());
  const stiffA = leftoverA < 0.12;
  const stiffB = leftoverB < 0.12;
  if (closing > 0) {
    // The one exchange of the pair, at the patch, once per slice: the normal impulse that closes the approach of the two cars' contact
    // points (the lever of each about its centre in the kernel's effective mass), at the most what the crush force over the slice has
    // left after the feed's kill while a structure still yields (the hit's own barrier speed over its stroke: that of the face that
    // is not stiff, a T-bone's packed bullet nose passes on what the struck door yields), rigid once both are stiff or the crush is
    // spent or too slow to crush. The slice the pair packs in splits its exchange at the packed stroke (`splitExchange`).
    const crushes = closing > CRASH.grazeMps && !spent && !(stiffA && stiffB);
    const force = Math.min(stiffA ? Infinity : crushForce(carA.deform), stiffB ? Infinity : crushForce(carB.deform));
    const maxJ = crushes ? Math.max(0, force * dt - Math.max(0, killed)) : Infinity;
    if (crushes && Math.max(roomShare(carA, dt, 1), roomShare(carB, dt, 1)) < 1) splitExchange(carA, carB, n, _p, maxJ, dt, closing);
    else exchangePair(carA, carB, n, _p, maxJ);
  }
  // The crush layer's kills are the lattice's, not an exchange: the pair's momentum is the one it had, the kernel's impulse the only
  // thing that moved it between the cars.
  restoreMomentum(carA, carB, _momentum);

  // While the pair closes, the cage's overlap is the crush's to take (`feedOverlap`): this slice's travel (`closing * dt`) or, while it closes faster than `REST_SPEED`
  // (a crush takes nothing at a creep: a resting pair closing 1 mm/s kept 4 cm of overlap as room), the stroke the face it presses on has left (`strokeLeftOn`); only
  // what is deeper is a push, by position. A pair that no longer closes feeds no crush, so it has no stroke to take the overlap (cars rested 10-21 cm into each other).
  const room = closing > REST_SPEED ? Math.max(strokeLeftOn(carA, n.x, n.z), strokeLeftOn(carB, -n.x, -n.z)) : 0;
  const give = closing > 0 ? Math.max(room, closing * dt) : 0;
  const extra = Math.max(0, hit - OUTLINE_REACH - give);
  if (extra > 0) pushApart(carA, carB, n.x, n.z, Math.min(extra + 0.006, satPushCap(dt)), dt);

  if (spent && closing > 0 && dist > 1e-4) holdComGap(carA, carB, leftoverA, leftoverB, dist, dt);
  _hit.closing = Math.max(0, closing);
  _hit.impulse = Math.max(_hit.closing, hit * 6);
  scrapePair(carA, carB, n, _p, _hit.impulse, half);
  _hit.contact.copy(_p);
  _hit.normal.copy(n);
  return _hit;
}
