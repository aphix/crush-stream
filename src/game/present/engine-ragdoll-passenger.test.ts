import { describe, expect, it } from "vitest";
import * as THREE from "three";
import "../kernel/rapier-node.test-util.ts";
import type { RigidBody } from "@dimforge/rapier3d-simd";
import type { Ejection } from "../vehicle/ejection.ts";
import { FREEWHEEL, launch, makeCar, makeWorld, tickWorld } from "../contact/crash-scenarios.test-util.ts";
import { armKill, DEFAULT_REALISM } from "../vehicle/vehicle-classes.ts";
import { FRAME_HZ } from "../kernel/constants.ts";
import type { DriverLook } from "./driver-look.ts";
import { RagdollSystem, type Throw } from "./engine-ragdoll.ts";
import { flatSystem, loadedRagdolls } from "./ragdoll-throws.test-util.ts";

const HEAD_ON_MPS = 20;
const SETTLE_FRAMES = 60;
const FIRST_WORKER_ID = 7;
const PASSENGER: DriverLook = { woman: false, shirt: 0x1f3463, pants: 0x1f3463, hair: 0xe8bf6c, hat: null, mustache: false, portly: true };
/** Two drivers of one head-on, thrown at each other: 3 m apart at 6 m/s each, they meet 0.12 s in, inside their 0.35 s grace. */
const MEET_APART = 3;
const MEET_MPS = 6;

/** A fleet-armed sedan head-on pair, played until a driver is thrown: the cars and the ejections that came out. */
function headOnEjections() {
  const cars = [makeCar(), makeCar()];
  for (const car of cars) {
    car.deform.setMode("shape");
    car.deform.squash = 0.32;
    car.deform.buckle = 0.45;
    armKill(car.deform, "sedan", DEFAULT_REALISM, "default");
  }
  launch(cars[0]!, -5, 0, Math.PI / 2, HEAD_ON_MPS, 0);
  launch(cars[1]!, 5, 0, -Math.PI / 2, -HEAD_ON_MPS, 0);
  const world = makeWorld(cars, false, false, FREEWHEEL);
  const ejections: Ejection[] = [];
  world.onEject = (e) => ejections.push(e);
  for (let f = 0; f < SETTLE_FRAMES; f++) tickWorld(world);
  return { cars, ejections };
}

/** A ragdoll system whose dummies' world is a worker that only records the throws sent to it (the worker mode of a race course). */
function systemWithWorker() {
  const sent: { t: Throw; purse: boolean }[] = [];
  const worker = {
    throwDummy: (t: Throw, purse: boolean) => {
      sent.push({ t: { ...t, p: t.p.clone(), v: t.v.clone() }, purse });
      return FIRST_WORKER_ID + sent.length - 1;
    },
  };
  const ragdolls = new RagdollSystem(new THREE.Scene(), () => {}, () => {});
  ragdolls["mode"] = "remote";
  Object.assign(ragdolls, { remote: worker });
  return { ragdolls, sent };
}

describe("given a race course's dummies simulated off the main thread and a driver thrown from his car", () => {
  it("when his passenger is thrown with him, then a second dummy is thrown beside the driver at the driver's own velocity, dressed as the passenger", () => {
    const { cars, ejections } = headOnEjections();
    expect(ejections.length, "a driver was thrown in the head-on").toBeGreaterThanOrEqual(1);
    const { ragdolls, sent } = systemWithWorker();
    const e = ejections[0]!;
    ragdolls.launch(e, cars);
    ragdolls.throwPassenger(e.car, PASSENGER);
    expect(sent.length, "the driver's and his passenger's throws reached the worker").toBe(2);
    const driver = sent[0]!;
    const passenger = sent[1]!;
    const apart = driver.t.p.distanceTo(passenger.t.p);
    expect(apart > 0.5 && apart < 1, `the passenger starts ${apart.toFixed(2)} m from the driver`).toBeTruthy();
    expect(driver.t.v.distanceTo(passenger.t.v), "he leaves at the driver's velocity").toBeLessThan(1e-9);
    expect(passenger.purse, "no purse for him").toBe(false);
    expect(ragdolls["dressing"].get(FIRST_WORKER_ID + 1)?.look.portly, "the worker's slot for him is dressed as the passenger").toBe(true);
  });

  it("when a passenger is thrown with a car whose driver was not thrown, then no second dummy is thrown", () => {
    const { cars, ejections } = headOnEjections();
    const { ragdolls, sent } = systemWithWorker();
    const e = ejections[0]!;
    ragdolls.launch(e, cars);
    ragdolls.throwPassenger(1 - e.car, PASSENGER);
    expect(sent.length, "only the driver's own throw").toBe(1);
  });

  it("when the other car's driver is thrown after his in the same frame, then his passenger is still thrown with him, beside him", () => {
    const { cars, ejections } = headOnEjections();
    expect(ejections.length, "both drivers are thrown in the head-on").toBeGreaterThanOrEqual(2);
    const { ragdolls, sent } = systemWithWorker();
    for (const e of ejections) ragdolls.launch(e, cars);
    const first = ejections[0]!;
    ragdolls.throwPassenger(first.car, PASSENGER);
    expect(sent.length, "every driver's throw and the passenger's reached the worker").toBe(ejections.length + 1);
    const driver = sent[0]!;
    const passenger = sent[ejections.length]!;
    const apart = driver.t.p.distanceTo(passenger.t.p);
    expect(apart > 0.5 && apart < 1, `the passenger starts ${apart.toFixed(2)} m from his own driver, not the later one`).toBeTruthy();
    expect(driver.t.v.distanceTo(passenger.t.v), "he leaves at his driver's velocity").toBeLessThan(1e-9);
  });
});

describe("given the dummies simulated on the main thread (the fallback, and every scene that is not a race course) and a driver thrown from his car", () => {
  it("when his passenger is thrown with him, then two dummies are out in the one world, the second beside the first", async () => {
    const { cars, ejections } = headOnEjections();
    const ragdolls = await loadedRagdolls();
    const e = ejections[0]!;
    ragdolls.launch(e, cars);
    ragdolls.throwPassenger(e.car, PASSENGER);
    const dolls: { live: boolean; bodies: { translation(): THREE.Vector3Like }[] }[] = ragdolls["dolls"];
    const out = dolls.filter((d) => d.live);
    expect(out.length, "the driver and his passenger").toBe(2);
    const a = out[0]!.bodies[0]!.translation();
    const b = out[1]!.bodies[0]!.translation();
    const apart = Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
    expect(apart > 0.5 && apart < 1, `the passenger starts ${apart.toFixed(2)} m from the driver`).toBeTruthy();
  });
});

/** The deepest any part of `a` sinks into any part of `b` (m; 0 when apart). */
function overlap(a: RigidBody[], b: RigidBody[]): number {
  let deepest = 0;
  for (const p of a) for (const q of b) deepest = Math.max(deepest, -(p.collider(0).contactCollider(q.collider(0), 0)?.distance ?? 0));
  return deepest;
}

describe("given two dummies thrown from two cars straight at each other, both in their first moments out", () => {
  it("when they meet, then they hit (no part sinks 10 cm into the other) and each comes down on his own side, within 1 m of the middle", async () => {
    const ragdolls = await flatSystem();
    const lying = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), -Math.PI / 2);
    const facing = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI).multiply(lying);
    for (const [car, side] of [-1, 1].entries()) {
      const q = side < 0 ? lying : facing;
      ragdolls.spawn({ car, p: new THREE.Vector3((side * MEET_APART) / 2, 1.2, 0), q, v: new THREE.Vector3(-side * MEET_MPS, 1, 0), w: new THREE.Vector3(), age: 0, cop: false, rides: true });
    }
    const [a, b]: { bodies: RigidBody[] }[] = ragdolls["dolls"];
    let deepest = 0;
    for (let f = 0; f < 3 * FRAME_HZ; f++) {
      ragdolls.update(1 / FRAME_HZ, [], true, false, null);
      deepest = Math.max(deepest, overlap(a!.bodies, b!.bodies));
    }
    const xa = a!.bodies[0]!.translation().x;
    const xb = b!.bodies[0]!.translation().x;
    ragdolls.dispose();
    expect(deepest, `a part sank ${(deepest * 100).toFixed(0)} cm into the other dummy`).toBeLessThan(0.1);
    expect(xa > -1 && xa < 0 && xb > 0 && xb < 1, `they came down at x ${xa.toFixed(2)} and ${xb.toFixed(2)} m (thrown from ∓${MEET_APART / 2})`).toBeTruthy();
  });
});

describe("given two dummies thrown from one car (a driver and his passenger), both in their first moments out, the second straight at the first", () => {
  it("when the second reaches the first, then he hits him (no part sinks 10 cm into him) and his torso stops short of the first's instead of passing through", async (t) => {
    const ragdolls = await flatSystem();
    const lying = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), -Math.PI / 2);
    ragdolls.spawn({ car: 0, p: new THREE.Vector3(0, 1.2, 0), q: lying, v: new THREE.Vector3(), w: new THREE.Vector3(), age: 0, cop: false, rides: true });
    ragdolls.spawn({ car: 0, p: new THREE.Vector3(-MEET_APART / 2, 1.2, 0), q: lying, v: new THREE.Vector3(MEET_MPS, 0, 0), w: new THREE.Vector3(), age: 0, cop: false, rides: true });
    const [a, b]: { bodies: RigidBody[] }[] = ragdolls["dolls"];
    let deepest = 0;
    let ahead = -Infinity;
    for (let f = 0; f < FRAME_HZ / 2; f++) {
      ragdolls.update(1 / FRAME_HZ, [], true, false, null);
      deepest = Math.max(deepest, overlap(a!.bodies, b!.bodies));
      ahead = Math.max(ahead, b!.bodies[0]!.translation().x - a!.bodies[0]!.translation().x);
    }
    ragdolls.dispose();
    t.annotate(`deepest ${(deepest * 100).toFixed(1)} cm; the second torso got to ${ahead.toFixed(2)} m of the first's`);
    expect(deepest, `a part sank ${(deepest * 100).toFixed(0)} cm into the other dummy`).toBeLessThan(0.1);
    expect(ahead, `the second torso got ${ahead.toFixed(2)} m past the first's`).toBeLessThan(0);
  });
});
