import { beforeAll, describe, expect, it } from "vitest";
import { pooledCar } from "../../contact/crash-scenarios.test-util.ts";
import { allocatedBytes, untilQuiet, yardstickMicros } from "../../kernel/alloc-sample.test-util.ts";
import type { DeformableCar } from "../../vehicle/car.ts";
import { Stoops } from "../../world/openworld/openworld-stoops.ts";
import type { CivilianCrowd } from "./civilian-crowd.ts";
import { buildFixtureMap } from "./civilian-graph.test-util.ts";
import { newCrowd } from "./civilian-crowd.test-util.ts";
import { buildOpenWorldMap } from "../../world/openworld/openworld-map.ts";
import { layOutLots } from "../../world/openworld/openworld-lots.ts";
import { gameHourAtMinute, gameMinuteAt, secondsOfGameMinutes } from "./civilian-clock.ts";
import { MINUTES_PER_GAME_DAY, MINUTES_PER_GAME_HOUR, RESIDENT_INT, RESIDENT_INT_STRIDE } from "./civilian-constants.ts";
import { ActivityReading, readActivity } from "./society-activity.ts";

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
/** Decision ticks (20 s of crowd time) the stoop row looks through for a walker on a step. */
const LIFT_TICKS = 40;
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
/** The city's crowd is read at this game hour, after this many crowd seconds of stepping: its bars full, people walking in and out. */
const CITY_EVENING_HOUR = 23;
const CITY_WARM_SECONDS = 20;

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

  it("when every street node is a stoop's door, then walkers cross the steps and the frames still allocate nothing", () => {
    const { nodeX, nodeZ } = buildFixtureMap(EXTRA_HOMES_PER_BLOCK).graph;
    const frontages = Array.from(nodeX, (x, node) => ({ x, z: nodeZ[node]!, yaw: 0, depth: 10, style: "federal" as const, storeys: 3, variant: 0 }));
    crowd.stoops = new Stoops(frontages, Array.from(nodeX, (_, node) => node));
    const kb = untilQuiet(() => readKb(), BOUND_KB);
    // Ticks at most to look for someone on a step: where the reads left the crowd's clock depends on how many the box needed.
    let lifted = 0;
    for (let tick = 0; tick < LIFT_TICKS && lifted === 0; tick++) {
      startNextTick();
      stepWithinTick(FRAMES_PER_TICK, () => void (lifted += crowd.poses.feetY.some((feetY) => feetY > 0) ? 1 : 0));
    }
    crowd.stoops = null;
    expect(kb, "KB over the run").toBeLessThanOrEqual(BOUND_KB);
    expect(lifted, "frames with someone on a step").toBeGreaterThan(0);
  });

  it("when each frame is followed by a few dozen small objects (the control), then the same read sees them", () => {
    const kept: Float32Array[] = [];
    const makeVectors = (): void => void (kept[kept.length % CONTROL_VECTORS] = new Float32Array(3));
    expect(readKb(() => Array.from({ length: CONTROL_VECTORS }, makeVectors)), "KB over the run").toBeGreaterThan(BOUND_KB);
  });

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

describe("given 300 civilians of the city's map in its bars, shops and coffee shops late in the evening, whose rooms have aisles", () => {
  const city = buildOpenWorldMap(layOutLots());
  const inRooms: number[] = [];
  const reading = new ActivityReading();
  let cityCrowd: CivilianCrowd;
  let at = 0;

  /** One frame's reads of everyone in a room at crowd second `seconds` (a double handed in once a frame, as the crowd hands its own). */
  function readRooms(seconds: number): number {
    let walking = 0;
    for (let index = 0; index < inRooms.length; index++) {
      readActivity(cityCrowd.state, inRooms[index]!, seconds, reading);
      if (reading.speed > 0) walking++;
    }
    return walking;
  }

  beforeAll(() => {
    cityCrowd = newCrowd(city, RESIDENTS);
    cityCrowd.step(FRAME_SECONDS, [], true);
    const now = gameHourAtMinute(gameMinuteAt(FRAME_SECONDS), cityCrowd.state.startHour) * MINUTES_PER_GAME_HOUR;
    at = Math.floor(secondsOfGameMinutes((CITY_EVENING_HOUR * MINUTES_PER_GAME_HOUR - now + MINUTES_PER_GAME_DAY) % MINUTES_PER_GAME_DAY) * 2) / 2;
    cityCrowd.skipThrough(at);
    for (let frame = 0; frame < CITY_WARM_SECONDS / WARM_STEP; frame++) cityCrowd.step((at += WARM_STEP), [], true);
    at = Math.floor(at * 2) / 2 + 0.5;
    cityCrowd.step(at, [], true);
    const tick = at * 2;
    const { ints } = cityCrowd.state;
    for (let resident = 0; resident < cityCrowd.state.capacity; resident++) {
      const base = resident * RESIDENT_INT_STRIDE;
      const leaving = ints[base + RESIDENT_INT.pathCount]! > 0 && tick < ints[base + RESIDENT_INT.departTick]! && city.places[ints[base + RESIDENT_INT.fromPlace]!]?.aisle !== undefined;
      const staying = city.places[ints[base + RESIDENT_INT.place]!]?.aisle !== undefined && tick >= ints[base + RESIDENT_INT.arriveTick]! && tick < ints[base + RESIDENT_INT.nextDecisionTick]!;
      if (leaving || staying) inRooms.push(resident);
    }
  });

  it("when everyone in a room is read every frame for 300 frames, walking, buying, sitting and leaving, then the reads allocate nothing (the profiler's own cost is under the bound)", () => {
    let walking = 0;
    const kb = untilQuiet(() => allocatedBytes(() => {
      for (let frame = 0; frame < MEASURED_FRAMES; frame++) walking += readRooms(at + (frame % FRAMES_PER_TICK) * FRAME_SECONDS);
    }) / 1024, BOUND_KB);
    expect(inRooms.length, "civilians in rooms").toBeGreaterThan(20);
    expect(walking, "reads of someone walking in a room").toBeGreaterThan(0);
    expect(kb, "KB over the run").toBeLessThanOrEqual(BOUND_KB);
  });
});
