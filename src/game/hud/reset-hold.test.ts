import { describe, expect, it } from "vitest";
import { RESET_HOLD, ResetHold } from "./reset-hold.ts";
import { FRAME_HZ } from "../kernel/constants.ts";
import { firstMismatch } from "../kernel/compare-arrays.test-util.ts";

const FRAME = 1 / FRAME_HZ;

/** Press for `secs` (in frames) then release; every step's result in order, with the fill after each. */
function press(h: ResetHold, secs: number): { acts: (string | null)[]; fills: number[] } {
  const acts: (string | null)[] = [];
  const fills: number[] = [];
  for (let t = 0; t < secs - 1e-9; t += FRAME) {
    acts.push(h.step(true, FRAME));
    fills.push(h.fill);
  }
  acts.push(h.step(false, FRAME));
  fills.push(h.fill);
  return { acts, fills };
}

describe("given a reset control pressed and released", () => {
  it("when it is released before the hold time, then the release is a tap and nothing acted while it was down", () => {
    const h = new ResetHold();
    const { acts } = press(h, RESET_HOLD * 0.5);
    expect(firstMismatch(acts.filter((a) => a !== null), ["tap"])).toBeUndefined();
    expect(acts[acts.length - 1]).toBe("tap");
  });

  it("when it stays down to the hold time, then the hold acts once on the step it completes, and the release after it is nothing", () => {
    const h = new ResetHold();
    const { acts } = press(h, RESET_HOLD * 1.6);
    expect(firstMismatch(acts.filter((a) => a !== null), ["hold"])).toBeUndefined();
    expect(acts[acts.length - 1]).not.toBe("tap");
    const at = (acts.indexOf("hold") + 1) * FRAME;
    expect(at >= RESET_HOLD && at < RESET_HOLD + 2 * FRAME, `the hold acted at ${at.toFixed(3)} s`).toBeTruthy();
  });

  it("when it is down, then the fill rises from 0 to 1 over the hold time, and is empty after the hold acts, after a release, and with nothing pressed", () => {
    const h = new ResetHold();
    expect(h.fill).toBe(0);
    const { fills } = press(h, RESET_HOLD * 1.5);
    expect(fills[0]! > 0 && fills[0]! < 0.1).toBeTruthy();
    expect(Math.abs(fills[Math.floor(RESET_HOLD / FRAME / 2)]! - 0.5), "half way at half the time").toBeLessThan(0.05);
    expect(fills.slice(0, Math.floor(RESET_HOLD / FRAME) - 1).every((f, i, a) => i === 0 || f >= a[i - 1]!), "never falls while held").toBeTruthy();
    expect(fills[fills.length - 1], "empty after the release").toBe(0);
    const k = new ResetHold();
    for (let t = 0; t < RESET_HOLD + 0.1; t += FRAME) k.step(true, FRAME);
    expect(k.fill, "empty once it has acted, though still down").toBe(0);
  });

  it("when the press is cancelled (a menu opened) before the hold time, then neither a tap nor a hold follows, and a fresh press starts from empty", () => {
    const h = new ResetHold();
    for (let t = 0; t < RESET_HOLD * 0.5; t += FRAME) h.step(true, FRAME);
    h.cancel();
    expect(h.fill).toBe(0);
    expect(h.step(false, FRAME)).toBe(null);
    expect(h.step(true, FRAME)).toBe(null);
    expect(h.fill).toBeLessThan(0.05);
  });

  it("when two presses follow each other, then each is its own tap or hold", () => {
    const h = new ResetHold();
    const acts = [...press(h, 0.1).acts, ...press(h, RESET_HOLD + 0.2).acts, ...press(h, 0.1).acts].filter((a) => a !== null);
    expect(firstMismatch(acts, ["tap", "hold", "tap"])).toBeUndefined();
  });
});
