import { hourOfDay } from "./civilian-clock.ts";
import { HOURS_PER_GAME_DAY } from "./civilian-constants.ts";
import type { CityState } from "./civilian-state.ts";

/** What `fillClosedPlaces` reads of the city: the clock's start, when each place re-opens after a wreck, and its weight in each hour (1 and over open). */
type HoursState = Pick<CityState, "startHour" | "closedUntilTick"> & { venues: Pick<CityState["venues"], "hourWeight"> };

/** 1 in `out`, a place a map-index long, for every place shut at `tick` (wrecked and closed for days, or outside its hours), else 0: what the signage and the interiors read, the same answer the society plans by. */
export function fillClosedPlaces(state: HoursState, tick: number, out: Uint8Array): void {
  const hour = hourOfDay(tick, state.startHour);
  for (let place = 0; place < out.length; place++) out[place] = state.closedUntilTick[place]! > tick || state.venues.hourWeight[place * HOURS_PER_GAME_DAY + hour]! < 1 ? 1 : 0;
}
