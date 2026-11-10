import { DECISION_HZ, HOURS_PER_GAME_DAY, MINUTES_PER_GAME_HOUR, STREAM, TICKS_PER_GAME_DAY, TICKS_PER_GAME_HOUR, TICKS_PER_GAME_MINUTE } from "./civilian-constants.ts";
import { residentDraws } from "./civilian-draws.ts";

/** The tick whose half second holds crowd time `seconds` (crowd seconds: the sim's clock, a game minute each). */
export function tickAt(seconds: number): number {
  return Math.floor(seconds * DECISION_HZ);
}

/** The game hour (0-23) crowd time 0 falls in: drawn from the seed. */
export function startHourOf(seed: number): number {
  return Math.floor(residentDraws(seed, 0, STREAM.clock, 0)() * HOURS_PER_GAME_DAY);
}

/** Ticks since game midnight of game day 0; hours and days start on multiples of their length. */
function gameTickOf(tick: number, startHour: number): number {
  return tick + startHour * TICKS_PER_GAME_HOUR;
}

/** The whole game minutes crowd time `seconds` is past the crowd's start. */
export function gameMinuteAt(seconds: number): number {
  return Math.floor((seconds * DECISION_HZ) / TICKS_PER_GAME_MINUTE);
}

/** The crowd seconds `minutes` game minutes take: `gameMinuteAt`'s inverse. */
export function secondsOfGameMinutes(minutes: number): number {
  return (minutes * TICKS_PER_GAME_MINUTE) / DECISION_HZ;
}

/** The game hour (0 up to 24, with its fraction) that `minute` game minutes past the crowd's start fall at: `hourOfDay`'s whole hours, finer. */
export function gameHourAtMinute(minute: number, startHour: number): number {
  return (((startHour + minute / MINUTES_PER_GAME_HOUR) % HOURS_PER_GAME_DAY) + HOURS_PER_GAME_DAY) % HOURS_PER_GAME_DAY;
}

export function hourOfDay(tick: number, startHour: number): number {
  return Math.floor(gameTickOf(tick, startHour) / TICKS_PER_GAME_HOUR) % HOURS_PER_GAME_DAY;
}

export function dayOf(tick: number, startHour: number): number {
  return Math.floor(gameTickOf(tick, startHour) / TICKS_PER_GAME_DAY);
}

/** Game hours start on every `TICKS_PER_GAME_HOUR` ticks: the start hour is a whole number of them. */
export function isHourTick(tick: number): boolean {
  return tick % TICKS_PER_GAME_HOUR === 0;
}

export function isDayTick(tick: number, startHour: number): boolean {
  return gameTickOf(tick, startHour) % TICKS_PER_GAME_DAY === 0;
}
