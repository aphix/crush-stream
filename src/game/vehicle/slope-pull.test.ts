import { after, afterEach, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import type { DeformableCar } from "./car.ts";
import { G } from "./car-air-body.ts";
import { energyOf } from "./energy.test-util.ts";
import { layOnWedge, RAD, stepSlices, Wedge, WEDGE_FOOT } from "./wedge.test-util.ts";
import { makeCar } from "./ground-probe.test-util.ts";
import { useStiffSprings } from "./stiff-springs.test-util.ts";
import { setGround } from "../world/ground.ts";

/**
 * A car coasting on its tyre springs over a face keeps the pull of gravity along it: on a face at angle θ a frictionless body gains
 * G·sin θ along the slope a second, G·sin θ·cos θ of it horizontal, uphill or down. The rigid step (`stepFree`) alone moves the car: no
 * drive, so nothing holds its speed but the contacts.
 */
const WEDGE_DEG = 10;
const COAST_S = 0.5;
const RATE_HZ = 240;
/** Most the gain may stray from the closed form (fraction of it): a slice's contact rounding, not a missing pull. */
const GAIN_TOLERANCE = 0.1;
const PULL = G * Math.sin(WEDGE_DEG * RAD) * Math.cos(WEDGE_DEG * RAD);

describe("given a car coasting along a 10° wedge's face on its tyre springs", () => {
  afterEach(() => setGround(null));

  const testCases = (["sedan", "monster"] as const).flatMap((cls) => [
    { it: `when a ${cls} coasts up the face at 6 m/s for ${COAST_S} s, then gravity has slowed it by G·sin·cos a second`, cls, yawDegrees: 90, startSpeedX: 6 },
    { it: `when a ${cls} coasts down the face at 6 m/s for ${COAST_S} s, then gravity has sped it up by G·sin·cos a second`, cls, yawDegrees: 270, startSpeedX: -6 },
  ]);
  for (const testCase of testCases) {
    it(testCase.it, () => {
      const wedge = new Wedge(WEDGE_DEG);
      setGround(wedge);
      const car = layOnWedge(testCase.cls, wedge, testCase.yawDegrees * RAD);
      car.velocity.set(testCase.startSpeedX, testCase.startSpeedX * Math.tan(WEDGE_DEG * RAD), 0);
      stepSlices(car, COAST_S, RATE_HZ);
      const gain = car.velocity.x - testCase.startSpeedX;
      const expected = -PULL * COAST_S;
      assert.ok(Math.abs(gain - expected) <= GAIN_TOLERANCE * Math.abs(expected), `horizontal speed changed by ${gain.toFixed(3)} m/s, gravity along the face gives ${expected.toFixed(3)}`);
    });
  }
});

/** The 10° rows above hold the pull to 10 %; a steeper face has to keep it, and no face may add energy to a coasting car. */
const STEEP_DEGREES = [20, 31, 40] as const;
const STEEP_PULL_TOLERANCE = 0.05;
/** The settle before the energy is read, and the window it is read over (s). */
const SETTLE_S = 0.25;
const ENERGY_WINDOW_S = 0.25;
/** Most mechanical energy (J/kg, a coasting 6 m/s car holds 18) a car may gain over the window: a slice's contact rounding, not a lift that pays no speed. */
const ENERGY_ROUNDING = 0.1;

const steepCases = (["sedan", "monster"] as const).flatMap((cls) =>
  STEEP_DEGREES.flatMap((deg) => [
    { cls, deg, up: true, way: "up", startSpeedX: 6 },
    { cls, deg, up: false, way: "down", startSpeedX: -6 },
  ]),
);

function stageOnSteepFace(c: (typeof steepCases)[number]): DeformableCar {
  const wedge = new Wedge(c.deg);
  setGround(wedge);
  const car = layOnWedge(c.cls, wedge, (c.up ? 90 : 270) * RAD);
  car.velocity.set(c.startSpeedX, c.startSpeedX * Math.tan(c.deg * RAD), 0);
  return car;
}

/**
 * The seconds a car is parked on its face before the pull is read: `layOnWedge` puts it there at its rest-ride compression, where the springs push the car's whole weight
 * straight up, and a body on a face needs only G n.y² of it (the normal load G cos, its vertical part). Released at once, the spring gives the surplus back (a monster at 40°: the
 * four pushes 1.0 of G·dt in total at slice 1, the front pair unloading to 0 by slice 55 with the rear pair at 0.27 each) and the tread's plan pull, the load's plan part, follows
 * that: +9.5 % of the window's speed change. A spring returning stored energy is not a pull off the law: a car that coasts on a face sits at the settled compression.
 */
const SETTLE_PARKED_S = 1;

/** `stageOnSteepFace`'s car, its springs settled on the face parked (its grip holds it), then let go at the face's own velocity. */
function settleOnFace(c: (typeof steepCases)[number], car: DeformableCar): void {
  car.velocity.set(0, 0, 0);
  car.parked = true;
  stepSlices(car, SETTLE_PARKED_S, RATE_HZ);
  car.parked = false;
  car.velocity.set(c.startSpeedX, c.startSpeedX * Math.tan(c.deg * RAD), 0);
}

describe("given a car coasting along a steep wedge face on its tyre springs", () => {
  afterEach(() => setGround(null));

  for (const c of steepCases) {
    it(`when a ${c.cls} coasts ${c.way} the ${c.deg}° face at 6 m/s for ${COAST_S} s from its settled compression, then gravity has changed its speed by G·sin·cos a second within 5 %`, () => {
      const car = stageOnSteepFace(c);
      settleOnFace(c, car);
      stepSlices(car, COAST_S, RATE_HZ);
      const gain = car.velocity.x - c.startSpeedX;
      const expected = -G * Math.sin(c.deg * RAD) * Math.cos(c.deg * RAD) * COAST_S;
      assert.ok(Math.abs(gain - expected) <= STEEP_PULL_TOLERANCE * Math.abs(expected), `horizontal speed changed by ${gain.toFixed(3)} m/s, gravity along the face gives ${expected.toFixed(3)}`);
    });
  }
});

describe("given a car coasting along a steep wedge face on springs so stiff that none of its energy is stored in them", () => {
  let restoreSprings = (): void => {};
  before(() => {
    restoreSprings = useStiffSprings();
  });
  after(() => restoreSprings());
  afterEach(() => setGround(null));

  for (const c of steepCases) {
    it(`when a ${c.cls} coasts ${c.way} the ${c.deg}° face at 6 m/s, then over ${ENERGY_WINDOW_S} s after it has settled it gains no energy`, () => {
      const car = stageOnSteepFace(c);
      stepSlices(car, SETTLE_S, RATE_HZ);
      const before = energyOf(car);
      stepSlices(car, ENERGY_WINDOW_S, RATE_HZ);
      const gain = energyOf(car) - before;
      assert.ok(gain <= ENERGY_ROUNDING, `the car gained ${gain.toFixed(3)} J/kg of the ${before.toFixed(1)} it had`);
    });
  }
});

/** A car coasting from flat road onto a face holds the energy it came with at most: it cannot climb higher than its speed lifts it. */
const MOUNT_DEGREES = [31, 40] as const;
const GENTLE_MOUNT_DEGREES = [10, 15, 20] as const;
const MOUNT_SPEEDS = [6, 10] as const;
const MOUNT_RUN_FROM_FOOT_M = 12;
const MOUNT_RUN_S = 5;
/** The run-up's length before the face's foot (m), and how far short of it the energy it came with is read: the car has settled from its drop and rolls steadily by then. */
const MOUNT_APPROACH_M = 12;
const MOUNT_READ_BEFORE_FOOT_M = 1;
/** Most the contacts may give a coasting car over the mount (J/kg): 3 % of the least energy a row holds (31), a kink's own rounding (the monster at 31° and 6 m/s reads 0.62 on the first slices of the face, stiff springs storing none). */
const MOUNT_GAIN_ROUNDING = 1;

type MountCase = { cls: "sedan" | "monster"; deg: number; speed: number };

const mountCases: MountCase[] = [
  ...(["sedan", "monster"] as const).flatMap((cls) => MOUNT_DEGREES.flatMap((deg) => MOUNT_SPEEDS.map((speed): MountCase => ({ cls, deg, speed })))),
  ...GENTLE_MOUNT_DEGREES.flatMap((deg) => MOUNT_SPEEDS.map((speed): MountCase => ({ cls: "sedan", deg, speed }))),
];

/** The most energy (J/kg) `c`'s car holds over the one it had a metre before the face's foot, and how far past the foot it was then. */
function mountGain(c: MountCase): { gain: number; start: number; at: number } {
  const wedge = new Wedge(c.deg);
  setGround(wedge);
  const car = makeCar(c.cls);
  car.spawnFacing(WEDGE_FOOT - MOUNT_APPROACH_M, 0, Math.PI / 2, c.speed);
  car.group.position.y = wedge.heightAt(car.group.position.x, 0, 0.5);
  while (car.group.position.x < WEDGE_FOOT - MOUNT_READ_BEFORE_FOOT_M) stepSlices(car, 1 / RATE_HZ, RATE_HZ);
  const start = energyOf(car);
  let peak = start;
  let at = 0;
  for (let s = 0; s < MOUNT_RUN_S * RATE_HZ && car.group.position.x < WEDGE_FOOT + MOUNT_RUN_FROM_FOOT_M && car.velocity.x > 0.2; s++) {
    stepSlices(car, 1 / RATE_HZ, RATE_HZ);
    const e = energyOf(car);
    if (e > peak) {
      peak = e;
      at = car.group.position.x - WEDGE_FOOT;
    }
  }
  return { gain: peak - start, start, at };
}

describe("given a car coasting from flat road onto a wedge face, on springs so stiff that none of its energy is stored in them", () => {
  let restoreSprings = (): void => {};
  before(() => {
    restoreSprings = useStiffSprings();
  });
  after(() => restoreSprings());
  afterEach(() => setGround(null));

  for (const c of mountCases) {
    it(`when a ${c.cls} coasts onto the ${c.deg}° face at ${c.speed} m/s, then it never holds more energy than it came with`, (t) => {
      const { gain, start, at } = mountGain(c);
      t.diagnostic(`${c.cls} ${c.deg}° at ${c.speed} m/s: ${gain >= 0 ? "+" : ""}${gain.toFixed(2)} J/kg of the ${start.toFixed(1)} it came with, ${at.toFixed(1)} m past the foot`);
      assert.ok(gain <= MOUNT_GAIN_ROUNDING, `the car held ${gain.toFixed(2)} J/kg more than the ${start.toFixed(1)} it came with, ${at.toFixed(1)} m past the foot`);
    });
  }
});
