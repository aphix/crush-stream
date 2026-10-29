import { describe, expect, it } from "vitest";
import { BODIES, carInState, cellI, cellJ, drawnField, NX } from "./drawn-body.test-util.ts";
import { CAR_STYLES } from "./car-variants.ts";

/** Roof cells read, in from the roof's ends (m) and across its middle (|x|, m): its flat top, not the pillars and rolled lips. */
const END_MARGIN_M = 0.1;
const MIDDLE_HALF_M = 0.3;
/** A cell is roof when the untouched body is this high over the origin (m). */
const ROOF_Y_M = 1;
/** The roof's slowest-dropping tenth of cells must have dropped this far (m), a quarter of the 0.40 m load crush: the skin hangs on the crushed roof mass over its whole length, not on a point further along it. */
const FOLLOW_MIN_M = 0.1;
const TENTH = 0.1;

/** The drop (m) of the drawn roof's slowest tenth of cells between `before` and `after`, over the roof span of `roofZ`. */
function slowestTenth(before: Float32Array, after: Float32Array, roofZ: readonly [number, number]): number {
  const drops: number[] = [];
  for (let j = cellJ(roofZ[0] + END_MARGIN_M); j <= cellJ(roofZ[1] - END_MARGIN_M); j++) {
    for (let i = cellI(-MIDDLE_HALF_M); i <= cellI(MIDDLE_HALF_M); i++) {
      const [y0, y1] = [before[j * NX + i]!, after[j * NX + i]!];
      if (Number.isFinite(y0) && Number.isFinite(y1) && y0 > ROOF_Y_M) drops.push(y0 - y1);
    }
  }
  expect(drops.length, `the roof's cells read: ${drops.length}`).toBeGreaterThan(50);
  drops.sort((p, q) => p - q);
  return drops[Math.floor(drops.length * TENTH)]!;
}

describe("given a body whose roof a load crushes 0.40 m", () => {
  for (const b of BODIES) {
    it(`when the ${b.body}'s drawn roof is read over its length, then even its slowest-dropping tenth has dropped ${FOLLOW_MIN_M * 100} cm, the skin following the crushed roof mass`, () => {
      const before = drawnField(carInState("untouched", b.style, b.cls)).top;
      const after = drawnField(carInState("loaded", b.style, b.cls)).top;
      const drop = slowestTenth(before, after, CAR_STYLES[b.style].roofZ);
      expect(drop, `${b.body}: the roof's slowest tenth dropped ${drop.toFixed(3)} m (bar ${FOLLOW_MIN_M} m)`).toBeGreaterThanOrEqual(FOLLOW_MIN_M);
    });
  }
});
