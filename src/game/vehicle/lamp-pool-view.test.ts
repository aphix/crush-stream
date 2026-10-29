import { describe, it } from "vitest";
import assert from "node:assert/strict";
import * as THREE from "three";
import { DeformableCar } from "./car.ts";
import { LampLights } from "./lamp-lights.ts";
import { paint } from "./test-support.ts";

/** Lamp order inside the car: head L, head R. */
const HEADS = [0, 1] as const;
const _p = new THREE.Vector3();
const _d = new THREE.Vector3();

/** Whether headlamp `i` of `car` has a real spot on it, or a fake pool drawn for it (an instance whose near edge sits at the lamp's foot), this frame. */
function lit(lights: LampLights, car: DeformableCar, i: number): boolean {
  car.lampWorld(i, _p, _d);
  for (let k = 0; k < lights.spots.length; k++) {
    const s = lights.spots[k]!;
    if (s.intensity > 0 && _p.distanceTo(s.position) < 1e-6) return true;
  }
  const m = lights.pools.instanceMatrix.array;
  for (let k = 0; k < lights.pools.count; k++) {
    if (Math.abs(m[k * 16 + 12]! - _p.x) < 1e-4 && Math.abs(m[k * 16 + 14]! - _p.z) < 1e-4) return true;
  }
  return false;
}

function camera(): THREE.PerspectiveCamera {
  return new THREE.PerspectiveCamera(56, 16 / 9, 0.1, 400);
}

describe("given 1 to 3 still cars side by side, all facing the same way, and a camera orbiting them", () => {
  for (const n of [1, 2, 3]) {
    it(`when the camera orbits ${n} car(s) once at 9 m, then no headlamp's light switches on or off as the view turns`, () => {
      const scene = new THREE.Scene();
      const cars: DeformableCar[] = [];
      for (let c = 0; c < n; c++) {
        const car = new DeformableCar(paint(), scene);
        car.spawnFacing((c - (n - 1) / 2) * 3, 0, 0, 0);
        car.group.updateMatrixWorld(true);
        cars.push(car);
      }
      const lights = new LampLights(scene, 4 * n);
      const cam = camera();
      const first: boolean[] = [];
      for (let f = 0; f <= 360; f++) {
        const a = (f * Math.PI) / 180;
        cam.position.set(Math.sin(a) * 9, 3, Math.cos(a) * 9);
        cam.lookAt(0, 0.5, 0);
        cam.updateMatrixWorld(true);
        lights.update(cars, cam, null, 0);
        for (let c = 0; c < n; c++) {
          for (const i of HEADS) {
            const on = lit(lights, cars[c]!, i);
            const k = c * 2 + i;
            if (f === 0) first[k] = on;
            else assert.equal(on, first[k], `car ${c} headlamp ${i === 0 ? "L" : "R"} turned ${on ? "on" : "off"} at ${f} deg of the orbit`);
          }
        }
      }
      for (let k = 0; k < first.length; k++) assert.ok(first[k], `car ${k >> 1} headlamp ${k & 1 ? "R" : "L"} has no light at all`);
    });
  }
});

describe("given a fixed camera looking across a road and one car driving through the middle of the frame", () => {
  for (const dir of [1, -1]) {
    it(`when the car crosses ${dir > 0 ? "left to right" : "right to left"} at 15 m/s, then both headlamps stay lit every frame`, () => {
      const scene = new THREE.Scene();
      const car = new DeformableCar(paint(), scene);
      const lights = new LampLights(scene, 4);
      const cam = camera();
      cam.position.set(0, 2, 14);
      cam.lookAt(0, 0.5, 0);
      cam.updateMatrixWorld(true);
      const yaw = dir > 0 ? Math.PI / 2 : -Math.PI / 2;
      for (let f = 0; f <= 120; f++) {
        const x = dir * (-15 + f * 0.25);
        car.spawnFacing(x, 0, yaw, 0);
        car.group.updateMatrixWorld(true);
        lights.update([car], cam, null, 0);
        for (const i of HEADS) assert.ok(lit(lights, car, i), `headlamp ${i === 0 ? "L" : "R"} dark at x=${x.toFixed(2)} (frame ${f})`);
      }
    });
  }
});
