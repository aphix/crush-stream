import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { CAGE_STEP } from "../vehicle/car-cage.ts";
import { WRECK_REST_S } from "../vehicle/car.ts";
import { satCars } from "../contact/sat.ts";
import { DT, fleetPair, frames, tick } from "./fleet-rest.test-util.ts";

/** How deep (m) the capture's crash left the hatchback's sill in the road. */
const SILL_SINK = 0.044;
/** The rise out of the road is monotone: at most this many turns of the hatchback's height; a turn under `TURN_MM` (mm) is rounding. */
const MAX_TURNS = 2;
const TURN_MM = 0.3;
/** The rise runs inside the rest, so the sunk hatchback sleeps one rest after it wakes, give or take a few frames (the 21 Hz hop kept it awake 2.1 s). */
const RISE_SLEEPS_BY = WRECK_REST_S + 0.1;
/** Side by side, 0.6 m apart; and 15 cm into each other (the capture's pair stood 10-21 cm in). */
const APART = 2.4;
const INSIDE = 1.45;
const INSIDE_AT_LEAST = 0.1;
/** The most (m) two resting cars overlap: the resolution of the cage outlines. */
const MAX_OVERLAP = CAGE_STEP;
const SETTLE_FRAMES = 4 / DT;

const _n = new THREE.Vector3();
const _p = new THREE.Vector3();

describe("given the fleet capture's hatchback, its front hubs popped, asleep as a wreck beside the pickup's wreck on flat road", () => {
  it(`when its sill is sunk ${SILL_SINK * 1000} mm in the road, then it rises out without a hop (at most ${MAX_TURNS} turns of its height) and sleeps within ${RISE_SLEEPS_BY} s`, () => {
    const { hatch, world } = fleetPair(APART);
    expect(frames(world, SETTLE_FRAMES, () => hatch.asleep), "the hatchback never slept on the road").toBeGreaterThan(0);
    hatch.wake();
    hatch.group.position.y -= SILL_SINK;
    for (const m of hatch.deform.masses) m.world.y -= SILL_SINK;
    let turns = 0;
    let lastDy = 0;
    let lastY = hatch.group.position.y * 1000;
    const slept = frames(world, SETTLE_FRAMES, () => {
      const y = hatch.group.position.y * 1000;
      const dy = y - lastY;
      if (Math.abs(dy) > TURN_MM) {
        if (lastDy * dy < 0) turns++;
        lastDy = dy;
      }
      lastY = y;
      return hatch.asleep;
    });
    expect(slept, "the sunk hatchback never slept").toBeGreaterThan(0);
    expect(turns, `its height turned ${turns} times on the way out`).toBeLessThanOrEqual(MAX_TURNS);
    expect(slept * DT, `it slept ${(slept * DT).toFixed(3)} s after it was sunk`).toBeLessThanOrEqual(RISE_SLEEPS_BY);
  });

  it(`when the pickup stands ${(INSIDE_AT_LEAST * 100).toFixed(0)} cm or more into the hatchback's side and both come to rest, then they rest no more than ${MAX_OVERLAP * 100} cm into each other`, () => {
    const { hatch, pickup, world } = fleetPair(INSIDE);
    const before = satCars(hatch, pickup, _n, _p, 0) ?? 0;
    expect(before, `staged only ${(before * 100).toFixed(1)} cm in`).toBeGreaterThanOrEqual(INSIDE_AT_LEAST);
    expect(frames(world, SETTLE_FRAMES, () => hatch.asleep && pickup.asleep), "the pair never both slept").toBeGreaterThan(0);
    tick(world);
    const after = satCars(hatch, pickup, _n, _p, 0) ?? 0;
    expect(after, `they rest ${(after * 100).toFixed(1)} cm into each other`).toBeLessThanOrEqual(MAX_OVERLAP);
  });
});
