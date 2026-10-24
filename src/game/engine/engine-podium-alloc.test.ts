import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { Session, type HeapProfiler } from "node:inspector";
import * as THREE from "three";
import { DeformableCar } from "../vehicle/car.ts";
import { fleetStyle } from "../scenes/fleet.ts";
import { NOW, PodiumDirector } from "./engine-podium.ts";
import { stubBrowser } from "./engine-headless.test-util.ts";

stubBrowser();

/** Frames before the first read: past most of V8's tier-up (cold code runs in the interpreter, where every double is boxed). */
const WARM_FRAMES = 20000;
/** V8 optimizes hot code on a background thread, so how long the cold code lasts follows the box's load: windows are read until one is quiet (a steady allocation never is), up to this many. */
const MAX_WINDOWS = 60;
const WINDOW_FRAMES = 12000;
const BOUND_B = 16;
/** Mean gap (B) between the sampling heap profiler's samples: a window's allocation reads to a few percent at the bar. */
const SAMPLE_B = 64;

/** Bytes sampled as allocated under `node`, dead by now or not. */
function allocated(node: HeapProfiler.SamplingHeapProfileNode): number {
  let bytes = node.selfSize;
  for (const child of node.children) bytes += allocated(child);
  return bytes;
}

/** Bytes `frame` allocates a call over the calls `from` to `from + frames`: the sampling profiler counts every object made, so neither a scavenge's timing nor a heap delta's noise moves it. */
function allocatedPerFrame(from: number, frames: number, frame: (f: number) => void): number {
  const session = new Session();
  session.connect();
  session.post("HeapProfiler.startSampling", { samplingInterval: SAMPLE_B, includeObjectsCollectedByMajorGC: true, includeObjectsCollectedByMinorGC: true });
  for (let f = from; f < from + frames; f++) frame(f);
  let bytes = NaN;
  session.post("HeapProfiler.stopSampling", (err, result) => {
    if (err) throw err;
    bytes = allocated(result.profile.head);
  });
  session.disconnect();
  return bytes / frames;
}

describe("given the allocation measure", () => {
  it("when a frame makes a vector, then it reads over the bar", () => {
    const kept: THREE.Vector3[] = [];
    const perFrame = allocatedPerFrame(0, WINDOW_FRAMES, (f) => {
      kept[f % 8] = new THREE.Vector3();
    });
    assert.ok(perFrame > BOUND_B, `${perFrame.toFixed(1)} B a frame for a vector a frame: the measure sees nothing`);
  });
});

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
    let perFrame = Infinity;
    for (let w = 0; w < MAX_WINDOWS && perFrame > BOUND_B; w++) perFrame = allocatedPerFrame(WARM_FRAMES + w * WINDOW_FRAMES, WINDOW_FRAMES, frame);
    assert.ok(perFrame <= BOUND_B, `${perFrame.toFixed(1)} B a frame > ${BOUND_B} in each of up to ${MAX_WINDOWS} windows: the podium allocates while it is up`);
  });
});
