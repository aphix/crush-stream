import { BLOCK_OF_DAY, CAST, type CastMember } from "./civilian-cast.ts";
import { dayOf, hourOfDay } from "./civilian-clock.ts";
import {
  BLOCK_COUNT,
  BLOCK_DAY_STEP,
  DAYS_PER_WEEK,
  HOURS_PER_GAME_DAY,
  MINUTES_PER_GAME_DAY,
  MINUTES_PER_GAME_HOUR,
  NO_PLACE,
  STREAM,
  TICKS_PER_GAME_HOUR,
  TICKS_PER_GAME_MINUTE,
} from "./civilian-constants.ts";
import { residentDraws } from "./civilian-draws.ts";
import type { MapIndex } from "./civilian-map-index.ts";
import type { CityState } from "./civilian-state.ts";

/** Marks an appointment whose place is the day's block, not one named place. */
const BLOCK_OF_DAY_PLACE = -2;

type ResolvedAppointment = { purpose: number; place: number; minuteOfDay: number; weekday: number; dwellMinutes: number };
export type ResolvedMember = { member: CastMember; home: number; workplace: number; appointments: readonly ResolvedAppointment[] };

/** The next appointment a walker is to keep: the leg's purpose, the place, the tick it ends at the place and how long it stays. */
type AppointmentSlot = { purpose: number; place: number; arriveTick: number; dwellTicks: number };

export function newAppointmentSlot(): AppointmentSlot {
  return { purpose: 0, place: NO_PLACE, arriveTick: 0, dwellTicks: 0 };
}

/** The cast whose home the map has (a missing home drops the person); a story whose place is missing is skipped, not an error. */
export function resolveCast(index: MapIndex): ResolvedMember[] {
  const resolved: ResolvedMember[] = [];
  for (const member of CAST) {
    const home = index.placeByName.get(member.home);
    if (home === undefined) continue;
    const appointments: ResolvedAppointment[] = [];
    for (const appointment of member.appointments) {
      const place = appointment.place === BLOCK_OF_DAY ? BLOCK_OF_DAY_PLACE : index.placeByName.get(appointment.place);
      if (place === undefined) continue;
      appointments.push({ purpose: appointment.purpose, place, minuteOfDay: appointment.hour * MINUTES_PER_GAME_HOUR + appointment.minute, weekday: appointment.weekday ?? -1, dwellMinutes: appointment.dwellMinutes });
    }
    appointments.sort((first, second) => first.minuteOfDay - second.minuteOfDay);
    resolved.push({ member, home, workplace: member.workplace === null ? NO_PLACE : (index.placeByName.get(member.workplace) ?? NO_PLACE), appointments });
  }
  return resolved;
}

/** The places the named residents live at: a newcomer or a mover does not take a room there. */
export function castHomesOf(cast: readonly ResolvedMember[]): ReadonlySet<number> {
  return new Set(cast.map((resolved) => resolved.home));
}

/** The block (0-8) a flyer-poster walks on a game day: a step of `BLOCK_DAY_STEP` blocks from a seeded start, so no two days in a row share one. */
export function blockOfDay(seed: number, day: number): number {
  const start = Math.floor(residentDraws(seed, 0, STREAM.block, 0)() * BLOCK_COUNT);
  return (start + day * BLOCK_DAY_STEP) % BLOCK_COUNT;
}

/** Whether `place` is within its hours from `fromTick` to `toTick`, ends included (both hours read). */
function openThrough(state: CityState, place: number, fromTick: number, toTick: number): boolean {
  const { hourWeight } = state.venues;
  return hourWeight[place * HOURS_PER_GAME_DAY + hourOfDay(fromTick, state.startHour)]! >= 1 && hourWeight[place * HOURS_PER_GAME_DAY + hourOfDay(toTick, state.startHour)]! >= 1;
}

/** The day's block's place for an appointment `sequence` from `arriveTick` for `dwellTicks`: the `sequence`th, else the next of the block open all that while (a shut one is no place to stand in), else the next block's. */
function placeOnBlockOfDay(state: CityState, day: number, sequence: number, arriveTick: number, dwellTicks: number): number {
  const block = blockOfDay(state.seed, day);
  for (let step = 0; step < BLOCK_COUNT; step++) {
    const places = state.index.placesOfBlock[(block + step) % BLOCK_COUNT]!;
    for (let at = 0; at < places.length; at++) {
      const place = places[(sequence + at) % places.length]!;
      if (openThrough(state, place, arriveTick, arriveTick + dwellTicks - 1)) return place;
    }
  }
  return NO_PLACE;
}

/** The weekday (Monday 0) of a game day. */
export function weekdayOf(state: CityState, day: number): number {
  return (day + state.startWeekday) % DAYS_PER_WEEK;
}

/** Fills `slot` with the first appointment of a named resident that ends after `afterTick`, within the coming week; false when there is none. A pure function of the clock, so every peer keeps the same one. */
export function nextAppointment(state: CityState, resident: number, afterTick: number, slot: AppointmentSlot): boolean {
  const member = state.cast[resident];
  if (member === undefined) return false;
  const firstDay = dayOf(Math.max(afterTick, 0), state.startHour);
  for (let dayStep = 0; dayStep <= DAYS_PER_WEEK; dayStep++) {
    const day = firstDay + dayStep;
    const weekday = weekdayOf(state, day);
    for (let at = 0; at < member.appointments.length; at++) {
      const appointment = member.appointments[at]!;
      if (appointment.weekday !== -1 && appointment.weekday !== weekday) continue;
      const arriveTick = (day * MINUTES_PER_GAME_DAY + appointment.minuteOfDay) * TICKS_PER_GAME_MINUTE - state.startHour * TICKS_PER_GAME_HOUR;
      if (arriveTick <= afterTick) continue;
      const dwellTicks = appointment.dwellMinutes * TICKS_PER_GAME_MINUTE;
      const place = appointment.place === BLOCK_OF_DAY_PLACE ? placeOnBlockOfDay(state, day, at, arriveTick, dwellTicks) : appointment.place;
      if (place === NO_PLACE) continue;
      slot.purpose = appointment.purpose;
      slot.place = place;
      slot.arriveTick = arriveTick;
      slot.dwellTicks = dwellTicks;
      return true;
    }
  }
  return false;
}
