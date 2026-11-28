import { describe, expect, it } from "vitest";
import { admitCarried, capAtRest, carryLift, DIRTY_WORD, findCaps, newCarried, ROW_KEEP, type Carried } from "./tyre-carried.ts";

/** Four welded points: point 0 is dirty with a 0.5 lift, and its one upward edge (to point 1, written 1 m over it and resting 0.1 m over it) drops 0.09. */
function fourPoints(): Carried {
  const dirtyBytes = new ArrayBuffer(DIRTY_WORD);
  const dirty = new Uint8Array(dirtyBytes);
  dirty[0] = 1;
  const c = newCarried(4, 4, {
    written: Float32Array.of(0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0),
    rest: Float32Array.of(0, 0, 0, 0, 0.1, 0, 0, 0, 0, 0, 0, 0),
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
    drop: Float32Array.of(0.09),
  });
  c.cap.set([1, 0.2, 1, 1]);
  return c;
}

describe("given a lift carried up one edge from a dirty point, over a cap that point's neighbour is above", () => {
  it("when the lift is carried and then capped, then the point and its neighbour are the ones listed, and only the neighbour is lowered", () => {
    const c = fourPoints();
    carryLift(c);
    expect(Array.from(c.touched.subarray(0, c.touchedN)), "the points carried from and raised").toEqual([0, 1]);
    expect(c.lift[1]!, "the neighbour's carried lift").toBeCloseTo(0.41, 6);
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

/** The tyre's top plus its gap as `findCaps` reads it from the wheel below: hub height + radius + gap. */
const TYRE_TOP = 0.715;
const TYRE = { r: 0.3, halfW: 0.1 };
const GAP = 0.05;

/** A column of welded points, each with an upward edge to the next, over one wheel whose top stands at `TYRE_TOP`: each point's `[rest y, written y, lift]`, the lift as the carry before the cap left it (nothing dirty: that carry is done). */
function column(points: readonly (readonly [number, number, number])[]): Carried {
  const n = points.length;
  const dirtyBytes = new ArrayBuffer(Math.ceil(n / DIRTY_WORD) * DIRTY_WORD);
  const heldAt = new Float64Array(6);
  heldAt.set([1, 0, 0, 0, TYRE_TOP - TYRE.r - GAP, 0]);
  const dirty = new Uint8Array(dirtyBytes);
  const c = newCarried(n, n, {
    written: Float32Array.from(points.flatMap(([, w]) => [0, w, 0])),
    rest: Float32Array.from(points.flatMap(([r]) => [0, r, 0])),
    liftable: new Uint8Array(n),
    over: [],
    wheelNow: new Float64Array(6),
    heldAt,
    ownLift: new Float32Array(n),
    lift: Float32Array.from(points.map(([, , l]) => l)),
    rep: Int32Array.from(points.keys()),
    push: new Float32Array(n),
    pushDir: new Float32Array(n * 3),
    dirty,
    dirtyWords: new Uint32Array(dirtyBytes),
    start: Int32Array.from({ length: n + 1 }, (_, k) => Math.min(k, n - 1)),
    to: Int32Array.from({ length: n - 1 }, (_, k) => k + 1),
    drop: Float32Array.from({ length: n - 1 }, (_, k) => (1 - ROW_KEEP) * (points[k + 1]![0] - points[k]![0])),
  });
  return c;
}

/** The drawn height of point `p`. */
const drawnAt = (c: Carried, p: number): number => c.written[p * 3 + 1]! + c.lift[p]!;

describe("given a column whose lower point the crush wrote 0.3 m under the rest and the next point 0.05 m over it at rest but 0.30 m over it written", () => {
  it("when the hold caps it, then the upper point is drawn at most the kept share of its rest rise over the lower one, not the stretch over the tyre's top", () => {
    // Rests 0.60 and 0.65, written 0.40 and 0.70, the lifts the carry left (0.5 and 0.455).
    const c = column([[0.6, 0.4, 0.5], [0.65, 0.7, 0.455]]);
    findCaps(c, TYRE, GAP, 1, 0);
    expect(drawnAt(c, 0), "the lower point, on the tyre's top").toBeCloseTo(TYRE_TOP, 5);
    expect(drawnAt(c, 1) - drawnAt(c, 0), "the upper point over it").toBeLessThanOrEqual(ROW_KEEP * 0.05 + 1e-6);
    expect(drawnAt(c, 1) - drawnAt(c, 0), "and still over it").toBeGreaterThan(0);
  });
});

describe("given a column whose base holds its own lift right on the tyre's top and the next point rests 0.1 m over it", () => {
  it("when the hold caps it, then the next point is drawn the kept share of that rise over the base, not on the cap beside it", () => {
    // Rests 0.50 and 0.60, written 0.40 and 0.60: the base's lift is its own (0.315 puts it on the top), the next point's carried lift 0.225 is over its cap 0.115.
    const c = column([[0.5, 0.4, 0.315], [0.6, 0.6, 0.225]]);
    c.ownLift[0] = 0.315;
    findCaps(c, TYRE, GAP, 1, 0);
    expect(drawnAt(c, 0), "the base, on the tyre's top").toBeCloseTo(TYRE_TOP, 5);
    expect(drawnAt(c, 1) - drawnAt(c, 0), "the next point over it, by the kept share of 0.1 m").toBeGreaterThanOrEqual(0.9 * ROW_KEEP * 0.1);
  });
});

/** One vertex written 0.35 m over a hub that stands at the origin with its axle along x (a tyre of `TYRE`): the crush carries it onto the tyre, so the wheel's set is that one vertex. */
function oneCrushedVertex(): Carried {
  const dirtyBytes = new ArrayBuffer(DIRTY_WORD);
  const c = newCarried(1, 1, {
    written: Float32Array.of(0, 0.35, 0),
    rest: Float32Array.of(0, 0.2, 0),
    liftable: new Uint8Array(1),
    over: [new Float32Array(1).fill(NaN)],
    wheelNow: Float64Array.of(1, 0, 0, 0, 0, 0),
    heldAt: new Float64Array(6),
    ownLift: new Float32Array(1),
    lift: new Float32Array(1),
    rep: Int32Array.of(0),
    push: new Float32Array(1),
    pushDir: new Float32Array(3),
    dirty: new Uint8Array(dirtyBytes),
    dirtyWords: new Uint32Array(dirtyBytes),
    start: Int32Array.of(0, 0),
    to: new Int32Array(0),
    drop: new Float32Array(0),
  });
  c.at[0] = new Int32Array(1);
  return c;
}

describe("given a wheel whose carried set was made from a crushed skin", () => {
  // mutation: sed -i 's/c.admitOk\[w\] === 1 \&\& sameAdmission/false \&\& sameAdmission/' src/game/vehicle/tyre-carried.ts
  it("when it is admitted again with the wheel, the skin and the crush as they were, then its set is not made again: it stands and nothing is reported changed", () => {
    const c = oneCrushedVertex();
    expect(admitCarried(c, TYRE, 1, 0, true, true), "the first set is new").toBe(1);
    expect(c.n[0], "the vertex is carried").toBe(1);
    // Were the set made again from no moved vertices it would be empty: a standing set was not made again.
    c.movedN = 0;
    expect(admitCarried(c, TYRE, 1, 0, true, false), "nothing changed").toBe(0);
    expect(c.n[0], "the set stands").toBe(1);
  });

  // mutation: sed -i 's/ \&\& sameAdmission(c, w, gone, crushed)//' src/game/vehicle/tyre-carried.ts
  it("when the wheel has moved a metre off, then its set is made again and is empty", () => {
    const c = oneCrushedVertex();
    admitCarried(c, TYRE, 1, 0, true, true);
    c.wheelNow[5] = 1;
    expect(admitCarried(c, TYRE, 1, 0, true, false), "the set changed").toBe(1);
    expect(c.n[0], "no vertex is over it").toBe(0);
  });

  // mutation: sed -i 's/if (skinWritten) c.admitOk.fill(0);//' src/game/vehicle/tyre-carried.ts
  it("when the skin is written again with the vertex back at its rest, then the set is made again and is empty", () => {
    const c = oneCrushedVertex();
    admitCarried(c, TYRE, 1, 0, true, true);
    c.written.set([0, 0.2, 0]);
    expect(admitCarried(c, TYRE, 1, 0, true, true), "the set changed").toBe(1);
    expect(c.n[0], "no vertex is carried").toBe(0);
  });
});
