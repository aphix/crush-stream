import { describe, expect, it } from "vitest";
import { edgeCross, ridgeCross } from "./surfaces.ts";

describe("given a car body edge whose far end has run off to infinity (a bad impulse upstream)", () => {
  // mutation: sed -i '/^  if (len === Infinity) nonFinite("a body edge.s length", len);/d' src/game/world/surfaces.ts
  it("when the ground is read along it, then the game stops with an error naming the edge instead of halving the segment forever", () => {
    expect(() => edgeCross(0, 0, 0, Infinity, 0, 0, 0, 0, 0, 0, NaN, -1, 0)).toThrow(/body edge's length is Infinity/);
  });

  // mutation: sed -i '/^  if (len === Infinity) nonFinite("a body ridge.s length", len);/d' src/game/world/surfaces.ts
  it("when its ridge is read along it, then the game stops with an error naming the ridge instead of reading forever", () => {
    expect(() => ridgeCross(0, 0, 0, 0, 0, Infinity, -1, 0)).toThrow(/body ridge's length is Infinity/);
  });
});
