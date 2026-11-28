import { afterEach, describe, expect, it } from "vitest";
import { launch, makeCar, makeWorld, tickWorld } from "./crash-scenarios.test-util.ts";
import { physicsSlice } from "./sat.ts";
import { zipBound } from "./zip-bound.test-util.ts";
import { stepWorld } from "../engine/world-step.ts";
import { FRAME_HZ } from "../kernel/constants.ts";
import { carState } from "../scenes/contact-parity.test-util.ts";
import { arenaWorld, placeDerby } from "../scenes/derby-arena.test-util.ts";
import { setGround } from "../world/ground.ts";
import type { DeformableCar } from "../vehicle/car.ts";

const FRAME = 1 / FRAME_HZ;
/** Km/h each striker meets the struck car at. */
const KPH = 20;
/** Clear air (m) between a striker's nose and the parked car's end: they meet within a fifth of a second. */
const GAP = 0.25;
/** Sim seconds a hit is run: contact is over well inside it. */
const RUN_S = 3;
/** Cars of the derby pile, and the seeds that squeeze the most cars (of the five measured). */
const DERBY_CARS = 16;
const DERBY_SECONDS = 14;
const DERBY_SPEED = 14;
const DERBY_SEEDS = [2, 4] as const;
/** The tail a car struck only at its nose keeps shut (mm): the sandwich's tail crushes tens of mm (38 at 20 km/h), the nose-only hit's is the rest offset. */
const TAIL_CLOSED_MM = 5;
const TAIL_CRUSHED_MM = 25;

afterEach(() => setGround(null));

/** The plan centroid of a car's dynamic masses into `out[at]`, `out[at + 1]` (the zip metric's point: the group origin follows the cell, not the body); false when it has none yet (no crash: the car is one rigid body). */
function centroid(car: DeformableCar, out: Float64Array, at: number): boolean {
  let x = 0;
  let z = 0;
  let mass = 0;
  for (const m of car.deform.masses) {
    if (!m.dynamic) continue;
    x += m.world.x * m.mass;
    z += m.world.z * m.mass;
    mass += m.mass;
  }
  out[at] = x / mass;
  out[at + 1] = z / mass;
  return mass > 0;
}

type Hit = { middle: DeformableCar; squeezed: boolean };

/** A parked car with a striker on each of `sides` (+1 its nose, -1 its tail, +2 its right flank) driving at it; whether it was ever squeezed (`bidirectional`) while the strikers ran in. */
function strike(sides: readonly (1 | -1 | 2)[]): Hit {
  const middle = makeCar("shape");
  middle.spawnFacing(0, 0, 0, 0);
  const cars = [middle];
  const v = KPH / 3.6;
  for (const side of sides) {
    const striker = makeCar("shape");
    const gap = middle.frame.half.z + striker.frame.half.z + GAP;
    if (side === 2) launch(striker, middle.frame.half.x + striker.frame.half.z + GAP, 0.08, -Math.PI / 2, -v, 0);
    else launch(striker, 0, side * gap, side > 0 ? Math.PI : 0, 0, -side * v);
    cars.push(striker);
  }
  const w = makeWorld(cars, false, false, null);
  let squeezed = false;
  for (let t = 0; t < RUN_S; t += FRAME) {
    tickWorld(w, FRAME);
    squeezed ||= middle.deform.bidirectional;
  }
  return { middle, squeezed };
}

describe("given a parked car with a car driving into each of its nose and tail at 20 km/h", () => {
  it("when the two hits land within the squeeze window, then the car is squeezed (both ends crumple zones) and its tail crushes where a nose-only hit leaves it shut", () => {
    const both = strike([1, -1]);
    const noseOnly = strike([1]);
    expect(both.squeezed, "the struck car was never squeezed").toBe(true);
    expect(noseOnly.squeezed, "a car struck at one end alone was squeezed").toBe(false);
    const tail = carState(both.middle).tailMm;
    const tailAlone = carState(noseOnly.middle).tailMm;
    expect(tailAlone, `tail of the nose-only hit ${tailAlone} mm`).toBeLessThanOrEqual(TAIL_CLOSED_MM);
    expect(tail, `tail of the sandwich ${tail} mm`).toBeGreaterThanOrEqual(TAIL_CRUSHED_MM);
  });

  it("when a car drives into its nose and another into its flank, then the car is not squeezed (a flank is no end)", () => {
    expect(strike([1, 2]).squeezed).toBe(false);
  });
});

describe("given 16 cars driving across the derby arena into a pile", () => {
  for (const seed of DERBY_SEEDS) {
    it(`when the pile runs ${DERBY_SECONDS} s (seed ${seed}) and cars are squeezed in it, then no car's centroid moves past its zip bound (3 x speed x step + 5 cm) in any step`, () => {
      const cars: DeformableCar[] = [];
      for (let i = 0; i < DERBY_CARS; i++) cars.push(makeCar("shape"));
      const { world } = arenaWorld(cars);
      placeDerby(cars, seed, DERBY_SPEED);
      const before = new Float64Array(2 * DERBY_CARS);
      const after = new Float64Array(2 * DERBY_CARS);
      const speedBefore = new Float64Array(DERBY_CARS);
      const measured = new Uint8Array(DERBY_CARS);
      let worstOver = -Infinity;
      let squeezedSlices = 0;
      for (let t = 0; t < DERBY_SECONDS; ) {
        let fastest = 0;
        for (const c of cars) fastest = Math.max(fastest, c.speed);
        const step = physicsSlice(FRAME, Math.max(8, fastest));
        for (let i = 0; i < DERBY_CARS; i++) {
          const c = cars[i]!;
          measured[i] = centroid(c, before, 2 * i) ? 1 : 0;
          speedBefore[i] = Math.hypot(c.velocity.x, c.velocity.z);
        }
        stepWorld(world, step);
        let any = false;
        for (let i = 0; i < DERBY_CARS; i++) {
          const c = cars[i]!;
          any ||= c.deform.bidirectional;
          if (!centroid(c, after, 2 * i) || measured[i] === 0) continue;
          const moved = Math.hypot(after[2 * i]! - before[2 * i]!, after[2 * i + 1]! - before[2 * i + 1]!);
          const bound = zipBound(Math.max(speedBefore[i]!, Math.hypot(c.velocity.x, c.velocity.z)), step);
          worstOver = Math.max(worstOver, moved - bound);
        }
        if (any) squeezedSlices++;
        t += step;
      }
      expect(squeezedSlices, "no car was squeezed in the pile: the check proved nothing").toBeGreaterThan(0);
      expect(worstOver, `a car's centroid moved ${(worstOver * 1000).toFixed(1)} mm past its zip bound`).toBeLessThanOrEqual(0);
    });
  }
});
