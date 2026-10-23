import * as THREE from "three";
import type { DeformableCar } from "./car.ts";
import type { LooseShape } from "./car-core.ts";
import { activeGround, NO_FLOOR } from "../world/ground.ts";
import { BAKE, C_AUX, C_DEPTH, C_GRIP, C_H, C_NX, C_NY, C_NZ, C_OWNER, C_TOUCH, HIT_SIZE, holdNearTops, MOUNT, MU_TYRE, patchOf, pointContact, pointContactHeld, pointContactNear, pointContactSolids, PQ_BODY, PQ_MOUNT, PQ_SIZE, PQ_VX, PQ_VY, PQ_VZ, PQ_X, PQ_Y, PQ_Z, solidTop, staticTop, topsTop, topsTopLive, topsTopNear, wheelContact, type Surface } from "../world/surfaces.ts";
import { EPICENTER } from "../deform/epicenter.ts";
import { G, GQ } from "../world/ground-clock.ts";
import { CRASH, hypot2 } from "../deform/physics-util.ts";
import { droop } from "./car-suspension.ts";
import { carClass } from "./vehicle-classes.ts";
import { PLATFORM_TYRE } from "../kernel/rig-spec.ts";
import { CarSurfaces, REACH } from "./car-surfaces.ts";
import { SAMPLE, sampleAt, type CageFields } from "./car-cage.ts";
import { cageLift, centreLift } from "./car-cage-rig.ts";
import { HUB_POP_MPS } from "../deform/deform-solve.ts";
import { POINT_X, POINT_Y, POINT_Z, BELLY_ABSENT, HUBS, TOUCH, RESTITUTION, BOUNCE_V, WALL_CRUSH, MU_BODY, CONTACT_HZ, HOLDING_NY, SIDE_ENTRY_SLICES, SIDE_ENTRY_SLACK, _r, centreOfMass, _dq, _eul, UP, _vp, R, _s, S_PEN, S_POINT_REACH, N, DIR, TYRE, SOFT, HUB, SLOT, OWN, FOLLOW, SINK, CLOSING, GAPV, SPECULATIVE_GAP, CLEAR_ROUND, UNDER, BX, BY, BZ, BRISE, BPATCH, UNREAD, LOCAL, HIT, PQ, MU, TYRE_POINTS, GROUND_LIFT_V, body, carrier, pointVel } from "./car-air-body.ts";

/** Belly point `i`'s reading at (`BX`, `BY`, `BZ`) for body `slot`: its contact in `HIT`, its rise in `BRISE` and its patch in `BPATCH`. With `travel2` (`pointContact`'s) the far answer is allowed: `C_H`, `C_OWNER` and `C_ARG` are all of `HIT` that is read then, and the return is true. */
export function readBelly(i: number, slot: number, travel2 = NaN): boolean {
  PQ[PQ_X] = BX[i]!;
  PQ[PQ_Z] = BZ[i]!;
  PQ[PQ_Y] = BY[i]!;
  const far = pointContact(PQ, slot, HIT, travel2, SPECULATIVE_GAP);
  BRISE[i] = HIT[C_H]! - BY[i]!;
  BPATCH[i] = patchOf(HIT);
  UNREAD[i] = 0;
  return far;
}

/** Contact `n`, a body point at `R[n]` from the centre `_s[S_PEN]` m under the surface in `hit` (`pointContact`): `hull` a cage vertex, else a belly point. Both are the drawn body, so both press the face their contact normal falls on (a belly point of the nose meets the ground nose-first as much as a vertex of it does). */
export function bodyContact(n: number, hit: Float64Array, hull: boolean): void {
  const pen = _s[S_PEN]!;
  const { q, v, w, surf, mass, part } = body;
  // A part is on the world's faces whatever it stands on: a car's top is no budget of that car's face, and bears nothing of it.
  const own = part ? -1 : hit[C_OWNER]!;
  if (part && hit[C_OWNER]! >= 0) body.met(body.skip, hit[C_OWNER]!);
  N[n]!.set(hit[C_NX]!, hit[C_NY]!, hit[C_NZ]!);
  TYRE[n] = false;
  HUB[n] = false;
  MU[n] = part && !body.panel ? CRASH.muSlide * hit[C_GRIP]! : MU_BODY;
  // A body point does not roll: every face pushes it along its normal, so a face does no work along itself. Pushed straight up on the
  // world's ground, a bumper scraping the corkscrew's climb at 27 m/s kept its travel along the road and gained the lift: 180 J/kg in
  // 0.7 s, the car off the lip at 31.4 m/s from 27 m/s at the mouth.
  DIR[n] = N[n]!;
  OWN[n] = own;
  UNDER[n] = !hull && own < 0;
  FOLLOW[n] = own >= 0 ? hit[C_AUX]! : 1;
  SLOT[n] = part ? -1 : surf.slot(own, N[n]!, true, q, FOLLOW[n]!);
  SOFT[n] = false;
  // A floor's depth is a vertical gap (`pen`), its normal depth that times the normal's y; a side face's `pen` (a part's, a tyre's) is its normal depth already.
  SINK[n] = hit[C_H] === NO_FLOOR ? pen : pen * N[n]!.y;
  carrier(surf, n, own, mass);
  CLOSING[n] = Math.max(0, -pointVel(n, v, w, _vp).dot(N[n]!));
  // A torn panel's row is solved to part at `RESTITUTION` of its closing on every pass: a bounce given on the first pass alone, the later passes took back.
  GAPV[n] = body.panel && CLOSING[n]! > BOUNCE_V ? -RESTITUTION * CLOSING[n]! : 0;
  if (own >= 0 && CLOSING[n]! < WALL_CRUSH) surf.touch(own);
}

/** A part point's query: with the point's own velocity (`PQ_VX`..), which a car's (`PQ`) never carries. */
const PART_PQ = new Float64Array(PQ_SIZE);
PART_PQ[PQ_BODY] = 1;

const CHK_Q = new Float64Array(PQ_SIZE);
const CHK_H = new Float64Array(HIT_SIZE);
const CHK_V = new THREE.Vector3();

/** `--verify` of `wreckTops`: the old path's answer for a point it skipped (`GQ.wreckTops`): the row it would have made, the `nearing` it would have set, the wreck top it would have been dropped by. */
function checkSkipped(c: { skipped: number; wouldRow: number; wouldNear: number; wreckTop: number }, own: boolean, px: number, py: number, pz: number, r: THREE.Vector3): void {
  c.skipped++;
  CHK_Q[PQ_X] = px;
  CHK_Q[PQ_Z] = pz;
  CHK_Q[PQ_Y] = py;
  CHK_Q[PQ_BODY] = c === GQ.overhead ? 1 : 0;
  if (own) pointContactNear(CHK_Q, body.skip, CHK_H, NaN, SPECULATIVE_GAP);
  else pointContact(CHK_Q, body.skip, CHK_H, NaN, SPECULATIVE_GAP);
  const gy = CHK_H[C_H]!;
  if (gy === NO_FLOOR) return;
  const pen = gy - py;
  if (pen <= 0 && -pen > SPECULATIVE_GAP) {
    CHK_V.crossVectors(body.w, r).add(body.v);
    if (!body.nearing && (CHK_V.x * CHK_H[C_NX]! + CHK_V.y * CHK_H[C_NY]! + CHK_V.z * CHK_H[C_NZ]!) * -body.dt >= -pen * CHK_H[C_NY]!) c.wouldNear++;
    return;
  }
  if (CHK_H[C_OWNER]! >= 0 && body.surf.cars[CHK_H[C_OWNER]!]!.deform.massActive) {
    c.wreckTop++;
    return;
  }
  c.wouldRow++;
}

/** `--verify`: whether the static surface's top over the box was under `low` before the tighter hill bound (`BAKE` off reads every hill's whole height there). */
function oldHillBound(statics: Surface, xMin: number, xMax: number, zMin: number, zMax: number, low: number): boolean {
  const on = BAKE.on;
  BAKE.on = false;
  const top = staticTop(statics, xMin, xMax, zMin, zMax);
  BAKE.on = on;
  return top < low;
}
/**
 * Whether a body point (arm `r` from the centre of mass) at crash speed against another car's top `hit` (depth `pen` under it) got there
 * from the side: deeper along the face than `SIDE_ENTRY_SLICES` slices of its closing carry it. Left to the cage top, it is lifted out of
 * the car's flank by riding up it, so the pair contact (the cage outlines) answers it.
 */
export function crossedPlanFromSide(hit: Float64Array, pen: number, r: THREE.Vector3): boolean {
  _vp.crossVectors(body.w, r).add(body.v).sub(body.surf.cars[hit[C_OWNER]!]!.velocity);
  const closing = -(_vp.x * hit[C_NX]! + _vp.y * hit[C_NY]! + _vp.z * hit[C_NZ]!);
  return _vp.length() > WALL_CRUSH && pen * hit[C_NY]! > SIDE_ENTRY_SLICES * Math.max(0, closing) * body.dt + SIDE_ENTRY_SLACK;
}

/**
 * Contact rows, from row `n` on, for the loaded points `from` to `to` (`loadPoints`, `loadShape`) as the body stands: those that meet a
 * surface within the slice, a point at most `SPECULATIVE_GAP` above one a row that lets it close that gap and no more. Returns the row
 * count past the last. The points from `bellyFrom` on are a car's belly: read (`BX`, `BRISE`, `BPATCH`) for its edges, no rows. With
 * `gate` a point that stays higher than the static surface and the solids anywhere within its slice's plan travel, by its descent over
 * the slice and a speculative gap, neither meets nor nears it: not asked; one above `bound` (`centredTop`) by that is so without its own
 * read. With `tops` (a car top within the body's reach) such a point must also stand that clear of the tops its own query would ask
 * (`topsTop` over the same list, `CarSurfaces.near`), and the belly is always read (its edges and ridges lie between its points). A part
 * also meets a prism's side face (`C_H` NO_FLOOR: the depth it is in, out along the face's normal), asks the car tops its caller held
 * (`holdTops`) and gives the point's own velocity for the way out.
 */
export function readPoints(from: number, to: number, bellyFrom: number, n: number, gate: boolean, bound = Infinity, tops = false, solidReach = 0, travel = 0, checkTops = false): number {
  const { q, v, w, dt, skip, part, pos } = body;
  const statics = activeGround();
  // The solids' highest over the square of half side `solidReach` about the centre of mass (every point's slice travel): read once, when a
  // point first needs the solids.
  let solids = NaN;
  // The car tops a point within `REACH` of the car asks (`near`), cut once to those over the square every such point's box lies in.
  let held = false;
  const wreckTops = EPICENTER.wreckTops === 1 && body.wreck && !part;
  // `EPICENTER.preClear`: a cage point whose height from the body's axes (`_e`, `wheelsAt` set them from `q`: three products, not `armOf`'s rotation) stands over `bound` by the most it can fall in the slice and the
  // gap, with `CLEAR_ROUND` over the two ways of rounding it, is clear by `bound < low` below too: the same answer for it without its arm, its velocity or its box. Only with a finite `bound` and no tops asked (`tops`).
  const cc = body.centre;
  const preClear = EPICENTER.preClear === 1 && gate && !part && !tops && solidReach > 0 && bound < Infinity;
  const preFall = preClear ? (Math.max(0, -v.y) + w.length() * solidReach) * dt + SPECULATIVE_GAP + CLEAR_ROUND : 0;
  for (let i = from; i < to; i++) {
    if (i >= bellyFrom && BELLY_ABSENT[i - bellyFrom] === 1) continue;
    if (preClear && i < bellyFrom) {
      const cheap = centreOfMass.y + _e[1]! * (POINT_X[i]! - cc.x) + _e[4]! * (POINT_Y[i]! - cc.y) + _e[7]! * (POINT_Z[i]! - cc.z) - preFall;
      if (bound < cheap) {
        if (GQ.on) GQ.calls[G.ptClear] = GQ.calls[G.ptClear]! + 1;
        // `--verify`: what the point's own `low` has over the cheap one (it must never be less: the margin that held, and how many points it cleared).
        if (GQ.check) {
          const rr = armOf(i, q, R[n]!);
          _vp.crossVectors(w, rr).add(v);
          const slack = centreOfMass.y + rr.y - (Math.max(0, -_vp.y) * dt + SPECULATIVE_GAP) - cheap;
          GQ.preClear.cleared++;
          if (slack < GQ.preClear.minSlack) GQ.preClear.minSlack = slack;
          if (!(bound < centreOfMass.y + rr.y - (Math.max(0, -_vp.y) * dt + SPECULATIVE_GAP))) GQ.preClear.wrong++;
        }
        continue;
      }
    }
    const r = armOf(i, q, R[n]!);
    const px = centreOfMass.x + r.x;
    const py = centreOfMass.y + r.y;
    const pz = centreOfMass.z + r.z;
    _vp.crossVectors(w, r).add(v);
    const planTravel = hypot2(_vp.x, _vp.z) * dt;
    const low = py - (Math.max(0, -_vp.y) * dt + SPECULATIVE_GAP);
    const own = !part && i < bellyFrom && Math.abs(pos.x - px) < REACH && Math.abs(pos.z - pz) < REACH;
    if (own && !held) {
      holdNearTops(skip, pos.x, pos.z, REACH + travel);
      held = true;
    }
    let clear = gate && (bound < low || staticTop(statics, px - planTravel, px + planTravel, pz - planTravel, pz + planTravel) < low);
    // `--verify`: a cage point only the tighter hill bound cleared (the bound before it, every hill's whole height, was not under `low`) is asked the old way too: what that would do is counted (`GQ.overhead`: nothing may be).
    const byHills = clear && GQ.check && !part && i < bellyFrom && !(bound < low) && !oldHillBound(statics, px - planTravel, px + planTravel, pz - planTravel, pz + planTravel, low);
    // `--verify`: the static bound over a cage point's box is never under the ground's own height at the point (the least of it over the run, and how many points were probed).
    if (GQ.check && gate && !part && i < bellyFrom) {
      const ground = statics.heightAt(px, pz);
      if (ground > NO_FLOOR) {
        GQ.overhead.probed++;
        GQ.overhead.minSlack = Math.min(GQ.overhead.minSlack, staticTop(statics, px - planTravel, px + planTravel, pz - planTravel, pz + planTravel) - ground);
      }
    }
    if (clear) {
      if (solids !== solids) solids = solidTop(centreOfMass.x - solidReach, centreOfMass.x + solidReach, centreOfMass.z - solidReach, centreOfMass.z + solidReach);
      clear = solids < low || solidTop(px - planTravel, px + planTravel, pz - planTravel, pz + planTravel) < low;
      // A wreck takes no contact row from another wreck's top (the answer is dropped below), so with `EPICENTER.wreckTops` only the other tops can keep such a point from being clear.
      if (clear && tops) {
        const reachable = i < bellyFrom;
        clear = reachable && (wreckTops ? topsTopLive(skip, body.surf.cars, own, px - planTravel, px + planTravel, pz - planTravel, pz + planTravel) : (own ? topsTopNear : topsTop)(skip, px - planTravel, px + planTravel, pz - planTravel, pz + planTravel)) < low;
        // `--verify`: a point only `wreckTops` cleared is asked the old way too, and what that would have done is counted (nothing may be: no row, no `nearing`).
        if (clear && wreckTops && GQ.check && !((own ? topsTopNear : topsTop)(skip, px - planTravel, px + planTravel, pz - planTravel, pz + planTravel) < low)) checkSkipped(GQ.wreckTops, own, px, py, pz, r);
      } else if (clear && checkTops && i < bellyFrom && !((own ? topsTopNear : topsTop)(skip, px - planTravel, px + planTravel, pz - planTravel, pz + planTravel) < low)) checkSkipped(GQ.wreckTops, own, px, py, pz, r);
      if (clear && byHills) checkSkipped(GQ.overhead, own, px, py, pz, r);
    }
    // A point the slice cannot bring to the surface needs no normal: with `nearing` set already none at all, else the square of the distance it moves (`pointContact`'s far answer).
    const travel2 = body.nearing ? -1 : (_vp.x * _vp.x + _vp.y * _vp.y + _vp.z * _vp.z) * dt * dt;
    let far: boolean;
    if (i >= bellyFrom) {
      BX[i] = px;
      BY[i] = py;
      BZ[i] = pz;
      if (clear) {
        UNREAD[i] = 1;
        if (GQ.on) GQ.calls[G.ptClear] = GQ.calls[G.ptClear]! + 1;
        continue;
      }
      far = readBelly(i, skip, travel2);
    } else {
      if (clear) {
        if (GQ.on) GQ.calls[G.ptClear] = GQ.calls[G.ptClear]! + 1;
        continue;
      }
      if (part) {
        PART_PQ[PQ_X] = px;
        PART_PQ[PQ_Z] = pz;
        PART_PQ[PQ_Y] = py;
        PART_PQ[PQ_VX] = _vp.x;
        PART_PQ[PQ_VY] = _vp.y;
        PART_PQ[PQ_VZ] = _vp.z;
        far = pointContactHeld(PART_PQ, skip, HIT, travel2, SPECULATIVE_GAP);
      } else {
        PQ[PQ_X] = px;
        PQ[PQ_Z] = pz;
        PQ[PQ_Y] = py;
        far = own ? pointContactNear(PQ, skip, HIT, travel2, SPECULATIVE_GAP) : pointContact(PQ, skip, HIT, travel2, SPECULATIVE_GAP);
      }
    }
    if (far) {
      if (GQ.on) GQ.calls[G.ptFarSkipped] = GQ.calls[G.ptFarSkipped]! + 1;
      continue;
    }
    const gy = HIT[C_H]!;
    if (gy === NO_FLOOR && !(part && HIT[C_DEPTH]! > 0)) continue;
    const pen = gy === NO_FLOOR ? HIT[C_DEPTH]! : gy - py;
    if (pen <= 0 && -pen > SPECULATIVE_GAP) {
      if (GQ.on) GQ.calls[G.ptFar] = GQ.calls[G.ptFar]! + 1;
      // A point that reaches the surface within this slice's travel at its closing speed: the next slice is cut finer.
      if (!body.nearing) {
        _vp.crossVectors(w, r).add(v);
        body.nearing = (_vp.x * HIT[C_NX]! + _vp.y * HIT[C_NY]! + _vp.z * HIT[C_NZ]!) * -dt >= -pen * HIT[C_NY]!;
      }
      continue;
    }
    // A body point closing on another car's top faster than a crash (`WALL_CRUSH`) onto a face steeper than the body's friction cone
    // (`HOLDING_NY`: a car's nose into another's edge or flank) is the car pair's hit: its SAT (the cage outlines) takes it and its crush
    // runs. So is a point that crossed the car's plan from the side and is now far under its top: deeper along the face than its closing
    // over this slice carried it (`SIDE_ENTRY_SLICES`), the top can only lift it by riding it up the car's flank (a T-bone's nose rose
    // 0.26 m and crushed 9 mm of a lethal 55 m/s). Every other point is answered by the cage's top as by any top (a roof landed on, a
    // hood driven onto).
    if (!part && HIT[C_OWNER]! >= 0) {
      if (body.wreck && body.surf.cars[HIT[C_OWNER]!]!.deform.massActive) continue;
      _vp.crossVectors(w, r).add(v).sub(body.surf.cars[HIT[C_OWNER]!]!.velocity);
      if (i < bellyFrom && HIT[C_NY]! < HOLDING_NY && -(_vp.x * HIT[C_NX]! + _vp.y * HIT[C_NY]! + _vp.z * HIT[C_NZ]!) > WALL_CRUSH) continue;
      if (crossedPlanFromSide(HIT, pen, r)) continue;
    }
    if (GQ.on) GQ.calls[G.ptRow] = GQ.calls[G.ptRow]! + 1;
    _s[S_PEN] = pen;
    bodyContact(n, HIT, i < bellyFrom);
    if (pen <= 0) GAPV[n] = GAPV[n]! + (-pen * HIT[C_NY]!) / dt;
    n++;
  }
  return n;
}

/**
 * What `loadPoints` loaded for a car and what it stood on: the tables are a function of the cage's fields (`serial` counts their fits),
 * the lift and whether the car is a wreck. `x`, `y` and `z` are exactly its points (`bellyFrom` + the belly), so a restore copies those
 * and no more: copied whole (`POINT_CAPACITY`, 590 since the held points, tubs and the hatch's sills), an intact car paid 14 KB a slice.
 */
interface LoadedPoints {
  serial: number;
  fields: CageFields;
  lift: number;
  wreck: boolean;
  bellyFrom: number;
  reach: number;
  x: Float64Array;
  y: Float64Array;
  z: Float64Array;
  absent: Uint8Array;
}

const LOADED = new WeakMap<DeformableCar, LoadedPoints>();

/**
 * Loads `car`'s body points into the point table: the four hubs (their tyres meet the ground through `wheelContact`), then the cage's
 * vertices (the drawn body as it is crushed and lifted by its class: the points a hit crushes; a wreck's sill samples too), then the belly. A torn-off or shattered
 * panel is no part of the drawn body: its vertices (left at rest in `pos`) are no points. Returns the index of the first belly point; the
 * cage's fit is current (`refitCage`). The tables come from the car's last load (copied back) while nothing they are a function of has changed:
 * the point loop and the belly samples run only for a car whose cage was fitted, lifted or wrecked since.
 */
export function loadPoints(car: DeformableCar): number {
  car.refitCage();
  const lift = cageLift(car);
  const wreck = car.deform.massActive;
  let memo = LOADED.get(car);
  if (memo !== undefined && memo.serial === car.cage.serial && memo.fields === car.cage.fields && Object.is(memo.lift, lift) && memo.wreck === wreck) {
    POINT_X.set(memo.x);
    POINT_Y.set(memo.y);
    POINT_Z.set(memo.z);
    BELLY_ABSENT.set(memo.absent);
    _s[S_POINT_REACH] = memo.reach;
    return memo.bellyFrom;
  }
  const { pos, panelOn } = car.cage.fields;
  const { vertexCount, vertexGroup, sillCount, heldFrom, heldCount } = car.cage.style;
  const { belly } = car.frame;
  // The reach about the body's centre (`centreY`), its points lifted with the drawn body (`lift`).
  const comY = car.frame.comY + centreLift(car);
  let reach2 = 0;
  let n = 0;
  // The underside's held points (`CageStyle.heldFrom`) and the sill samples are a wreck's alone: a car on its tyres stands on neither.
  const heldTo = wreck ? heldFrom : heldFrom + heldCount;
  for (let k = 0, end = vertexCount + (wreck ? sillCount : 0); k < end; k++) {
    if (k === heldFrom && heldTo > heldFrom) k = heldTo;
    if (k >= end) break;
    const g = vertexGroup[k]!;
    if (g > 0 && panelOn[g - 1] === 0) continue;
    const x = pos[k * 3]!;
    const y = pos[k * 3 + 1]! + lift;
    const z = pos[k * 3 + 2]!;
    POINT_X[n] = x;
    POINT_Y[n] = y;
    POINT_Z[n] = z;
    n++;
    reach2 = Math.max(reach2, x * x + (y - comY) * (y - comY) + z * z);
  }
  const bellyFrom = n;
  const { bottom } = car.cage.fields;
  for (let k = 0; k < belly.length; k++) {
    const [x, y, z] = belly[k]!;
    SAMPLE[0] = x;
    SAMPLE[1] = z;
    sampleAt(bottom, car.cage.style);
    BELLY_ABSENT[k] = wreck && Number.isNaN(SAMPLE[2]!) ? 1 : 0;
    // A wreck's belly is the cage's own bottom (the drawn body, crushed as drawn), not the stock underside table.
    const h = (wreck && BELLY_ABSENT[k] === 0 ? SAMPLE[2]! : y) + lift;
    POINT_X[bellyFrom + k] = x;
    POINT_Y[bellyFrom + k] = h;
    POINT_Z[bellyFrom + k] = z;
    reach2 = Math.max(reach2, x * x + (h - comY) * (h - comY) + z * z);
  }
  _s[S_POINT_REACH] = Math.sqrt(reach2);
  const count = bellyFrom + belly.length;
  if (memo === undefined || memo.x.length !== count) {
    memo = {
      serial: 0,
      fields: car.cage.fields,
      lift: 0,
      wreck: false,
      bellyFrom: 0,
      reach: 0,
      x: new Float64Array(count),
      y: new Float64Array(count),
      z: new Float64Array(count),
      absent: new Uint8Array(belly.length),
    };
  }
  memo.serial = car.cage.serial;
  memo.fields = car.cage.fields;
  memo.lift = lift;
  memo.wreck = wreck;
  memo.bellyFrom = bellyFrom;
  memo.reach = _s[S_POINT_REACH]!;
  for (let k = 0; k < count; k++) {
    memo.x[k] = POINT_X[k]!;
    memo.y[k] = POINT_Y[k]!;
    memo.z[k] = POINT_Z[k]!;
  }
  memo.absent.set(BELLY_ABSENT);
  LOADED.set(car, memo);
  return bellyFrom;
}

/** Loads a part's shape (`LooseShape`: `count` points as offsets from its centre, in its own axes) into the point table, where a car's points go. Returns the index past the last point. */
export function loadShape(shape: LooseShape): number {
  const { points, centre, count } = shape;
  for (let k = 0; k < count; k++) {
    POINT_X[k] = centre.x + points[k * 3]!;
    POINT_Y[k] = centre.y + points[k * 3 + 1]!;
    POINT_Z[k] = centre.z + points[k * 3 + 2]!;
  }
  return count;
}

/** Body point `i` of the loaded table from the body's centre of mass, turned by its orientation `q`, into `out`. */
function armOf(i: number, q: THREE.Quaternion, out: THREE.Vector3): THREE.Vector3 {
  const centre = body.centre;
  return out.set(POINT_X[i]! - centre.x, POINT_Y[i]! - centre.y, POINT_Z[i]! - centre.z).applyQuaternion(q);
}

/** Picks the other cars' tops `car`'s queries see (a car in no world sees none); the slice's contact bookkeeping starts here. */
export function beginContacts(car: DeformableCar): CarSurfaces {
  const surf = car.surfaces ?? LOCAL;
  surf.begin(car);
  return surf;
}

export const _e = new Float64Array(9);
const _hub = new Float64Array(3);
const _hit = new Float64Array(HIT_SIZE);
/** Each wheel's hub (world x, y, z) and tyre (radius, half-width; radius 0: no tyre, its hub popped) as `wheelsAt` last stood them. */
const TYRE_HUB = new Float64Array(12);
const TYRE_DIM = new Float64Array(8);
/** A tyre point's query: the tyre's law (a face within its own `PQ_MOUNT` of the point is floor, so it climbs it; a taller one is side). */
const TYRE_PQ = new Float64Array(PQ_SIZE);
/** Its answer: its own, so the body points' `HIT` keeps what their reads left in it (a far answer fills only part of it). */
const TYRE_HIT = new Float64Array(HIT_SIZE);

/** The body's x, y and z axes in world (9 numbers) from `q` into `_e`. */
function basisOf(q: THREE.Quaternion): void {
  const x2 = q.x + q.x;
  const y2 = q.y + q.y;
  const z2 = q.z + q.z;
  const xx = q.x * x2;
  const xy = q.x * y2;
  const xz = q.x * z2;
  const yy = q.y * y2;
  const yz = q.y * z2;
  const zz = q.z * z2;
  const wx = q.w * x2;
  const wy = q.w * y2;
  const wz = q.w * z2;
  _e[0] = 1 - (yy + zz);
  _e[1] = xy + wz;
  _e[2] = xz - wy;
  _e[3] = xy - wz;
  _e[4] = 1 - (xx + zz);
  _e[5] = yz + wx;
  _e[6] = xz + wy;
  _e[7] = yz - wx;
  _e[8] = 1 - (xx + yy);
}

/**
 * Each wheel's contact (`wheelContact`: its tread's footprint on what is under it) with the body as posed, into
 * `car.wheelHit` (slot i at `i * HIT_SIZE`: the lift it needs, the normal, grip, surface, owner and the footprint point).
 * Returns the wheels reaching, bit i: the tread within `within` m above its surface (or in it).
 */
export function wheelsAt(car: DeformableCar, within: number): number {
  const p = car.group.position;
  basisOf(car.group.quaternion);
  const hit = car.wheelHit;
  let mask = 0;
  const wreck = car.deform.massActive;
  for (let i = 0; i < 4; i++) {
    const o = i * HIT_SIZE;
    if (wreck && car.deform.hubPopped(HUBS[i]!)) {
      hit[o + C_H] = NO_FLOOR;
      TYRE_DIM[2 * i] = 0;
      continue;
    }
    const sc = car.wheels[i]!.scale.x;
    const r = car.frame.rig.tyre.r * sc;
    const at = wreck ? car.deform.massLocal(HUBS[i]!) : null;
    const hx = at === null ? car.frame.wx[i]! : at.x;
    const hz = at === null ? car.frame.wz[i]! : at.z;
    // The hub on its rest ride: the tyre's bottom is the body's y = 0 for every class.
    _hub[0] = p.x + _e[0]! * hx + _e[3]! * r + _e[6]! * hz;
    _hub[1] = p.y + _e[1]! * hx + _e[4]! * r + _e[7]! * hz;
    _hub[2] = p.z + _e[2]! * hx + _e[5]! * r + _e[8]! * hz;
    // The footprint's tread rings are the platform tyre's: scaled to this car's radius and its width, so its tread reaches the ground its
    // hub stands over across the whole drawn tread.
    const { r: tyreR, halfW } = car.frame.rig.tyre;
    wheelContact(_hub, _e, sc * (tyreR / PLATFORM_TYRE.r), sc * (halfW / PLATFORM_TYRE.halfW), car.slot, _hit);
    TYRE_HUB[i * 3] = _hub[0]!;
    TYRE_HUB[i * 3 + 1] = _hub[1]!;
    TYRE_HUB[i * 3 + 2] = _hub[2]!;
    TYRE_DIM[2 * i] = r;
    TYRE_DIM[2 * i + 1] = halfW * sc;
    for (let k = 0; k < HIT_SIZE; k++) hit[o + k] = _hit[k]!;
    if (-_hit[C_TOUCH]! <= within && _hit[C_H]! > NO_FLOOR) mask |= 1 << i;
  }
  return mask;
}

/**
 * Rows for the bound body's tyres against side faces (a wall, a slab, a prism's flank) as `wheelsAt` last stood them (its hubs, on its axes `_e`), from row `n` on;
 * returns the row past the last. A tyre point standing inside a face it cannot mount meets it as a body point does: a lifted car's tyres
 * meet a slab its body clears, and a tyre never runs through a solid. Only where something taller than the tyre's mount stands within its
 * plan reach (the floor rows already hold it on everything lower).
 * The tyre and its suspension give over the class's `stroke` (m, its spring travel) before the face holds the point rigid: a spring that
 * takes a hit at the speed that pops a hub (`HUB_POP_MPS`) in exactly that stroke, so a slower one stops inside it and a harder one
 * bottoms it out. Its push slows the point's closing slice by slice; once it has stopped, the tyre comes back out at no more than a body
 * at rest parts from what it stands in (`GROUND_LIFT_V`): the hit's energy is spent, not thrown back (the spring's own push sent a truck
 * back off an 8 m/s wall hit at 1.2 m/s). A rigid tyre stopped a monster's 29 m/s in one 4 ms slice.
 * Bottomed on a wreck, the wheel goes back into its well: the face shoves its hub by the depth past the stroke (`shoveWheel`, torn off
 * past a wheel's diameter) while the bottomed spring still pushes the body. Held rigid there, a sedan's front tyres (0.40 m behind its
 * bumper) stopped its nose's crush dead once it passed them, at 14-20 m/s on the range's slab.
 */
export function readTyreSides(car: DeformableCar, n: number, stroke: number): number {
  const { v, w, dt, skip } = body;
  const statics = activeGround();
  const travel = v.length() * dt;
  const spring = (HUB_POP_MPS / stroke) ** 2;
  const wreck = car.deform.massActive;
  unionTops(statics, travel);
  for (let i = 0; i < 4; i++) {
    const r = TYRE_DIM[2 * i]!;
    if (r === 0) continue;
    const half = TYRE_DIM[2 * i + 1]!;
    const hx = TYRE_HUB[3 * i]!;
    const hy = TYRE_HUB[3 * i + 1]!;
    const hz = TYRE_HUB[3 * i + 2]!;
    const reach = r + half + travel;
    const step = MOUNT * r;
    const mount = hy - r + step;
    // A surface whose bound over all four tyres' boxes (`unionTops`) is under this tyre's mount is under it over its own box too: not asked.
    const solids = UNION_TOP[0]! <= mount ? -Infinity : solidTop(hx - reach, hx + reach, hz - reach, hz + reach);
    const ground = UNION_TOP[1]! <= mount ? -Infinity : staticTop(statics, hx - reach, hx + reach, hz - reach, hz + reach);
    if (Math.max(solids, ground) <= mount) continue;
    TYRE_PQ[PQ_MOUNT] = step;
    let over = 0;
    let ox = 0;
    let oz = 0;
    for (const [across, along] of TYRE_POINTS) {
      const a = across * half;
      const f = along * r;
      TYRE_PQ[PQ_X] = hx + _e[0]! * a + _e[6]! * f;
      TYRE_PQ[PQ_Y] = hy + _e[1]! * a + _e[7]! * f;
      TYRE_PQ[PQ_Z] = hz + _e[2]! * a + _e[8]! * f;
      const rx = TYRE_PQ[PQ_X]! - centreOfMass.x;
      const ry = TYRE_PQ[PQ_Y]! - centreOfMass.y;
      const rz = TYRE_PQ[PQ_Z]! - centreOfMass.z;
      // The point's plan velocity: the face it came in through is the side it meets. A tyre standing in a face taller than its mount (a
      // point under the top by less is the floor it climbs) came in by a side whatever its vertical motion: read falling, a monster's front
      // tyres pitching down 0.36 m into the slab read its top as come in through, and the stopped body drove on through at 3 m/s.
      TYRE_PQ[PQ_VX] = v.x + w.y * rz - w.z * ry;
      TYRE_PQ[PQ_VY] = 0;
      TYRE_PQ[PQ_VZ] = v.z + w.x * ry - w.y * rx;
      pointContactSolids(TYRE_PQ, skip, TYRE_HIT);
      if (TYRE_HIT[C_H] !== NO_FLOOR || !(TYRE_HIT[C_DEPTH]! > 0)) continue;
      R[n]!.set(rx, ry, rz);
      _s[S_PEN] = TYRE_HIT[C_DEPTH]!;
      bodyContact(n, TYRE_HIT, true);
      TYRE[n] = true;
      MU[n] = MU_TYRE;
      // The tyre is no face of the body: the face it presses takes no load crush (a yielding face let the tyre sink 28 cm into the slab).
      SLOT[n] = body.surf.slot(OWN[n]!, N[n]!, false, body.q, FOLLOW[n]!);
      const depth = TYRE_HIT[C_DEPTH]!;
      const shoved = wreck && depth >= stroke;
      SINK[n] = shoved ? 0 : depth - stroke;
      GAPV[n] = depth < stroke || shoved ? Math.max(CLOSING[n]! - spring * Math.min(depth, stroke) * dt, -GROUND_LIFT_V) : 0;
      if (shoved && depth - stroke > over) {
        over = depth - stroke;
        ox = N[n]!.x;
        oz = N[n]!.z;
      }
      n++;
    }
    if (over > 0) car.deform.shoveWheel(HUBS[i]!, ox * over, oz * over);
  }
  return n;
}

/** `unionTops`' bounds: the armed solids' and the static ground's, over the four tyres' boxes together. */
const UNION_TOP = new Float64Array(2);

/**
 * Into `UNION_TOP`, the highest the armed solids and the static ground each stand over the four tyres' plan boxes taken together
 * (`readTyreSides`' per tyre box): one raster read a surface instead of four, a bound that never falls as the box grows (`cellsOnly`),
 * so a tyre whose mount stands over a surface's bound needs no read of its own of that surface. A car on open road asked 8 surface
 * reads a slice for nothing; on a slope the downhill tyres still ask the ground their own.
 */
function unionTops(statics: Surface, travel: number): void {
  let x0 = Infinity;
  let x1 = -Infinity;
  let z0 = Infinity;
  let z1 = -Infinity;
  for (let i = 0; i < 4; i++) {
    const r = TYRE_DIM[2 * i]!;
    if (r === 0) continue;
    const reach = r + TYRE_DIM[2 * i + 1]! + travel;
    const hx = TYRE_HUB[3 * i]!;
    const hz = TYRE_HUB[3 * i + 2]!;
    x0 = Math.min(x0, hx - reach);
    x1 = Math.max(x1, hx + reach);
    z0 = Math.min(z0, hz - reach);
    z1 = Math.max(z1, hz + reach);
  }
  if (x0 === Infinity) return;
  UNION_TOP[0] = solidTop(x0, x1, z0, z1, true);
  UNION_TOP[1] = staticTop(statics, x0, x1, z0, z1, true);
}

/** How many of the wheels in `mask` stand on the world rather than on another car's top. */
export function worldWheels(car: DeformableCar, mask: number): number {
  let n = 0;
  for (let i = 0; i < 4; i++) if (((mask >> i) & 1) !== 0 && car.wheelHit[i * HIT_SIZE + C_OWNER]! < 0) n++;
  return n;
}

/** Whether tyre `i` of wreck `car` stands on the top of another wreck (`wheelHit`, `cars` the surfaces' cars): a wreck takes no support from one, so the rigid step takes no row from it and the drawn ride seats no wheel on it. */
export function onWreckTop(car: DeformableCar, cars: readonly DeformableCar[], i: number): boolean {
  const own = car.wheelHit[i * HIT_SIZE + C_OWNER]!;
  return own >= 0 && car.deform.massActive && cars[own]!.deform.massActive;
}

/**
 * The rate (Hz) at which `stepWorld` splits a step on `car`'s account, 0 for its own slice: a body holding a hard contact or about to
 * (`hardTouch`: a hull point or belly in a surface or reaching one, a tyre at its spring stop or taking a landing), a face yielding under
 * it, or standing on another car is solved at `CONTACT_HZ`. A car rolling on its tyre springs, free flight and a body frozen at rest on
 * its contact (exactly zero speed) cost a normal slice: a derby's wrecks never pay for it, nor do 32 cars driving.
 */
export function contactHz(car: DeformableCar): number {
  if (car.falling || car.deform.massActive) return 0;
  if (car.velocity.lengthSq() === 0 && car.angular.lengthSq() === 0) return 0;
  return car.hardTouch || car.yielding || car.restsOn !== null ? CONTACT_HZ : 0;
}

/**
 * What the body touches as posed, read off the pose where no slice carried it (a keyframe restored): which wheels reach.
 */
export function readContact(car: DeformableCar): void {
  car.restsOn = null;
  car.yielding = false;
  car.hardTouch = false;
  beginContacts(car);
  const mask = wheelsAt(car, droop(carClass(car)) + TOUCH);
  car.wheelsDown = mask;
  car.airborne = mask === 0;
}

const _lay = new THREE.Vector3();

/**
 * `car` placed on the active ground once, as a placement and not as physics: its up turned to the mean normal under its four tyres (the
 * heading kept) and its origin raised until none sinks, so it stands as it will roll. Call it where a car is set down on a slope or a bank.
 */
export function layOnGround(car: DeformableCar): void {
  const q = car.group.quaternion;
  const hit = car.wheelHit;
  beginContacts(car);
  wheelsAt(car, 0);
  _lay.set(0, 0, 0);
  for (let i = 0; i < 4; i++) {
    const o = i * HIT_SIZE;
    if (hit[o + C_H]! > NO_FLOOR) _lay.add(_r.set(hit[o + C_NX]!, hit[o + C_NY]!, hit[o + C_NZ]!));
  }
  if (_lay.lengthSq() > 0) q.setFromUnitVectors(UP, _lay.normalize()).multiply(_dq.setFromAxisAngle(UP, car.yaw));
  wheelsAt(car, 0);
  let sink = -Infinity;
  for (let i = 0; i < 4; i++) if (hit[i * HIT_SIZE + C_H]! > NO_FLOOR) sink = Math.max(sink, hit[i * HIT_SIZE + C_H]!);
  if (sink > -Infinity) car.group.position.y += sink;
  _eul.setFromQuaternion(q, "YXZ");
  car.yaw = _eul.y;
  car.pitch = _eul.x;
  car.roll = _eul.z;
  car.refreshBasis();
  readContact(car);
}

/**
 * Whether the contacts just solved (the first `tyres` of `n` are tyres) hold a hard one or are about to: a hull point or a belly's edge in
 * a surface or reaching one within the slice (`nearing`), or a tyre at its spring stop. Tyres riding in their springs are not: a car
 * rolling on the road costs the plain slice.
 */
export function hardContactNear(tyres: number, n: number, nearing: boolean): boolean {
  if (nearing || n > tyres) return true;
  for (let c = 0; c < tyres; c++) if (!SOFT[c]) return true;
  return false;
}

/** Whether the body is taking a landing: a wheel within its springs' reach (bit i of `down`) of a surface the body closes on faster than a bounce (`BOUNCE_V`). */
export function landing(hit: Float64Array, down: number, v: THREE.Vector3): boolean {
  for (let i = 0; i < 4; i++) {
    if (((down >> i) & 1) === 0) continue;
    const o = i * HIT_SIZE;
    if (v.x * hit[o + C_NX]! + v.y * hit[o + C_NY]! + v.z * hit[o + C_NZ]! < -BOUNCE_V) return true;
  }
  return false;
}
