import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import "../kernel/rapier-node.test-util.ts";
import { FREEWHEEL, launch as drive, makeCar, makeWorld, tickWorld } from "../contact/crash-scenarios.test-util.ts";
import { FRAME_HZ } from "../kernel/constants.ts";
import { DeformableCar } from "../vehicle/car.ts";
import { blankEjection, type Ejection } from "../vehicle/ejection.ts";
import { paint } from "../vehicle/test-support.ts";
import { assignClass, STYLE_CLASS } from "../vehicle/vehicle-classes.ts";
import { setGround } from "../world/ground.ts";
import { RagdollSystem } from "./engine-ragdoll.ts";
import { type Doll, PARTS, SHOULDER_Y } from "./ragdoll-body.ts";
import { hinge } from "./ragdoll-pose.test-util.ts";
import type { ReleaseScale } from "./ragdoll-boxes.ts";
import { seatedPose } from "./seated-drivers.ts";

const FRAME = 1 / FRAME_HZ;
const DEG = 180 / Math.PI;
/** The window the owner watches a thrown dummy over (s), and the bend (deg) an elbow and a knee each must pass in it: a limb that gives, not one that holds the dive. */
const FLIGHT_SECONDS = 1;
const BEND_MIN_DEGREES = 30;
/** By when (s) each forearm must be below the shoulder line, measured along the torso's up (a raised arm's forearm is 0.66 m up, the shoulder 0.24 m). */
const ARMS_DOWN_BY_SECONDS = 0.8;
const SHOULDER_LINE = SHOULDER_Y - PARTS[0].c[1];
/** The launch's total linear momentum against the rigid launch it replaces, as a share of it (f32 velocities: 1e-7 each). */
const MOMENTUM_TOLERANCE = 1e-4;
/** How far (m) a part's farthest corner may leave from where he sat in the event's car (an f32 body position at 300 m), and from where he was drawn seated in a real crash: no pop at the hand-over. */
const POSE_TOLERANCE = 1e-4;
const SEAT_TOLERANCE = 0.01;
/** Height (m) the ejections start at: far over the sand, so the first second is all air. */
const START_HEIGHT = 12;
/** Frames (s × 60) the head-on runs on after both cars first crush, before the throw: the cabins have moved with their cells by then. */
const CRUSH_FRAMES = 6;

const AXIS_X = new THREE.Vector3(1, 0, 0);
const LEAN = new THREE.Quaternion().setFromAxisAngle(AXIS_X, (80 * Math.PI) / 180);
const SIDE = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2).multiply(LEAN);

/** The farthest any corner of `doll`'s parts stands from the same part seated in `car` (`seatedPose` on the cabin's world matrix, as `SeatedDrivers` draws him), and that part. */
function offSeat(doll: Doll, car: DeformableCar): { off: number; part: number } {
  car.group.updateMatrixWorld(true);
  const pose = seatedPose(car.style);
  const frame = car.interior.matrixWorld;
  const turn = new THREE.Quaternion();
  frame.decompose(new THREE.Vector3(), turn, new THREE.Vector3());
  let worst = { off: 0, part: -1 };
  for (const [k, body] of doll.bodies.entries()) {
    const satAt = pose.p[k]!.clone().applyMatrix4(frame);
    const satTurn = turn.clone().multiply(pose.q[k]!);
    const t = body.translation();
    const r = body.rotation();
    const at = new THREE.Vector3(t.x, t.y, t.z);
    const q = new THREE.Quaternion(r.x, r.y, r.z, r.w);
    const h = PARTS[k]!.h;
    for (const sx of [-1, 1])
      for (const sy of [-1, 1])
        for (const sz of [-1, 1]) {
          const c = new THREE.Vector3(sx * h[0], sy * h[1], sz * h[2]);
          const off = c.clone().applyQuaternion(q).add(at).distanceTo(c.applyQuaternion(satTurn).add(satAt));
          if (off > worst.off) worst = { off, part: k };
        }
  }
  return worst;
}

/** Ejections as the sim makes them: head first out of the pane (80° lean), somersault 3 rad/s about the shoulder line, his own velocity out of the car on top of the car's. */
const SHOTS: readonly { name: string; quat: THREE.Quaternion; carVel: THREE.Vector3; rel: THREE.Vector3; spin: THREE.Vector3 }[] = [
  { name: "a car at 15 m/s", quat: LEAN, carVel: new THREE.Vector3(0, 0, 15), rel: new THREE.Vector3(0, 3.5, 3), spin: new THREE.Vector3(3, 0, 0) },
  { name: "a wall (the car stopped, he keeps 18 m/s)", quat: LEAN, carVel: new THREE.Vector3(0, 0, 0), rel: new THREE.Vector3(0, 3.5, 18), spin: new THREE.Vector3(3, 0, 0) },
  { name: "a car half stopped", quat: LEAN, carVel: new THREE.Vector3(0, 0, 8), rel: new THREE.Vector3(0, 3.5, 10), spin: new THREE.Vector3(3, 0, 0) },
  { name: "a side door", quat: SIDE, carVel: new THREE.Vector3(10, 0, 0), rel: new THREE.Vector3(3, 3.5, 0), spin: new THREE.Vector3(0, 0, -3) },
];

function ejection(shot: (typeof SHOTS)[number]): Ejection {
  const e = blankEjection();
  e.pos.set(-300, START_HEIGHT, 0);
  e.quat.copy(shot.quat);
  e.carVel.copy(shot.carVel);
  e.rel.copy(shot.rel);
  e.spin.copy(shot.spin);
  return e;
}

/** A ragdoll system on flat sand, `shot` thrown out of `car` (through `launch`, as the sim does); the doll in slot 0. */
async function thrown(shot: (typeof SHOTS)[number], scale?: ReleaseScale, car = makeCar()): Promise<{ sys: RagdollSystem; doll: Doll; e: Ejection }> {
  const sys = new RagdollSystem(new THREE.Scene(), () => {}, () => {});
  await sys.preload();
  setGround(null);
  sys.update(FRAME, [], true, false, null);
  const e = ejection(shot);
  if (scale) sys.launch(e, [car], true, scale);
  else sys.launch(e, [car]);
  return { sys, doll: sys["dolls"][0]!, e };
}

/** What a flight did in its first `FLIGHT_SECONDS`: the deepest elbow and knee bend (deg), and when a forearm first went below the shoulder line (s; Infinity: never). */
function fly(sys: RagdollSystem, doll: Doll): { elbow: number; knee: number; armsDownAt: number } {
  const out = { elbow: 0, knee: 0, armsDownAt: Infinity };
  const up = new THREE.Vector3();
  const q = new THREE.Quaternion();
  const away = new THREE.Vector3();
  for (let f = 1; f <= Math.round(FLIGHT_SECONDS * FRAME_HZ); f++) {
    sys.update(FRAME, [], true, false, null);
    const b = doll.bodies;
    out.elbow = Math.max(out.elbow, -hinge(b, 2, 3) * DEG, -hinge(b, 4, 5) * DEG);
    out.knee = Math.max(out.knee, hinge(b, 6, 7) * DEG, hinge(b, 8, 9) * DEG);
    const torso = b[0]!;
    up.set(0, 1, 0).applyQuaternion(q.copy(torso.rotation() as THREE.Quaternion));
    for (const k of [3, 5]) {
      away.copy(b[k]!.translation() as THREE.Vector3).sub(torso.translation() as THREE.Vector3);
      if (away.dot(up) < SHOULDER_LINE) out.armsDownAt = Math.min(out.armsDownAt, f * FRAME);
    }
  }
  return out;
}

const _r = new THREE.Vector3();
const _p = new THREE.Vector3();

describe("given a driver thrown out of a car", () => {
  it(`when he flies, then in the first ${FLIGHT_SECONDS} s an elbow and a knee each bend at least ${BEND_MIN_DEGREES}° and both forearms drop below the shoulder line by ${ARMS_DOWN_BY_SECONDS} s, in each of the four ejections`, async () => {
    for (const shot of SHOTS) {
      const { sys, doll } = await thrown(shot);
      const flight = fly(sys, doll);
      sys.dispose();
      const seen = `${shot.name}: elbow ${flight.elbow.toFixed(0)}°, knee ${flight.knee.toFixed(0)}°, arms down at ${flight.armsDownAt.toFixed(2)} s`;
      assert.ok(flight.elbow >= BEND_MIN_DEGREES, `elbows stayed straight (${seen})`);
      assert.ok(flight.knee >= BEND_MIN_DEGREES, `knees stayed straight (${seen})`);
      assert.ok(flight.armsDownAt <= ARMS_DOWN_BY_SECONDS, `arms stayed up (${seen})`);
    }
  });

  it("when he has just been thrown, then every part leaves from where he sat in the car the event holds, the class lift included: the seated driver hands over without a jump", async () => {
    for (const id of ["sedan", "monster"] as const) {
      const car = new DeformableCar(paint(), new THREE.Scene(), null, id);
      assignClass(car, STYLE_CLASS[id]);
      for (const shot of SHOTS) {
        // The car the event holds: at his torso point (no car-local offset), its turn his lean out of the windshield undone.
        car.group.position.set(-300, START_HEIGHT, 0);
        car.group.quaternion.copy(shot.quat).multiply(LEAN.clone().invert());
        const { sys, doll } = await thrown(shot, undefined, car);
        const { off, part } = offSeat(doll, car);
        sys.dispose();
        assert.ok(off < POSE_TOLERANCE, `${id}, ${shot.name}: part ${part} leaves ${off.toFixed(4)} m from where he sat`);
      }
    }
  });

  it(`when two cars have crushed into each other head-on at 56 km/h each and both drivers are thrown, then each leaves from where he is drawn seated that very step, every part within ${SEAT_TOLERANCE * 100} cm`, async () => {
    const sys = new RagdollSystem(new THREE.Scene(), () => {}, () => {});
    await sys.preload();
    const a = makeCar();
    const b = makeCar();
    drive(a, -5, 0, Math.PI / 2, 56 / 3.6, 0);
    drive(b, 5, 0, -Math.PI / 2, -56 / 3.6, 0);
    const w = makeWorld([a, b], false, false, FREEWHEEL);
    for (let f = 0; f < 150 && !(a.crashed && b.crashed); f++) tickWorld(w);
    for (let f = 0; f < CRUSH_FRAMES; f++) tickWorld(w);
    // A forced throw (a mini game's) takes the crushed car as it stands: the same `launch` a disabling hit's does.
    w.world.ejection.throwDriverNow(w.cars, 0);
    w.world.ejection.throwDriverNow(w.cars, 1);
    const seen: { car: number; off: number; part: number }[] = [];
    for (const e of w.world.ejection.take()) {
      sys.launch(e, w.cars);
      seen.push({ car: e.car, ...offSeat(sys["dolls"][sys["lastSlot"]]!, w.cars[e.car]!) });
    }
    sys.dispose();
    const said = seen.map((s) => `car ${s.car}: part ${s.part} ${s.off.toFixed(4)} m`).join("; ");
    assert.ok(a.crashed && b.crashed, "the head-on crushed both");
    assert.equal(seen.length, 2, `both drivers thrown: ${said}`);
    assert.ok(seen.every((s) => s.off < SEAT_TOLERANCE), `a driver leaves from off his drawn seat: ${said}`);
  });

  for (const [name, scale] of [
    ["unscaled", undefined],
    ["on the range minigames' release scale", { forward: 0.4, upward: 0.7, elevation: null }],
  ] as const) {
    it(`when he is thrown ${name}, then his loosened limbs carry the momentum of the rigid launch (his velocity plus spin times each part's offset from his torso as he sat, all ten parts) within ${MOMENTUM_TOLERANCE * 100}%`, async () => {
      for (const shot of SHOTS) {
        const { sys, doll, e } = await thrown(shot, scale);
        const launched = new THREE.Vector3().copy(e.carVel).add(e.rel);
        if (scale) launched.set(launched.x * scale.forward, launched.y * scale.upward, launched.z * scale.forward);
        const expected = new THREE.Vector3();
        const got = new THREE.Vector3();
        const torso = doll.bodies[0]!.translation();
        for (const body of doll.bodies) {
          const m = body.mass();
          const at = body.translation();
          expected.addScaledVector(launched, m).addScaledVector(_p.copy(shot.spin).cross(_r.set(at.x - torso.x, at.y - torso.y, at.z - torso.z)), m);
          const v = body.linvel();
          got.x += m * v.x;
          got.y += m * v.y;
          got.z += m * v.z;
        }
        sys.dispose();
        const off = got.distanceTo(expected);
        assert.ok(off <= MOMENTUM_TOLERANCE * expected.length(), `${shot.name}: momentum off by ${off.toFixed(4)} of ${expected.length().toFixed(1)} kg m/s`);
      }
    });
  }
});

describe("given a dummy placed in the scene rather than thrown from a car", () => {
  it("when it is placed moving, then every part leaves at the one rigid velocity as it always has", async () => {
    const sys = new RagdollSystem(new THREE.Scene(), () => {}, () => {});
    await sys.preload();
    setGround(null);
    sys.update(FRAME, [], true, false, null);
    const v = new THREE.Vector3(6, 4, -2);
    const slot = sys.place(new THREE.Vector3(-300, START_HEIGHT, 0), new THREE.Quaternion(), v, new THREE.Vector3(), Infinity, -1);
    const doll = sys["dolls"][slot]!;
    const speeds = doll.bodies.map((b) => new THREE.Vector3().copy(b.linvel() as THREE.Vector3).distanceTo(v));
    sys.dispose();
    assert.ok(Math.max(...speeds) < 1e-5, `a part leaves ${Math.max(...speeds)} m/s from the placed velocity`);
  });

  it("when it is placed in a slot a loose driver flew in, then it flies exactly as one placed in a fresh world: the loose driver's joint give is gone", async () => {
    const flight = async (afterLoose: boolean) => {
      const sys = new RagdollSystem(new THREE.Scene(), () => {}, () => {});
      await sys.preload();
      setGround(null);
      sys.update(FRAME, [], true, false, null);
      if (afterLoose) {
        sys.launch(ejection(SHOTS[0]!), [makeCar()]);
        for (let f = 0; f < FRAME_HZ; f++) sys.update(FRAME, [], true, false, null);
        sys.reset();
      }
      const tumble = new THREE.Quaternion().setFromAxisAngle(AXIS_X, 1);
      const slot = sys.place(new THREE.Vector3(-300, START_HEIGHT, 0), tumble, new THREE.Vector3(6, 4, -2), new THREE.Vector3(5, 2, 0), Infinity, 0);
      for (let f = 0; f < 2 * FRAME_HZ; f++) sys.update(FRAME, [], true, false, null);
      const pose = sys["dolls"][slot]!.bodies.flatMap((b) => [b.translation().x, b.translation().y, b.translation().z]);
      sys.dispose();
      return pose;
    };
    const fresh = await flight(false);
    const reused = await flight(true);
    const off = Math.max(...fresh.map((x, k) => Math.abs(x - reused[k]!)));
    assert.ok(off === 0, `a part flew ${off.toFixed(4)} m off the fresh world's`);
  });
});
