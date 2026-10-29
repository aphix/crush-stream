import { describe, expect, it } from "vitest";
import * as THREE from "three";
import "../kernel/rapier-node.test-util.ts";
import { makeCar } from "../contact/crash-scenarios.test-util.ts";
import { FRAME_HZ } from "../kernel/constants.ts";
import { blankEjection, type Ejection } from "../vehicle/ejection.ts";
import type { RagdollSystem } from "./engine-ragdoll.ts";
import { ARM, type Doll, PARTS, SHOULDER_Y } from "./ragdoll-body.ts";
import { hinge } from "./ragdoll-pose.test-util.ts";
import { flatSystem } from "./ragdoll-throws.test-util.ts";
import type { ReleaseScale } from "./ragdoll-boxes.ts";

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
/** How near (m, rad) the launch pose is to the standing dummy laid out at the ejection's torso point and turned (an f32 body position at 300 m). */
const POSE_TOLERANCE = 1e-4;
/** Height (m) the ejections start at: far over the sand, so the first second is all air. */
const START_HEIGHT = 12;
const _q = new THREE.Quaternion();

const AXIS_X = new THREE.Vector3(1, 0, 0);
const LEAN = new THREE.Quaternion().setFromAxisAngle(AXIS_X, (80 * Math.PI) / 180);
const SIDE = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2).multiply(LEAN);
const ARM_OVER = new THREE.Quaternion().setFromAxisAngle(AXIS_X, Math.PI);

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

/** A ragdoll system on flat sand with no cars, `shot` thrown out of a car (through `launch`, as the sim does); the doll in slot 0. */
async function thrown(shot: (typeof SHOTS)[number], scale?: ReleaseScale): Promise<{ sys: RagdollSystem; doll: Doll; e: Ejection }> {
  const sys = await flatSystem();
  const e = ejection(shot);
  if (scale) sys.launch(e, [makeCar()], true, scale);
  else sys.launch(e, [makeCar()]);
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

/** Part `k`'s centre from the torso's, rigidly turned with it: the standing layout, the arms raised over the head about their shoulders (`spawn`'s own recipe). */
function offset(k: number, q: THREE.Quaternion, into: THREE.Vector3): THREE.Vector3 {
  const c = PARTS[k]!.c;
  const t0 = PARTS[0].c;
  return into.set(c[0] - t0[0], (ARM(k) ? 2 * SHOULDER_Y - c[1] : c[1]) - t0[1], c[2] - t0[2]).applyQuaternion(q);
}

describe("given a driver thrown out of a car", () => {
  it(`when he flies, then in the first ${FLIGHT_SECONDS} s an elbow and a knee each bend at least ${BEND_MIN_DEGREES}° and both forearms drop below the shoulder line by ${ARMS_DOWN_BY_SECONDS} s, in each of the four ejections`, async () => {
    for (const shot of SHOTS) {
      const { sys, doll } = await thrown(shot);
      const flight = fly(sys, doll);
      sys.dispose();
      const seen = `${shot.name}: elbow ${flight.elbow.toFixed(0)}°, knee ${flight.knee.toFixed(0)}°, arms down at ${flight.armsDownAt.toFixed(2)} s`;
      expect(flight.elbow, `elbows stayed straight (${seen})`).toBeGreaterThanOrEqual(BEND_MIN_DEGREES);
      expect(flight.knee, `knees stayed straight (${seen})`).toBeGreaterThanOrEqual(BEND_MIN_DEGREES);
      expect(flight.armsDownAt, `arms stayed up (${seen})`).toBeLessThanOrEqual(ARMS_DOWN_BY_SECONDS);
    }
  });

  it("when he has just been thrown, then every part is where the dive puts it: the standing layout turned with his torso, arms raised over his head, joints straight", async () => {
    for (const shot of SHOTS) {
      const { sys, doll, e } = await thrown(shot);
      for (const [k, body] of doll.bodies.entries()) {
        const at = offset(k, e.quat, _r).add(e.pos);
        const was = body.translation();
        expect(_p.set(was.x, was.y, was.z).distanceTo(at), `${shot.name}: part ${k} is ${_p.distanceTo(at).toFixed(4)} m from the dive's layout`).toBeLessThan(POSE_TOLERANCE);
        const turned = new THREE.Quaternion().copy(e.quat);
        if (ARM(k)) turned.multiply(ARM_OVER);
        const r = body.rotation();
        const sign = turned.dot(_q.set(r.x, r.y, r.z, r.w)) < 0 ? -1 : 1;
        const off = Math.max(Math.abs(turned.x - sign * r.x), Math.abs(turned.y - sign * r.y), Math.abs(turned.z - sign * r.z), Math.abs(turned.w - sign * r.w));
        expect(off, `${shot.name}: part ${k} is turned ${off.toFixed(5)} off the dive's layout`).toBeLessThan(POSE_TOLERANCE);
      }
      sys.dispose();
    }
  });

  const momentumCases = [
    { it: `when he is thrown unscaled, then his loosened limbs carry the momentum of the rigid launch (his velocity plus spin times each part's offset, all ten parts) within ${MOMENTUM_TOLERANCE * 100}%`, scale: undefined },
    { it: `when he is thrown on the range minigames' release scale, then his loosened limbs carry the momentum of the rigid launch (his velocity plus spin times each part's offset, all ten parts) within ${MOMENTUM_TOLERANCE * 100}%`, scale: { forward: 0.4, upward: 0.7, elevation: null } },
  ] as const;

  for (const { it: title, scale } of momentumCases) {
    it(title, async () => {
      for (const shot of SHOTS) {
        const { sys, doll, e } = await thrown(shot, scale);
        const launched = new THREE.Vector3().copy(e.carVel).add(e.rel);
        if (scale) launched.set(launched.x * scale.forward, launched.y * scale.upward, launched.z * scale.forward);
        const expected = new THREE.Vector3();
        const got = new THREE.Vector3();
        for (const [k, body] of doll.bodies.entries()) {
          const m = body.mass();
          expected.addScaledVector(launched, m).addScaledVector(_p.copy(shot.spin).cross(offset(k, e.quat, _r)), m);
          const v = body.linvel();
          got.x += m * v.x;
          got.y += m * v.y;
          got.z += m * v.z;
        }
        sys.dispose();
        const off = got.distanceTo(expected);
        expect(off, `${shot.name}: momentum off by ${off.toFixed(4)} of ${expected.length().toFixed(1)} kg m/s`).toBeLessThanOrEqual(MOMENTUM_TOLERANCE * expected.length());
      }
    });
  }
});

describe("given a dummy placed in the scene rather than thrown from a car", () => {
  it("when it is placed moving, then every part leaves at the one rigid velocity as it always has", async () => {
    const sys = await flatSystem();
    const v = new THREE.Vector3(6, 4, -2);
    const slot = sys.place(new THREE.Vector3(-300, START_HEIGHT, 0), new THREE.Quaternion(), v, new THREE.Vector3(), Infinity, -1);
    const doll = sys["dolls"][slot]!;
    const speeds = doll.bodies.map((b) => new THREE.Vector3().copy(b.linvel() as THREE.Vector3).distanceTo(v));
    sys.dispose();
    expect(Math.max(...speeds), `a part leaves ${Math.max(...speeds)} m/s from the placed velocity`).toBeLessThan(1e-5);
  });

  it("when it is placed in a slot a loose driver flew in, then it flies exactly as one placed in a fresh world: the loose driver's joint give is gone", async () => {
    const flight = async (afterLoose: boolean) => {
      const sys = await flatSystem();
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
    expect(off, `a part flew ${off.toFixed(4)} m off the fresh world's`).toBe(0);
  });
});
