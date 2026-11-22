import { describe, expect, it } from "vitest";
import { buildOpenWorldMap } from "../../world/openworld/openworld-map.ts";
import { layOutLots } from "../../world/openworld/openworld-lots.ts";
import { hourOfDay } from "./civilian-clock.ts";
import { HOURS_PER_GAME_DAY, NO_PLACE, RESIDENT_INT, TICKS_PER_GAME_DAY, TICKS_PER_GAME_MINUTE } from "./civilian-constants.ts";
import type { CityState } from "./civilian-state.ts";
import { computeTick } from "./civilian-tick.ts";
import { createCityState } from "./society.ts";
import { intAt } from "./society.test-util.ts";
import { VENUE } from "./society-venues.ts";

const map = buildOpenWorldMap(layOutLots());
/** The middle tier's crowd. */
const RESIDENTS = 150;
const DAYS = 2;
/** Looked at every game quarter hour. */
const SAMPLE_EVERY = 15 * TICKS_PER_GAME_MINUTE;
/** A sign that reads shut half an hour either side of a moment: past any opening or closing margin. */
const MARGIN_TICKS = 30 * TICKS_PER_GAME_MINUTE;

const signShut = (state: CityState, place: number, tick: number): boolean => state.venues.hourWeight[place * HOURS_PER_GAME_DAY + hourOfDay(tick, state.startHour)]! < 1;

/** Staff seen in at their workplace over the run: those while its sign has read shut for half an hour and will for half an hour more, and those at a bar. */
function staffSeen(seed: number): { atWork: number; inShut: string[]; atBar: number } {
  const state = createCityState(seed, map, RESIDENTS);
  const inShut: string[] = [];
  let atWork = 0;
  let atBar = 0;
  for (let tick = 0; tick < DAYS * TICKS_PER_GAME_DAY; tick++) {
    computeTick(state, tick);
    if (tick % SAMPLE_EVERY !== 0) continue;
    for (let resident = 0; resident < state.capacity; resident++) {
      const work = intAt(state, resident, RESIDENT_INT.work);
      if (intAt(state, resident, RESIDENT_INT.alive) === 0 || work === NO_PLACE || intAt(state, resident, RESIDENT_INT.place) !== work || intAt(state, resident, RESIDENT_INT.arriveTick) > tick) continue;
      atWork++;
      if (state.venues.venueOf[work] === VENUE.bar) atBar++;
      if (signShut(state, work, tick - MARGIN_TICKS) && signShut(state, work, tick) && signShut(state, work, tick + MARGIN_TICKS)) inShut.push(`${map.places[work]!.name} at ${hourOfDay(tick, state.startHour)}h`);
    }
  }
  return { atWork, inShut, atBar };
}

describe("given the neighbourhood's workplaces with opening hours (coffee from 6 to 15, bars from 16 to 3, shops by day) and its working people living two game days", () => {
  // mutation: sed -i 's/  if (opens < 0) return limit;/  return limit;/' /home/aphix/worktrees/OwFix/src/game/ai/civilians/society-hours.ts (staff keep no hours)
  it("when the staff at work are looked at every quarter hour, then none is in while the sign has read shut for half an hour, and bar staff work the evening", () => {
    let atBar = 0;
    for (const seed of [5, 7]) {
      const seen = staffSeen(seed);
      atBar += seen.atBar;
      expect(seen.atWork, `control: staff are seen at work (seed ${seed})`).toBeGreaterThan(0);
      expect(seen.inShut, `staff in at a shut workplace (seed ${seed})`).toEqual([]);
    }
    expect(atBar, "control: bar staff at work").toBeGreaterThan(0);
  });
});
