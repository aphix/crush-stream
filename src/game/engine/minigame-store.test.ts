import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { minigameStore } from "./minigame-store.ts";

/** An in-memory `localStorage`, the browser's key/value store. */
function memoryStorage(): Storage {
  const entries = new Map<string, string>();
  return {
    get length() {
      return entries.size;
    },
    clear: () => entries.clear(),
    getItem: (key) => entries.get(key) ?? null,
    key: (index) => [...entries.keys()][index] ?? null,
    removeItem: (key) => void entries.delete(key),
    setItem: (key, value) => void entries.set(key, value),
  };
}

function useStorage(storage: Storage): void {
  Object.defineProperty(globalThis, "localStorage", { value: storage, configurable: true, writable: true });
}

function expectBests(got: { thisCar: number | null; overall: number | null }, thisCar: number | null, overall: number | null, why: string): void {
  expect(got.thisCar, `${why}: this car's best`).toBe(thisCar);
  expect(got.overall, `${why}: overall best`).toBe(overall);
}

describe("given the minigame bests in an in-memory localStorage", () => {
  let storage: Storage;
  beforeEach(() => {
    storage = memoryStorage();
    useStorage(storage);
  });
  afterEach(() => Reflect.deleteProperty(globalThis, "localStorage"));

  it("when nothing was recorded, then every best reads as none", () => {
    expectBests(minigameStore().bestFor("longJump", null, "sedan"), null, null, "empty store");
  });

  it("when a score is recorded, then it reads back as the car type's best and the overall best, and the record is a new best", () => {
    const store = minigameStore();
    expect(store.record("longJump", null, "sedan", 42.5), "first score is a new best").toBe(true);
    expectBests(store.bestFor("longJump", null, "sedan"), 42.5, 42.5, "after the first score");
  });

  it("when two car types score, then each keeps its own best and the overall is the higher", () => {
    const store = minigameStore();
    store.record("highJump", null, "sedan", 12);
    store.record("highJump", null, "monster", 20);
    expectBests(store.bestFor("highJump", null, "sedan"), 12, 20, "the sedan");
    expectBests(store.bestFor("highJump", null, "monster"), 20, 20, "the monster");
    expect(store.record("highJump", null, "sedan", 15), "a better sedan score that is still under the overall is a new best for the car").toBe(true);
    expectBests(store.bestFor("highJump", null, "sedan"), 15, 20, "the sedan after beating itself");
  });

  it("when a lower or equal score is recorded, then the best is not overwritten and the record is not a new best", () => {
    const store = minigameStore();
    store.record("longJump", null, "sedan", 50);
    expect(store.record("longJump", null, "sedan", 30), "lower score").toBe(false);
    expect(store.record("longJump", null, "sedan", 50), "equal score").toBe(false);
    expectBests(store.bestFor("longJump", null, "sedan"), 50, 50, "best kept");
  });

  it("when modes score, then each mode keeps its own bests", () => {
    const store = minigameStore();
    store.record("longJump", null, "sedan", 60);
    store.record("highJump", null, "sedan", 9);
    expectBests(store.bestFor("highJump", null, "sedan"), 9, 9, "high jump");
    expectBests(store.bestFor("longJump", null, "sedan"), 60, 60, "long jump");
  });

  it("when a new store is made on the same storage (a reload), then the bests are still there", () => {
    minigameStore().record("ringFling", 5, "truck", 240);
    const reloaded = minigameStore();
    expectBests(reloaded.bestFor("ringFling", 5, "truck"), 240, 240, "after the reload");
    expect(reloaded.record("ringFling", 5, "truck", 200), "the reloaded store still knows the best").toBe(false);
  });

  it("when Ring Fling sets of different lengths score, then their bests are kept apart", () => {
    const store = minigameStore();
    store.record("ringFling", 5, "sedan", 300);
    store.record("ringFling", 3, "sedan", 90);
    expectBests(store.bestFor("ringFling", 5, "sedan"), 300, 300, "five-throw sets");
    expectBests(store.bestFor("ringFling", 3, "sedan"), 90, 90, "three-throw sets");
    expectBests(store.bestFor("ringFling", 4, "sedan"), null, null, "a length never played");
  });

  it("when scores are recorded, then they live under crush.minigame.best.<mode>[.<throwsPerSet>].<carType|overall>", () => {
    const store = minigameStore();
    store.record("longJump", null, "wagon", 11);
    store.record("ringFling", 5, "wagon", 70);
    expect(storage.getItem("crush.minigame.best.longJump.wagon"), "long jump car key").toBe("11");
    expect(storage.getItem("crush.minigame.best.longJump.overall"), "long jump overall key").toBe("11");
    expect(storage.getItem("crush.minigame.best.ringFling.5.wagon"), "ring fling car key").toBe("70");
    expect(storage.getItem("crush.minigame.best.ringFling.5.overall"), "ring fling overall key").toBe("70");
  });

  it("when a score of 0 or less is recorded, then nothing is kept and it is not a new best", () => {
    const store = minigameStore();
    expect(store.record("longJump", null, "sedan", 0), "zero score").toBe(false);
    expect(storage.length, "nothing stored").toBe(0);
  });

  it("when a stored value is not a score, then the best reads as none", () => {
    storage.setItem("crush.minigame.best.longJump.sedan", "not a number");
    expectBests(minigameStore().bestFor("longJump", null, "sedan"), null, null, "garbage in storage");
  });

  it("when the storage is blocked, then reading and recording do not throw, reads are none and the record is a new best", () => {
    useStorage({
      ...memoryStorage(),
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    });
    const store = minigameStore();
    expectBests(store.bestFor("longJump", null, "sedan"), null, null, "read from blocked storage");
    expect(store.record("longJump", null, "sedan", 33), "record in blocked storage").toBe(true);
  });

  it("when there is no localStorage at all, then reading and recording do not throw", () => {
    Reflect.deleteProperty(globalThis, "localStorage");
    const store = minigameStore();
    expectBests(store.bestFor("highJump", null, "sedan"), null, null, "read without storage");
    expect(store.record("highJump", null, "sedan", 4), "record without storage").toBe(true);
  });
});
