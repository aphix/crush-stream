import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { roundHalfUp } from "./cage-outline.ts";

describe("given a lattice coordinate between nodes", () => {
  const testCases = [
    { it: "when it stands on a tie above zero, then it rounds up as Math.round does", coordinate: 17.5 },
    { it: "when it stands on a tie below zero, then it rounds toward zero as Math.round does", coordinate: -1.5 },
    { it: "when it stands a rounding step under a tie, then it rounds down as Math.round does", coordinate: 2.4999999999999996 },
    { it: "when it stands the last double under one half, then it rounds to zero as Math.round does", coordinate: 0.49999999999999994 },
    { it: "when it stands the first double over one half, then it rounds to one as Math.round does", coordinate: 0.5000000000000001 },
    { it: "when it stands the last double over minus one half, then it rounds to zero as Math.round does", coordinate: -0.49999999999999994 },
    { it: "when it is far over a tie, then it rounds as Math.round does", coordinate: 100.50000000000001 },
    { it: "when it is negative and past a tie, then it rounds as Math.round does", coordinate: -3.7 },
  ] as const;

  for (const testCase of testCases) {
    it(testCase.it, () => {
      assert.equal(roundHalfUp(testCase.coordinate) | 0, Math.round(testCase.coordinate) | 0, "lattice index");
    });
  }
});
