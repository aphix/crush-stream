import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { allocatedBytes, COMPILE_WAIT_S, untilQuiet } from "../../kernel/alloc-sample.test-util.ts";
import { FRAME_HZ } from "../../kernel/constants.ts";
import { STIMULUS } from "../civilian-gaze.ts";
import { CrowdMinds } from "./crowd-minds.ts";
import { mindsWorld, putStimulus } from "./minds.test-util.ts";

const FRAME = 1 / FRAME_HZ;
const WARM_FRAMES = 6000;
const WINDOW_FRAMES = 3000;
const BOUND_B = 16;
/** Every this many frames (past the crash pulse's 8 s life) the table's pulse moves 3 m, so it is a new pulse and a group of the crowd is scheduled to turn. */
const PULSE_FRAMES = 600;

const { world, gaze } = mindsWorld();
const minds = new CrowdMinds(world.state!.capacity, world, () => {
  throw new Error("the Minds are off: no worker");
});
gaze.attend = () => {};
putStimulus(gaze, 0, STIMULUS.car, 5, 5, 0.5, 0);
let frames = 0;

/** One frame of the Minds, a car and a crash pulse in the table that moves now and then. */
function frame(): void {
  if (frames % PULSE_FRAMES === 0) putStimulus(gaze, 1, STIMULUS.crash, 3 + 3 * ((frames / PULSE_FRAMES) % 2), 0, 1, 8);
  minds.frame(FRAME);
  frames++;
}

function windowPerFrame(): number {
  return (
    allocatedBytes(() => {
      for (let f = 0; f < WINDOW_FRAMES; f++) frame();
    }) / WINDOW_FRAMES
  );
}

describe("given the Minds off over a crowd, a car and a crash pulse that moves 3 m every 10 s", () => {
  // mutation: sed -i 's/    this.scanAcc += dt;/    this.scanAcc += Number(dt.toFixed(9));/' src/game/present/minds/crowd-minds.ts
  it(`when a window of frames runs, scanning the table and turning scheduled heads, then the Minds allocate no more than ${BOUND_B} bytes a frame`, () => {
    for (let f = 0; f < WARM_FRAMES; f++) frame();
    const perFrame = untilQuiet(windowPerFrame, BOUND_B);
    if (process.env.ALLOC_PRINT) console.log(`crowd-minds-alloc: ${perFrame.toFixed(2)} B/frame`);
    expect(perFrame, `${perFrame.toFixed(1)} B a frame > ${BOUND_B} in every window for ${COMPILE_WAIT_S} s: the Minds' frame allocates`).toBeLessThanOrEqual(BOUND_B);
  });
});

// After the row above, with a loop of its own: a second callee at the measured loop's call site would cost the frame its optimized code.
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
