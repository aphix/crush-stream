import { describe, expect, it } from "vitest";
import { capAtRest, carryLift, DIRTY_WORD, newCarried, type Carried } from "./tyre-carried.ts";

/** Four welded points in a row's worth of tables: point 0 is dirty with a 0.5 lift, and its one upward edge (to point 1) drops 0.1. */
function fourPoints(): Carried {
  const dirtyBytes = new ArrayBuffer(DIRTY_WORD);
  const dirty = new Uint8Array(dirtyBytes);
  dirty[0] = 1;
  const c = newCarried(4, 4, {
    written: new Float32Array(12),
    rest: new Float32Array(12),
    liftable: new Uint8Array(4),
    over: [],
    wheelNow: new Float64Array(24),
    heldAt: new Float64Array(24),
    ownLift: new Float32Array(4),
    lift: Float32Array.of(0.5, 0, 0, 9),
    rep: Int32Array.of(0, 1, 2, 3),
    push: new Float32Array(4),
    pushDir: new Float32Array(12),
    dirty,
    dirtyWords: new Uint32Array(dirtyBytes),
    start: Int32Array.of(0, 1, 1, 1, 1),
    to: Int32Array.of(1),
    drop: Float32Array.of(0.1),
  });
  c.cap.set([1, 0.2, 1, 1]);
  return c;
}

describe("given a lift carried up one edge from a dirty point, over a cap that point's neighbour is above", () => {
  it("when the lift is carried and then capped, then the point and its neighbour are the ones listed, and only the neighbour is lowered", () => {
    const c = fourPoints();
    carryLift(c);
    expect(Array.from(c.touched.subarray(0, c.touchedN)), "the points carried from and raised").toEqual([0, 1]);
    expect(c.lift[1]!, "the neighbour's carried lift").toBeCloseTo(0.4, 6);
    capAtRest(c);
    expect(c.lift[0]!, "the dirty point, under its cap").toBeCloseTo(0.5, 6);
    expect(c.lift[1]!, "the neighbour, lowered to its cap").toBeCloseTo(0.2, 6);
    expect(c.touchedN, "the list is spent").toBe(0);
    expect(Array.from(c.mark), "and no point is marked").toEqual([0, 0, 0, 0]);
  });

  it("when a point nobody touched stands over its cap, then the cap leaves it: only touched lifts are checked", () => {
    const c = fourPoints();
    carryLift(c);
    capAtRest(c);
    expect(c.lift[3]!, "an untouched lift over its cap").toBe(9);
  });
});
