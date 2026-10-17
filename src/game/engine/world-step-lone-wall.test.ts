import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { setGround } from "../world/ground.ts";
import { makeWorld } from "../world/race-world.test-util.ts";
import { applyDrive, type DriveInput } from "../vehicle/car-drive.ts";
import { makeCar } from "../vehicle/ground-probe.test-util.ts";
import { launch, makeCar as makeShapeCar } from "../contact/crash-scenarios.test-util.ts";
import type { DeformableCar } from "../vehicle/car.ts";
import { FINE_HZ, QUIET_HZ, SLICES_PER_STEP } from "../kernel/constants.ts";
import { newWorld, settleStep, stepWorld } from "./world-step.ts";

/**
 * A lone car against the course's walls: Havana's alley wall (five 10 m panels across x = -40.25, approached from +x; `prop-wall.test.ts`), the car driven
 * at it at 40 m/s in steps of the pacer's coarse floor, with a pair parked far off holding every step cut to fine slices, so what the car's own state asks is the
 * only thing between one slice and three.
 */
const NEAR = -40.25 + 0.22;
const FAR = -40.25 - 0.22;
const COARSE = 1 / QUIET_HZ;
const FINE = 1 / FINE_HZ;
const TOWARD = -Math.PI / 2;
const SPEED = 40;
/** The car's centre this far (m) from the wall's near face at the start (the ground drops 4 m to the wall's foot over the approach: the car comes down onto it). */
const START_GAP = 40;
/** The steps after the start that are not judged: the car comes down onto the ground and a landing asks for finer slices (`contactHz`, 9 steps measured). */
const SETTLE_STEPS = 15;
/** The steps from the first sliced one that must be sliced: the hit's (measured: the crush window closes about 25 steps after it). */
const HIT_STEPS = 20;
/** The wall's first step with the car's nose within a step's travel of it (the 2.3 m of its half length and the step's 0.5 m): the car is nearly on it. */
const NEAR_STEP_GAP = 2.3 + SPEED * COARSE + 0.5;

afterEach(() => setGround(null));

interface Run {
  /** Per step: the car's centre's gap to the near face at the step's start (m), whether it was a lone car, and the slices the step ran. */
  rows: { gap: number; lone: boolean; slices: number }[];
  past: number;
  x: number;
  alive: boolean;
}

function drive(lone: boolean): Run {
  const w = makeWorld();
  w.race.showLobby("havana");
  const car = makeCar("sedan");
  const parked: DeformableCar[] = [makeShapeCar("shape"), makeShapeCar("shape")];
  launch(parked[0]!, 2000, 0, 0, 0, 0);
  launch(parked[1]!, 2003, 0, 0, 0, 0);
  const cars = [car, ...parked];
  const world = newWorld(cars);
  world.collide = (c, i, h) => w.race.courseHit(c, i, h);
  world.fine = FINE;
  world.lone = lone;
  car.spawnFacing(NEAR + START_GAP, 12, TOWARD, SPEED);
  car.velocity.set(-SPEED, 0, 0);
  const input: DriveInput = { throttle: 1, steer: 0, brake: 0, ebrake: false, boost: false };
  const rows: Run["rows"] = [];
  let past = 0;
  for (let s = 0; s < 3 * QUIET_HZ; s++) {
    const gap = car.group.position.x - NEAR;
    applyDrive(car, input, COARSE);
    stepWorld(world, COARSE);
    settleStep(cars, COARSE, false);
    rows.push({ gap, lone: (world.loners & 1) === 1, slices: world.shape + 1 });
    for (const m of car.deform.masses) past = Math.max(past, FAR - m.world.x);
  }
  const out = { rows, past, x: car.group.position.x, alive: car.deform.drivetrainAlive };
  for (const c of cars) c.dispose();
  return out;
}

describe("given a sedan driven at 40 m/s at Havana's alley wall from 40 m, in coarse steps all cut to fine slices by a pair parked far off", () => {
  it("when lone cars run, then it is lone until its nose is within a step's travel of the wall, from there on every step takes all the slices, and it never gets a mass past the wall's far face", () => {
    const run = drive(true);
    const far = run.rows.slice(SETTLE_STEPS).filter((r) => r.gap > NEAR_STEP_GAP + 1);
    assert.ok(far.length > 20, `${far.length} steps well clear of the wall`);
    const bad = far.find((r) => !r.lone || r.slices !== SLICES_PER_STEP);
    assert.equal(bad, undefined, `a step well clear of the wall is a lone car's: ${JSON.stringify(bad)} of ${JSON.stringify(far.slice(0, 3))}`);
    const first = run.rows.findIndex((r, s) => s >= SETTLE_STEPS && !r.lone);
    assert.ok(first > SETTLE_STEPS, "the car left the lone steps");
    assert.ok(run.rows[first]!.gap > 0.5 && run.rows[first]!.gap <= NEAR_STEP_GAP + 1, `the first sliced step starts ${run.rows[first]!.gap.toFixed(2)} m from the wall`);
    assert.ok(run.rows.slice(first, first + HIT_STEPS).every((r) => !r.lone && r.slices === SLICES_PER_STEP), "the hit's steps take all the slices");
    assert.equal(run.past, 0, "no mass past the far face");
  });

  it("when lone cars run and when they do not, then the sedan ends the 3 s within 5 cm of the same place with the same drivetrain health", () => {
    const lone = drive(true);
    const sliced = drive(false);
    assert.ok(sliced.rows.every((r) => !r.lone));
    assert.ok(Math.abs(lone.x - sliced.x) < 0.05, `${lone.x.toFixed(3)} against ${sliced.x.toFixed(3)} m`);
    assert.equal(lone.alive, sliced.alive);
  });
});
