import { describe, expect, it } from "vitest";
import { VoicePool } from "./motor-voices.ts";
import { FRAME_HZ } from "../kernel/constants.ts";
import { firstMismatch } from "../kernel/compare-arrays.test-util.ts";

const FRAME = 1 / FRAME_HZ;
const NO_PRIORITY = -1;

function metres(...distances: number[]): Float64Array {
  return Float64Array.from(distances, (d) => d * d);
}

/** Runs `frames` of two contenders swinging out of phase around 10 m and 11 m behind a priority car; returns the swaps of the free slot. */
function swapsOfTwoNearCars(pool: VoicePool): number {
  const distSq = new Float64Array(3);
  let swaps = 0;
  for (let frame = 0; frame < 120; frame++) {
    const swing = 0.6 * Math.sin((frame / 20) * 2 * Math.PI);
    distSq[0] = (10 + swing) ** 2;
    distSq[1] = (11 - swing) ** 2;
    distSq[2] = 3 * 3;
    pool.swapped.fill(0);
    pool.assign(distSq, 3, 2, FRAME);
    if (frame > 0) for (let s = 0; s < pool.slots; s++) swaps += pool.swapped[s]!;
  }
  return swaps;
}

describe("given six cars and three slots", () => {
  it("when the priority car is the farthest, then it holds a slot on every frame", () => {
    const pool = new VoicePool(3);
    const distSq = metres(5, 6, 7, 8, 40, 9);
    for (let frame = 0; frame < 10; frame++) {
      pool.assign(distSq, 6, 4, FRAME);
      expect(pool.car.includes(4), `frame ${frame}`).toBeTruthy();
    }
  });
  it("when the cars are all near, then the other slots hold the nearest ones", () => {
    const pool = new VoicePool(3);
    pool.assign(metres(5, 6, 7, 8, 40, 9), 6, 4, FRAME);
    expect(firstMismatch([...pool.car].sort(), [0, 1, 4])).toBeUndefined();
  });
  it("when there is no priority car, then the three nearest are held", () => {
    const pool = new VoicePool(3);
    pool.assign(metres(30, 6, 7, 8, 40, 9), 6, NO_PRIORITY, FRAME);
    expect(firstMismatch([...pool.car].sort(), [1, 2, 3])).toBeUndefined();
  });
});

describe("given two cars swinging past each other in front of a held priority car", () => {
  it("when the pool has its hysteresis, then the free slot never swaps after the first frame", () => {
    expect(swapsOfTwoNearCars(new VoicePool(2))).toBe(0);
  });
  it("when the hysteresis is off (ratio 1, no hold), then the free slot swaps more than ten times", () => {
    expect(swapsOfTwoNearCars(new VoicePool(2, 1, 0))).toBeGreaterThan(10);
  });
});

describe("given a car closing in on two held cars at 20 m and 25 m (one slot each, a frame is 0.125 s)", () => {
  const testCases = [
    { name: "slowly (under 17.5 m at frame 9, the hold ended at frame 6)", pace: 4, swapFrame: 9 },
    { name: "quickly (under 17.5 m at frame 3, the hold ends at frame 6)", pace: 12, swapFrame: 6 },
  ];
  for (const c of testCases) {
    it(`when it closes ${c.name}, then it takes the 25 m slot on frame ${c.swapFrame} and on no earlier frame`, () => {
      const pool = new VoicePool(2);
      const distSq = new Float64Array(3);
      let firstSwap = -1;
      for (let frame = 0; frame < 20; frame++) {
        distSq[0] = 20 * 20;
        distSq[1] = 25 * 25;
        distSq[2] = Math.max(5, 50 - c.pace * frame) ** 2;
        pool.swapped.fill(0);
        pool.assign(distSq, 3, NO_PRIORITY, 0.125);
        if (frame > 0 && firstSwap < 0 && pool.car.includes(2)) firstSwap = frame;
      }
      expect(firstSwap).toBe(c.swapFrame);
      expect(firstMismatch([...pool.car].sort(), [0, 2])).toBeUndefined();
    });
  }
});

describe("given cars leaving the pool", () => {
  it("when a held car goes unhearable (Infinity), then its slot is freed that frame and marked swapped", () => {
    const pool = new VoicePool(2);
    const distSq = metres(5, 6);
    pool.assign(distSq, 2, NO_PRIORITY, FRAME);
    pool.swapped.fill(0);
    distSq[0] = Infinity;
    pool.assign(distSq, 2, NO_PRIORITY, FRAME);
    expect(pool.car[0]).toBe(-1);
    expect(pool.swapped[0]).toBe(1);
  });
  it("when the car count drops from 6 to 2, then the slots holding cars 2 to 5 are freed", () => {
    const pool = new VoicePool(4);
    pool.assign(metres(9, 8, 7, 6, 5, 4), 6, NO_PRIORITY, FRAME);
    expect(firstMismatch([...pool.car].sort(), [2, 3, 4, 5])).toBeUndefined();
    pool.assign(metres(9, 8, 7, 6, 5, 4), 2, NO_PRIORITY, FRAME);
    expect(firstMismatch([...pool.car].sort(), [-1, -1, 0, 1])).toBeUndefined();
  });
  it("when the pool is released, then every slot is free and swapped", () => {
    const pool = new VoicePool(3);
    pool.assign(metres(5, 6, 7), 3, NO_PRIORITY, FRAME);
    pool.swapped.fill(0);
    pool.release();
    for (let s = 0; s < 3; s++) {
      expect(pool.car[s]).toBe(-1);
      expect(pool.swapped[s]).toBe(1);
    }
  });
  it("when the priority car is unhearable, then no slot is spent on it", () => {
    const pool = new VoicePool(2);
    const distSq = metres(5, 6, 7);
    distSq[2] = Infinity;
    pool.assign(distSq, 3, 2, FRAME);
    expect(firstMismatch([...pool.car].sort(), [0, 1])).toBeUndefined();
  });
});
