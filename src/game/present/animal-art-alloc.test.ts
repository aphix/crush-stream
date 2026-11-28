import { describe, expect, it } from "vitest";
import { SPECIES } from "../ai/civilians/civilian-constants.ts";
import { LOOK } from "../ai/civilians/civilian-crowd-constants.ts";
import { allocatedBytes, COMPILE_WAIT_S, untilQuiet } from "../kernel/alloc-sample.test-util.ts";
import { AnimalArt } from "./animal-art.ts";
import { FAR_DRAW } from "./civilian-art-constants.ts";
import { FRAME_SECONDS, IN_SIGHT, posesScattered } from "./civilian-art.test-util.ts";

const RESIDENTS = 300;
/** Every this-many-th resident is a cat, the next one a dog: twenty of each among the 300. */
const ANIMAL_EVERY = 15;
/** Frames before the first read: past most of V8's tier-up. */
const WARM_FRAMES = 6000;
const WINDOW_FRAMES = 3000;
const BOUND_B = 16;
const WALK_STEP = 0.02;
const STRIDE_STEP = 0.1;
/** Every this-many frames the animals stop and walk again, so the postures keep easing. */
const STOP_PERIOD = 200;

const poses = posesScattered(RESIDENTS, FAR_DRAW, 11);
for (let resident = 0; resident + 1 < RESIDENTS; resident += ANIMAL_EVERY) {
  poses.look[resident] = ((SPECIES.cat << LOOK.speciesShift) | resident) >>> 0;
  poses.look[resident + 1] = ((SPECIES.dog << LOOK.speciesShift) | resident) >>> 0;
}
const art = new AnimalArt(RESIDENTS);
let frameAt = 0;

/** One frame: everyone walks along her yaw and back again, stopping between, so the crowd stays within the drawing's reach; the animals are drawn. */
function frame(): void {
  const period = Math.floor(frameAt++ / STOP_PERIOD);
  const walking = period % 2 === 0;
  const way = period % 4 === 0 ? WALK_STEP : -WALK_STEP;
  for (let resident = 0; resident < RESIDENTS; resident++) {
    poses.speed[resident] = walking ? 1 : 0;
    if (!walking) continue;
    poses.x[resident] = poses.x[resident]! + Math.sin(poses.yaw[resident]!) * way;
    poses.z[resident] = poses.z[resident]! + Math.cos(poses.yaw[resident]!) * way;
    poses.stride[resident] = poses.stride[resident]! + STRIDE_STEP;
  }
  art.update(poses, 0, 0, IN_SIGHT, FRAME_SECONDS);
}

function windowPerFrame(): number {
  return (
    allocatedBytes(() => {
      for (let f = 0; f < WINDOW_FRAMES; f++) frame();
    }) / WINDOW_FRAMES
  );
}

describe("given a warmed crowd of 300 with forty cats and dogs walking back and forth and stopping", () => {
  it(`when a window of frames is drawn, then the animals' drawing allocates no more than ${BOUND_B} bytes a frame`, () => {
    for (let f = 0; f < WARM_FRAMES; f++) frame();
    const perFrame = untilQuiet(windowPerFrame, BOUND_B);
    if (process.env.ALLOC_PRINT) console.log(`animal-art-alloc: ${perFrame.toFixed(2)} B/frame`);
    expect(art.figuresOf(SPECIES.cat).mesh.count + art.figuresOf(SPECIES.dog).mesh.count, "animals drawn").toBeGreaterThan(0);
    expect(perFrame, `${perFrame.toFixed(1)} B a frame > ${BOUND_B} in every window for ${COMPILE_WAIT_S} s: the animals' drawing allocates`).toBeLessThanOrEqual(BOUND_B);
  });
});
