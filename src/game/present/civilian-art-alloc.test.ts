import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { allocatedBytes, COMPILE_WAIT_S, untilQuiet } from "../kernel/alloc-sample.test-util.ts";
import { CivilianArt } from "./civilian-art.ts";
import { NEAR_DRAW, NEAR_SLOTS } from "./civilian-art-constants.ts";
import { FRAME_SECONDS, IN_SIGHT, posesScattered } from "./civilian-art.test-util.ts";
import { CrowdGaze, STIMULUS } from "./civilian-gaze.ts";
import { blankSenses, type GazeSenses } from "./civilian-gaze-table.ts";

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
const gaze = new CrowdGaze(CIVILIANS);
art.gaze = gaze;
/** Cars circling the eye at speeds from town to fast, one with its siren on; the player on foot; a wall along one diagonal hiding half the views. */
const CARS = 6;
const CAR_LAP_M = 40;
const cars = Array.from({ length: CARS }, (_, at) => ({ group: { position: { x: 0, y: 0, z: 0 } }, velocity: { x: 0, z: 0 }, sirens: at === 0 }));
const senses: GazeSenses = { ...blankSenses(), cars, player: true, playerX: 3, playerY: 1.55, playerZ: 2, lineOfSight: (ax, _az, _bx, bz) => ax + bz > 0 };
/** A crash pulses this often (frames), so the reactions it schedules are drawn under the read too. */
const PULSE_FRAMES = 120;
let frames = 0;

/** One frame: everyone walks along her yaw and strides, the cars go round; the crowd looks about, then the art draws it. */
function frame(): void {
  for (let civilian = 0; civilian < CIVILIANS; civilian++) {
    poses.x[civilian] = poses.x[civilian]! + Math.sin(poses.yaw[civilian]!) * WALK_STEP;
    poses.z[civilian] = poses.z[civilian]! + Math.cos(poses.yaw[civilian]!) * WALK_STEP;
    poses.stride[civilian] = poses.stride[civilian]! + STRIDE_STEP;
    if (poses.x[civilian]! * poses.x[civilian]! + poses.z[civilian]! * poses.z[civilian]! > TURN_BACK * TURN_BACK) poses.yaw[civilian] = poses.yaw[civilian]! + Math.PI;
  }
  for (let at = 0; at < CARS; at++) {
    const speed = 8 + 4 * at;
    const angle = (frames * FRAME_SECONDS * speed) / CAR_LAP_M + at;
    cars[at]!.group.position.x = Math.cos(angle) * CAR_LAP_M;
    cars[at]!.group.position.z = Math.sin(angle) * CAR_LAP_M;
    cars[at]!.velocity.x = -Math.sin(angle) * speed;
    cars[at]!.velocity.z = Math.cos(angle) * speed;
  }
  if (frames % PULSE_FRAMES === 0) gaze.pulse(STIMULUS.crash, 10, 1, 10, 40, 1);
  frames++;
  gaze.update(poses, FRAME_SECONDS, senses);
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

describe("given a warmed crowd of 300 walking back and forth across the near and far lines with forty dummies, looking at cars, a siren, the player and crashes", () => {
  it(`when a window of frames is sensed and drawn, then gaze and the art allocate no more than ${BOUND_B} bytes a frame`, () => {
    for (let f = 0; f < WARM_FRAMES; f++) frame();
    const perFrame = untilQuiet(windowPerFrame, BOUND_B);
    if (process.env.ALLOC_PRINT) console.log(`civilian-art-alloc: ${perFrame.toFixed(2)} B/frame`);
    expect(art.nearDrawn, "dummies drawn").toBe(NEAR_SLOTS.desktop);
    expect(art.farDrawn, "figures drawn").toBeGreaterThan(0);
    expect(gaze.lookKind.some((kind) => kind !== STIMULUS.none), "someone looks at something").toBe(true);
    expect(perFrame, `${perFrame.toFixed(1)} B a frame > ${BOUND_B} in every window for ${COMPILE_WAIT_S} s: the civilians' gaze or drawing allocates`).toBeLessThanOrEqual(BOUND_B);
    // mutation: sed -i 's/    this.pulses = refreshStimuli(this.stimuli, this.pulses, senses, this.dt);/    this.pulses = refreshStimuli(this.stimuli, this.pulses, { ...senses }, this.dt);/' /home/aphix/worktrees/Gaze/src/game/present/civilian-gaze.ts
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
