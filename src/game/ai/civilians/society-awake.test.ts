import { describe, expect, it } from "vitest";
import { PLACE_KIND } from "../../world/openworld/walk-graph.ts";
import { HOUR_WEIGHTS, NEED, RESIDENT_INT, RESIDENT_INT_STRIDE, SPECIES, TICKS_PER_GAME_DAY, TICKS_PER_GAME_HOUR } from "./civilian-constants.ts";
import type { CityState } from "./civilian-state.ts";
import { createCityState } from "./society.ts";
import { fillAwakeAtHomes, restWeightAt, sleepsAt } from "./society-awake.ts";
import { buildSocietyMap, stageResident } from "./society.test-util.ts";

const SEED = 17;
const RESIDENTS = 24;
/** A day far from the crowd's start, so every hour is whole days into the run. */
const DAYS_IN = 3;
/** Where the staged residents arrived: long before every tick a row asks about. */
const ARRIVED_TICK = 0;
/** Residents whose bedtime is drawn, and the shares of them asleep at weights below, between and above the range bedtimes are drawn from (0.5 to 1). */
const BEDTIME_SAMPLE = 2000;
const HALF_SPREAD = 0.15;

const map = buildSocietyMap();
const homes = map.places.flatMap((place, index) => (place.kind === PLACE_KIND.home ? [index] : []));
const shop = map.places.findIndex((place) => place.kind === PLACE_KIND.shop);

/** A society with every resident gone, so the ones a row stages are the only people there are. */
function emptyState(): CityState {
  const state = createCityState(SEED, map, RESIDENTS);
  for (let resident = 0; resident < state.capacity; resident++) state.ints[resident * RESIDENT_INT_STRIDE + RESIDENT_INT.alive] = 0;
  return state;
}

/** The tick at game hour `hour` (with `minute` past it) of a day some days into the run. */
const tickAtHour = (state: CityState, hour: number, minute = 0): number => (((hour - state.startHour + 24) % 24) + DAYS_IN * 24) * TICKS_PER_GAME_HOUR + (minute * TICKS_PER_GAME_HOUR) / 60;

/** The people awake at `place` at `hour`:`minute`, the staged residents being the only ones. */
function awakeAt(state: CityState, place: number, hour: number, minute = 0): number {
  const tick = tickAtHour(state, hour, minute);
  const out = new Uint8Array(state.index.placeCount);
  fillAwakeAtHomes(state, tick, out);
  return out[place]!;
}

/** Residents `ids` staged at home `place` resting, as the society leaves them after a leg home. */
function restAt(state: CityState, ids: readonly number[], place: number, home = place, purpose: number = NEED.rest): void {
  for (const resident of ids) stageResident(state, resident, { place, home, tick: ARRIVED_TICK, dwell: 1, purpose });
}

describe("given the society's rest weight by the hour", () => {
  // mutation: sed -i 's/  return now + (next - now) \* (into \/ TICKS_PER_GAME_HOUR);/  return now;/' src/game/ai/civilians/society-awake.ts
  it("when the weight is read on the hour and half past, then the hour is the table's and the half hour the mean of it and the next", () => {
    const state = emptyState();
    const rest = HOUR_WEIGHTS[NEED.rest];
    for (const hour of [0, 6, 18, 20, 21, 22, 23]) {
      expect(restWeightAt(tickAtHour(state, hour), state.startHour), `${hour}:00`).toBeCloseTo(rest[hour]!, 9);
      expect(restWeightAt(tickAtHour(state, hour, 30), state.startHour), `${hour}:30`).toBeCloseTo((rest[hour]! + rest[(hour + 1) % 24]!) / 2, 9);
    }
  });

  // mutation: sed -i 's/  return restWeight >= bedtimeOf(resident);/  return restWeight >= 0.75;/' src/game/ai/civilians/society-awake.ts
  it("when bedtimes are read over many residents, then none sleeps below the range, all do above it, and in between they go to bed at their own pace", () => {
    const asleepShare = (weight: number): number => {
      let asleep = 0;
      for (let resident = 0; resident < BEDTIME_SAMPLE; resident++) if (sleepsAt(weight, resident)) asleep++;
      return asleep / BEDTIME_SAMPLE;
    };
    expect(asleepShare(0.45), "below the range").toBe(0);
    expect(asleepShare(1), "at the night's weight").toBe(1);
    expect(asleepShare(0.75), "a quarter-way up the range's middle").toBeGreaterThan(0.5 - HALF_SPREAD);
    expect(asleepShare(0.75), "a quarter-way up the range's middle").toBeLessThan(0.5 + HALF_SPREAD);
    expect(asleepShare(0.6), "early in the evening").toBeGreaterThan(0);
    expect(asleepShare(0.6), "early in the evening").toBeLessThan(asleepShare(0.75));
  });
});

describe("given people at homes at night and in the evening", () => {
  // mutation: sed -i 's/    if (resting \&\& sleepsAt(rest, resident)) continue;/    if (resting) continue;/' src/game/ai/civilians/society-awake.ts
  it("when residents rest at their own home, then in the evening they are awake, and at three in the night none is", () => {
    const state = emptyState();
    restAt(state, [0, 1, 2], homes[0]!);
    expect(awakeAt(state, homes[0]!, 18), "evening at six").toBe(3);
    expect(awakeAt(state, homes[0]!, 14), "the afternoon").toBe(3);
    expect(awakeAt(state, homes[0]!, 3), "three in the night").toBe(0);
    expect(awakeAt(state, homes[0]!, 23), "eleven at night").toBe(0);
  });

  // mutation: sed -i 's/    if (out\[place\]! < 255) out\[place\]!++;/    if (out[place]! < 255) out[place]! += 0;/' src/game/ai/civilians/society-awake.ts
  it("when the evening thins, then the people awake at home fall from all to none between eight and ten, a bedtime at a time", () => {
    const state = emptyState();
    const ids = Array.from({ length: RESIDENTS }, (_, at) => at);
    restAt(state, ids, homes[0]!);
    const counts = [18, 20, 21, 22].map((hour) => awakeAt(state, homes[0]!, hour));
    expect(counts[0], "six").toBe(RESIDENTS);
    expect(counts[1]! >= counts[2]! && counts[2]! >= counts[3]!, `eight ${counts[1]}, nine ${counts[2]}, ten ${counts[3]}`).toBe(true);
    expect(counts[2], "nine: some are in bed, some are not").toBeGreaterThan(0);
    expect(counts[2], "nine: some are in bed, some are not").toBeLessThan(RESIDENTS);
    expect(counts[3], "ten").toBe(0);
  });

  // mutation: sed -i 's/    const resting = ints\[base + RESIDENT_INT.home\] === place \&\& ints\[base + RESIDENT_INT.legPurpose\] === NEED.rest;/    const resting = ints[base + RESIDENT_INT.legPurpose] === NEED.rest;/' src/game/ai/civilians/society-awake.ts
  it("when a guest, or someone at home for another purpose, is there at night, then they are awake", () => {
    const state = emptyState();
    restAt(state, [0], homes[0]!, homes[1]!);
    restAt(state, [1], homes[0]!, homes[0]!, NEED.social);
    expect(awakeAt(state, homes[0]!, 3), "a guest on rest and one there for company").toBe(2);
  });

  // mutation: sed -i 's/    if (place === NO_PLACE || tick < ints\[base + RESIDENT_INT.arriveTick\]! || state.index.kindOf\[place\] !== PLACE_KIND.home) continue;/    if (place === NO_PLACE || state.index.kindOf[place] !== PLACE_KIND.home) continue;/' src/game/ai/civilians/society-awake.ts
  it("when a resident is still walking home, or is no person, or is gone, or is somewhere that is no home, then they light nothing", () => {
    const state = emptyState();
    restAt(state, [0, 1, 2, 3], homes[0]!, homes[0]!, NEED.social);
    const row = (resident: number): number => resident * RESIDENT_INT_STRIDE;
    state.ints[row(0) + RESIDENT_INT.arriveTick] = tickAtHour(state, 3) + TICKS_PER_GAME_HOUR;
    state.ints[row(1) + RESIDENT_INT.species] = SPECIES.cat;
    state.ints[row(2) + RESIDENT_INT.alive] = 0;
    stageResident(state, 3, { place: shop, home: homes[0]!, tick: ARRIVED_TICK, dwell: 1, purpose: NEED.social });
    const out = new Uint8Array(state.index.placeCount);
    fillAwakeAtHomes(state, tickAtHour(state, 3), out);
    expect(out[homes[0]!], "the home").toBe(0);
    expect(out[shop], "the shop").toBe(0);
    expect(out.reduce((sum, count) => sum + count, 0), "anyone anywhere").toBe(0);
  });

  it("when the tick is a day, a week or a month in, then the same hour reads the same: the answer is the clock's, not the run's age", () => {
    const state = emptyState();
    restAt(state, [0, 1], homes[0]!);
    const out = new Uint8Array(state.index.placeCount);
    const at = (days: number): number => {
      fillAwakeAtHomes(state, tickAtHour(state, 22, 20) + days * TICKS_PER_GAME_DAY, out);
      return out[homes[0]!]!;
    };
    expect(at(1), "a day on").toBe(at(0));
    expect(at(7), "a week on").toBe(at(0));
  });
});
