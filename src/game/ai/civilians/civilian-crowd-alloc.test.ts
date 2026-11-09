import { beforeAll, describe, expect, it } from "vitest";
import { pooledCar } from "../../contact/crash-scenarios.test-util.ts";
import { allocatedBytes, untilQuiet } from "../../kernel/alloc-sample.test-util.ts";
import type { DeformableCar } from "../../vehicle/car.ts";
import type { CivilianCrowd } from "./civilian-crowd.ts";
import { buildFixtureMap } from "./civilian-graph.test-util.ts";
import { newCrowd } from "./civilian-crowd.test-util.ts";

const RESIDENTS = 300;
/** Homes enough for 300 residents at the brain's household sizes. */
const EXTRA_HOMES_PER_BLOCK = 14;
const CARS = 8;
/** Cars parked far from every street: the hit loop runs over all of them and hits nobody. */
const PARKED = 5000;
/** A decision tick is half a second: a run's frames all fall in one, so no frame advances the brain (that allocates, twice a second). */
const FRAME_SECONDS = 1 / 64;
const FRAMES_PER_TICK = 31;
const WARM_SECONDS = 200;
const WARM_STEP = 1 / 16;
const MEASURED_FRAMES = 300;
/** The sampling profiler's own cost is 4-5 KB of a read; a frame that makes one object reads far above this. */
const BOUND_KB = 8;
/** Vectors the control makes each frame: far more than the bound's worth. */
const CONTROL_VECTORS = 200;
/** Mean microseconds a frame of the crowd's step (placing 300 civilians and testing 8 cars against them) costs on the main thread: measured at 29 us a frame on the dev box, bounded at twice that. */
const BOUND_MICROS = 58;
const TIMED_FRAMES = 4000;

let crowd: CivilianCrowd;
let cars: DeformableCar[];
let tickStart = 0;

/** The crowd warmed through `WARM_SECONDS`, in the middle of a day with most of its civilians out and about. */
beforeAll(() => {
  crowd = newCrowd(buildFixtureMap(EXTRA_HOMES_PER_BLOCK), RESIDENTS);
  cars = Array.from({ length: CARS }, (_, slot) => {
    const car = pooledCar(slot);
    car.group.position.set(PARKED + slot * 10, 0, PARKED);
    return car;
  });
  for (let seconds = WARM_STEP; seconds <= WARM_SECONDS; seconds += WARM_STEP) crowd.step(seconds, cars, true);
  tickStart = WARM_SECONDS;
});

/** `frames` steps at the crowd times inside the current decision tick, then the next tick is entered (outside any read). */
function stepWithinTick(frames: number, between?: () => void): void {
  for (let frame = 0; frame < frames; frame++) {
    crowd.step(tickStart + (frame % FRAMES_PER_TICK) * FRAME_SECONDS, cars, true);
    between?.();
  }
}

function startNextTick(): void {
  tickStart += 0.5;
  crowd.step(tickStart, cars, true);
}

/** KB a read of `MEASURED_FRAMES` frames allocates; `between` runs after each frame. */
function readKb(between?: () => void): number {
  startNextTick();
  return allocatedBytes(() => stepWithinTick(MEASURED_FRAMES, between)) / 1024;
}

describe("given a warmed crowd of 300 civilians among eight parked cars", () => {
  it("when it steps frames within a tick, then it allocates nothing of its own (the profiler's own cost is under the bound)", () => {
    expect(untilQuiet(() => readKb(), BOUND_KB), "KB over the run").toBeLessThanOrEqual(BOUND_KB);
  });

  it("when each frame is followed by a few dozen small objects (the control), then the same read sees them", () => {
    const kept: Float32Array[] = [];
    const makeVectors = (): void => void (kept[kept.length % CONTROL_VECTORS] = new Float32Array(3));
    expect(readKb(() => Array.from({ length: CONTROL_VECTORS }, makeVectors)), "KB over the run").toBeGreaterThan(BOUND_KB);
  });

  it(`when it steps, then a frame's step costs under ${BOUND_MICROS} us on average`, () => {
    untilQuiet(() => readKb(), BOUND_KB);
    startNextTick();
    const start = performance.now();
    stepWithinTick(TIMED_FRAMES);
    const micros = ((performance.now() - start) * 1000) / TIMED_FRAMES;
    expect(micros, "mean us a frame").toBeLessThan(BOUND_MICROS);
  });
});
