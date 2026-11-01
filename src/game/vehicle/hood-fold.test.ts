import { describe, expect, it } from "vitest";
import { drawnField, TOP_P95_M, TOP_WORST_M, topGaps, topGapsOff, topParts } from "./drawn-body.test-util.ts";
import { hoodFoldAfterWall } from "./hood-fold.test-util.ts";

/**
 * A crushed hood buckles: the length the crush takes off its chord folds it out of its plane into a ridge on its crease line, the rear half turned
 * up from its rest and the front half down from it, not the whole panel turned alike about its cowl.
 */

/** Cases: a hit the hood's crush law does not yet answer (its yield, 0.10 m of crush), the 56 km/h wall (hinge value 0.31), then the last frame the hood stands at 166 km/h before it tears at 0.78. */
const wallCases = [
  { it: "when it hits the wall at 20 km/h, then the hood stays flat: its crest gains under 1 cm over the line between its ends and no third of its segments turns more than 15 deg from rest", kph: 20, hingeMoved: false, crestGainM: [-0.01, 0.01], rearDeg: [-15, 15], frontDeg: [-15, 15] },
  { it: "when it hits the wall at 56 km/h, then the hood's rear third turns up 8 deg or more from rest, its front third down 15 deg or more, and its crest gains 8 to 18 cm over the line between its ends", kph: 56, hingeMoved: true, crestGainM: [0.08, 0.18], rearDeg: [8, 60], frontDeg: [-60, -15] },
  { it: "when it hits the wall at 166 km/h, then the hood at its last frame on the car is a fold: its rear third turns up 15 deg or more from rest, its front third down 15 deg or more, and its crest gains 15 cm or more over the line between its ends", kph: 166, hingeMoved: true, crestGainM: [0.15, 0.4], rearDeg: [15, 70], frontDeg: [-70, -15] },
] as const;

describe("given a sedan driven square into a rigid wall", () => {
  for (const testCase of wallCases) {
    it(testCase.it, () => {
      const fold = hoodFoldAfterWall(testCase.kph);
      const [rear, , front] = fold.turnDeg;
      expect(fold.car.crashed, "the car crashed").toBe(true);
      expect(fold.hingeT > 0, "the hood's hinge value moved").toBe(testCase.hingeMoved);
      expect(fold.crestGainM, "crest height gained over the line between the hood's ends (m)").toBeGreaterThanOrEqual(testCase.crestGainM[0]);
      expect(fold.crestGainM, "crest height gained over the line between the hood's ends (m)").toBeLessThanOrEqual(testCase.crestGainM[1]);
      expect(rear, "mean turn of the hood's rear third of segments from rest (deg)").toBeGreaterThanOrEqual(testCase.rearDeg[0]);
      expect(rear, "mean turn of the hood's rear third of segments from rest (deg)").toBeLessThanOrEqual(testCase.rearDeg[1]);
      expect(front, "mean turn of the hood's front third of segments from rest (deg)").toBeGreaterThanOrEqual(testCase.frontDeg[0]);
      expect(front, "mean turn of the hood's front third of segments from rest (deg)").toBeLessThanOrEqual(testCase.frontDeg[1]);
    });
  }
});

describe("given a sedan that hit the wall at 56 km/h", () => {
  it(`when the surface other cars stand on is read over its buckled hood, then it lies within ${TOP_P95_M * 100} cm of the drawn hood (95th percentile) and ${TOP_WORST_M * 100} cm at worst`, () => {
    const { car } = hoodFoldAfterWall(56);
    const gaps = topGaps(car, drawnField(car), topParts(car.style.id).hood);
    expect(gaps.cells, "hood cells read").toBeGreaterThan(100);
    expect(topGapsOff("hood", gaps)).toHaveLength(0);
  });
});
