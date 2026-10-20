import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { applyDrive, idleDrive } from "./car-drive.ts";
import { DeformableCar } from "./car.ts";
import { physicsSlice, sliceSpeed } from "../contact/sat.ts";
import { assertSameDigest, DT, paint } from "./test-support.ts";
import { newWorld, stepWorld } from "../engine/world-step.ts";

/**
 * Every field of a deform as plain data, nested and typed arrays included; −0, NaN and ±Infinity kept apart. The G / P
 * debug views (`helper`, `particleHelper`) are scene objects the view owns, and `kernelIn` / `kernelSet` are the WASM skin's
 * scratch and its style's placed tables (both built on the first skin, the scratch rewritten by each), not the deform's state.
 */
function fields(d: object): unknown {
  const num = (x: unknown) => (typeof x === "number" && (Object.is(x, -0) || !Number.isFinite(x)) ? String(Object.is(x, -0) ? "-0" : x) : x);
  const plain = (k: string, v: unknown) =>
    k === "helper" || k === "particleHelper" || k === "kernelIn" || k === "kernelSet" ? undefined : ArrayBuffer.isView(v) ? Array.from(v as Float64Array, num) : v instanceof Map ? [...v] : num(v);
  return JSON.parse(JSON.stringify(d, plain));
}

describe("given two cars that have crashed head-on at 20 m/s each for 90 frames, and a car that never crashed", () => {
  it("when the crashed car is reset and the never-crashed one is reset too, then every deform field of the two is identical (hit clocks, pose, hulls, buffers, clusters)", () => {
    const scene = new THREE.Scene();
    const built = new DeformableCar(paint(), scene);
    const a = new DeformableCar(paint(), scene);
    const b = new DeformableCar(paint(), scene);
    a.spawnFacing(0, -6, 0, 20);
    b.spawnFacing(0, 6, Math.PI, 20);
    const w = newWorld([a, b]);
    for (let f = 0; f < 90; f++) {
      for (let acc = DT; acc > 1e-5; ) {
        const h = physicsSlice(acc, sliceSpeed(w.cars));
        stepWorld(w, h);
        acc -= h;
      }
      for (const car of w.cars) car.updateSkin();
    }
    assert.ok(a.crashed && a.deform.massActive, "the head-on never crashed the car");
    a.resetVisual();
    built.resetVisual();
    assertSameDigest(fields(a.deform), fields(built.deform), "deform after reset");
  });
});

/** Seconds of gas, full lock and handbrake at `HARD_SPEED_MS`: long enough to build a slide, a wheelspin and the handbrake's ramp. */
const HARD_S = 0.6;
const HARD_SPEED_MS = 20;

describe("given a car that has driven hard (gas, full lock and the handbrake at 20 m/s)", () => {
  it("when it is put on a spot again, then every field of its drive is a built car's: no wheel, pedals, wheelspin, slide, grip or ramp carried over", () => {
    const car = new DeformableCar(paint(), new THREE.Scene());
    car.spawnFacing(0, 0, 0, HARD_SPEED_MS);
    const input = { ...idleDrive(), throttle: 1, steer: 1, ebrake: true };
    for (let t = 0; t < HARD_S - 1e-9; t += DT) {
      car.velocity.set(car.fwdFlat.x * HARD_SPEED_MS, 0, car.fwdFlat.z * HARD_SPEED_MS);
      applyDrive(car, input, DT);
    }
    for (const key of ["steer", "throttle", "drift", "ebrakeK"] as const) assert.ok(car.drive[key] !== 0, `the control: ${key} is ${car.drive[key]} before the respawn`);
    car.spawnFacing(10, 10, 1, 0);
    for (const [key, value] of Object.entries(car.drive)) assert.equal(value, typeof value === "boolean" ? false : -0, key);
  });
});
