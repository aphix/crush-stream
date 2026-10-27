import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { REST_SPEED } from "../vehicle/car-air-body.ts";
import { DT, fleetPair, frames, tick } from "./fleet-rest.test-util.ts";

/**
 * The capture's late sleep, staged: a pickup rocking just over rest speed within reach of the sleeping hatchback, not touching it, stirs it
 * (`stirNear`). A stir that leaves the wreck at rest costs it none of its rest (REPLAY 163), so it sleeps on; under the rule before, each
 * stir restarted its whole second of rest and the capture's hatchback slept late or never.
 */
/** Side by side, 0.6 m apart: within a sleeper's stir reach, clear of contact. */
const APART = 2.4;
/** The pickup's roll rate (rad/s) under and over rest speed: the capture's pickup rocked at 0.167 against 0.163. */
const TIP_UNDER = 0.9 * REST_SPEED;
const TIP_OVER = 1.04 * REST_SPEED;
const SETTLE_FRAMES = 4 / DT;
const WATCH_FRAMES = 3 / DT;

/** Wakes `car` turning at `rate` (rad/s) about its length. */
function rock(car: { wake(): void; angular: { z: number } }, rate: number): void {
  car.wake();
  car.angular.z = rate;
}

describe("given the fleet capture's hatchback, its front hubs popped, asleep as a wreck 0.6 m beside the pickup's sleeping wreck", () => {
  it(`when the pickup tips at ${TIP_UNDER.toFixed(3)} rad/s and then at ${TIP_OVER.toFixed(3)} rad/s (under, then over rest speed), then the hatchback, at rest itself, sleeps through both: a stir costs a resting wreck none of its rest`, () => {
    const { hatch, pickup, world } = fleetPair(APART);
    assert.ok(frames(world, SETTLE_FRAMES, () => hatch.asleep && pickup.asleep) > 0, "the pair never both slept");

    // The pickup rocks at a held rate: set before each frame, as its contacts damp a one-off spin inside the step, before the hatchback (the earlier slot) next reads it.
    for (let f = 0; f < WATCH_FRAMES; f++) {
      rock(pickup, TIP_UNDER);
      tick(world);
      assert.ok(hatch.asleep, `the hatchback woke ${f} frames after the pickup tipped under rest speed`);
    }
    for (let f = 0; f < WATCH_FRAMES; f++) {
      rock(pickup, TIP_OVER);
      tick(world);
      assert.ok(hatch.asleep, `the hatchback woke ${f} frames after the pickup tipped over rest speed (rest ${hatch.restS.toFixed(2)} s): a stir cost it its rest`);
    }
  });
});
