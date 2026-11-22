import { describe, expect, it } from "vitest";
import { edgeCross, ridgeCross } from "./surfaces.ts";

/** A body segment a kilometre long: ten times the bound, two hundred times any car; read without the guard it returns (or reads its 20 000 points) well inside a second, so the rows go red by themselves. */
const THROWN_APART_M = 1000;

describe("given a car body segment whose far end has been thrown a kilometre off (a bad impulse upstream)", () => {
  // mutation: sed -i '/^  if (len > CROSS_MAX_LEN) nonFinite("a body edge.s length", len);/d' src/game/world/surfaces.ts
  it("when the ground is read along it, then the game stops with an error naming the edge instead of reading on (past 1e12 m the halving never ends)", () => {
    expect(() => edgeCross(0, 0, 0, THROWN_APART_M, 0, 0, 0, 0, 0, 0, NaN, -1, 0)).toThrow(/body edge's length is 1000/);
  });

  // mutation: sed -i '/^  if (len > CROSS_MAX_LEN) nonFinite("a body ridge.s length", len);/d' src/game/world/surfaces.ts
  it("when its ridge is read along it, then the game stops with an error naming the ridge instead of reading tens of thousands of points (infinitely many for an infinite one)", () => {
    expect(() => ridgeCross(0, 0, 0, 0, 0, THROWN_APART_M, -1, 0)).toThrow(/body ridge's length is 1000/);
  });

  it("when a segment's end is NaN, then the reads return nothing, as before (guard)", () => {
    expect(edgeCross(0, 0, 0, NaN, 0, 0, 0, 0, 0, 0, NaN, -1, 0), "edge").toBe(-Infinity);
    expect(ridgeCross(0, 0, 0, NaN, 0, 0, -1, 0), "ridge").toBe(-Infinity);
  });
});
