import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import "../kernel/rapier-node.test-util.ts";
import { setGround } from "../world/ground.ts";
import type { CrashEngine } from "./engine.ts";
import { bootEngine, stubBrowser } from "./engine-headless.test-util.ts";

describe("given the real engine and a car drawn small, skinned every second frame", () => {
  let engine: CrashEngine;
  beforeAll(async () => {
    stubBrowser();
    engine = await bootEngine();
  });
  afterAll(() => {
    engine.dispose();
    setGround(null);
  });

  // mutation: sed -i 's/    return (stride > 1 \&\& skinDeferred) || this.holdHidden(car, stride, i);/    return this.holdHidden(car, stride, i);/' src/game/engine/engine.ts
  it("when the skins are scheduled over two frames, then its tyre hold waits on the frame its skin is not written and runs on the other; a car skinned every frame never waits", () => {
    const cars = engine["live"]();
    const small = cars[1]!;
    const near = cars[2]!;
    vi.spyOn(engine as unknown as { followedCar(): unknown }, "followedCar").mockReturnValue(cars[0]);
    vi.spyOn(engine as unknown as { holdHidden(): boolean }, "holdHidden").mockReturnValue(false);
    vi.spyOn(engine as unknown as { skinStride(car: unknown): number }, "skinStride").mockImplementation((car) => (car === small ? 2 : 1));
    const waits = { small: [] as boolean[], near: [] as boolean[] };
    const smallHold = vi.spyOn(small, "setHoldDeferred").mockImplementation((waiting) => void waits.small.push(waiting));
    const nearHold = vi.spyOn(near, "setHoldDeferred").mockImplementation((waiting) => void waits.near.push(waiting));
    engine["scheduleSkins"](cars);
    engine["scheduleSkins"](cars);
    smallHold.mockRestore();
    nearHold.mockRestore();
    vi.restoreAllMocks();
    expect(waits.small.filter(Boolean).length, "of two frames, one waits").toBe(1);
    expect(waits.near, "a car skinned every frame").toEqual([false, false]);
  });
});
