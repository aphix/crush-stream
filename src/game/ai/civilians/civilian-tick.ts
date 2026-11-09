import { isDayTick, isHourTick } from "./civilian-clock.ts";
import { RESIDENT_INT, RESIDENT_INT_STRIDE } from "./civilian-constants.ts";
import { applyIndividualEvents, applySocietyEvents, broadcastStatic, completeEvents, reopenClosedPlaces } from "./civilian-events.ts";
import { decideResident } from "./civilian-plan.ts";
import type { CityState } from "./civilian-state.ts";
import { buildAnswer, type TickAnswer } from "./civilian-wire.ts";
import { runGameDay } from "./society-day.ts";

/** Every resident whose dwell ends at or before `tick` decides where to go next. */
function decideDue(state: CityState, tick: number): void {
  for (let resident = 0; resident < state.capacity; resident++) {
    const base = resident * RESIDENT_INT_STRIDE;
    if (state.ints[base + RESIDENT_INT.alive] === 1 && state.ints[base + RESIDENT_INT.nextDecisionTick]! <= tick) decideResident(state, resident, tick);
  }
}

/**
 * Steps the city one tick: events whose own tick has come, at an hour tick the society (events' society side, reopenings, the radio, at a game day's start each resident's day), then the decisions due. A pure function of
 * the state, so the worker and the main thread, stepping the same ticks in order, keep equal states.
 */
export function stepTick(state: CityState, tick: number): void {
  applyIndividualEvents(state, tick);
  if (isHourTick(tick)) {
    applySocietyEvents(state, tick);
    reopenClosedPlaces(state, tick);
    broadcastStatic(state, tick);
    if (tick > 0 && isDayTick(tick, state.startHour)) runGameDay(state, tick);
  }
  decideDue(state, tick);
  completeEvents(state, tick);
  state.nextTick = tick + 1;
}

/** Steps the next tick and returns what it changed: the worker's work, and the main thread's when the worker's answer is late. */
export function computeTick(state: CityState, tick: number): TickAnswer {
  if (tick !== state.nextTick) throw new Error(`civilian tick ${tick} computed at tick ${state.nextTick}`);
  stepTick(state, tick);
  return buildAnswer(state, tick);
}
