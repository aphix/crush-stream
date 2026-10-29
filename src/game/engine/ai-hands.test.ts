import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as THREE from "three";
import { idleDrive, THROTTLE_STEPS, type DriveInput } from "../vehicle/car-drive.ts";
import { applyAiDrive, FADE_S, InputFade } from "../ai/input-fade.ts";
import { DeformableCar } from "../vehicle/car.ts";
import { FEEL } from "../vehicle/drive-input.ts";
import type { CrashEngine } from "./engine.ts";
import { benchPlanEngine, disposeBenchEngine } from "./engine-bench-headless.test-util.ts";
import { FINE_HZ, FRAME_HZ, QUIET_HZ } from "../kernel/constants.ts";

/** The coarse step a phone runs (s). */
const STEP = 1 / QUIET_HZ;
/** A speed (m/s) at which the wheel fades by its whole time constant. */
const FAST = 30;
const GAS: DriveInput = { ...idleDrive(), throttle: 1 };

describe("given an AI driver's hands (`InputFade`)", () => {
  it("when it asks for full gas, then 0.06 s later (one time constant) the pedal is 63 % of the way, the same at 1/240, 1/120 and 1/60 s steps", () => {
    for (const steps of [29, 14, 7]) {
      const dt = FADE_S.throttle / steps;
      const hands = new InputFade();
      let throttle = 0;
      for (let s = 0; s < steps; s++) throttle = hands.fade(0, GAS, dt, FAST).throttle;
      expect(Math.abs(throttle - (1 - Math.exp(-1))), `${throttle.toFixed(6)} after ${steps} steps`).toBeLessThan(1e-9);
    }
  });

  it("when the car is crawling (3 m/s) the wheel follows the driver in a fifth of the time constant it has at 15 m/s and above, and stopped it follows at once", () => {
    const steps = (speed: number): number => {
      const hands = new InputFade();
      let n = 0;
      while (hands.fade(0, { ...idleDrive(), steer: 1 }, STEP, speed).steer < 0.63 && n < 1000) n++;
      return n * STEP;
    };
    expect(Math.abs(steps(30) - FADE_S.steer), `at 30 m/s ${steps(30).toFixed(3)} s`).toBeLessThan(STEP);
    expect(Math.abs(steps(3) - FADE_S.steer / 5), `at 3 m/s ${steps(3).toFixed(3)} s`).toBeLessThan(STEP);
    expect(steps(0), "stopped").toBe(0);
  });

  it("when it flips between gas and brake every step, then neither pedal ever moves by more than a few percent a step and the mean is what the flips average to", () => {
    const hands = new InputFade();
    let worst = 0;
    let before = 0;
    let sum = 0;
    for (let s = 0; s < 400; s++) {
      const out = hands.fade(0, s % 2 === 0 ? GAS : { ...idleDrive(), brake: 1 }, STEP, FAST);
      worst = Math.max(worst, Math.abs(out.throttle - before));
      before = out.throttle;
      sum += out.throttle;
    }
    expect(worst, `a pedal moved ${worst.toFixed(3)} in one step`).toBeLessThan(0.2);
    expect(Math.abs(sum / 400 - 0.5), `mean gas ${(sum / 400).toFixed(3)}`).toBeLessThan(0.1);
  });

  it("when the handbrake is asked for one step, then it is not pressed; asked for a tenth of a second it is, and it stays until let go for as long", () => {
    const hands = new InputFade();
    expect(hands.fade(0, { ...idleDrive(), ebrake: true }, STEP, FAST).ebrake, "one step").toBe(false);
    expect(hands.fade(0, idleDrive(), STEP, FAST).ebrake).toBe(false);
    let on = false;
    for (let t = 0; t < 0.2; t += STEP) on = hands.fade(0, { ...idleDrive(), ebrake: true }, STEP, FAST).ebrake;
    expect(on, "asked 0.2 s").toBe(true);
    expect(hands.fade(0, idleDrive(), STEP, FAST).ebrake, "let go for one step").toBe(true);
  });

  it("when another driver had the car (`follow`), then the hands take over from where it left the pedals", () => {
    const hands = new InputFade();
    hands.follow(3, { ...idleDrive(), throttle: 0.8, steer: -0.4 });
    const out = hands.fade(3, { ...idleDrive(), throttle: 0.8, steer: -0.4 }, STEP, FAST);
    expect(Math.abs(out.throttle - 0.8) < 1e-9 && Math.abs(out.steer + 0.4) < 1e-9).toBeTruthy();
  });

  it("when the car is put on a spot (its placements count moves), then its first step there is what the driver asks, not a fade from the pedals it had where it was; with the count unmoved it fades as ever", () => {
    const ask = { ...idleDrive(), brake: 0.7, steer: -0.2 };
    const hands = new InputFade();
    for (let s = 0; s < 100; s++) hands.fade(0, { ...idleDrive(), throttle: 1 }, STEP, FAST, 1);
    const placed = hands.fade(0, ask, STEP, FAST, 2);
    expect(Math.abs(placed.brake - 0.7) < 1e-9 && Math.abs(placed.steer + 0.2) < 1e-9 && placed.throttle === 0, `brake ${placed.brake.toFixed(3)}, steer ${placed.steer.toFixed(3)}, gas ${placed.throttle.toFixed(3)}`).toBeTruthy();
    const next = hands.fade(0, { ...idleDrive(), throttle: 1 }, STEP, FAST, 2);
    expect(next.throttle > 0 && next.throttle < 0.5, "and fades from there on").toBeTruthy();
  });
});

describe("given a sedan at 25 m/s driven by an AI driver (`applyAiDrive`, every AI's way to the drive)", () => {
  it("when the driver flips between full left and full right lock every step, then the wheel the car runs moves no faster than a pad player's (12 of lock a second, on the byte grid), at 1/240, 1/80 and 1/60 s steps; then held at full lock, it gets there moving the pad's whole bytes a step", () => {
    for (const dt of [1 / FINE_HZ, 1 / QUIET_HZ, 1 / FRAME_HZ]) {
      const car = new DeformableCar({ body: 0xc5c8ce, accent: 0x9aa0a8, name: "hands" }, new THREE.Scene());
      car.spawnFacing(0, 0, 0, 25);
      const reach = FEEL.steerPad * dt + 0.5 / THROTTLE_STEPS + 1e-9;
      let worst = 0;
      for (let s = 0; s < 30; s++) {
        const was = car.drive.steer;
        applyAiDrive(car, { ...idleDrive(), steer: s % 2 === 0 ? 1 : -1 }, dt);
        worst = Math.max(worst, Math.abs(car.drive.steer - was));
      }
      expect(worst > 0 && worst <= reach, `${(1 / dt).toFixed(0)} Hz: the wheel moved ${worst.toFixed(4)} in a step, a pad's reach ${reach.toFixed(4)}`).toBeTruthy();
      const from = car.drive.steer;
      let steps = 0;
      while (car.drive.steer < 1 && steps < 100) {
        applyAiDrive(car, { ...idleDrive(), steer: 1 }, dt);
        steps++;
      }
      const bytes = Math.floor(FEEL.steerPad * dt * THROTTLE_STEPS);
      expect(steps, `${(1 / dt).toFixed(0)} Hz: full lock from ${from.toFixed(3)} in ${steps} steps of ${bytes} bytes`).toBeLessThanOrEqual(Math.ceil(((1 - from) * THROTTLE_STEPS) / bytes));
    }
  });
});

/** The strip's first 30 s of race, the bench card's own (`?bench=strip`, seed 1, the AI drives the player's sedan). */
const RACE_S = 30;
/** Steps the engine takes in the window: one per frame at the phone's coarse step. */
const STEPS = Math.round(RACE_S / STEP);

interface Sample {
  steer: number;
  throttle: number;
  brake: number;
  roll: number;
  crashed: boolean;
}

/** Every step's pedals and drawn body roll (rad) of car 0 for the window, after the race starts. */
function runWindow(engine: CrashEngine): Sample[] {
  const out: Sample[] = [];
  engine.pace.pin = true;
  for (let i = 0; i < 80 * 20 && engine["race"].phase !== "racing"; i++) engine.advance(STEP, { frameDt: STEP });
  for (let s = 0; s < STEPS; s++) {
    engine.advance(STEP, { frameDt: STEP });
    const car = engine["live"]()[0]!;
    const body = car.suspension["body"] as { rotation: { z: number } } | null;
    out.push({ steer: car.drive.steer, throttle: car.drive.throttle, brake: car.drive.brake, roll: body ? body.rotation.z : 0, crashed: car.crashed });
  }
  return out;
}

/** Direction reversals a second of `xs` among its jumps over `jump` between steps. */
function reversalsPerS(xs: readonly number[], jump: number): number {
  let reversals = 0;
  let last = 0;
  for (let i = 1; i < xs.length; i++) {
    const d = xs[i]! - xs[i - 1]!;
    if (Math.abs(d) <= jump) continue;
    if (last !== 0 && Math.sign(d) !== last) reversals++;
    last = Math.sign(d);
  }
  return reversals / (xs.length * STEP);
}

/** Swings of `xs` (alternations between extremes at least `amp` apart) a second: the back-and-forth a viewer follows. */
function swingsPerS(xs: readonly number[], amp: number): number {
  let swings = 0;
  let pivot = xs[0]!;
  let dir = 0;
  for (const x of xs) {
    if (dir === 0) {
      if (x - pivot >= amp) dir = 1;
      else if (pivot - x >= amp) dir = -1;
      if (dir !== 0) pivot = x;
    } else if (dir === 1) {
      if (x > pivot) pivot = x;
      else if (pivot - x >= amp) {
        swings++;
        dir = -1;
        pivot = x;
      }
    } else if (x < pivot) pivot = x;
    else if (x - pivot >= amp) {
      swings++;
      dir = 1;
      pivot = x;
    }
  }
  return swings / (xs.length * STEP);
}

/** Steps a second of `xs` whose jump from the step before is over `jump`. */
function jumpsPerS(xs: readonly number[], jump: number): number {
  let n = 0;
  for (let i = 1; i < xs.length; i++) if (Math.abs(xs[i]! - xs[i - 1]!) > jump) n++;
  return n / (xs.length * STEP);
}
/** The pedals' direction reversals a second, over jumps this big (of full travel): a hand does not reverse a pedal 5 times a second; a racer on main did 4-30. */
const MOST_REVERSALS = 2;
/** The wheel's, which the contact guard's avoidance also moves (a swerve and its return are two): main's racer reversed it 32 times a second. */
const MOST_STEER_REVERSALS = 3;
const PEDAL_JUMP = 0.05;
/** The wheel's jump per step: only the contact guard's avoidance onsets exceed it (0.1 a second); main's racer did 5 and more. */
const STEER_JUMP = 0.2;
const MOST_BIG_JUMPS = 0.25;
/** Wheel swings (0.1 of lock apart) a second: main's racer swung it 32 times, the contact guard's swerves swing it 3. */
const MOST_STEER_SWINGS = 4;
/** The drawn body's roll swings (1.5 degrees apart) a second: main's racer 16-22, a calm one 1 to 2. */
const ROLL_SWING_DEG = 1.5;
const MOST_ROLL_SWINGS = 3;
/** The first seconds are the grid's launch; the window judged starts after them. */
const SETTLE_STEPS = 5 * QUIET_HZ;

describe("given the bench strip's first 30 s with the AI driving the player's sedan", () => {
  let engine: CrashEngine;
  let samples: Sample[];
  beforeAll(async () => {
    engine = await benchPlanEngine("?bench=strip");
    samples = runWindow(engine);
  });
  afterAll(() => disposeBenchEngine(engine));

  it("when it drives, then the wheel and the pedals do not reverse at the step rate and a step seldom jumps the wheel by more than a fifth of lock", () => {
    const judged = samples.slice(SETTLE_STEPS).filter((s) => !s.crashed);
    expect(judged.length, `${judged.length} steps judged`).toBeGreaterThan(15 * QUIET_HZ);
    const steer = judged.map((s) => s.steer);
    const jump = Math.max(...steer.slice(1).map((v, i) => Math.abs(v - steer[i]!)));
    expect(jumpsPerS(steer, STEER_JUMP), `big wheel jumps a second ${jumpsPerS(steer, STEER_JUMP).toFixed(2)}, the largest ${jump.toFixed(3)} of lock`).toBeLessThanOrEqual(MOST_BIG_JUMPS);
    expect(reversalsPerS(steer, PEDAL_JUMP), `wheel reversals a second ${reversalsPerS(steer, PEDAL_JUMP).toFixed(2)}`).toBeLessThanOrEqual(MOST_STEER_REVERSALS);
    expect(reversalsPerS(judged.map((s) => s.throttle), PEDAL_JUMP), "gas reversals a second").toBeLessThanOrEqual(MOST_REVERSALS);
    expect(reversalsPerS(judged.map((s) => s.brake), PEDAL_JUMP), "brake reversals a second").toBeLessThanOrEqual(MOST_REVERSALS);
    expect(swingsPerS(steer, 0.1), `wheel swings a second ${swingsPerS(steer, 0.1).toFixed(2)}`).toBeLessThanOrEqual(MOST_STEER_SWINGS);
  });

  it("when it drives, then the drawn body does not rock left and right: its roll swings (1.5 degrees apart) no more than 3 times a second", () => {
    const judged = samples.slice(SETTLE_STEPS).filter((s) => !s.crashed);
    const swings = swingsPerS(judged.map((s) => (s.roll * 180) / Math.PI), ROLL_SWING_DEG);
    expect(swings, `roll swings a second ${swings.toFixed(2)}`).toBeLessThanOrEqual(MOST_ROLL_SWINGS);
  });
});
