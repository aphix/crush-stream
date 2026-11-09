import { clamp01 } from "../../kernel/scalar.ts";
import {
  DWELL_MINUTES,
  HOURS_PER_GAME_DAY,
  HOUR_WEIGHTS,
  NEED,
  NEED_COUNT,
  NEED_RATE_PER_HOUR,
  RATE_SPREAD,
  RELIEF_PER_MINUTE,
  RESIDENT_FLOAT,
  SHIFT_HOURS_AFTER,
  SHIFT_HOURS_BEFORE,
  START_NEED_MAX,
  TICKS_PER_GAME_HOUR,
  TICKS_PER_GAME_MINUTE,
  WORK_OFF_SHIFT,
} from "./civilian-constants.ts";

/** How much the hour of the day favours acting on a need; work is by the resident's own shift. */
export function needWeight(need: number, hour: number, shiftStart: number): number {
  if (need !== NEED.work) return HOUR_WEIGHTS[need]![hour]!;
  const sinceWindowOpened = (hour - shiftStart + SHIFT_HOURS_BEFORE + HOURS_PER_GAME_DAY) % HOURS_PER_GAME_DAY;
  return sinceWindowOpened < SHIFT_HOURS_BEFORE + SHIFT_HOURS_AFTER ? 1 : WORK_OFF_SHIFT;
}

/** Writes into `out` the needs at `tick` of a resident whose needs stood as stored in `floats` at `fromTick`, who walked to `arriveTick` and has dwelt since at a place of `dwellKind` (it eases the needs that kind answers while the others keep rising). */
export function evolveNeeds(floats: Float32Array, floatBase: number, fromTick: number, arriveTick: number, tick: number, dwellKind: number, out: Float32Array): void {
  const risingTicks = Math.max(0, Math.min(tick, arriveTick) - fromTick);
  const dwellTicks = Math.max(0, tick - arriveTick);
  const hours = (risingTicks + dwellTicks) / TICKS_PER_GAME_HOUR;
  const dwellMinutes = dwellTicks / TICKS_PER_GAME_MINUTE;
  const relief = RELIEF_PER_MINUTE[dwellKind]!;
  for (let need = 0; need < NEED_COUNT; need++) {
    const value = floats[floatBase + RESIDENT_FLOAT.needs + need]! + floats[floatBase + RESIDENT_FLOAT.rates + need]! * hours - relief[need]! * dwellMinutes;
    out[need] = clamp01(value);
  }
}

/** A resident's own rise rates (within `RATE_SPREAD` of the common ones) and a first set of needs, from the resident's draws. */
export function rollNeeds(floats: Float32Array, floatBase: number, draw: () => number): void {
  for (let need = 0; need < NEED_COUNT; need++) {
    floats[floatBase + RESIDENT_FLOAT.rates + need] = NEED_RATE_PER_HOUR[need]! * (1 + (draw() * 2 - 1) * RATE_SPREAD);
    floats[floatBase + RESIDENT_FLOAT.needs + need] = draw() * START_NEED_MAX;
  }
}

/** Ticks a dwell at a place of `kind` lasts for a draw `unit` in [0, 1). */
export function dwellTicksOf(kind: number, unit: number): number {
  const range = DWELL_MINUTES[kind]!;
  return Math.round((range[0] + (range[1] - range[0]) * unit) * TICKS_PER_GAME_MINUTE);
}

/** The need that reads highest now, or -1 when none is over `level`. */
export function topNeed(needs: Float32Array, level: number): number {
  let top = -1;
  let height = level;
  for (let need = 0; need < NEED_COUNT; need++) {
    if (needs[need]! < height) continue;
    height = needs[need]!;
    top = need;
  }
  return top;
}
