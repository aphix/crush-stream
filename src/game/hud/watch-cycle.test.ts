import { describe, expect, it } from "vitest";
import { showsPrevNext } from "./watch-cycle.ts";

describe("given the camera and the targets Previous / Next could reach", () => {
  const cases = [
    { it: "when a car is followed and there are no targets, then there are no Previous / Next", seat: "follow", watchTargets: 0, expected: false },
    { it: "when a car is followed and it is the only target, then there are no Previous / Next", seat: "follow", watchTargets: 1, expected: false },
    { it: "when a car is followed and there are two targets, then Previous / Next show", seat: "follow", watchTargets: 2, expected: true },
    { it: "when a car is followed and there are many targets, then Previous / Next show", seat: "follow", watchTargets: 14, expected: true },
    { it: "when the whole field is in view (nothing watched) with many cars, then there are no Previous / Next", seat: "global", watchTargets: 14, expected: false },
    { it: "when the player is at the wheel with many cars, then there are no Previous / Next", seat: "drive", watchTargets: 14, expected: false },
  ] as const;
  for (const testCase of cases) {
    it(testCase.it, () => expect(showsPrevNext({ seat: testCase.seat, watchTargets: testCase.watchTargets })).toBe(testCase.expected));
  }
});
