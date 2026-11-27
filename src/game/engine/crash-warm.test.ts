import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { firstMismatch } from "../kernel/compare-arrays.test-util.ts";
import { FINE_HZ } from "../kernel/constants.ts";
import { fleetClass, fleetStyle } from "../scenes/fleet.ts";
import { DeformableCar } from "../vehicle/car.ts";
import { STOCK_PAINT } from "../vehicle/constants.ts";
import { EjectionWatch } from "../vehicle/ejection.ts";
import { assignClass } from "../vehicle/vehicle-classes.ts";
import { crashWarmWanted, warmCrashPath } from "./crash-warm.ts";
import { newWorld, settleStep, stepWorld } from "./world-step.ts";

/** Fleet slot, x, z, yaw and speed of each car of the probe crash: a head-on of two styles and a monster truck t-boning them. */
const PROBE_CARS = [
  [0, 0, -6, 0, 14],
  [3, 0, 6, Math.PI, 14],
  [5, -7, 0, Math.PI / 2, 10],
] as const;

/** Every car's pose, velocity, masses and skinned body after the probe crash, run as the warm-up runs its own: a lone-car race world with an ejection watch, the skin written each frame. */
function probeCrash(): number[] {
  const scene = new THREE.Scene();
  const cars = PROBE_CARS.map(([slot, x, z, yaw, speed]) => {
    const car = new DeformableCar({ ...STOCK_PAINT, name: "probe" }, scene, null, fleetStyle(slot));
    assignClass(car, fleetClass(slot));
    car.spawnFacing(x, z, yaw, speed);
    return car;
  });
  const world = newWorld(cars, null, new EjectionWatch());
  world.lone = true;
  for (let step = 0; step < FINE_HZ / 2; step++) {
    stepWorld(world, 1 / FINE_HZ);
    settleStep(cars, 1 / FINE_HZ, true);
    if (step % (FINE_HZ / 60) === FINE_HZ / 60 - 1) for (const car of cars) car.updateSkin();
  }
  const out: number[] = [];
  for (const car of cars) {
    const { position, quaternion } = car.group;
    out.push(position.x, position.y, position.z, quaternion.x, quaternion.y, quaternion.z, quaternion.w, car.velocity.x, car.velocity.y, car.velocity.z);
    for (const mass of car.deform.masses) out.push(mass.world.x, mass.world.y, mass.world.z, mass.vel.x, mass.vel.z);
    out.push(...car.body.geometry.getAttribute("position").array);
    car.dispose();
  }
  return out;
}

describe("given the crash path's boot warm-up", () => {
  // mutation: sed -i 's/^const PILE_SECONDS = 0.6;/const PILE_SECONDS = 0.1;/' src/game/engine/crash-warm.ts
  it("when a three-car crash (a head-on and a t-bone) is run before the warm-up and again after it, then the warm-up crashed every car of its pile and nothing of the crash, skin or body differs", () => {
    const before = probeCrash();
    expect(before.length, "the probe has cars and masses to compare").toBeGreaterThan(100);
    expect(warmCrashPath(), "every car of the pile crashed with its masses loose, else it no longer compiles the crash path").toBe(true);
    expect(firstMismatch(probeCrash(), before), "first value that differs after the warm-up").toBeUndefined();
  });
});

describe("given the Vitest app project", () => {
  // mutation: sed -i 's/process.env.CRASH_WARM !== "off"/true/' src/game/engine/crash-warm.ts
  it("when a boot asks whether to run the crash warm-up, then it is told no here (each file boots one engine) and yes once the switch is not set", () => {
    expect(crashWarmWanted(), "the app project sets CRASH_WARM=off").toBe(false);
    const set = process.env.CRASH_WARM;
    delete process.env.CRASH_WARM;
    try {
      expect(crashWarmWanted(), "no switch: every other boot runs it").toBe(true);
    } finally {
      process.env.CRASH_WARM = set;
    }
  });
});
