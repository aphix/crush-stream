import { hourOfDay } from "./civilian-clock.ts";
import {
  HOURS_PER_GAME_DAY,
  NO_PLACE,
  RESIDENT_INT,
  RESIDENT_INT_STRIDE,
  SHIFT_CLOSE_LAG_MINUTES,
  SHIFT_FIT_HOURS,
  SHIFT_OPEN_LEAD_MINUTES,
  TICKS_PER_GAME_DAY,
  TICKS_PER_GAME_HOUR,
  TICKS_PER_GAME_MINUTE,
} from "./civilian-constants.ts";
import type { CityState } from "./civilian-state.ts";

/** What `fillClosedPlaces` reads of the city: the clock's start, when each place re-opens after a wreck, and its weight in each hour (1 and over open). */
type HoursState = Pick<CityState, "startHour" | "closedUntilTick"> & { venues: Pick<CityState["venues"], "hourWeight"> };

/** 1 in `out`, a place a map-index long, for every place shut at `tick` (wrecked and closed for days, or outside its hours), else 0: what the signage and the interiors read, the same answer the society plans by. */
export function fillClosedPlaces(state: HoursState, tick: number, out: Uint8Array): void {
  const hour = hourOfDay(tick, state.startHour);
  for (let place = 0; place < out.length; place++) out[place] = state.closedUntilTick[place]! > tick || state.venues.hourWeight[place * HOURS_PER_GAME_DAY + hour]! < 1 ? 1 : 0;
}

/** The hour resident `resident`'s shift starts: their drawn hour, moved into their workplace's hours (by its offset from opening) where it would run past the close. */
export function shiftStartOf(state: CityState, resident: number): number {
  const base = resident * RESIDENT_INT_STRIDE;
  const drawn = state.ints[base + RESIDENT_INT.shiftStart]!;
  const work = state.ints[base + RESIDENT_INT.work]!;
  const opens = work === NO_PLACE ? -1 : state.venues.opensAt[work]!;
  if (opens < 0) return drawn;
  const latest = Math.max(0, state.venues.openHours[work]! - SHIFT_FIT_HOURS);
  const offset = (drawn - opens + HOURS_PER_GAME_DAY) % HOURS_PER_GAME_DAY;
  return (opens + (offset <= latest ? offset : offset % (latest + 1))) % HOURS_PER_GAME_DAY;
}

/** Ticks staff may still be at `place` from `tick`, at most `limit`: until `SHIFT_CLOSE_LAG_MINUTES` after it shuts; before it opens only within `SHIFT_OPEN_LEAD_MINUTES` of the opening, else 0. */
export function staffTicksLeft(state: CityState, place: number, tick: number, limit: number): number {
  const opens = state.venues.opensAt[place]!;
  if (opens < 0) return limit;
  const open = state.venues.openHours[place]! * TICKS_PER_GAME_HOUR + SHIFT_CLOSE_LAG_MINUTES * TICKS_PER_GAME_MINUTE;
  const sinceOpening = (((tick + (state.startHour - opens) * TICKS_PER_GAME_HOUR) % TICKS_PER_GAME_DAY) + TICKS_PER_GAME_DAY) % TICKS_PER_GAME_DAY;
  if (sinceOpening < open) return Math.min(limit, open - sinceOpening);
  const toOpening = TICKS_PER_GAME_DAY - sinceOpening;
  return toOpening <= SHIFT_OPEN_LEAD_MINUTES * TICKS_PER_GAME_MINUTE ? Math.min(limit, toOpening + open) : 0;
}
