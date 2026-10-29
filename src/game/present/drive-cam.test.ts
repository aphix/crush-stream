import { describe, expect, it } from "vitest";
import { CHASE, followBlend, wobbleEnvelope } from "./drive-cam.ts";

describe("given the chase view's follow blend over forward speed (masterclass 23:34: fade over a parameter)", () => {
  it("when the car is under the band or past it, then the blend is 0 or 1", () => {
    expect(followBlend(-5)).toBe(0);
    expect(followBlend(CHASE.followFrom)).toBe(0);
    expect(followBlend(CHASE.followTo)).toBe(1);
    expect(followBlend(40)).toBe(1);
  });
  it("when the speed climbs through the band, then the blend rises without a jump or a fall, and the old 3 m/s switch is mid-band", () => {
    const STEP = 0.01;
    let prev = 0;
    for (let v = 0; v <= 8; v += STEP) {
      const b = followBlend(v);
      expect(b, `the blend fell at ${v.toFixed(2)} m/s`).toBeGreaterThanOrEqual(prev);
      expect(b - prev, `the blend jumped at ${v.toFixed(2)} m/s: ${prev} -> ${b}`).toBeLessThan(0.02);
      prev = b;
    }
    expect(followBlend(3) > 0 && followBlend(3) < 1).toBeTruthy();
  });
});

describe("given a landing's wobble envelope", () => {
  const { hold, attack } = CHASE.landing;
  it("when the landing has just begun, then the amplitude is 0, not the full amplitude", () => {
    expect(wobbleEnvelope(hold, hold, attack)).toBe(0);
  });
  it("when the landing runs its hold, then the amplitude eases in without a jump, peaks, and fades out to 0", () => {
    const STEP = 0.001;
    let prev = 0;
    let peak = 0;
    for (let left = hold; left >= 0; left -= STEP) {
      const a = wobbleEnvelope(left, hold, attack);
      expect(Math.abs(a - prev), `the envelope jumped at ${left.toFixed(3)} s left: ${prev} -> ${a}`).toBeLessThan(0.05);
      peak = Math.max(peak, a);
      prev = a;
    }
    expect(peak > 0.8 && peak <= 1).toBeTruthy();
    expect(wobbleEnvelope(0, hold, attack)).toBe(0);
  });
});
