import { beforeAll, describe, expect, it } from "vitest";
import { pooledCar } from "../../contact/crash-scenarios.test-util.ts";
import { allocatedBytes, untilQuiet, yardstickMicros } from "../../kernel/alloc-sample.test-util.ts";
import type { DeformableCar } from "../../vehicle/car.ts";
import { Stoops } from "../../world/openworld/openworld-stoops.ts";
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
/**
 * A frame's mean step cost (placing 300 civilians and testing 8 cars against them) over `yardstickMicros()`, so the bound holds
 * on a slow box as on a fast one. Three reads on the dev box (step us / yardstick us): 60.37 / 60.53, 53.68 / 50.65,
 * 60.46 / 59.60; the middle ratio 1.014, doubled and rounded up.
 */
const BOUND_RATIO = 2.1;
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

  // mutation: sed -i 's/const x = xs\[at\]!;/(globalThis as { kept?: unknown }).kept = new Float32Array(3); const x = xs[at]!;/' src/game/world/openworld/openworld-stoops.ts
  it("when every street node is a stoop's door, then walkers cross the steps and the frames still allocate nothing", () => {
    const { nodeX, nodeZ } = buildFixtureMap(EXTRA_HOMES_PER_BLOCK).graph;
    const frontages = Array.from(nodeX, (x, node) => ({ x, z: nodeZ[node]!, yaw: 0, depth: 10, style: "federal" as const, storeys: 3, variant: 0 }));
    crowd.stoops = new Stoops(frontages, Array.from(nodeX, (_, node) => node));
    const kb = untilQuiet(() => readKb(), BOUND_KB);
    let lifted = 0;
    startNextTick();
    stepWithinTick(MEASURED_FRAMES, () => void (lifted += crowd.poses.feetY.some((feetY) => feetY > 0) ? 1 : 0));
    crowd.stoops = null;
    expect(kb, "KB over the run").toBeLessThanOrEqual(BOUND_KB);
    expect(lifted, "frames with someone on a step").toBeGreaterThan(0);
  });

  it("when each frame is followed by a few dozen small objects (the control), then the same read sees them", () => {
    const kept: Float32Array[] = [];
    const makeVectors = (): void => void (kept[kept.length % CONTROL_VECTORS] = new Float32Array(3));
    expect(readKb(() => Array.from({ length: CONTROL_VECTORS }, makeVectors)), "KB over the run").toBeGreaterThan(BOUND_KB);
  });

  // mutation: sed -i 's/    this.authority = authority;/    this.authority = authority; for (let spin = 0; spin < 100000; spin++) this.seconds += 1e-30;/' src/game/ai/civilians/civilian-crowd.ts
  it(`when it steps, then a frame's step costs under ${BOUND_RATIO} yardsticks on average`, () => {
    untilQuiet(() => readKb(), BOUND_KB);
    startNextTick();
    const start = performance.now();
    stepWithinTick(TIMED_FRAMES);
    const micros = ((performance.now() - start) * 1000) / TIMED_FRAMES;
    const yardstick = yardstickMicros();
    if (process.env["COST_PRINT"] === "1") process.stdout.write(`crowd step ${micros.toFixed(2)} us, yardstick ${yardstick.toFixed(2)} us, ratio ${(micros / yardstick).toFixed(3)}\n`);
    expect(micros / yardstick, "mean yardsticks a frame").toBeLessThan(BOUND_RATIO);
  });
});
