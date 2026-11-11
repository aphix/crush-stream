import { describe, expect, it } from "vitest";
import { Ground } from "./ground.ts";
import { activate, C_H, HIT_SIZE, pointContact, PQ_SIZE, PQ_X, PQ_Y, PQ_Z } from "./surfaces.ts";

/**
 * A static surface of more patches than the index takes whole, each longer than the index's reach (`WIDE`), is tested patch by patch at
 * every query: `offerAll` passes over the ones whose box misses the point without calling `offer`, and must answer as the call would.
 */

const STRIPS = 12;
/** Longer than `WIDE` cells of the index, so no strip is listed by cell. */
const LENGTH = 1200;
const STRIP_DEPTH = 1;
/** Strip k lies over z in [2k, 2k + 1] at height k / 8. */
const STRIP_PITCH = 2;
const STEP_UP = 0.125;
const HALF = LENGTH / 2;

function stripGround(): Ground {
  const g = new Ground();
  for (let k = 0; k < STRIPS; k++) g.addPlane(k * STEP_UP, -HALF, HALF, k * STRIP_PITCH, k * STRIP_PITCH + STRIP_DEPTH, Infinity);
  return g;
}

function heightAt(x: number, z: number): number {
  const q = new Float64Array(PQ_SIZE);
  const out = new Float64Array(HIT_SIZE);
  q[PQ_X] = x;
  q[PQ_Z] = z;
  q[PQ_Y] = Infinity;
  pointContact(q, -1, out);
  return out[C_H]!;
}

describe("given twelve 1200 m strips side by side, each at its own height", () => {
  it("when a point lies on a strip's near corner, then that strip answers, its box edge included", () => {
    activate(stripGround());
    try {
      expect(heightAt(-HALF, 5 * STRIP_PITCH)).toBeCloseTo(5 * STEP_UP, 6);
      expect(heightAt(0, 7 * STRIP_PITCH + 0.5), "inside a strip").toBeCloseTo(7 * STEP_UP, 6);
    } finally {
      activate(null);
    }
  });

  it("when a point lies over no strip, then nothing answers", () => {
    activate(stripGround());
    try {
      expect(heightAt(0, STRIPS * STRIP_PITCH + 10)).toBe(-Infinity);
      expect(heightAt(HALF + 1, 0.5), "past a strip's end").toBe(-Infinity);
    } finally {
      activate(null);
    }
  });
});
