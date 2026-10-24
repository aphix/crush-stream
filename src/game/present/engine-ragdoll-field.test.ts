import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import "../kernel/rapier-node.test-util.ts";
import type { RigidBody } from "@dimforge/rapier3d-simd";
import { FREEWHEEL, launch, makeCar, makeWorld, tickWorld } from "../contact/crash-scenarios.test-util.ts";
import { blankEjection } from "../vehicle/ejection.ts";
import type { DeformableCar } from "../vehicle/car.ts";
import { RagdollSystem } from "./engine-ragdoll.ts";
import { FRAME_HZ } from "../kernel/constants.ts";
import { allocatedBytes, COMPILE_WAIT_S, untilQuiet } from "../kernel/alloc-sample.test-util.ts";

/**
 * A 32-car field: every car drives a ring around the middle (no car physics; the dummies only read the cars' poses),
 * and drivers are thrown up out of their windshields. Allocation is the bytes V8's sampling heap profiler sees made, dead or alive.
 */
const CARS = 32;
const FRAME = 1 / FRAME_HZ;
const UP = new THREE.Vector3(0, 1, 0);

function field(): { cars: DeformableCar[]; drive: (t: number) => void } {
  const cars: DeformableCar[] = [];
  for (let i = 0; i < CARS; i++) cars.push(makeCar());
  const drive = (t: number) => {
    for (let i = 0; i < CARS; i++) {
      const c = cars[i]!;
      const r = 12 + (i % 8) * 4;
      const w = (14 / r) * (i % 2 ? 1 : -1);
      const a = w * t + (i * 2 * Math.PI) / CARS;
      c.group.position.set(Math.cos(a) * r, 0, Math.sin(a) * r);
      c.velocity.set(-Math.sin(a) * r * w, 0, Math.cos(a) * r * w);
      c.group.quaternion.setFromAxisAngle(UP, Math.atan2(c.velocity.x, c.velocity.z));
      c.group.updateMatrixWorld();
    }
  };
  return { cars, drive };
}

/** Car `i`'s driver out of the windshield, 6 m/s up and 3 m/s ahead of the car. */
function throwOut(ragdolls: RagdollSystem, cars: DeformableCar[], i: number): void {
  const c = cars[i]!;
  const e = blankEjection();
  e.car = i;
  e.dir.set(0, 0, 1).applyQuaternion(c.group.quaternion);
  e.pos.copy(c.group.position).addScaledVector(UP, 1.3).addScaledVector(e.dir, 0.6);
  e.quat.copy(c.group.quaternion);
  e.rel.copy(e.dir).multiplyScalar(3).addScaledVector(UP, 6);
  e.carVel.copy(c.velocity);
  e.spin.set(3, 0, 0);
  ragdolls.launch(e, cars);
}

/** Frames of a flight before the measured ones: the throw's own launch frames. */
const LAUNCH_FRAMES = 4;
/** Frames of a flight the allocation is read over, and the flights run first so the code is warm. */
const MEASURED_FRAMES = 40;
const WARM_FLIGHTS = 6;
/** Vectors the control makes each frame: over 100 B each, so 1200 are more than the biggest bar. */
const CONTROL_VECTORS = 1200;

/**
 * `thrown` drivers thrown out of the field's first cars. `kbPerFrame` flies them again from the launch and reads what the dummies allocate over `MEASURED_FRAMES` frames after
 * `LAUNCH_FRAMES` (KB a frame, dead or alive; `extra` is more work each frame); `lowestTorso` is the lowest a torso reached in the frames it read.
 */
async function flightRig(thrown: number) {
  const { cars, drive } = field();
  const ragdolls = new RagdollSystem(new THREE.Scene(), () => {}, () => {});
  drive(0);
  await ragdolls.preload();
  const dolls = ragdolls["dolls"];
  let lowestTorso = Infinity;
  const launch = (): void => {
    ragdolls.reset();
    drive(0);
    for (let k = 0; k < thrown; k++) throwOut(ragdolls, cars, k);
  };
  const fly = (from: number, to: number, extra: () => void): void => {
    for (let f = from; f < to; f++) {
      drive((f + 1) * FRAME);
      ragdolls.update(FRAME, cars, true, false, null);
      extra();
      if (f >= LAUNCH_FRAMES) for (let k = 0; k < thrown; k++) lowestTorso = Math.min(lowestTorso, dolls[k]!.cur[1]!);
    }
  };
  const nothing = (): void => {};
  for (let warm = 0; warm < WARM_FLIGHTS; warm++) {
    launch();
    fly(0, LAUNCH_FRAMES + MEASURED_FRAMES + 6, nothing);
  }
  lowestTorso = Infinity;
  return {
    dispose: () => ragdolls.dispose(),
    lowestTorso: () => lowestTorso,
    kbPerFrame: (extra: () => void = nothing): number => {
      launch();
      fly(0, LAUNCH_FRAMES, nothing);
      return allocatedBytes(() => fly(LAUNCH_FRAMES, LAUNCH_FRAMES + MEASURED_FRAMES, extra)) / MEASURED_FRAMES / 1024;
    },
  };
}

const flightAllocCases = [
  { it: "when one driver is thrown and flies for 40 frames, then the dummies allocate at most 75 KB per frame", thrown: 1, boundKb: 75 },
  { it: "when four drivers are thrown and fly for 40 frames, then the dummies allocate at most 125 KB per frame", thrown: 4, boundKb: 125 },
] as const;

describe("given 32 cars driving around the middle of an open field and drivers thrown out of their windshields", () => {
  for (const testCase of flightAllocCases) {
    it(testCase.it, async () => {
      const rig = await flightRig(testCase.thrown);
      const kb = untilQuiet(() => rig.kbPerFrame(), testCase.boundKb);
      rig.dispose();
      assert.ok(rig.lowestTorso() > 1.5, `the dummies were down to ${rig.lowestTorso().toFixed(2)} m: not a flight`);
      assert.ok(kb <= testCase.boundKb, `${kb.toFixed(1)} KB per frame > ${testCase.boundKb} in every flight for ${COMPILE_WAIT_S} s`);
    });
  }

  it("when each frame of a flight also makes a vector hundreds of times over, then the allocation reads over the biggest bar", async () => {
    const rig = await flightRig(1);
    const kept: THREE.Vector3[] = [];
    const kb = rig.kbPerFrame(() => {
      for (let i = 0; i < CONTROL_VECTORS; i++) kept[i % 8] = new THREE.Vector3();
    });
    rig.dispose();
    assert.ok(kb > Math.max(...flightAllocCases.map((c) => c.boundKb)), `${kb.toFixed(0)} KB per frame for ${CONTROL_VECTORS} vectors a frame: the measure sees nothing`);
  });

  it("when a car comes at a dummy lying 40 m ahead of it at 25 m/s, then it strikes him and shoves him at least 3 m", async () => {
    const car = makeCar("shape", 0.32, 0.45);
    launch(car, -40, 0, Math.PI / 2, 0, 0);
    const w = makeWorld([car], false, false, FREEWHEEL);
    const ragdolls = new RagdollSystem(new THREE.Scene(), () => {}, () => {});
    await ragdolls.preload();
    const frame = () => {
      tickWorld(w);
      ragdolls.update(FRAME, [car], true, false, null);
    };
    frame();
    ragdolls["spawn"]({ car: 5, p: new THREE.Vector3(0, 0.3, 0), q: new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2), v: new THREE.Vector3(), w: new THREE.Vector3(), age: 0, cop: false, rides: true });
    const torso: RigidBody = ragdolls["dolls"][0]!.bodies[0]!;
    for (let f = 0; f < 30; f++) frame();
    launch(car, -40, 0, Math.PI / 2, 25, 0);
    for (let f = 0; f < 180; f++) frame();
    const x = torso.translation().x;
    ragdolls.dispose();
    assert.ok(x > 3, `the car shoved him ${x.toFixed(1)} m`);
  });
});
