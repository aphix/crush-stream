import { describe, expect, it } from "vitest";
import { firstMismatch } from "../../kernel/compare-arrays.test-util.ts";
import { hypot2 } from "../../kernel/physics-core.js";
import { buildOpenWorldMap } from "../../world/openworld/openworld-map.ts";
import { layOutLots } from "../../world/openworld/openworld-lots.ts";
import { PLACE_KIND } from "../../world/openworld/walk-graph.ts";
import { hourOfDay } from "./civilian-clock.ts";
import { DECISION_HZ, EVENT_KIND, FLAG, HOURS_PER_GAME_DAY, NEED, NO_PLACE, NO_SEAT, PURPOSE, RESIDENT_INT, RESIDENT_INT_STRIDE, TICKS_PER_GAME_DAY, TICKS_PER_GAME_HOUR, TICKS_PER_GAME_MINUTE } from "./civilian-constants.ts";
import { queueEvents } from "./civilian-events.ts";
import { decideResident } from "./civilian-plan.ts";
import { runTicks, tickOfHour } from "./civilian-run.test-util.ts";
import type { CityState } from "./civilian-state.ts";
import { newAppointmentSlot, nextAppointment } from "./civilian-story.ts";
import { computeTick } from "./civilian-tick.ts";
import { createCityState } from "./society.ts";
import { intAt, needsWith, placeIn, stageResident } from "./society.test-util.ts";
import { walkMetres } from "./society-cars.ts";
import { VENUE, isOutdoorPurpose } from "./society-venues.ts";

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
  it("when it is their favourite, then each goes where they would with no favourite: a place open now that shuts before they could get there is no candidate", () => {
    const liking = afternoonWith(true);
    const none = afternoonWith(false);
    expect(liking.likers, "control: residents who live that far from such a place").toBeGreaterThan(10);
    expect(firstMismatch(liking.went, none.went), "where each sets out for").toBeUndefined();
  });
});

describe("given the neighbourhood living three game days (Jamal hands out flyers on the day's block, its basketball court open only 14-18)", () => {
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

/** A resident still this long (ticks) in a place whose sign reads shut is past the closing stagger (30) and her walk out of the room. */
const STILL_IN_SHUT_TICKS = 40;
/** The hours on day 1 at which the most crowded place away from anyone's home is wrecked: a coffee shop's morning, a shop's noon, a bar's evening. */
const WRECK_HOURS = [10, 12, 19];

/** The place away from every home that holds the most residents settled in it (their stay begun) at `tick`, not already wrecked: -1 for none. */
function busiestPlace(state: CityState, tick: number): number {
  const held = new Map<number, number>();
  for (let resident = 0; resident < state.capacity; resident++) {
    const place = intAt(state, resident, RESIDENT_INT.place);
    if (intAt(state, resident, RESIDENT_INT.alive) === 0 || intAt(state, resident, RESIDENT_INT.arriveTick) > tick || place === intAt(state, resident, RESIDENT_INT.home) || state.closedUntilTick[place]! > tick) continue;
    held.set(place, (held.get(place) ?? 0) + 1);
  }
  let best = NO_PLACE;
  for (const [place, count] of held) if (best === NO_PLACE || count > held.get(best)!) best = place;
  return best;
}

describe("given the neighbourhood's most crowded place wrecked at three hours of day 1, and the days after", () => {
  it("when everyone away from home with no walk under way and not standing at a door is looked at every tick for four days, then nobody stays inside a place whose sign reads shut (wrecked or out of hours) past the closing stagger", () => {
    for (const seed of [4, 6, 11, 21]) {
      const state = createCityState(seed, map, RESIDENTS);
      const wrecksAt = WRECK_HOURS.map((hour) => tickOfHour(state, 1, hour));
      const stuck = new Map<number, number>();
      const inShut = new Set<string>();
      for (let tick = 0; tick < 4 * TICKS_PER_GAME_DAY; tick++) {
        if (wrecksAt.includes(tick)) {
          const place = busiestPlace(state, tick);
          if (place !== NO_PLACE) queueEvents(state, tick, [EVENT_KIND.wreck, place, tick / DECISION_HZ]);
        }
        computeTick(state, tick);
        for (let resident = 0; resident < state.capacity; resident++) {
          const place = intAt(state, resident, RESIDENT_INT.place);
          const wrecked = state.closedUntilTick[place]! > tick;
          const staffInHours = place === intAt(state, resident, RESIDENT_INT.work) && !wrecked;
          const shut = wrecked || (signShut(state, place, tick) && !staffInHours);
          if (!shut || intAt(state, resident, RESIDENT_INT.alive) === 0 || intAt(state, resident, RESIDENT_INT.pathCount) !== 0 || intAt(state, resident, RESIDENT_INT.arriveTick) > tick || place === intAt(state, resident, RESIDENT_INT.home) || isOutdoorPurpose(intAt(state, resident, RESIDENT_INT.legPurpose))) {
            stuck.delete(resident);
            continue;
          }
          const ticks = (stuck.get(resident) ?? 0) + 1;
          stuck.set(resident, ticks);
          if (ticks === STILL_IN_SHUT_TICKS) inShut.add(`${resident} (${(intAt(state, resident, RESIDENT_INT.flags) & FLAG.cast) !== 0 ? "named" : "unnamed"}, ${place === intAt(state, resident, RESIDENT_INT.work) ? "staff" : "customer"}) in ${map.places[place]!.name}${wrecked ? " wrecked" : ""} at ${hourOfDay(tick, state.startHour)}h`);
        }
      }
      expect([...inShut], `still inside a shut place (seed ${seed})`).toEqual([]);
    }
  });
});

describe("given a customer and a clerk settled in the bodega at noon on day 2 for hours, and a car that wrecks it", () => {
  /** The bodega with a customer and a clerk (adults who live elsewhere) in it, their stays set to last three hours, a wreck posted at noon; the city run on to `ticks` ticks after it. */
  function wreckedAtNoon(ticks: number): { state: CityState; bodega: number; customer: number; clerk: number } {
    const state = createCityState(7, map, RESIDENTS);
    const bodega = placeIn(map, "Bodega Supreme");
    const noon = tickOfHour(state, 2, 12);
    runTicks(state, noon);
    const customer = state.cast.length;
    const clerk = customer + 1;
    for (const [resident, work] of [[customer, NO_PLACE], [clerk, bodega]] as const) {
      const home = intAt(state, resident, RESIDENT_INT.home);
      stageResident(state, resident, { place: bodega, home, work, tick: noon, dwell: 10, nextDecision: noon + 3 * TICKS_PER_GAME_HOUR });
    }
    runTicks(state, ticks, new Map([[noon, [EVENT_KIND.wreck, bodega, noon / DECISION_HZ]]]));
    return { state, bodega, customer, clerk };
  }

  it("when the wreck's hour comes, then both are still in it a half hour before and both have set out at once at it, the clerk laid off", () => {
    const before = wreckedAtNoon(TICKS_PER_GAME_HOUR / 2);
    expect(intAt(before.state, before.customer, RESIDENT_INT.place), "control: the sign still reads open and her stay goes on").toBe(before.bodega);
    expect(intAt(before.state, before.clerk, RESIDENT_INT.place), "control: the sign still reads open and her shift goes on").toBe(before.bodega);
    const after = wreckedAtNoon(TICKS_PER_GAME_HOUR + 1);
    expect(after.state.closedUntilTick[after.bodega], "control: the bodega is wrecked now").toBeGreaterThan(0);
    expect(intAt(after.state, after.customer, RESIDENT_INT.place), "where the customer is bound").not.toBe(after.bodega);
    expect(intAt(after.state, after.clerk, RESIDENT_INT.place), "where the laid-off clerk is bound").not.toBe(after.bodega);
    expect(intAt(after.state, after.clerk, RESIDENT_INT.flags) & FLAG.laidOff, "the clerk is laid off").toBe(FLAG.laidOff);
  });
});

describe("given Dee, a named resident whose home is the one farthest on foot from the bodega where her 23:00 coffee is, at the shut place nearest the bodega with that coffee three hours off", () => {
  const city = (() => {
    let made: { state: CityState; dee: number; bodega: number; home: number; shut: number } | null = null;
    return () => {
      if (made !== null) return made;
      const state = createCityState(5, map, RESIDENTS);
      runTicks(state, tickOfHour(state, 1, 20));
      const dee = state.cast.findIndex((resolved) => resolved.member.key === "dee");
      const bodega = placeIn(map, "Bodega Supreme");
      const homes = map.places.flatMap((place, index) => (place.kind === PLACE_KIND.home && place.doorNode >= 0 ? [index] : []));
      const home = homes.reduce((far, candidate) => (walkMetres(state, candidate, bodega) > walkMetres(state, far, bodega) ? candidate : far));
      let shut = NO_PLACE;
      for (let place = 0; place < map.places.length; place++) {
        if (place === bodega || place === home || map.places[place]!.doorNode < 0 || state.venues.opensAt[place]! < 0 || !signShut(state, place, tickOfHour(state, 1, 20))) continue;
        if (shut === NO_PLACE || walkMetres(state, place, bodega) < walkMetres(state, shut, bodega)) shut = place;
      }
      made = { state, dee, bodega, home, shut };
      return made;
    };
  })();

  /** Dee, at `place` with her decision due at `tick`, her coffee not yet kept, deciding. */
  function deeDecides(place: number, tick: number): CityState {
    const { state, dee, home } = city();
    stageResident(state, dee, { place, home, tick, flags: FLAG.cast });
    state.ints[dee * RESIDENT_INT_STRIDE + RESIDENT_INT.storyTick] = 0;
    decideResident(state, dee, tick);
    return state;
  }

  it("when she decides at 20:00, then she waits at the shut door instead of inside: her walk home would miss the coffee, and she does not set out", () => {
    const { dee, bodega, home, shut } = city();
    const tick = tickOfHour(city().state, 1, 20);
    const slot = newAppointmentSlot();
    nextAppointment(city().state, dee, tick, slot);
    expect(slot.place, "control: her next appointment is the coffee at the bodega").toBe(bodega);
    expect(walkMetres(city().state, shut, home) + walkMetres(city().state, home, bodega), "control: home and on to the bodega is a longer way than from here").toBeGreaterThan(2 * walkMetres(city().state, shut, bodega));
    const state = deeDecides(shut, tick);
    expect(intAt(state, dee, RESIDENT_INT.place), "where she dwells").toBe(shut);
    expect(intAt(state, dee, RESIDENT_INT.legPurpose), "what she does there").toBe(PURPOSE.loiter);
    expect(intAt(state, dee, RESIDENT_INT.pathCount), "nodes on a walk").toBe(0);
  });

  it("when she waits at the door of a shut coffee shop with seats, then she holds no seat inside it", () => {
    const { state, dee } = city();
    const tick = tickOfHour(state, 1, 20);
    const shutCoffee = state.venues.byVenue[VENUE.coffee]!.filter((place) => map.places[place]!.doorNode >= 0 && signShut(state, place, tick));
    expect(shutCoffee.length, "control: coffee shops are shut at 20:00").toBeGreaterThan(0);
    let waited = 0;
    for (const place of shutCoffee) {
      if (place === city().home) continue;
      deeDecides(place, tick);
      if (intAt(state, dee, RESIDENT_INT.legPurpose) !== PURPOSE.loiter) continue;
      waited++;
      expect(intAt(state, dee, RESIDENT_INT.seat), `her seat in ${map.places[place]!.name}`).toBe(NO_SEAT);
    }
    expect(waited, "control: she waits at a shut coffee shop's door").toBeGreaterThan(0);
  });
});
