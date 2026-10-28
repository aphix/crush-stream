import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { FRAME_HZ } from "../kernel/constants.ts";
import { EyeStop } from "./showcase-eye.ts";

const DT = 1 / FRAME_HZ;
const POSE_A = [1, 0, 0, 0, 1, 0];
const POSE_B = [1, 0.3, 1, 4, 2, 6];

/** Frames of `seconds` at pose `cam`; the poses `stop` returned. */
function hold(stop: EyeStop, cam: readonly number[], seconds: number): (readonly number[])[] {
  const out: (readonly number[])[] = [];
  for (let t = 0; t < seconds; t += DT) {
    const rest = stop.frame(cam, DT);
    if (rest !== null) out.push(rest);
  }
  return out;
}

describe("given the showcase eye's stop detector", () => {
  it("when the eye keeps still from the start, then it never reports: the pose is the one the URL already shows", () => {
    assert.equal(hold(new EyeStop(), POSE_A, 3).length, 0);
  });

  it("when the eye moves every frame, then it never reports, and once it stays it reports that pose once, however long it stays", () => {
    const stop = new EyeStop();
    hold(stop, POSE_A, 0.1);
    for (let i = 0; i < 120; i++) assert.equal(stop.frame([1, 0, i * 0.01, 0, 1, 0], DT), null, "moving");
    assert.equal(hold(stop, POSE_B, 0.3).length, 0, "a moment after it stopped it has not yet rested");
    const rests = hold(stop, POSE_B, 3);
    assert.equal(rests.length, 1);
    assert.equal(rests[0], POSE_B);
  });

  it("when the eye returns to the pose the URL shows, then nothing is reported; after a reset the next pose is the one shown", () => {
    const stop = new EyeStop();
    hold(stop, POSE_A, 0.1);
    assert.equal(hold(stop, POSE_B, 1).length, 1);
    assert.equal(hold(stop, POSE_B, 1).length, 0);
    assert.equal(hold(stop, POSE_A, 1).length, 1, "a different pose is a new one");
    stop.reset();
    assert.equal(hold(stop, POSE_B, 1).length, 0, "the first pose after a reset is the baseline");
  });
});
