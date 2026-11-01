import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as THREE from "three";
import { RagdollSystem } from "./engine-ragdoll.ts";
import { driverLook } from "./driver-look.ts";
import { flatSystem } from "./ragdoll-throws.test-util.ts";
import { FOOT_LOCK } from "./walker-motors.ts";

/** Walkers standing away from the world's origin, stepped by frames longer than the foot locks' ramp (the showcase on a slow device). */
const LOOK = { cop: false, look: driverLook(0, 0) };
/** Frame lengths (s) at and past the ramp: 20 and 25 fps. */
const FRAMES = [1 / 20, 1 / 25] as const;
const SPOTS = [0.8, 2.3, 6, 9] as const;
const SECONDS = 1;
/** A standing walker's parts move this fast (m/s) at most while he settles; a lock pulling a foot to the origin took them past 10. */
const SETTLE_MPS = 3;
const DRIFT_M = 0.5;

let system: RagdollSystem;

beforeEach(async () => {
  system = await flatSystem();
});
afterEach(() => {
  system.dispose();
});

describe(`given walkers placed on their feet away from the origin and frames of ${FOOT_LOCK.rampSeconds * 1000} ms or longer`, () => {
  for (const dt of FRAMES) {
    it(`when ${SPOTS.length} stand for ${SECONDS} s at ${Math.round(1 / dt)} fps, then no part of any of them moves fast and each stays within ${DRIFT_M} m of his spot`, () => {
      expect(dt, "the control: the frame is not shorter than the lock's ramp").toBeGreaterThanOrEqual(FOOT_LOCK.rampSeconds);
      for (let slot = 0; slot < SPOTS.length; slot++) {
        expect(system.startWalker(new THREE.Vector3(SPOTS[slot]!, 0, 0), 0, LOOK, slot), `walker ${slot} is placed`).toBe(slot);
      }
      let fastest = 0;
      for (let f = 0; f < SECONDS / dt; f++) {
        system.update(dt, [], true, true, null);
        for (let slot = 0; slot < SPOTS.length; slot++) {
          for (const body of system["dolls"][slot]!.bodies) {
            const v = body.linvel();
            fastest = Math.max(fastest, Math.hypot(v.x, v.y, v.z));
          }
        }
      }
      expect(fastest, `the fastest part moved ${fastest.toFixed(1)} m/s`).toBeLessThan(SETTLE_MPS);
      const at = new THREE.Vector3();
      for (let slot = 0; slot < SPOTS.length; slot++) {
        expect(system.walkerTorso(at, slot), `walker ${slot} is out`).toBe(true);
        expect(Math.hypot(at.x - SPOTS[slot]!, at.z), `walker ${slot} is ${at.x.toFixed(2)}, ${at.z.toFixed(2)}`).toBeLessThan(DRIFT_M);
      }
    });
  }
});
