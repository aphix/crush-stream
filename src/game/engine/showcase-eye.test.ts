import { describe, expect, it } from "vitest";
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
    expect(hold(new EyeStop(), POSE_A, 3).length).toBe(0);
  });

  it("when the eye moves every frame, then it never reports, and once it stays it reports that pose once, however long it stays", () => {
    const stop = new EyeStop();
    hold(stop, POSE_A, 0.1);
    for (let i = 0; i < 120; i++) expect(stop.frame([1, 0, i * 0.01, 0, 1, 0], DT), "moving").toBe(null);
    expect(hold(stop, POSE_B, 0.3).length, "a moment after it stopped it has not yet rested").toBe(0);
    const rests = hold(stop, POSE_B, 3);
    expect(rests.length).toBe(1);
    expect(rests[0]).toBe(POSE_B);
  });

  it("when the eye returns to the pose the URL shows, then nothing is reported; after a reset the next pose is the one shown", () => {
    const stop = new EyeStop();
    hold(stop, POSE_A, 0.1);
    expect(hold(stop, POSE_B, 1).length).toBe(1);
    expect(hold(stop, POSE_B, 1).length).toBe(0);
    expect(hold(stop, POSE_A, 1).length, "a different pose is a new one").toBe(1);
    stop.reset();
    expect(hold(stop, POSE_B, 1).length, "the first pose after a reset is the baseline").toBe(0);
  });
});
