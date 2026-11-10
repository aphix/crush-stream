import { PLACE_KIND } from "../../world/openworld/walk-graph.ts";
import { hourOfDay } from "./civilian-clock.ts";
import { HOUR_WEIGHTS, HOURS_PER_GAME_DAY, NEED, NO_PLACE, RESIDENT_INT, RESIDENT_INT_STRIDE, SPECIES, TICKS_PER_GAME_HOUR } from "./civilian-constants.ts";
import type { CityState } from "./civilian-state.ts";

/**
 * Who is awake in each home: what the open world's night windows read. The society has no sleep state of its own; it has rest. A resident who came home for rest (`legPurpose` rest) dwells there to
 * relieve the need, and the society's hour table (`HOUR_WEIGHTS`) weighs rest by the hour: 1 from ten at night to five, falling to 0.1 by day. A resident at their own home on rest is asleep while the hour's weight
 * has reached their own bedtime weight, a number from 0.5 to 1 that is theirs for life: so the evening thins from eight (the weight 0.5) to ten (1), the early riser is up from five and the night owl's
 * dawn is seven. Everyone else in a home (a guest, anyone there for another purpose, a child home from school) is awake.
 */

/** The least bedtime weight any resident has (the hour table's 0.5 is eight in the evening): the greatest is 1. */
const BEDTIME_FROM = 0.5;

/** A number in [0, 1) that only the resident's id decides: their bedtime's place between `BEDTIME_FROM` and 1. */
function bedtimeOf(resident: number): number {
  const mixed = Math.imul(resident + 1, 0x9e3779b1) ^ Math.imul(resident + 7, 0x85ebca6b);
  return BEDTIME_FROM + (1 - BEDTIME_FROM) * ((Math.imul(mixed, 0xc2b2ae35) >>> 8) / 0x1000000);
}

/** The society's rest weight at `tick`: the hour table's value for the hour, drawn to the next hour's by the minutes past. */
export function restWeightAt(tick: number, startHour: number): number {
  const hour = hourOfDay(tick, startHour);
  const into = (((tick + startHour * TICKS_PER_GAME_HOUR) % TICKS_PER_GAME_HOUR) + TICKS_PER_GAME_HOUR) % TICKS_PER_GAME_HOUR;
  const now = HOUR_WEIGHTS[NEED.rest][hour]!;
  const next = HOUR_WEIGHTS[NEED.rest][(hour + 1) % HOURS_PER_GAME_DAY]!;
  return now + (next - now) * (into / TICKS_PER_GAME_HOUR);
}

/** Whether a resident resting at their own home is asleep at this rest weight. */
export function sleepsAt(restWeight: number, resident: number): boolean {
  return restWeight >= bedtimeOf(resident);
}

/** `out[place]` = the people awake at each home place at `tick` (every other place 0): people (not animals) who have arrived and are not asleep; capped at 255. */
export function fillAwakeAtHomes(state: CityState, tick: number, out: Uint8Array): void {
  out.fill(0);
  const rest = restWeightAt(tick, state.startHour);
  const ints = state.ints;
  for (let resident = 0; resident < state.capacity; resident++) {
    const base = resident * RESIDENT_INT_STRIDE;
    if (ints[base + RESIDENT_INT.alive] === 0 || ints[base + RESIDENT_INT.species] !== SPECIES.person) continue;
    const place = ints[base + RESIDENT_INT.place]!;
    if (place === NO_PLACE || tick < ints[base + RESIDENT_INT.arriveTick]! || state.index.kindOf[place] !== PLACE_KIND.home) continue;
    const resting = ints[base + RESIDENT_INT.home] === place && ints[base + RESIDENT_INT.legPurpose] === NEED.rest;
    if (resting && sleepsAt(rest, resident)) continue;
    if (out[place]! < 255) out[place]!++;
  }
}
