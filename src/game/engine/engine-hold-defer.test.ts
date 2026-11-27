import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import "../kernel/rapier-node.test-util.ts";
import { setGround } from "../world/ground.ts";
import type { DeformableCar } from "../vehicle/car.ts";
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

  /** Strides by car: `small` 2, every other 1; no car followed but car 0; nothing hidden behind a solid. */
  function drawn(small: DeformableCar): void {
    const cars = engine["live"]();
    vi.spyOn(engine as unknown as { followedCar(): unknown }, "followedCar").mockReturnValue(cars[0]);
    vi.spyOn(engine["cover"], "hidden").mockReturnValue(false);
    vi.spyOn(engine as unknown as { skinStride(car: unknown): number }, "skinStride").mockImplementation((car) => (car === small ? 2 : 1));
  }

  /** What `car.setHoldDeferred` is told while `run` goes. */
  function told(car: DeformableCar, run: () => void): boolean[] {
    const waits: boolean[] = [];
    vi.spyOn(car, "setHoldDeferred").mockImplementation((waiting) => void waits.push(waiting));
    run();
    return waits;
  }

  // mutation: sed -i 's/^  return (stride > 1 \&\& skinDeferred) || holdHidden(/  return holdHidden(/' src/game/engine/skin-hold.ts
  it("when the skins are scheduled over two frames, then its tyre hold waits on the frame its skin is not written and runs on the other; a car skinned every frame never waits", () => {
    const cars = engine["live"]();
    drawn(cars[1]!);
    const small = told(cars[1]!, () => undefined);
    const near = told(cars[2]!, () => undefined);
    engine["scheduleSkins"](cars);
    engine["scheduleSkins"](cars);
    vi.restoreAllMocks();
    expect(small.filter(Boolean).length, "of two frames, one waits").toBe(1);
    expect(near, "a car skinned every frame").toEqual([false, false]);
  });

  // mutation: sed -i 's/holdWaits(this.cover, this.race, car, stride, i, car.deform.skinDeferred, LOD_RADIUS)/holdWaits(this.cover, this.race, car, stride, i, false, LOD_RADIUS)/' src/game/engine/engine.ts
  it("when the camera has moved and a hold is owed, then a small car whose skin is deferred keeps it owed, and a car that came to full rate has it laid", () => {
    const cars = engine["live"]();
    const small = cars[1]!;
    const grown = cars[2]!;
    drawn(small);
    for (const car of [small, grown]) {
      Object.defineProperty(car, "holdOwed", { value: true, configurable: true });
      car.deform.skinDeferred = true;
    }
    const smallWaits = told(small, () => undefined);
    const grownWaits = told(grown, () => undefined);
    const settled = vi.spyOn(grown, "settleHold").mockImplementation(() => undefined);
    engine["flushVisibleSkins"]();
    vi.restoreAllMocks();
    for (const car of [small, grown]) delete (car as { holdOwed?: boolean }).holdOwed;
    expect(smallWaits, "a small car with its skin deferred: its hold stays owed").toEqual([true]);
    expect(grownWaits, "a car at full rate: its hold is laid").toEqual([false]);
    expect(settled).toHaveBeenCalledTimes(1);
  });
});
