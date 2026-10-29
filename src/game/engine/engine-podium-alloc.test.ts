import { describe, it } from "vitest";
import assert from "node:assert/strict";
import * as THREE from "three";
import { allocatedBytes, COMPILE_WAIT_S, untilQuiet } from "../kernel/alloc-sample.test-util.ts";
import { DeformableCar } from "../vehicle/car.ts";
import { fleetStyle } from "../scenes/fleet.ts";
import { NOW, PodiumDirector } from "./engine-podium.ts";
import { stubBrowser } from "./engine-headless.test-util.ts";

stubBrowser();

/** Frames before the first read: past most of V8's tier-up (cold code runs in the interpreter, where every double is boxed). */
const WARM_FRAMES = 20000;
/** Windows of this many frames are read until one is quiet: V8 optimizes hot code on a background thread, so how long the cold code lasts follows the box's load. */
const WINDOW_FRAMES = 12000;
const BOUND_B = 16;

/** Bytes a frame of `frame` allocates over the window of frames from `from`. */
function windowPerFrame(frame: (f: number) => void, from: number): number {
  return allocatedBytes(() => {
    for (let f = from; f < from + WINDOW_FRAMES; f++) frame(f);
  }) / WINDOW_FRAMES;
}

describe("given the podium on screen", () => {
  it("when it draws frames after the engine has warmed up, then a window of them allocates no more than 16 bytes a frame", () => {
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
      director.time[NOW] = f / 60;
      director.frame();
      director.aim(camera);
    };
    for (let f = 0; f < WARM_FRAMES; f++) frame(f);
    const perFrame = untilQuiet((w) => windowPerFrame(frame, WARM_FRAMES + w * WINDOW_FRAMES), BOUND_B);
    assert.ok(perFrame <= BOUND_B, `${perFrame.toFixed(1)} B a frame > ${BOUND_B} in every window for ${COMPILE_WAIT_S} s: the podium allocates while it is up`);
  });
});

// After the row above, and with a loop of its own: a second callee at the measured loop's call site would cost the podium its optimized code.
describe("given the allocation measure", () => {
  it("when a frame makes a vector, then it reads over the bar", () => {
    const kept: THREE.Vector3[] = [];
    const perFrame =
      allocatedBytes(() => {
        for (let f = 0; f < WINDOW_FRAMES; f++) kept[f % 8] = new THREE.Vector3();
      }) / WINDOW_FRAMES;
    assert.ok(perFrame > BOUND_B, `${perFrame.toFixed(1)} B a frame for a vector a frame: the measure sees nothing`);
  });
});
