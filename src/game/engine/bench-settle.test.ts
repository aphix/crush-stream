import { describe, expect, it } from "vitest";
import { SETTLE, SettleWatch, type SettleResult } from "./bench-settle.ts";

const FRAME_MS = 6;

/** The frames of a switch: `lead` frames at the values given, then steady frames at `FRAME_MS`; the watch is pushed until it stops. */
function watch(lead: readonly number[], steady: (index: number) => number = () => FRAME_MS): SettleResult {
  const w = new SettleWatch();
  for (let i = 0; i < 100_000; i++) {
    const interval = i < lead.length ? lead[i]! : steady(i - lead.length);
    if (w.push(interval, interval * 0.5)) break;
  }
  return w.result();
}

describe("given the frames after a setting was switched", () => {
  it("when the arm was steady throughout, then it settles as soon as two windows of frames are in, and the longest frame is an ordinary one", () => {
    const r = watch([]);
    expect(r.settled, "settled").toBe(true);
    expect(r.frames, "frames watched").toBe(2 * SETTLE.frames);
    expect(r.longestMs, "longest frame").toBe(FRAME_MS);
  });

  it("when a synthetic 400 ms hang opens the switch, then the arm settles only after the hang is out of the newest window, and the hang is the longest frame, at its place, with the engine's ms in it", () => {
    const r = watch([400, 90, 40]);
    expect(r.settled, "settled").toBe(true);
    expect(r.frames, `${r.frames} frames: not before two windows of steady frames`).toBeGreaterThanOrEqual(3 + 2 * SETTLE.frames - 3);
    expect(r.longestMs, "longest frame").toBe(400);
    expect(r.longestAt, "the hang is the first frame").toBe(0);
    expect(r.longestCpuMs, "the engine's ms in the hang frame").toBe(200);
  });

  it("when a hang falls in the middle of the watch, then it does not settle until a whole newest window is clear of it", () => {
    const r = watch(Array.from({ length: 2 * SETTLE.frames }, (_, i) => (i === SETTLE.frames + 5 ? 300 : FRAME_MS)));
    expect(r.settled, "settled").toBe(true);
    expect(r.frames, `${r.frames} frames: the window with the hang in it was taken as steady`).toBeGreaterThanOrEqual(SETTLE.frames + 5 + SETTLE.frames);
    expect(r.longestAt, "the hang's place").toBe(SETTLE.frames + 5);
  });

  it("when the frame time is still falling (a cost running down 30 % a window), then it is not settled while it falls and is once it levels", () => {
    const r = watch([], (i) => FRAME_MS * (1 + 2 * Math.max(0, 1 - i / 90)));
    expect(r.settled, "settled").toBe(true);
    expect(r.frames, `${r.frames} frames: settled while the cost was still falling`).toBeGreaterThan(90);
  });

  it("when a slow display (100 ms frames) takes 50 frames to level from a 4x cost, then it settles past the cap's seconds, because the cap also wants its frames", () => {
    const r = watch([], (i) => 100 * (1 + 3 * Math.max(0, 1 - i / 50)));
    expect(r.settled, "settled").toBe(true);
    expect(r.settleS, `${r.settleS} s: the watch would have stopped at the cap's seconds`).toBeGreaterThan(SETTLE.capS);
    expect(r.frames, `${r.frames} frames`).toBeLessThan(SETTLE.capFrames);
  });

  it("when the arm never settles (a frame time that doubles every window), then the watch stops at the cap and says it did not settle", () => {
    const r = watch([], (i) => FRAME_MS * 1.05 ** i);
    expect(r.settled, "settled").toBe(false);
    expect(r.settleS, `${r.settleS} s: stopped before the cap`).toBeGreaterThanOrEqual(SETTLE.capS);
    expect(r.frames, `${r.frames} frames: stopped before the cap's frames`).toBeGreaterThanOrEqual(SETTLE.capFrames);
  });

  it("when the watch is reset for the next switch, then nothing of the last one is kept", () => {
    const w = new SettleWatch();
    for (let i = 0; i < 100 && !w.push(i === 0 ? 500 : FRAME_MS, 1); i++);
    expect(w.result().longestMs, "the control: the first switch had a hang").toBe(500);
    w.reset();
    for (let i = 0; i < 100 && !w.push(FRAME_MS, 1); i++);
    expect(w.result().longestMs, "the second switch's longest frame").toBe(FRAME_MS);
    expect(w.result().settled, "the second switch settled").toBe(true);
  });
});
