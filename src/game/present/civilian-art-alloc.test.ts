import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { allocatedBytes, COMPILE_WAIT_S, untilQuiet } from "../kernel/alloc-sample.test-util.ts";
import { CivilianArt } from "./civilian-art.ts";
import { NEAR_DRAW, NEAR_SLOTS } from "./civilian-art-constants.ts";
import { FRAME_SECONDS, IN_SIGHT, posesScattered } from "./civilian-art.test-util.ts";

const CIVILIANS = 300;
/** Frames before the first read: past most of V8's tier-up (cold code runs in the interpreter, where every double is boxed). */
const WARM_FRAMES = 6000;
/** Windows of this many frames are read until one is quiet: how long the cold code lasts follows the box's load. */
const WINDOW_FRAMES = 3000;
const BOUND_B = 16;
const WALK_STEP = 0.02;
const STRIDE_STEP = 0.1;
/** The crowd turns back at this distance (m) from the eye, so it keeps crossing the near and far lines for the whole run. */
const TURN_BACK = NEAR_DRAW * 2;

const poses = posesScattered(CIVILIANS, TURN_BACK, 7);
const art = new CivilianArt(NEAR_SLOTS.desktop, CIVILIANS);

/** One frame: everyone walks along her yaw and strides; the art draws the crowd. */
function frame(): void {
  for (let civilian = 0; civilian < CIVILIANS; civilian++) {
    poses.x[civilian] = poses.x[civilian]! + Math.sin(poses.yaw[civilian]!) * WALK_STEP;
    poses.z[civilian] = poses.z[civilian]! + Math.cos(poses.yaw[civilian]!) * WALK_STEP;
    poses.stride[civilian] = poses.stride[civilian]! + STRIDE_STEP;
    if (poses.x[civilian]! * poses.x[civilian]! + poses.z[civilian]! * poses.z[civilian]! > TURN_BACK * TURN_BACK) poses.yaw[civilian] = poses.yaw[civilian]! + Math.PI;
  }
  art.update(poses, 0, 0, IN_SIGHT, FRAME_SECONDS);
}

/** Bytes a frame allocates over one window of frames. */
function windowPerFrame(): number {
  return (
    allocatedBytes(() => {
      for (let f = 0; f < WINDOW_FRAMES; f++) frame();
    }) / WINDOW_FRAMES
  );
}

describe("given a warmed crowd of 300 walking back and forth across the near and far lines with forty dummies", () => {
  it(`when a window of frames is drawn, then the art allocates no more than ${BOUND_B} bytes a frame`, () => {
    for (let f = 0; f < WARM_FRAMES; f++) frame();
    const perFrame = untilQuiet(windowPerFrame, BOUND_B);
    if (process.env.ALLOC_PRINT) console.log(`civilian-art-alloc: ${perFrame.toFixed(2)} B/frame`);
    expect(art.nearDrawn, "dummies drawn").toBe(NEAR_SLOTS.desktop);
    expect(art.farDrawn, "figures drawn").toBeGreaterThan(0);
    expect(perFrame, `${perFrame.toFixed(1)} B a frame > ${BOUND_B} in every window for ${COMPILE_WAIT_S} s: the civilians' drawing allocates`).toBeLessThanOrEqual(BOUND_B);
  });
});

// After the row above, with a loop of its own: a second callee at the measured loop's call site would cost the art its optimized code.
describe("given the allocation measure", () => {
  it("when a frame makes a vector, then it reads over the bar", () => {
    const kept: THREE.Vector3[] = [];
    const perFrame =
      allocatedBytes(() => {
        for (let f = 0; f < WINDOW_FRAMES; f++) kept[f % 8] = new THREE.Vector3();
      }) / WINDOW_FRAMES;
    expect(perFrame, `${perFrame.toFixed(1)} B a frame for a vector a frame: the measure sees nothing`).toBeGreaterThan(BOUND_B);
  });
});
