import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { DeformableCar } from "../vehicle/car.ts";
import { fleetStyle } from "../scenes/fleet.ts";
import { PodiumDirector } from "./engine-podium.ts";
import { stubBrowser } from "./engine-headless.test-util.ts";

stubBrowser();

/** Frames before the measure: past V8's tier-up (cold code runs in the interpreter, where every double is boxed). */
const WARM_FRAMES = 20000;
/** Windows of 12000 frames read at their ends only (`memoryUsage` allocates its own result, which a short window would count), the quietest taken (as `engine-record.test.ts`): a steady allocation fails every one of them. A file of its own: a heap that earlier tests left to collect reads as growth. */
const WINDOWS = 5;
const WINDOW_FRAMES = 12000;
const BOUND_B = 16;

describe("given the podium on screen", () => {
  it("when it draws sixty thousand frames after the engine has warmed up, then it allocates no more than 16 bytes a frame", () => {
    const scene = new THREE.Scene();
    const director = new PodiumDirector({
      spot: () => ({ x: 120, y: 55, z: -30 }),
      carFor: (id, reuse) => reuse ?? new DeformableCar({ body: 0x808080, accent: 0, name: `c${id}` }, scene, null, fleetStyle(id)),
      dress: () => {},
      discard: () => {},
      damageOf: () => null,
      scene,
      jet: () => {},
    });
    director.raise(
      [
        { id: 0, name: "Ayla", place: 1 },
        { id: 1, name: "Bo", place: 2 },
        { id: 2, name: "Cy", place: 3 },
      ],
      "race",
      "Test Oval",
    );
    const camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 2000);
    const frame = (f: number): void => {
      director.frame(f / 60);
      director.aim(camera);
    };
    for (let f = 0; f < WARM_FRAMES; f++) frame(f);
    let perFrame = Infinity;
    for (let w = 0; w < WINDOWS; w++) {
      const before = process.memoryUsage().heapUsed;
      for (let f = 0; f < WINDOW_FRAMES; f++) frame(WARM_FRAMES + w * WINDOW_FRAMES + f);
      perFrame = Math.min(perFrame, Math.max(0, process.memoryUsage().heapUsed - before) / WINDOW_FRAMES);
    }
    assert.ok(perFrame <= BOUND_B, `${perFrame.toFixed(1)} B a frame > ${BOUND_B}: the podium allocates while it is up`);
  });
});
