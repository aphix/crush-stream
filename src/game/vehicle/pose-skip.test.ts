import { afterEach, describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import { EPICENTER,  epicenterValues, loadEpicenter } from "../deform/epicenter.ts";
import { EPICENTER_AT_LOAD } from "../deform/epicenter.test-util.ts";
import { FREEWHEEL, launch, makeCar, makeWorld, tickWorld } from "../contact/crash-scenarios.test-util.ts";
import { layOnGround } from "./car-air-points.ts";
import type { DriveInput } from "./car-drive.ts";
import { DeformableCar } from "./car.ts";
import { assertSameNumbers } from "./test-support.ts";

/**
 * `presentSkip` re-poses a crashed car's parts only when something the pose reads changed: the poses it leaves must be those of re-posing every frame
 * (it is drawing only), while a car sitting still no longer pays for the doors' ground probes and the bumpers' search each frame.
 */

const KPH = 1 / 3.6;
const FRAMES = 360;
/** A resting wreck's masses carry 1e-13 of rounding noise (`POSE_EPSILON`): the poses agree to within a nanometre, no more. */
const POSE_TOLERANCE = 1e-8;
const GAS: DriveInput = { throttle: 1, steer: 0, brake: 0, ebrake: false, boost: false };
const saved = epicenterValues();
afterEach(() => loadEpicenter(saved));

type Rec = { poses: number[]; calls: number };

/** Every attached part's position, turn and scale on every 3rd frame of `FRAMES`, and how many times `posePart` ran. */
function film(scene: "settled head-on" | "driven wreck", skip: boolean): Rec {
  loadEpicenter(EPICENTER_AT_LOAD);
  EPICENTER.presentSkip = skip ? 1 : 0;
  const proto = DeformableCar.prototype as unknown as { posePart: (p: unknown) => void };
  const posePart = vi.spyOn(proto, "posePart");
  try {
    const a = makeCar("shape");
    const b = scene === "settled head-on" ? makeCar("shape") : null;
    if (b) {
      launch(a, -5, 0, Math.PI / 2, 20, 0);
      launch(b, 5, 0, -Math.PI / 2, -20, 0);
      layOnGround(b);
    } else launch(a, 6.2, 0, -Math.PI / 2, -50 * KPH, 0);
    layOnGround(a);
    const cars = b ? [a, b] : [a];
    const w = makeWorld(cars, !b, false, FREEWHEEL);
    for (const car of cars) w.pedals.set(car, scene === "driven wreck" ? GAS : FREEWHEEL);
    const poses: number[] = [];
    for (let f = 0; f < FRAMES; f++) {
      tickWorld(w);
      if (f % 3 !== 0) continue;
      for (const car of cars) {
        for (const p of (car as unknown as { parts: { detached: boolean; object: THREE.Object3D }[] }).parts) {
          if (p.detached) continue;
          p.object.position.toArray(poses, poses.length);
          p.object.quaternion.toArray(poses, poses.length);
          p.object.scale.toArray(poses, poses.length);
        }
      }
    }
    return { poses, calls: posePart.mock.calls.length };
  } finally {
    posePart.mockRestore();
  }
}

describe("given a crash filmed with and without presentSkip", () => {
  for (const scene of ["settled head-on", "driven wreck"] as const) {
    it(`when the ${scene} is run both ways, then every part's pose in every filmed frame is the same to a nanometre`, () => {
      const every = film(scene, false);
      const skipping = film(scene, true);
      expect(every.poses.length, "no parts filmed").toBeGreaterThan(0);
      assertSameNumbers(skipping.poses, every.poses, "part poses", POSE_TOLERANCE);
      if (scene === "settled head-on") expect(skipping.calls, `${skipping.calls} part poses against ${every.calls}: it skipped too few frames to be a saving`).toBeLessThan(0.5 * every.calls);
    });
  }
});
