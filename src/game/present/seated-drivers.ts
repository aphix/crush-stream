import * as THREE from "three";
import { MAX_CARS } from "../scenes/fleet.ts";
import type { DeformableCar } from "../vehicle/car.ts";
import type { BodyStyle } from "../vehicle/car-variants.ts";
import { copDriver } from "../vehicle/ejection.ts";
import { driverSeat } from "../vehicle/interior.ts";
import { PART_KIND } from "../vehicle/part-geometry.ts";
import type { DriverLook } from "./driver-look.ts";
import { JOINTS, PARTS } from "./ragdoll-body.ts";
import { LEFT_LEG } from "./dummy-rig.ts";
import { seatedGeometry } from "./dummy-skin.ts";
import { DummyMesh } from "./ragdoll-mesh.ts";

/** Standing joints (`JOINTS` rows): [shoulder, elbow, hip, knee] per side, his right (-x) first; and his hips' middle. */
const LIMB_JOINTS = [
  [1, 2, 5, 6],
  [3, 4, 7, 8],
] as const;
/** Body parts per side: upper arm, forearm, thigh, shin (`PARTS`). */
const LIMB_PARTS = [
  [2, 3, 6, 7],
  [4, 5, 8, 9],
] as const;
const HIP_MID = new THREE.Vector3(0, JOINTS[5]![3], 0);
/** Elbow to the palm's grip on the rim (m): the forearm's 0.28 and the hand's root. */
const FOREARM_GRIP = 0.35;
/** The knee to the sole (m): the shin's whole length. */
const SHIN_SOLE = JOINTS[6]![3];
/** Elbows bend out and down, knees up and a little ahead. */
const ELBOW_POLE = [0.6, -1, 0] as const;
const KNEE_POLE = new THREE.Vector3(0, 1, 0.3).normalize();

/** A seated driver's ten parts (`PARTS` order) in car space: each part's centre and turn from standing. */
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
    const [shoulderJ, elbowJ, hipJ, kneeJ] = LIMB_JOINTS[side]!;
    const [upper, fore, thigh, shin] = LIMB_PARTS[side]!;
    const out = side === 0 ? -1 : 1;
    const shoulder = onTorso(joint(shoulderJ));
    const upperLen = joint(shoulderJ).distanceTo(joint(elbowJ));
    const grip = seat.grips[side]!;
    const elbow = bend(new THREE.Vector3(), shoulder, grip, upperLen, FOREARM_GRIP, new THREE.Vector3(out * ELBOW_POLE[0], ELBOW_POLE[1], ELBOW_POLE[2]).normalize());
    hang(upper, joint(shoulderJ), shoulder, elbow.clone().sub(shoulder).normalize());
    hang(fore, joint(elbowJ), elbow, grip.clone().sub(elbow).normalize());
    const hip = onTorso(joint(hipJ));
    const thighLen = joint(hipJ).distanceTo(joint(kneeJ));
    const foot = seat.feet[side]!;
    const knee = bend(new THREE.Vector3(), hip, foot, thighLen, SHIN_SOLE, KNEE_POLE);
    hang(thigh, joint(hipJ), hip, knee.clone().sub(hip).normalize());
    hang(shin, joint(kneeJ), knee, foot.clone().sub(knee).normalize());
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

/**
 * Every car's driver, seated in it while he is in: one instanced draw (`DummyMesh` on `seatedGeometry`), the drivers shown packed
 * from slot 0 so the draw ends at the last of them; no shadow (the car's covers him).
 */
export class SeatedDrivers {
  readonly mesh = new DummyMesh(MAX_CARS, false, seatedGeometry());
  /** Slots holding a driver, from 0. */
  private drawn = 0;
  /** Each slot's car (index in the field) and how it is dressed. */
  private readonly carOf = new Int8Array(MAX_CARS).fill(-1);
  private readonly dressed: (DriverLook | null)[] = Array.from({ length: MAX_CARS }, () => null);
  private readonly cops = new Uint8Array(MAX_CARS);

  /** The car's glass is off the camera (`CarDetail.isMid`), so no one sees him there. */
  private readonly cut: (car: DeformableCar) => boolean;

  constructor(cut: (car: DeformableCar) => boolean) {
    this.cut = cut;
    this.mesh.name = "seatedDrivers";
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = true;
  }

  /** Pose the drivers of `cars` (world matrices current), dressed as `lookOf` has them; empty slots, thrown drivers and cut cars hide. */
  sync(cars: readonly DeformableCar[], lookOf: (car: number, cop: boolean) => DriverLook): void {
    let s = 0;
    for (let c = 0; c < MAX_CARS; c++) {
      const car = cars[c];
      const seat = car?.partSeats[PART_KIND.seatFront];
      if (!car || !seat || this.cut(car) || !seatedShown(car, seat)) continue;
      const cop = copDriver(car);
      const look = lookOf(c, cop);
      // Another car in the slot dresses it afresh, so its bust starts at rest there.
      if (this.carOf[s] !== c || this.cops[s] !== Number(cop) || !sameLook(this.dressed[s] ?? null, look)) {
        this.mesh.dress(s, cop, look);
        this.carOf[s] = c;
        this.dressed[s] = look;
        this.cops[s] = Number(cop);
      }
      const pose = seatedPose(car.style);
      const frame = car.interior.matrixWorld;
      frame.decompose(_at, _turn, _scale);
      // His legs (parts from LEFT_LEG on) are cut from `seatedGeometry`.
      for (let k = 0; k < LEFT_LEG; k++) {
        this.mesh.pose(s, k, _p.copy(pose.p[k]!).applyMatrix4(frame), _q.copy(_turn).multiply(pose.q[k]!));
      }
      s++;
    }
    for (let k = s; k < this.drawn; k++) this.mesh.hide(k);
    this.drawn = s;
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
