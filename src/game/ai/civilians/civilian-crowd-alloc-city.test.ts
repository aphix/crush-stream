import { beforeAll, describe, expect, it } from "vitest";
import { allocatedBytes, untilQuiet } from "../../kernel/alloc-sample.test-util.ts";
import type { DeformableCar } from "../../vehicle/car.ts";
import { buildOpenWorldMap } from "../../world/openworld/openworld-map.ts";
import { layOutLots } from "../../world/openworld/openworld-lots.ts";
import type { CivilianCrowd } from "./civilian-crowd.ts";
import { newCrowd } from "./civilian-crowd.test-util.ts";
import { gameHourAtMinute, gameMinuteAt, secondsOfGameMinutes } from "./civilian-clock.ts";
import { MINUTES_PER_GAME_DAY, MINUTES_PER_GAME_HOUR } from "./civilian-constants.ts";

const RESIDENTS = 300;
/** A decision tick is half a second: a read's frames all fall in one, so no frame advances the brain (that allocates, twice a second). */
const FRAME_SECONDS = 1 / 64;
const FRAMES_PER_TICK = 31;
const MEASURED_FRAMES = 300;
/** The sampling profiler's own cost and the read's boxed frame time are 4-5 KB of a read; a frame that boxes one number a walker reads far above this. */
const BOUND_KB = 8;
/** The city is read at this game hour, after this many crowd seconds of stepping: its streets busy with people going out and home. */
const CITY_EVENING_HOUR = 23;
const CITY_WARM_SECONDS = 200;
const WARM_STEP = 1 / 16;
// Its own file: the crowd's per-frame code compiles as it does in a game, not after other rows' crowds and readers taught V8 other call sites (beside them, the cached heading's mutation still read clean).

describe("given 300 civilians on the city's own map late in the evening, many walking its streets", () => {
  const noCars: DeformableCar[] = [];
  let crowd: CivilianCrowd;
  let at = 0;

  beforeAll(() => {
    crowd = newCrowd(buildOpenWorldMap(layOutLots()), RESIDENTS);
    crowd.step(FRAME_SECONDS, noCars, true);
    const now = gameHourAtMinute(gameMinuteAt(FRAME_SECONDS), crowd.state.startHour) * MINUTES_PER_GAME_HOUR;
    at = Math.floor(secondsOfGameMinutes((CITY_EVENING_HOUR * MINUTES_PER_GAME_HOUR - now + MINUTES_PER_GAME_DAY) % MINUTES_PER_GAME_DAY) * 2) / 2;
    crowd.skipThrough(at);
    for (let frame = 0; frame < CITY_WARM_SECONDS / WARM_STEP; frame++) crowd.step((at += WARM_STEP), noCars, true);
    at = Math.floor(at * 2) / 2;
  });

  // mutation: sed -i 's/^    out.yaw = state.legYaw\[resident\]!;/    out.yaw = out.speed < 0 ? detAtan2(-out.dirX, -out.dirZ) : detAtan2(out.dirX, out.dirZ);/' src/game/ai/civilians/civilian-leg.ts
  it("when the whole crowd is stepped every frame for 300 frames within a tick, then the steps allocate nothing (the profiler's own cost is under the bound)", () => {
    const kb = untilQuiet(() => {
      at += 0.5;
      crowd.step(at, noCars, true);
      return allocatedBytes(() => {
        for (let frame = 0; frame < MEASURED_FRAMES; frame++) crowd.step(at + (frame % FRAMES_PER_TICK) * FRAME_SECONDS, noCars, true);
      }) / 1024;
    }, BOUND_KB);
    const { shown, speed } = crowd.poses;
    let walking = 0;
    for (let resident = 0; resident < crowd.poses.count; resident++) if (shown[resident] === 1 && speed[resident] !== 0) walking++;
    expect(walking, "civilians walking the streets").toBeGreaterThan(20);
    expect(kb, "KB over the run").toBeLessThanOrEqual(BOUND_KB);
  });
});
