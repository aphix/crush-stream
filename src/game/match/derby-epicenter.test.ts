import { afterEach, describe, expect, it } from "vitest";
import { epicenterValues, loadEpicenter } from "../deform/epicenter.ts";
import { derbySeed, KEEP, WHEEL_BOUND } from "./derby-epicenter.test-util.ts";

const saved = epicenterValues();
afterEach(() => loadEpicenter(saved));

describe("given a six-car derby (seed 10) with the epicenter activation on", () => {
  it("when it runs 15 s, then the freeze moves no hub's car-frame place more than the pin slack (a hub standing far off its pin keeps it) and every frozen wreck's drawn wheels stay within half a metre of their hubs", () => {
    const { frozenSlices, worstJump, worstWheel } = derbySeed();
    expect(frozenSlices, `${frozenSlices} frozen wreck slices: the row proves nothing`).toBeGreaterThan(1000);
    // The absolute pin-from-rest bound is gone: a pin legitimately stands 0.1 to 0.95 m off its rest place (a face shove, a squeezed wreck's hub cap) and the freeze did not move it. Seed 10 no longer reaches the keep
    // branch (0 freeze-start hubs past ${KEEP} m off their pin on 7917d954c), so the keep itself is pinned by the staged row in epicenter-thaw.test.ts; this row keeps the drawn-wheel intent and the jump on real derby freezes.
    expect(worstJump, `the freeze moved a hub ${worstJump.toFixed(2)} m from its pin in the car frame`).toBeLessThanOrEqual(KEEP);
    expect(worstWheel, `a frozen wreck's drawn wheel stood ${worstWheel.toFixed(2)} m off its hub`).toBeLessThan(WHEEL_BOUND);
  });
});
