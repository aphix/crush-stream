import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { firstMismatch } from "../kernel/compare-arrays.test-util.ts";
import { FINE_HZ } from "../kernel/constants.ts";
import { fleetClass, fleetStyle } from "../scenes/fleet.ts";
import { DeformableCar } from "../vehicle/car.ts";
import { STOCK_PAINT } from "../vehicle/constants.ts";
import { assignClass } from "../vehicle/vehicle-classes.ts";
import { warmCrashPath } from "./crash-warm.ts";
import { newWorld, settleStep, stepWorld } from "./world-step.ts";

/** Fleet slot, x, z, yaw and speed of each car of the probe crash: a head-on of two styles and a monster truck t-boning them. */
const PROBE_CARS = [
  [0, 0, -6, 0, 14],
  [3, 0, 6, Math.PI, 14],
  [5, -7, 0, Math.PI / 2, 10],
] as const;

/** Every car's pose, velocity and masses after the probe crash runs for half a second. */
function probeCrash(): number[] {
  const scene = new THREE.Scene();
  const cars = PROBE_CARS.map(([slot, x, z, yaw, speed]) => {
    const car = new DeformableCar({ ...STOCK_PAINT, name: "probe" }, scene, null, fleetStyle(slot));
    assignClass(car, fleetClass(slot));
    car.spawnFacing(x, z, yaw, speed);
    return car;
  });
  const world = newWorld(cars);
  for (let step = 0; step < FINE_HZ / 2; step++) {
    stepWorld(world, 1 / FINE_HZ);
    settleStep(cars, 1 / FINE_HZ, true);
  }
  const out: number[] = [];
  for (const car of cars) {
    const { position, quaternion } = car.group;
    out.push(position.x, position.y, position.z, quaternion.x, quaternion.y, quaternion.z, quaternion.w, car.velocity.x, car.velocity.y, car.velocity.z);
    for (const mass of car.deform.masses) out.push(mass.world.x, mass.world.y, mass.world.z, mass.vel.x, mass.vel.z);
    car.dispose();
  }
  return out;
}

describe("given the crash path's boot warm-up", () => {
  // mutation: sed -i 's/^const PILE_SECONDS = 0.6;/const PILE_SECONDS = 0.1;/' src/game/engine/crash-warm.ts
  it("when it runs, then every car of its pile has crashed and its masses are loose: it compiles the crash path it is for", () => {
    expect(warmCrashPath()).toBe(true);
  });

  it("when a three-car crash is run before the warm-up and again after it, then every pose, velocity and mass is bit-identical (guard)", () => {
    const before = probeCrash();
    expect(before.length, "the probe has cars and masses to compare").toBeGreaterThan(100);
    warmCrashPath();
    expect(firstMismatch(probeCrash(), before), "first value that differs after the warm-up").toBeUndefined();
  });
});
