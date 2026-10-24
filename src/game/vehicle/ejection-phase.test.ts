import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { collide, type Hit } from "./ejection.test-util.ts";
import type { VehicleClassId } from "./vehicle-classes.ts";

/**
 * A hit's outcome must not depend on which slice of the step the cages first meet in: the same pair, a m/s faster, never leaves the
 * striker healthier. The speeds are the ones a step-phase sawtooth showed up at, one m/s apart: the first overlap's patch (the nodes of
 * the striker's outline the look-ahead reaches) landed on a lifted body's low or high parts by the slice, and the crush took it from the
 * masses it was near.
 */

/** Health may only fall as the speed rises: a faster hit leaves at most this much more (the stop slice's own jitter: the largest rise over the 1 m/s sweeps is 0.026, where the step phase made 0.14). */
const HEALTH_JITTER = 0.03;

type Case = { hit: Hit; striker: VehicleClassId; struck: VehicleClassId; speeds: readonly number[] };

const CASES: readonly Case[] = [
  { hit: "t-bone", striker: "monster", struck: "sedan", speeds: [41, 42, 43, 44, 45, 46] },
  { hit: "rear-end", striker: "sedan", struck: "monster", speeds: [29, 30, 31, 35, 36, 37, 39, 40, 41, 44, 45] },
  { hit: "t-bone", striker: "monster", struck: "suv", speeds: [34, 35, 36, 37, 38, 39, 40] },
];

describe("given a car driving into a monster truck, or a monster truck into a car, standing on their wheels", () => {
  for (const { hit, striker, struck, speeds } of CASES) {
    it(`when a ${hit} of a ${striker} into a ${struck} is made faster by 1 m/s (${speeds.join(", ")} m/s), then the striker's engine is never healthier for it`, () => {
      let prev = Infinity;
      let prevMps = 0;
      for (const mps of speeds) {
        const [now] = collide(hit, striker, struck, mps);
        assert.ok(now.health <= prev + HEALTH_JITTER, `${hit} ${striker} into ${struck}: ${prevMps} -> ${mps} m/s: striker health ${prev.toFixed(2)} -> ${now.health.toFixed(2)}`);
        prev = now.health;
        prevMps = mps;
      }
    });
  }
});
