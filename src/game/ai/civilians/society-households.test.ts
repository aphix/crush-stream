import { describe, expect, it } from "vitest";
import { firstMismatch } from "../../kernel/compare-arrays.test-util.ts";
import { layOutLots } from "../../world/openworld/openworld-lots.ts";
import { buildOpenWorldMap } from "../../world/openworld/openworld-map.ts";
import { PLACE_KIND } from "../../world/openworld/walk-graph.ts";
import { TICKS_PER_GAME_HOUR } from "./civilian-constants.ts";
import type { CityState } from "./civilian-state.ts";
import { createCityState } from "./society.ts";
import { ImaginedHouseholds } from "./society-households.ts";

const SEED = 5;
const OTHER_SEED = 6;
const RESIDENTS = 60;
const DAYS_IN = 5;
const HOURS_ON_A_CLOCK = 24;
const map = buildOpenWorldMap(layOutLots());
const homes = map.places.flatMap((place, index) => (place.kind === PLACE_KIND.home ? [index] : []));

/** The society and its households. */
type City = { state: CityState; households: ImaginedHouseholds };

function cityOf(seed: number): City {
  const state = createCityState(seed, map, RESIDENTS);
  return { state, households: new ImaginedHouseholds(state) };
}
const city = cityOf(SEED);

/** The tick at game hour `hour` (the small hours counted on past 24) some days into `of`'s run. */
const tickAtHour = (of: City, hour: number): number => (((hour - of.state.startHour + 2 * HOURS_ON_A_CLOCK) % HOURS_ON_A_CLOCK) + DAYS_IN * HOURS_ON_A_CLOCK) * TICKS_PER_GAME_HOUR;

/** The people awake in every place at `hour`, from the households alone. */
function awakeAt(hour: number, of = city): Uint8Array {
  const out = new Uint8Array(of.state.index.placeCount);
  of.households.fill(tickAtHour(of, hour), out);
  return out;
}

/** The share of homes that have someone awake at `hour`. */
function litShareAt(hour: number): number {
  const out = awakeAt(hour);
  return homes.filter((place) => out[place]! > 0).length / homes.length;
}

/** How many homes have a different number of people awake at `hour` in `other` than in this city. */
function homesThatDiffer(hour: number, other: City): number {
  const [mine, theirs] = [awakeAt(hour), awakeAt(hour, other)];
  return homes.filter((place) => mine[place] !== theirs[place]).length;
}

describe("given the open world's homes, each with a household and few with a simulated resident", () => {
  const dayTable = [
    { it: "when it is eight in the evening, then nearly every home has someone awake", hour: 20, atLeast: 0.85, atMost: 1 },
    { it: "when it is ten at night, then most homes still have someone awake", hour: 22, atLeast: 0.6, atMost: 0.85 },
    { it: "when it is midnight, then a third of the homes or fewer have someone awake", hour: 24, atLeast: 0.1, atMost: 0.4 },
    { it: "when it is one in the morning, then most homes have gone dark", hour: 25, atLeast: 0.02, atMost: 0.2 },
    { it: "when it is four in the morning, then every home is dark", hour: 28, atLeast: 0, atMost: 0 },
    { it: "when it is half past six in the morning, then most homes have someone up", hour: 6.5, atLeast: 0.6, atMost: 1 },
    { it: "when it is noon, then nobody is home awake", hour: 12, atLeast: 0, atMost: 0 },
  ] as const;
  // mutation: sed -i 's/^const BEDTIME_HOURS = .*$/const BEDTIME_HOURS = [30, 30, 30, 30, 30, 30, 30, 30] as const;/' src/game/ai/civilians/society-households.ts
  // mutation: sed -i 's/^const BEDTIME_HOURS = .*$/const BEDTIME_HOURS = [17, 17, 17, 17, 17, 17, 17, 17] as const;/' src/game/ai/civilians/society-households.ts
  // mutation: sed -i 's/^const WAKE_FROM_HOUR = 5;/const WAKE_FROM_HOUR = 20;/' src/game/ai/civilians/society-households.ts
  for (const testCase of dayTable) {
    it(testCase.it, () => {
      const share = litShareAt(testCase.hour);
      expect(share, "share of empty homes with someone awake").toBeGreaterThanOrEqual(testCase.atLeast);
      expect(share, "share of empty homes with someone awake").toBeLessThanOrEqual(testCase.atMost);
    });
  }

  // mutation: sed -i 's/this.bed\[at\] = bedtimeAt(draw());/this.bed[at] = 24 + 0 * draw();/' src/game/ai/civilians/society-households.ts
  it("when the night goes on from nine to two, then the homes with someone awake thin out every hour, as their bedtimes are spread", () => {
    const shares = [21, 22, 23, 24, 25, 26].map(litShareAt);
    for (let at = 1; at < shares.length; at++) expect(shares[at]!, `share at hour ${21 + at} under the hour before`).toBeLessThan(shares[at - 1]!);
    expect(shares[0], "the evening was lit to begin with").toBeGreaterThan(0.6);
  });

  // mutation: sed -i 's/^const HOUSEHOLD_SIZE_CUMULATIVE = .*$/const HOUSEHOLD_SIZE_CUMULATIVE = [1, 1, 1, 1] as const;/' src/game/ai/civilians/society-households.ts
  it("when the evening is at its fullest, then homes have one, two, three and four people awake, and none five", () => {
    const counts = new Set<number>();
    for (const hour of [19.5, 20, 20.5]) for (const awake of awakeAt(hour)) counts.add(awake);
    for (const people of [1, 2, 3, 4]) expect(counts.has(people), `homes with ${people} awake`).toBe(true);
    expect(counts.has(5), "homes with five awake").toBe(false);
  });

  // mutation: sed -i 's/this.size\[place\] = 1 + /this.size[place] = state.occupants[place] > 0 ? 0 : 1 + /' src/game/ai/civilians/society-households.ts
  it("when a home has a simulated resident who is out at eight in the evening, then its household still lights it, as it does a home with no resident", () => {
    const occupied = homes.filter((place) => city.state.occupants[place]! > 0);
    const out = awakeAt(20);
    expect(occupied.length, "homes with a simulated resident").toBeGreaterThan(0);
    expect(homes.length - occupied.length, "homes with none").toBeGreaterThan(0);
    expect(occupied.filter((place) => out[place]! > 0).length / occupied.length, "share of homes with a resident that have the household awake").toBeGreaterThanOrEqual(0.85);
  });

  // mutation: sed -i 's/out\[place\] = Math.min(255, out\[place\]! + awake);/out[place] = awake;/' src/game/ai/civilians/society-households.ts
  it("when a resident is already awake at home, then the household's people are awake with them", () => {
    const household = awakeAt(20);
    const place = homes.find((candidate) => household[candidate]! > 0)!;
    const out = new Uint8Array(city.state.index.placeCount);
    out[place] = 2;
    city.households.fill(tickAtHour(city, 20), out);
    expect(out[place], "the resident and the household").toBe(2 + household[place]!);
  });
});

describe("given two draws of the households", () => {
  // mutation: sed -i 's/state\.seed, place/0, place/g' src/game/ai/civilians/society-households.ts
  it("when the same seed is drawn twice, then the same homes have the same people awake, and another seed has other people awake", () => {
    const again = cityOf(SEED);
    const other = cityOf(OTHER_SEED);
    expect(firstMismatch(awakeAt(20, again), awakeAt(20), 0), "the same seed's evening").toBeUndefined();
    expect(firstMismatch(awakeAt(23, again), awakeAt(23), 0), "the same seed's night").toBeUndefined();
    expect(homesThatDiffer(23, other), "homes with a different number awake under another seed").toBeGreaterThan(homes.length / 10);
  });
});
