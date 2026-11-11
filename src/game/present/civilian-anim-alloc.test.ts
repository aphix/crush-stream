import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { ACTIVITY } from "../ai/civilians/civilian-activity.ts";
import { allocatedBytes, COMPILE_WAIT_S, untilQuiet } from "../kernel/alloc-sample.test-util.ts";
import { FRAME_HZ } from "../kernel/constants.ts";
import { NEAR_SLOTS, SLOTS_PER_DUMMY_MESH } from "./civilian-art-constants.ts";
import { emptyPoses } from "./civilian-art.test-util.ts";
import { PoseSmoothing } from "./civilian-anim-smoothing.ts";
import { DOOR, STOOP } from "../world/openworld/openworld-facade-solids.ts";
import { Stoops } from "../world/openworld/openworld-stoops.ts";
import { poseCivilian } from "./civilian-pose.ts";
import { DummyMesh } from "./ragdoll-mesh.ts";

const DUMMIES = NEAR_SLOTS.desktop;
const ACTIVITY_CODES = Object.keys(ACTIVITY).length;
/** Frames before the first read: past most of V8's tier-up (cold code runs in the interpreter, where every double is boxed). */
const WARM_FRAMES = 6000;
/** Windows of this many frames are read until one is quiet: how long the cold code lasts follows the box's load. */
const WINDOW_FRAMES = 3000;
const BOUND_B = 16;
const STRIDE_STEP = 0.1;
const CLOCK_STEP = 1 / FRAME_HZ;
/** Frames an activity lasts before each civilian takes the next code, so every clip runs under the read. */
const ACTIVITY_FRAMES = 40;
const SEAT_TOP_M = 0.46;

const poses = emptyPoses(DUMMIES);
const meshes = Array.from({ length: Math.ceil(DUMMIES / SLOTS_PER_DUMMY_MESH) }, (_, chunk) => new DummyMesh(Math.min(SLOTS_PER_DUMMY_MESH, DUMMIES - chunk * SLOTS_PER_DUMMY_MESH)));
const smoothing = new PoseSmoothing(DUMMIES);
/** One rowhome's stoop at the origin facing +x: the odd civilians walk its spur up and down, so `plantOnTreads` solves their legs. */
const stoops = new Stoops([{ x: 0, z: 0, yaw: 0, depth: 10, style: "federal", storeys: 3, variant: 0 }], [0]);
const WALK_RATE = 0.05;
let frames = 0;

/** One frame: every dummy moves about, strides, her activity's clock runs, and each takes the next code every `ACTIVITY_FRAMES`, a partner beside her. */
function frame(): void {
  smoothing.begin(frames + 1, CLOCK_STEP);
  const next = frames % ACTIVITY_FRAMES === 0;
  const round = Math.floor(frames / ACTIVITY_FRAMES);
  for (let civilian = 0; civilian < DUMMIES; civilian++) {
    if (next) {
      poses.activity[civilian] = (civilian + round) % ACTIVITY_CODES;
      poses.activityClock[civilian] = 0;
    }
    poses.activityClock[civilian] = poses.activityClock[civilian]! + CLOCK_STEP;
    poses.stride[civilian] = poses.stride[civilian]! + STRIDE_STEP;
    poses.speed[civilian] = civilian % 2;
    poses.x[civilian] = STOOP.run * (0.5 + 0.5 * Math.sin(frames * WALK_RATE + civilian));
    poses.z[civilian] = DOOR.across + 0.3 * Math.cos(frames * WALK_RATE + civilian);
    poses.yaw[civilian] = frames * WALK_RATE + civilian;
    poses.onSpur[civilian] = civilian % 2;
    poses.partner[civilian] = (civilian + 1) % DUMMIES;
    poses.surfaceY[civilian] = SEAT_TOP_M;
    poseCivilian(meshes[Math.floor(civilian / SLOTS_PER_DUMMY_MESH)]!, civilian % SLOTS_PER_DUMMY_MESH, poses, civilian, smoothing, stoops);
  }
  frames++;
}

/** Bytes a frame allocates over one window of frames. */
function windowPerFrame(): number {
  return (
    allocatedBytes(() => {
      for (let f = 0; f < WINDOW_FRAMES; f++) frame();
    }) / WINDOW_FRAMES
  );
}

describe("given forty dummies each cycling through every activity, with a partner, on a seat, walking or standing", () => {
  it(`when a window of frames is posed, then posing allocates no more than ${BOUND_B} bytes a frame`, () => {
    for (let f = 0; f < WARM_FRAMES; f++) frame();
    const perFrame = untilQuiet(windowPerFrame, BOUND_B);
    if (process.env.ALLOC_PRINT) console.log(`civilian-anim-alloc: ${perFrame.toFixed(2)} B/frame`);
    expect(perFrame, `${perFrame.toFixed(1)} B a frame > ${BOUND_B} in every window for ${COMPILE_WAIT_S} s: posing the civilians allocates`).toBeLessThanOrEqual(BOUND_B);
  });
});

// After the row above, with a loop of its own: a second callee at the measured loop's call site would cost the posing its optimized code.
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
