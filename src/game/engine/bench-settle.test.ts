import { describe, it } from "vitest";
import assert from "node:assert/strict";
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
    assert.equal(r.settled, true, "settled");
    assert.equal(r.frames, 2 * SETTLE.frames, "frames watched");
    assert.equal(r.longestMs, FRAME_MS, "longest frame");
  });

  it("when a synthetic 400 ms hang opens the switch, then the arm settles only after the hang is out of the newest window, and the hang is the longest frame, at its place, with the engine's ms in it", () => {
    const r = watch([400, 90, 40]);
    assert.equal(r.settled, true, "settled");
    assert.ok(r.frames >= 3 + 2 * SETTLE.frames - 3, `${r.frames} frames: not before two windows of steady frames`);
    assert.equal(r.longestMs, 400, "longest frame");
    assert.equal(r.longestAt, 0, "the hang is the first frame");
    assert.equal(r.longestCpuMs, 200, "the engine's ms in the hang frame");
  });

  it("when a hang falls in the middle of the watch, then it does not settle until a whole newest window is clear of it", () => {
    const r = watch(Array.from({ length: 2 * SETTLE.frames }, (_, i) => (i === SETTLE.frames + 5 ? 300 : FRAME_MS)));
    assert.equal(r.settled, true, "settled");
    assert.ok(r.frames >= SETTLE.frames + 5 + SETTLE.frames, `${r.frames} frames: the window with the hang in it was taken as steady`);
    assert.equal(r.longestAt, SETTLE.frames + 5, "the hang's place");
  });

  it("when the frame time is still falling (a cost running down 30 % a window), then it is not settled while it falls and is once it levels", () => {
    const r = watch([], (i) => FRAME_MS * (1 + 2 * Math.max(0, 1 - i / 90)));
    assert.equal(r.settled, true, "settled");
    assert.ok(r.frames > 90, `${r.frames} frames: settled while the cost was still falling`);
  });

  it("when a slow display (100 ms frames) takes 50 frames to level from a 4x cost, then it settles past the cap's seconds, because the cap also wants its frames", () => {
    const r = watch([], (i) => 100 * (1 + 3 * Math.max(0, 1 - i / 50)));
    assert.equal(r.settled, true, "settled");
    assert.ok(r.settleS > SETTLE.capS, `${r.settleS} s: the watch would have stopped at the cap's seconds`);
    assert.ok(r.frames < SETTLE.capFrames, `${r.frames} frames`);
  });

  it("when the arm never settles (a frame time that doubles every window), then the watch stops at the cap and says it did not settle", () => {
    const r = watch([], (i) => FRAME_MS * 1.05 ** i);
    assert.equal(r.settled, false, "settled");
    assert.ok(r.settleS >= SETTLE.capS, `${r.settleS} s: stopped before the cap`);
    assert.ok(r.frames >= SETTLE.capFrames, `${r.frames} frames: stopped before the cap's frames`);
  });

  it("when the watch is reset for the next switch, then nothing of the last one is kept", () => {
    const w = new SettleWatch();
    for (let i = 0; i < 100 && !w.push(i === 0 ? 500 : FRAME_MS, 1); i++);
    assert.equal(w.result().longestMs, 500, "the control: the first switch had a hang");
    w.reset();
    for (let i = 0; i < 100 && !w.push(FRAME_MS, 1); i++);
    assert.equal(w.result().longestMs, FRAME_MS, "the second switch's longest frame");
    assert.equal(w.result().settled, true, "the second switch settled");
  });
});
