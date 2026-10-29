import { afterEach, describe, expect, it } from "vitest";
import * as THREE from "three";
import "../kernel/rapier-node.test-util.ts";
import { FRAME_HZ } from "../kernel/constants.ts";
import { firstMismatch } from "../kernel/compare-arrays.test-util.ts";
import { FREEWHEEL, launch, makeCar, makeWorld, tickWorld } from "../contact/crash-scenarios.test-util.ts";
import type { DeformableCar } from "../vehicle/car.ts";
import { driverLook } from "./driver-look.ts";
import type { RagdollSystem } from "./engine-ragdoll.ts";
import { flatSystem } from "./ragdoll-throws.test-util.ts";
import { SLOTS } from "./ragdoll-config.ts";

const FRAME = 1 / FRAME_HZ;
const WALKER = SLOTS - 1;
/** The walker stands this many frames before the wheel is let go, and the run is this many after. */
const SETTLE_FRAMES = FRAME_HZ;
const FRAMES = 2.5 * FRAME_HZ;
/** The wheel is let go this far (m) down the road from the walker, at hip height (m), and flies at him at this speed (m/s). */
const WHEEL_FROM_M = 4;
const WHEEL_Y = 1.1;
const WHEEL_MPS = 8;
/** A walker whose head has come down below this (m) is knocked over; standing, his head is at 1.63. */
const KNOCKED_HEAD_M = 1;
const STANDING_HEAD_M = 1.4;

let system: RagdollSystem | null = null;

/** A sedan parked 40 m off in a sim of its own, a wheel popped off it and let go at (0, `WHEEL_Y`, `z`) with velocity (0, 0, `vz`). */
function wheelOff(z: number, vz: number): { car: DeformableCar; step: () => void; at: () => number[] } {
  const car = makeCar();
  launch(car, 40, 40, 0, 0, 0);
  const w = makeWorld([car], false, false, FREEWHEEL);
  car["dropWheel"](0, "hubFL");
  const wheel = car["looseWheels"][0]!;
  wheel.object.position.set(0, WHEEL_Y, z);
  wheel.velocity.set(0, 0, vz);
  wheel.angular.set(0, 0, 0);
  wheel.shape.seatFor = 0;
  return { car, step: () => tickWorld(w), at: () => wheel.object.position.toArray() };
}

/** A walker standing at the origin and the wheel let go at him (`toward`) or away from him: the lowest his head gets, and the wheel's place each frame. */
async function throwAtWalker(toward: boolean): Promise<{ lowest: number; path: number[] }> {
  system = await flatSystem();
  const sys = system;
  sys.startWalker(new THREE.Vector3(0, 0, 0), 0, { cop: false, look: driverLook(0, 0) });
  for (let f = 0; f < SETTLE_FRAMES; f++) sys.update(FRAME, [], true, true, null);
  const thrown = wheelOff(WHEEL_FROM_M, toward ? -WHEEL_MPS : WHEEL_MPS);
  let lowest = Infinity;
  const path: number[] = [];
  for (let f = 0; f < FRAMES; f++) {
    thrown.step();
    sys.walker.ask();
    sys.update(FRAME, [thrown.car], true, true, null);
    lowest = Math.min(lowest, sys["dolls"][WALKER]!.bodies[1]!.translation().y);
    path.push(...thrown.at());
  }
  return { lowest, path };
}

afterEach(() => {
  system?.dispose();
  system = null;
});

describe("given a walker standing at the origin and a wheel popped off a car parked far off, thrown at him at hip height at 8 m/s", () => {
  it(`when it reaches him, then his head comes down below ${KNOCKED_HEAD_M} m, where the same wheel thrown the other way leaves it over ${STANDING_HEAD_M} m`, async () => {
    const hit = await throwAtWalker(true);
    system?.dispose();
    const miss = await throwAtWalker(false);
    expect(miss.lowest, `the control: his head never came lower than ${miss.lowest.toFixed(2)} m`).toBeGreaterThan(STANDING_HEAD_M);
    expect(hit.lowest, `his head came down to ${hit.lowest.toFixed(2)} m`).toBeLessThan(KNOCKED_HEAD_M);
  });

  it("when it is thrown with no walker out, then it flies the same path, frame for frame, as it did into him (he does not push it back)", async () => {
    const hit = await throwAtWalker(true);
    const alone = wheelOff(WHEEL_FROM_M, -WHEEL_MPS);
    const path: number[] = [];
    for (let f = 0; f < FRAMES; f++) {
      alone.step();
      path.push(...alone.at());
    }
    const bad = firstMismatch(hit.path, path);
    expect(bad, `the wheel's path first differs at number ${bad?.index} (frame ${Math.floor((bad?.index ?? 0) / 3)})`).toBeUndefined();
  });
});
