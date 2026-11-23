import * as THREE from "three";
import { MAX_CARS } from "../scenes/fleet.ts";
import { MAX_ACTORS } from "../scenes/seat-table.ts";
import { scootShare, SEAT_DRIVER, seatHip } from "../vehicle/car-seats.ts";
import type { SeatRiders } from "./seat-riders.ts";
import type { DeformableCar } from "../vehicle/car.ts";
import type { BodyStyle } from "../vehicle/car-variants.ts";
import { copDriver } from "../vehicle/ejection.ts";
import { driverSeat, HEAD } from "../vehicle/interior.ts";
import { PART_KIND } from "../vehicle/part-geometry.ts";
import type { DriverLook } from "./driver-look.ts";
import { ANKLE_Y, JOINTS, PARTS } from "./ragdoll-body.ts";
import { LEFT_LEG } from "./dummy-rig.ts";
import { seatedGeometry } from "./dummy-skin.ts";
import { DummyMesh } from "./ragdoll-mesh.ts";

/** Standing joints (`JOINTS` rows): [shoulder, elbow, hip, knee, ankle] per side, his right (-x) first; and his hips' middle. */
const LIMB_JOINTS = [
  [1, 2, 5, 6, 9],
  [3, 4, 7, 8, 10],
] as const;
/** Body parts per side: upper arm, forearm, thigh, shin, foot (`PARTS`). */
const LIMB_PARTS = [
  [2, 3, 6, 7, 10],
  [4, 5, 8, 9, 11],
] as const;
const HIP_MID = new THREE.Vector3(0, JOINTS[5]![3], 0);
/** Elbow to the palm's grip on the rim (m): the forearm's 0.28 and the hand's root. */
const FOREARM_GRIP = 0.35;
/** The knee to the ankle (m): the shin's whole length. */
const SHIN_LENGTH = JOINTS[6]![3] - JOINTS[9]![3];
/** Elbows bend out and down, knees up and a little ahead. */
const ELBOW_POLE = [0.6, -1, 0] as const;
const KNEE_POLE = new THREE.Vector3(0, 1, 0.3).normalize();

/** A seated driver's twelve parts (`PARTS` order) in car space: each part's centre and turn from standing. */
interface SeatedPose {
  readonly p: readonly THREE.Vector3[];
  readonly q: readonly THREE.Quaternion[];
}

const DOWN = new THREE.Vector3(0, -1, 0);
const _u = new THREE.Vector3();
const _v = new THREE.Vector3();

/** The middle joint of a two-bone limb from `root` toward `tip` (`a` then `b` long), bending toward `pole`, into `out`. */
function bend(out: THREE.Vector3, root: THREE.Vector3, tip: THREE.Vector3, a: number, b: number, pole: THREE.Vector3): THREE.Vector3 {
  _u.subVectors(tip, root);
  const d = Math.min(_u.length(), a + b - 1e-4);
  _u.normalize();
  const cos = (a * a + d * d - b * b) / (2 * a * d);
  _v.copy(pole).addScaledVector(_u, -_u.dot(pole)).normalize();
  return out.copy(root).addScaledVector(_u, a * cos).addScaledVector(_v, a * Math.sqrt(Math.max(0, 1 - cos * cos)));
}

const poses = new WeakMap<BodyStyle, SeatedPose>();

/**
 * `style`'s driver sat on his drawn seat (`driverSeat`): hips on the H-point, back on the seat's lean, hands on the wheel's grips,
 * soles on the floor ahead. Built once per style. The pose a thrown driver can start from, so the seated one hands over without a jump.
 */
function seatedPose(style: BodyStyle): SeatedPose {
  const known = poses.get(style);
  if (known) return known;
  const seat = driverSeat(style);
  const torso = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -seat.recline);
  const p = PARTS.map(() => new THREE.Vector3());
  const q = PARTS.map(() => new THREE.Quaternion());
  const stand = (k: number) => new THREE.Vector3(...PARTS[k]!.c);
  const joint = (j: number) => new THREE.Vector3(JOINTS[j]![2], JOINTS[j]![3], JOINTS[j]![4]);
  const onTorso = (rest: THREE.Vector3) => rest.sub(HIP_MID).applyQuaternion(torso).add(seat.hip);
  for (const k of [0, 1]) {
    p[k]!.copy(onTorso(stand(k)));
    q[k]!.copy(torso);
  }
  const down = DOWN.clone().applyQuaternion(torso);
  /** Part `k` hung from joint `j` (standing `rest`) at `at`, pointing down `dir`. */
  const hang = (k: number, rest: THREE.Vector3, at: THREE.Vector3, dir: THREE.Vector3) => {
    q[k]!.setFromUnitVectors(down, dir).multiply(torso);
    p[k]!.copy(stand(k).sub(rest).applyQuaternion(q[k]!).add(at));
  };
  for (let side = 0; side < 2; side++) {
    const [shoulderJ, elbowJ, hipJ, kneeJ, ankleJ] = LIMB_JOINTS[side]!;
    const [upper, fore, thigh, shin, foot] = LIMB_PARTS[side]!;
    const out = side === 0 ? -1 : 1;
    const shoulder = onTorso(joint(shoulderJ));
    const upperLen = joint(shoulderJ).distanceTo(joint(elbowJ));
    const grip = seat.grips[side]!;
    const elbow = bend(new THREE.Vector3(), shoulder, grip, upperLen, FOREARM_GRIP, new THREE.Vector3(out * ELBOW_POLE[0], ELBOW_POLE[1], ELBOW_POLE[2]).normalize());
    hang(upper, joint(shoulderJ), shoulder, elbow.clone().sub(shoulder).normalize());
    hang(fore, joint(elbowJ), elbow, grip.clone().sub(elbow).normalize());
    const hip = onTorso(joint(hipJ));
    const thighLen = joint(hipJ).distanceTo(joint(kneeJ));
    const ankle = seat.feet[side]!.clone().setY(seat.feet[side]!.y + ANKLE_Y);
    const knee = bend(new THREE.Vector3(), hip, ankle, thighLen, SHIN_LENGTH, KNEE_POLE);
    hang(thigh, joint(hipJ), hip, knee.clone().sub(hip).normalize());
    hang(shin, joint(kneeJ), knee, ankle.clone().sub(knee).normalize());
    p[foot]!.copy(stand(foot).sub(joint(ankleJ)).add(ankle));
  }
  const pose = { p, q };
  poses.set(style, pose);
  return pose;
}

/** Whether `car`'s driver is in and drawn: not thrown, his seat on the car and on the camera (`CarDetail` cuts it with the cabin). */
function seatedShown(car: DeformableCar, seat: THREE.Object3D): boolean {
  if (car.driverOut !== null || !seat.layers.isEnabled(0)) return false;
  for (let o: THREE.Object3D | null = seat; o; o = o.parent) {
    if (!o.visible) return false;
    if (o === car.group) return true;
  }
  return false;
}

const _at = new THREE.Vector3();
const _turn = new THREE.Quaternion();
const _scale = new THREE.Vector3();
const _p = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _lean = new THREE.Quaternion();
const X_AXIS = new THREE.Vector3(1, 0, 0);
const _duck = { lean: 0, down: 0 };
/** A ducking head stays this far (m) ahead of the roof's rear end: the roof rolls down there, open from above until the rear glass. */
const ROOF_END_CLEAR = 0.05;

/**
 * How `style`'s driver leans further back (rad) and then slumps down (m) to bring his head `d` m lower, under a roof crushed that
 * far: he leans until his head would leave the roof's rear end or meet the cab's back wall (a short truck cab's come first), then slumps.
 */
function duck(style: BodyStyle, d: number): { lean: number; down: number } {
  _duck.lean = 0;
  _duck.down = 0;
  if (d <= 0) return _duck;
  const { recline, hip } = driverSeat(style);
  const back = Math.max(style.rearBulkhead.z, style.roofZ[0]) + HEAD.r + ROOF_END_CLEAR;
  const wall = Math.asin(THREE.MathUtils.clamp((hip.z - back) / HEAD.up, 0, 1));
  const to = Math.min(wall, Math.acos(Math.max(-1, Math.cos(recline) - d / HEAD.up)));
  _duck.lean = Math.max(0, to - recline);
  _duck.down = d - HEAD.up * (Math.cos(recline) - Math.cos(recline + _duck.lean));
  return _duck;
}

/** Slots the draw holds: every car's driver, and a player more for every seat but one (a player holds one seat). */
const SLOTS = MAX_CARS + MAX_ACTORS;
/** A rider's slot is keyed from here, above every car index. */
const RIDER_KEY = MAX_CARS;
const _hip = { x: 0, y: 0, z: 0 };
const _from = { x: 0, y: 0, z: 0 };
const _driver = { x: 0, y: 0, z: 0 };
const _shift = new THREE.Vector3();

/**
 * Every seated driver and rider, seated while he is in: one instanced draw (`DummyMesh` on `seatedGeometry`), the figures shown packed
 * from slot 0 so the draw ends at the last of them; no shadow (the car's covers him).
 */
export class SeatedDrivers {
  readonly mesh = new DummyMesh(SLOTS, false, seatedGeometry());
  /** Slots holding a figure, from 0. */
  private drawn = 0;
  /** Each slot's key (a car's index for its driver, `RIDER_KEY` + the actor for a player the seat table holds) and how it is dressed. */
  private readonly keyOf = new Int8Array(SLOTS).fill(-1);
  private readonly dressed: (DriverLook | null)[] = Array.from({ length: SLOTS }, () => null);
  private readonly cops = new Uint8Array(SLOTS);

  /** The car's glass is off the camera (`CarDetail.isMid`), so no one sees him there. */
  private readonly cut: (car: DeformableCar) => boolean;

  constructor(cut: (car: DeformableCar) => boolean) {
    this.cut = cut;
    this.mesh.name = "seatedDrivers";
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = true;
  }

  /**
   * Pose the drivers of `cars` (world matrices current), dressed as `lookOf` has them, and the players `riders` seats at their own seats with their own looks; empty slots, thrown drivers,
   * cut cars, car `away` (its driver is out walking) and a car `empty` says is parked hide.
   */
  sync(cars: readonly DeformableCar[], lookOf: (car: number) => DriverLook, uniform: (car: number, cop: boolean) => boolean, away = -1, empty: ((car: number, body: DeformableCar) => boolean) | null = null, riders: SeatRiders | null = null): void {
    let s = 0;
    for (let c = 0; c < MAX_CARS; c++) {
      const car = cars[c];
      const seat = car?.partSeats[PART_KIND.seatFront];
      if (!car || !seat || c === away || (riders !== null && riders.drives(c)) || this.cut(car) || !seatedShown(car, seat) || (empty !== null && empty(c, car))) continue;
      _shift.set(0, 0, 0);
      this.figure(s++, c, car, uniform(c, copDriver(car)), lookOf(c), _shift);
    }
    for (let r = 0; riders !== null && r < riders.count; r++) {
      const car = cars[riders.car[r]!];
      const seat = car?.partSeats[PART_KIND.seatFront];
      if (!car || !seat || this.cut(car) || !seatedShown(car, seat)) continue;
      const actor = riders.actor[r]!;
      this.shift(car, riders.seat[r]!, riders.from[r]!, riders.slid[r]!);
      this.figure(s++, RIDER_KEY + actor, car, false, riders.lookOf(actor), _shift);
    }
    for (let k = s; k < this.drawn; k++) this.mesh.hide(k);
    this.drawn = s;
  }

  /** Into `_shift`: how far (car frame) a figure in `seat` sits from the driver's seat, `slid` s into a slide from seat `from` (-1: none). */
  private shift(car: DeformableCar, seat: number, from: number, slid: number): void {
    seatHip(car.style, SEAT_DRIVER, _driver);
    seatHip(car.style, seat, _hip);
    if (from >= 0) {
      seatHip(car.style, from, _from);
      const share = scootShare(slid);
      _hip.x = _from.x + (_hip.x - _from.x) * share;
      _hip.y = _from.y + (_hip.y - _from.y) * share;
      _hip.z = _from.z + (_hip.z - _from.z) * share;
    }
    _shift.set(_hip.x - _driver.x, _hip.y - _driver.y, _hip.z - _driver.z);
  }

  /** Slot `s` holds the figure `key` of `car`, dressed `look` (a `cop` in uniform), sat `shift` (car frame) from the driver's seat. */
  private figure(s: number, key: number, car: DeformableCar, cop: boolean, look: DriverLook, shift: THREE.Vector3): void {
    // Another figure in the slot dresses it afresh, so its bust starts at rest there.
    if (this.keyOf[s] !== key || this.cops[s] !== Number(cop) || !sameLook(this.dressed[s] ?? null, look)) {
      this.mesh.dress(s, cop, look);
      this.keyOf[s] = key;
      this.dressed[s] = look;
      this.cops[s] = Number(cop);
    }
    const pose = seatedPose(car.style);
    const frame = car.interior.matrixWorld;
    frame.decompose(_at, _turn, _scale);
    const place = driverSeat(car.style);
    const drop = duck(car.style, -car.cabin.roofSink);
    _lean.setFromAxisAngle(X_AXIS, -drop.lean);
    // His legs (parts from LEFT_LEG on) are cut from `seatedGeometry`.
    for (let k = 0; k < LEFT_LEG; k++) {
      _p.copy(pose.p[k]!).sub(place.hip).applyQuaternion(_lean).add(place.hip);
      _p.y -= drop.down;
      _p.add(shift);
      this.mesh.pose(s, k, _p.applyMatrix4(frame), _q.copy(_turn).multiply(_lean).multiply(pose.q[k]!));
    }
  }

  /** The body geometry is shared (`seatedGeometry`, on `dummyGeometry`'s attributes): only this mesh's material and instance buffers go. */
  dispose(): void {
    this.mesh.material.dispose();
    this.mesh.dispose();
  }
}

/** Two looks dress a figure alike. */
function sameLook(a: DriverLook | null, b: DriverLook): boolean {
  return (
    a !== null &&
    a.woman === b.woman &&
    a.shirt === b.shirt &&
    a.pants === b.pants &&
    a.hair === b.hair &&
    a.hat === b.hat &&
    a.mustache === b.mustache &&
    a.portly === b.portly &&
    a.outfit === b.outfit &&
    a.shades === b.shades &&
    a.face === b.face &&
    a.tie === b.tie
  );
}
