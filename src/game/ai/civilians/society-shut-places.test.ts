import { describe, expect, it } from "vitest";
import { firstMismatch } from "../../kernel/compare-arrays.test-util.ts";
import { hypot2 } from "../../kernel/physics-core.js";
import { buildOpenWorldMap } from "../../world/openworld/openworld-map.ts";
import { layOutLots } from "../../world/openworld/openworld-lots.ts";
import { PLACE_KIND } from "../../world/openworld/walk-graph.ts";
import { hourOfDay } from "./civilian-clock.ts";
import { HOURS_PER_GAME_DAY, NEED, NO_PLACE, RESIDENT_INT, RESIDENT_INT_STRIDE, TICKS_PER_GAME_DAY, TICKS_PER_GAME_MINUTE } from "./civilian-constants.ts";
import { decideResident } from "./civilian-plan.ts";
import { tickOfHour } from "./civilian-run.test-util.ts";
import type { CityState } from "./civilian-state.ts";
import { computeTick } from "./civilian-tick.ts";
import { createCityState } from "./society.ts";
import { intAt, needsWith, stageResident } from "./society.test-util.ts";
import { VENUE } from "./society-venues.ts";

const map = buildOpenWorldMap(layOutLots());
const RESIDENTS = 150;
const HUNGRY = 0.95;
/** Supper time: the coffee shops (6-15) are shut and stay shut, the diners (7-23) are open. */
const SUPPER = 18;
/** A sign read this long either side of a moment is past the closing stagger. */
const AROUND_TICKS = 10 * TICKS_PER_GAME_MINUTE;

const signShut = (state: CityState, place: number, tick: number): boolean => state.venues.hourWeight[place * HOURS_PER_GAME_DAY + hourOfDay(tick, state.startHour)]! < 1;

/** Where every grown resident, at home and hungry at supper on day 2 with `favourite` as the place they like to eat, sets out for (their home: they stay in). */
function supperWith(favourite: (state: CityState) => number): number[] {
  const state = createCityState(7, map, RESIDENTS);
  const tick = tickOfHour(state, 2, SUPPER);
  const went: number[] = [];
  for (let resident = state.cast.length; resident < state.capacity; resident++) {
    if (intAt(state, resident, RESIDENT_INT.alive) === 0) continue;
    const home = intAt(state, resident, RESIDENT_INT.home);
    stageResident(state, resident, { place: home, home, tick, needs: needsWith({ [NEED.food]: HUNGRY }) });
    state.ints[resident * RESIDENT_INT_STRIDE + RESIDENT_INT.favouriteFood] = favourite(state);
    decideResident(state, resident, tick);
    went.push(intAt(state, resident, RESIDENT_INT.place));
  }
  return went;
}

describe("given the neighbourhood's grown-ups at home and hungry at supper, when the coffee shops have shut for the day and the diners are open", () => {
  // mutation: sed -i 's/  return isOpen(state, place, tick) \&\& withinHours(state, place, soonestArrival(state, resident, from, place, tick));/  return isOpen(state, place, tick);/' src/game/ai/civilians/civilian-plan.ts
  it("when their favourite place to eat is a shut coffee shop, then each goes where they would with no favourite: the shut shop never holds them home", () => {
    const coffee = (state: CityState): number => state.venues.byVenue[VENUE.coffee]![0]!;
    const withShutFavourite = supperWith(coffee);
    const withNone = supperWith(() => NO_PLACE);
    expect(withNone.filter((place) => map.places[place]!.kind === PLACE_KIND.food).length, "control: residents who go out to eat with no favourite").toBeGreaterThan(0);
    expect(firstMismatch(withShutFavourite, withNone), "where each sets out for").toBeUndefined();
  });
});

/** Half past one: a coffee shop that shuts at 15 is open another hour and a half, and the pizza place and the café open to 17 are open too. */
const AFTERNOON_MINUTES = 13 * 60 + 30;
/** A place to eat this far (m) off is a walk of about three game hours: it shuts before she could get there. */
const FAR_FOOD_M = 250;
const WALK_THERE_TICKS = 3 * 60 * TICKS_PER_GAME_MINUTE;

/** Where every grown resident at home who lives 250 m or more from a place to eat that is open at half past one and shut three hours on sets out for, hungry then on day 2, liking that place (`liked`) or none. */
function afternoonWith(liked: boolean): { went: number[]; likers: number } {
  const state = createCityState(7, map, RESIDENTS);
  const tick = tickOfHour(state, 2, 0) + AFTERNOON_MINUTES * TICKS_PER_GAME_MINUTE;
  const closing = Array.from(state.index.byKind[PLACE_KIND.food]!).filter((place) => !signShut(state, place, tick) && signShut(state, place, tick + WALK_THERE_TICKS));
  const went: number[] = [];
  for (let resident = state.cast.length; resident < state.capacity; resident++) {
    if (intAt(state, resident, RESIDENT_INT.alive) === 0) continue;
    const home = intAt(state, resident, RESIDENT_INT.home);
    let far = NO_PLACE;
    for (const place of closing) if (hypot2(map.places[place]!.doorX - map.places[home]!.doorX, map.places[place]!.doorZ - map.places[home]!.doorZ) >= FAR_FOOD_M) far = place;
    if (far === NO_PLACE) continue;
    stageResident(state, resident, { place: home, home, tick, needs: needsWith({ [NEED.food]: HUNGRY }) });
    state.ints[resident * RESIDENT_INT_STRIDE + RESIDENT_INT.favouriteFood] = liked ? far : NO_PLACE;
    decideResident(state, resident, tick);
    went.push(intAt(state, resident, RESIDENT_INT.place));
  }
  return { went, likers: went.length };
}

describe("given the neighbourhood's grown-ups at home and hungry at half past one, each living 250 m or more from a place to eat that is open now and shut three hours on", () => {
  // mutation: sed -i 's/  return isOpen(state, place, tick) \&\& withinHours(state, place, soonestArrival(state, resident, from, place, tick));/  return isOpen(state, place, tick) \&\& (withinHours(state, place, tick) || withinHours(state, place, soonestArrival(state, resident, from, place, tick)));/' src/game/ai/civilians/civilian-plan.ts
  it("when it is their favourite, then each goes where they would with no favourite: a place open now that shuts before they could get there is no candidate", () => {
    const liking = afternoonWith(true);
    const none = afternoonWith(false);
    expect(liking.likers, "control: residents who live that far from such a place").toBeGreaterThan(10);
    expect(firstMismatch(liking.went, none.went), "where each sets out for").toBeUndefined();
  });
});

describe("given the neighbourhood living three game days (Jamal hands out flyers on the day's block, its basketball court open only 14-18)", () => {
  // mutation: sed -i 's/      if (openThrough(state, place, arriveTick, arriveTick + dwellTicks - 1)) return place;/      return place;/' src/game/ai/civilians/civilian-story.ts
  it("when everyone away from home and work with no walk under way is looked at every tick, then nobody stays in a place whose sign reads shut", () => {
    for (const seed of [5, 7, 11]) {
      const state = createCityState(seed, map, RESIDENTS);
      const inShut = new Set<string>();
      for (let tick = 0; tick < 3 * TICKS_PER_GAME_DAY; tick++) {
        computeTick(state, tick);
        for (let resident = 0; resident < state.capacity; resident++) {
          const place = intAt(state, resident, RESIDENT_INT.place);
          if (intAt(state, resident, RESIDENT_INT.alive) === 0 || intAt(state, resident, RESIDENT_INT.pathCount) !== 0 || intAt(state, resident, RESIDENT_INT.arriveTick) > tick) continue;
          if (place === intAt(state, resident, RESIDENT_INT.home) || place === intAt(state, resident, RESIDENT_INT.work)) continue;
          if (signShut(state, place, tick - AROUND_TICKS) && signShut(state, place, tick) && signShut(state, place, tick + AROUND_TICKS)) inShut.add(`${resident} in ${map.places[place]!.name} at ${hourOfDay(tick, state.startHour)}h`);
        }
      }
      expect([...inShut], `staying in a shut place (seed ${seed})`).toEqual([]);
    }
  });
});
