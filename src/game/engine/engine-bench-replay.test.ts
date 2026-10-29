import { describe, expect, test } from "vitest";
import type { RagdollStats } from "../present/engine-ragdoll.ts";
import { ragdollCost, replayTier, type ReplayFrames } from "./engine-bench-replay.ts";

const NO_COST = { steps: 0, stepMs: { mean: 0, p95: 0 }, colliders: 0, bodies: 0 };

describe("given the ragdoll world's step log (a ring of the newest world.step() ms)", () => {
  test("when fewer steps ran since the mark than the ring holds, then the cost is those steps' mean and p95, and the world's size is the one now", () => {
    const log = new Float64Array(8);
    log.set([9, 9, 1, 2, 3, 4]);
    const stats: RagdollStats = { steps: 6, log, colliders: 70, bodies: 12 };
    const cost = ragdollCost(stats, 2);
    expect(cost.steps).toBe(4);
    expect(cost.stepMs.mean).toBe(2.5);
    expect(cost.stepMs.p95).toBe(4);
    expect(cost.colliders).toBe(70);
    expect(cost.bodies).toBe(12);
  });

  test("when more steps ran since the mark than the ring holds, then the newest ones in the ring are scored and the count is the real one", () => {
    const log = new Float64Array(4);
    // 10 steps ran: step k wrote k + 1 ms at slot k % 4, so the ring holds steps 6..9 (7, 8, 9, 10 ms).
    for (let k = 0; k < 10; k++) log[k % 4] = k + 1;
    const cost = ragdollCost({ steps: 10, log, colliders: 0, bodies: 0 }, 0);
    expect(cost.steps).toBe(10);
    expect(cost.stepMs.mean).toBe(8.5);
    expect(cost.stepMs.p95).toBe(10);
  });

  test("when no step ran since the mark (a world with nothing to move), then the cost is zero steps and zero ms", () => {
    const cost = ragdollCost({ steps: 5, log: new Float64Array(4), colliders: 3, bodies: 1 }, 5);
    expect(cost.steps).toBe(0);
    expect(cost.stepMs.mean).toBe(0);
    expect(cost.stepMs.p95).toBe(0);
  });
});

describe("given the frames the reel drew at one FX tier", () => {
  const frames: ReplayFrames = { n: 4, iv: Float64Array.of(10, 10, 10, 30), cpu: Float64Array.of(4, 5, 6, 9), sim: Float64Array.of(1, 1, 2, 4), draw: Float64Array.of(2, 2, 3, 5) };

  test("when the tier's row is made, then the fps is frames over their wall time, the wall time is their sum, and each reading is its mean and p95", () => {
    const row = replayTier(frames, 1.5, NO_COST);
    expect(row.frames).toBe(4);
    expect(row.wallS).toBe(0.06);
    expect(row.fps).toBe((1000 * 4) / 60);
    expect(row.frameMs.mean).toBe(15);
    expect(row.cpuMs.mean).toBe(6);
    expect(row.simMs.mean).toBe(2);
    expect(row.renderMs.mean).toBe(3);
    expect(row.gpuMs).toBe(1.5);
  });

  test("when the 1 % low is read, then it is one over the 99th-percentile frame interval", () => {
    expect(replayTier(frames, null, NO_COST).fpsLow1).toBe(1000 / 30);
  });

  test("when no frame was drawn, then the row is zeros and not a division by zero, and a device with no timer query has a null gpu", () => {
    const row = replayTier({ n: 0, iv: new Float64Array(2), cpu: new Float64Array(2), sim: new Float64Array(2), draw: new Float64Array(2) }, null, NO_COST);
    expect(row.fps).toBe(0);
    expect(row.fpsLow1).toBe(0);
    expect(row.gpuMs).toBe(null);
  });
});
