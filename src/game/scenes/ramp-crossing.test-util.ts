import * as THREE from "three";
import { applyDrive, type DriveInput } from "../vehicle/car-drive.ts";
import { JerseyBarrier } from "./engine-props.ts";
import { FleetRamps, RAMP } from "./fleet-ramps.ts";
import { collideOn } from "./ramp-collide.test-util.ts";
import { setGround } from "../world/ground.ts";
import { physicsSlice, sliceSpeed } from "../contact/sat.ts";
import { newWorld, stepWorld } from "../engine/world-step.ts";
import { pooled, tyreGaps } from "../vehicle/ground-probe.test-util.ts";
import { STIFF_TRAVEL } from "../vehicle/stiff-springs.test-util.ts";
import { FRAME_HZ } from "../kernel/constants.ts";

/** The fleet ramp's toe crossings (`ramp-crossing.test.ts`): one sedan driven over the toe and the worst of every bar over its slices. Not a test file itself. */
const FRAME = 1 / FRAME_HZ;
export const DEG = 180 / Math.PI;
const EDGE = -RAMP.halfW;
const TOE = RAMP.start + RAMP.len;
const TOUCH = 0.03;
/** A tyre within its stiff spring's travel of what it touches carries the body; the plane through those tyres is what the body's tilt follows. */
const SPRING_REACH = STIFF_TRAVEL;
/** A tyre's reach (m, plan) from its hub: its radius and a little. */
const REACH = 0.35;

function wrap(a: number): number {
  let r = a;
  while (r > Math.PI) r -= 2 * Math.PI;
  while (r < -Math.PI) r += 2 * Math.PI;
  return r;
}

export type Result = {
  yaw: number;
  heading: number;
  shove: number;
  dv: number;
  tilt: number;
  tiltAt: string;
  airWhileTouching: number;
  slices: number;
  crashed: boolean;
  /** Worst angle (deg) between the plane through the touching wheels' hub points and the one through their tread contact points, over the slices where every one of those points has the same ground normal (one plane under all of them). */
  planeGap: number;
  /** Slices that `planeGap` covers, and of those the ones on level ground. */
  planeSlices: number;
  flatSlices: number;
};

const _q = new THREE.Vector3();
const _ax = new THREE.Vector3();
const _c = new THREE.Vector3();

/** Elevation (deg) of a body axis and the unit plan direction it points in (`dir`). */
function axis(q: THREE.Quaternion, x: number, y: number, z: number, dir: Float64Array): number {
  _ax.set(x, y, z).applyQuaternion(q);
  const len = Math.hypot(_ax.x, _ax.z);
  dir[0] = _ax.x / len;
  dir[1] = _ax.z / len;
  return Math.asin(_ax.y) * DEG;
}

/** Least-squares plane y = a x + b z + c through the first n points (into `abc`); false when they are collinear. */
function fitPlane(px: Float64Array, py: Float64Array, pz: Float64Array, n: number, abc: Float64Array): boolean {
  let mx = 0;
  let my = 0;
  let mz = 0;
  for (let i = 0; i < n; i++) {
    mx += px[i]! / n;
    my += py[i]! / n;
    mz += pz[i]! / n;
  }
  let sxx = 0;
  let sxz = 0;
  let szz = 0;
  let sxy = 0;
  let szy = 0;
  for (let i = 0; i < n; i++) {
    const ax = px[i]! - mx;
    const az = pz[i]! - mz;
    const ay = py[i]! - my;
    sxx += ax * ax;
    sxz += ax * az;
    szz += az * az;
    sxy += ax * ay;
    szy += az * ay;
  }
  const det = sxx * szz - sxz * sxz;
  if (!(Math.abs(det) > 1e-9)) return false;
  abc[0] = (sxy * szz - szy * sxz) / det;
  abc[1] = (szy * sxx - sxy * sxz) / det;
  abc[2] = my - abc[0]! * mx - abc[1]! * mz;
  return true;
}

/** Angle (deg) between two fitted planes. */
function planeAngle(p: Float64Array, q: Float64Array): number {
  const dot = (p[0]! * q[0]! + 1 + p[1]! * q[1]!) / (Math.hypot(p[0]!, 1, p[1]!) * Math.hypot(q[0]!, 1, q[1]!));
  return Math.acos(Math.min(1, dot)) * DEG;
}

/** The ramps and the slab, built once and put back as new for each crossing. */
let builtScene: { ramps: FleetRamps; slab: JerseyBarrier } | undefined;
function crossingScene(): { ramps: FleetRamps; slab: JerseyBarrier } {
  if (!builtScene) {
    const three = new THREE.Scene();
    builtScene = { ramps: new FleetRamps(three), slab: new JerseyBarrier(three, new THREE.Group()) };
  }
  builtScene.slab.reset();
  builtScene.ramps.place(0, builtScene.slab);
  setGround(builtScene.ramps);
  return builtScene;
}

/** Cross the toe once: the worst of every bar over every physics slice. `mirrored` drives the reflection of the same crossing in the ramp's axis. */
export function cross(v: number, thDeg: number, e: number, mirrored = false): Result {
  const { ramps, slab } = crossingScene();
  const car = pooled("sedan");
  const w = newWorld([car], slab);
  w.collide = collideOn(ramps);
  const yaw = mirrored ? Math.PI - thDeg / DEG : Math.PI + thDeg / DEG;
  const dx = Math.sin(yaw);
  const dz = Math.cos(yaw);
  // The mirrored crossing is the same situation reflected in the ramp's axis: the edge it crosses inside is the +x one.
  const edge = mirrored ? RAMP.halfW : EDGE;
  car.spawnFacing(mirrored ? edge - e - dx * 10 : edge + e - dx * 10, TOE - dz * 10, yaw, v);
  const input: DriveInput = { throttle: 0, steer: 0, brake: 0, ebrake: false, boost: false };
  const p = car.group.position;
  const out: Result = { yaw: 0, heading: 0, shove: 0, dv: 0, tilt: 0, tiltAt: "", airWhileTouching: 0, slices: 0, crashed: false, planeGap: 0, planeSlices: 0, flatSlices: 0 };
  const yaw0 = car.group.rotation.y;
  const head0 = wrap(yaw);
  let lastVx = car.velocity.x;
  let lastVz = car.velocity.z;
  _c.set(0, car.frame.comY, 0).applyQuaternion(car.group.quaternion);
  let lastCx = p.x + _c.x;
  let lastCz = p.z + _c.z;
  const dirF = new Float64Array(2);
  const dirR = new Float64Array(2);
  // The touching wheels' hub points (x, the ground's height under the hub, z) and resting hubs (x, the hub's height less its tread
  // gap, z).
  const hx = new Float64Array(4);
  const hy = new Float64Array(4);
  const hz = new Float64Array(4);
  const ry = new Float64Array(4);
  const touched = new Int32Array(4);
  const planeC = new Float64Array(3);
  const planeH = new Float64Array(3);
  const normal0 = new THREE.Vector3();
  const normal = new THREE.Vector3();
  let acc = 0;
  for (let f = 0; f < 5 * 60; f++) {
    acc = Math.min(0.05, acc + FRAME);
    while (acc > 1e-5) {
      const h = physicsSlice(acc, sliceSpeed(w.cars));
      input.throttle = Math.max(0, Math.min(1, (v - Math.hypot(car.velocity.x, car.velocity.z)) / 1.5));
      applyDrive(car, input, h);
      stepWorld(w, h);
      car.stepBreakage(h);
      acc -= h;
      out.slices++;
      const fi = tyreGaps(car, ramps);
      let touching = 0;
      let tyresNearGround = 0;
      let tyresShortOfToe = 0;
      for (let i = 0; i < 4; i++) {
        car.wheels[i]!.getWorldPosition(_q);
        if (_q.z > TOE - REACH) tyresShortOfToe++;
        if (fi.gaps[i]! < TOUCH) tyresNearGround++;
        if (fi.gaps[i]! >= SPRING_REACH) continue;
        hx[touching] = _q.x;
        hz[touching] = _q.z;
        hy[touching] = ramps.heightAt(_q.x, _q.z, _q.y);
        ry[touching] = _q.y - fi.gaps[i]!;
        touched[touching] = i;
        touching++;
      }
      const crossing = tyresShortOfToe > 0;
      if (fi.airborne && tyresNearGround > 0) out.airWhileTouching++;
      // `velocity` is the centre of mass's: a body turning about its centre swings its origin, and that is no shove.
      _c.set(0, car.frame.comY, 0).applyQuaternion(car.group.quaternion);
      const mx = p.x + _c.x - lastCx;
      const mz = p.z + _c.z - lastCz;
      if (crossing) {
        out.yaw = Math.max(out.yaw, Math.abs(wrap(car.group.rotation.y - yaw0)) * DEG);
        out.heading = Math.max(out.heading, Math.abs(wrap(Math.atan2(car.velocity.x, car.velocity.z) - head0)) * DEG);
        out.dv = Math.max(out.dv, Math.hypot(car.velocity.x - lastVx, car.velocity.z - lastVz));
        out.shove = Math.max(out.shove, Math.hypot(mx - car.velocity.x * h, mz - car.velocity.z * h));
      }
      lastVx = car.velocity.x;
      lastVz = car.velocity.z;
      lastCx = p.x + _c.x;
      lastCz = p.z + _c.z;
      if (touching >= 3 && fitPlane(hx, ry, hz, touching, planeC)) {
        // The plane through the touching wheels' resting hubs (least squares): y = a x + b z + c.
        const q = car.group.quaternion;
        const pitch = axis(q, 0, 0, 1, dirF);
        const roll = axis(q, 1, 0, 0, dirR);
        const pitchErr = Math.abs(pitch - Math.atan(planeC[0]! * dirF[0]! + planeC[1]! * dirF[1]!) * DEG);
        const rollErr = Math.abs(roll - Math.atan(planeC[0]! * dirR[0]! + planeC[1]! * dirR[1]!) * DEG);
        const worst = Math.max(pitchErr, rollErr);
        if (crossing && worst > out.tilt) {
          out.tilt = worst;
          out.tiltAt = `${pitchErr > rollErr ? "pitch" : "roll"} at z ${p.z.toFixed(2)} on ${touching} wheels`;
        }
        // One plane under every tyre: the same ground normal under each touching hub and a tyre's reach before, behind and to either
        // side of it (a tyre whose hub and contact are on the wedge's face but whose front is over its crest rests on the crest). There
        // the two fits are parallel planes.
        let one = fitPlane(hx, hy, hz, touching, planeH);
        ramps.normalAt(hx[0]!, hz[0]!, normal0, hy[0]! + 0.5);
        for (let i = 0; one && i < touching; i++) {
          for (let s = 0; one && s < 5; s++) {
            const a = s === 0 ? 0 : s < 3 ? (s === 1 ? REACH : -REACH) : 0;
            const b = s < 3 ? 0 : s === 3 ? REACH : -REACH;
            ramps.normalAt(hx[i]! + a * dirF[0]! + b * dirR[0]!, hz[i]! + a * dirF[1]! + b * dirR[1]!, normal, hy[i]! + 0.5);
            if (normal.distanceTo(normal0) > 1e-9) one = false;
          }
        }
        if (one) {
          out.planeSlices++;
          if (normal0.y > 1 - 1e-12) out.flatSlices++;
          out.planeGap = Math.max(out.planeGap, planeAngle(planeH, planeC));
        }
      }
    }
    if (p.z < RAMP.start - 0.2 || car.crashed) break;
  }
  out.crashed = car.crashed;
  setGround(null);
  return out;
}
