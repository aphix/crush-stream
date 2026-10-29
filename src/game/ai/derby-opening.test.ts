import { describe, expect, it } from "vitest";
import { DerbyBrain } from "./derby-ai.ts";
import { aiCar } from "../vehicle/test-support.ts";
import { FRAME_HZ } from "../kernel/constants.ts";

/**
 * Opening caution (owner 10-04): until 8 s into a heat or a car's own first hit, a driver does not drive its nose into a
 * rival at a high closing speed. One rule in the brain for every AI car; the player is untouched.
 */

/** A hungry driver 0 at 20 m/s with a rival `z` m dead ahead that is `foeVz` m/s along +z; the brain has run `age` s. */
function charge(age: number, foeVz = -20, z = 18): { brain: DerbyBrain; out: { throttle: number; brake: number; boost: boolean } } {
  const brain = new DerbyBrain();
  brain.setAggression(0, 1);
  const self = aiCar(0, { vz: 20, rear: 0.9, damage: 0.3, idle: 1000 });
  const all = [self, aiCar(1, { z, vz: foeVz })];
  brain.think(self, all, age);
  brain.meter[0] = 1;
  const out = brain.think(self, all, 1 / FRAME_HZ);
  return { brain, out: { throttle: out.throttle, brake: out.brake, boost: out.boost } };
}

describe("given a fully aggressive driver doing 20 m/s that has not yet landed a hit of its own", () => {
  it("when a rival 18 m dead ahead closes at 40 m/s in the first 2 s of the heat, then the driver lifts off the throttle, brakes hard and does not boost", () => {
    const { out } = charge(2);
    expect(out.throttle <= 0 && out.brake > 0.5 && !out.boost, JSON.stringify(out)).toBeTruthy();
  });

  it("when the same 40 m/s charge happens 9 s into the heat, then the driver keeps the gas and does not brake", () => {
    const { out } = charge(9);
    expect(out.throttle > 0 && out.brake === 0, JSON.stringify(out)).toBeTruthy();
  });

  it("when the rival 18 m ahead closes at only 2 m/s in the first 2 s of the heat, then the driver keeps the gas and does not brake", () => {
    const { out } = charge(2, 18);
    expect(out.throttle > 0 && out.brake === 0, JSON.stringify(out)).toBeTruthy();
  });

  it("when the driver lands its first aggressive hit 2 s into the heat, then the opening caution is over and it keeps the gas against the same charge", () => {
    const brain = new DerbyBrain();
    brain.setAggression(0, 1);
    const self = aiCar(0, { vz: 20, rear: 0.9, damage: 0.3, idle: 30 });
    const all = [self, aiCar(1, { z: 18, vz: -20 })];
    brain.think(self, all, 2);
    self.idle = 0; // it just landed a hit (the hit clock restarts)
    for (let k = 0; k < FRAME_HZ / 2; k++) brain.think(self, all, 1 / FRAME_HZ);
    self.idle = 0.5;
    const out = brain.think(self, all, 1 / FRAME_HZ);
    expect(out.throttle > 0 && out.brake === 0, JSON.stringify({ ...out })).toBeTruthy();
  });

  it("when the only rival is 18 m behind the nose, then the driver does not brake", () => {
    const { out } = charge(2, 20, -18);
    expect(out.brake, JSON.stringify(out)).toBe(0);
  });

  it("when a stationary rival 5 m away at 37 degrees off the nose is met at 8 m/s along the heading, then the driver still lifts, brakes hard and does not boost even though the range closes at only 6.4 m/s", () => {
    const brain = new DerbyBrain();
    brain.setAggression(0, 1);
    const self = aiCar(0, { vz: 8, rear: 0.9, damage: 0.3, idle: 1000 });
    // 5 m off at 37 degrees: the range rate is 6.4 m/s (under the threshold) but the nose meets it at 8.
    const all = [self, aiCar(1, { x: 3, z: 4, vz: 0 })];
    brain.think(self, all, 2);
    brain.meter[0] = 1;
    const out = brain.think(self, all, 1 / FRAME_HZ);
    expect(out.throttle <= 0 && out.brake > 0.5 && !out.boost, JSON.stringify({ ...out })).toBeTruthy();
  });
});

describe("given a fully aggressive driver whose rival ahead closes at about the opening caution's line (7 m/s) in the first seconds of the heat", () => {
  /** Driver 0 against a standing rival 18 m dead ahead (in range, in the cone), at `speeds[k]` m/s along its heading on step k: the closing speed is its own speed. Returns the brake of each step. */
  function brakes(speeds: readonly number[]): number[] {
    const brain = new DerbyBrain();
    brain.setAggression(0, 1);
    const self = aiCar(0, { vz: speeds[0]!, rear: 0.9, damage: 0.3, idle: 1000 });
    const all = [self, aiCar(1, { z: 18, vz: 0 })];
    brain.think(self, all, 2);
    return speeds.map((v) => {
      self.vz = v;
      return brain.think(self, all, 1 / FRAME_HZ).brake;
    });
  }
  const STEPS_PER_S = FRAME_HZ;

  it("when its closing speed reads 8 m/s for one step and 6 m/s (under the line) after it, then it brakes that step and is off the brake within half a second, for good: the caution brakes no car that closes slower than the line", () => {
    const b = brakes([8, ...Array<number>(2 * STEPS_PER_S).fill(6)]);
    expect(b[0]!, "the step it closed too fast brakes").toBeGreaterThan(0.5);
    const on = b.slice(STEPS_PER_S / 2).filter((x) => x > 0).length;
    expect(on, `braked ${on} of ${1.5 * STEPS_PER_S} steps closing at 6 m/s after the first half second`).toBe(0);
  });

  it("when its closing speed reads 8 m/s once and then hovers within 0.3 m/s of the line, crossing it every step for a second, then the brake pedal does not swap with the gas more than twice", () => {
    const b = brakes([8, ...Array.from({ length: STEPS_PER_S }, (_, k) => (k % 2 === 0 ? 7.3 : 6.7))]);
    let swaps = 0;
    for (let k = 1; k < b.length; k++) if (Math.abs(b[k]! - b[k - 1]!) > 0.2) swaps++;
    expect(swaps, `the brake swapped ${swaps} times in a second: ${b.map((x) => x.toFixed(1)).join(" ")}`).toBeLessThanOrEqual(2);
  });
});
