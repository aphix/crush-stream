import assert from "node:assert/strict";
import { describe, it } from "node:test";

/** Past the guard's diff budget, yet one differing entry keeps Node's own diff cheap if the guard is missing. */
const BIG = 100_000;
const MAX_REPORT_CHARS = 5000;

/** @param {number} at the one entry that differs */
const texture = (at) => {
  const data = new Float32Array(BIG);
  data[at] = 1;
  return { isDataTexture: true, image: { data, width: BIG, height: 1 } };
};

/** @param {() => unknown} fail */
function caught(fail) {
  try {
    fail();
  } catch (err) {
    if (!(err instanceof assert.AssertionError)) throw err;
    return err;
  }
  assert.fail("the comparison passed");
}

/** @param {import("node:assert").AssertionError} err */
const bounded = (err) =>
  typeof err.actual === "string" && typeof err.expected === "string" && err.actual.length + err.expected.length + err.message.length < MAX_REPORT_CHARS;

describe("given a test process (the guard is imported first by every test runner)", () => {
  it("when a strict deep compare fails on objects holding a big typed array, then the error's message, actual and expected are bounded prints, not the values", () => {
    const err = caught(() => assert.deepEqual(texture(0), texture(1)));
    assert.ok(bounded(err), `${err.message.length} message chars, actual ${typeof err.actual}`);
  });

  it("when t.assert fails the same compare, then its error is bounded too", (t) => {
    const err = caught(() => t.assert.deepStrictEqual(texture(0), texture(1)));
    assert.ok(bounded(err), `${err.message.length} message chars, actual ${typeof err.actual}`);
  });

  it("when a compare of small values fails, then the message is Node's own", () => {
    assert.equal(caught(() => assert.equal(1, 2)).message, "Expected values to be strictly equal:\n\n1 !== 2\n");
    assert.equal(caught(() => assert.deepEqual({ a: [1, 2] }, { a: [1, 3] })).message.split("\n")[0], "Expected values to be strictly deep-equal:");
  });
});
