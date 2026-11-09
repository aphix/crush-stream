import { TICKS_PER_GAME_DAY, TICKS_PER_GAME_HOUR } from "./civilian-constants.ts";
import { queueEvents } from "./civilian-events.ts";
import type { CityState } from "./civilian-state.ts";
import { computeTick } from "./civilian-tick.ts";
import type { TickAnswer } from "./civilian-wire.ts";

function mix(hash: number, value: number): number {
  return Math.imul(hash ^ value, 16777619) >>> 0;
}

function mixInts(hash: number, values: ArrayLike<number>): number {
  let next = hash;
  for (let at = 0; at < values.length; at++) next = mix(next, values[at]!);
  return next;
}

function bitsOf(floats: Float32Array): Int32Array {
  return new Int32Array(floats.buffer, floats.byteOffset, floats.length);
}

/** A hash of everything that makes up a state (rows, paths, closings, fear): two states are equal when their digests are. */
export function stateDigest(state: CityState): string {
  let hash = 2166136261;
  hash = mixInts(hash, state.ints);
  hash = mixInts(hash, bitsOf(state.floats));
  hash = mixInts(hash, state.pathNodes);
  hash = mixInts(hash, state.closedUntilTick);
  hash = mixInts(hash, bitsOf(state.fear));
  hash = mix(hash, state.alive);
  hash = mix(hash, state.nextTick);
  return hash.toString(16);
}

/** A hash of what a tick's answer carries. */
export function answerDigest(answer: TickAnswer): string {
  let hash = mix(2166136261, answer.tick);
  hash = mixInts(hash, answer.residents);
  hash = mixInts(hash, answer.ints);
  hash = mixInts(hash, bitsOf(answer.floats));
  hash = mixInts(hash, answer.paths);
  hash = mixInts(hash, answer.closures);
  hash = mixInts(hash, bitsOf(answer.fear));
  return hash.toString(16);
}

/** Host events by the tick they are posted on: (kind, subject, crowd seconds) triples. */
export type EventsByTick = ReadonlyMap<number, readonly number[]>;

/** Steps `state` through `ticks` ticks from where it is, posting each tick's events first; returns every tick's answer digest joined, so the legs of the whole run are one string. */
export function runTicks(state: CityState, ticks: number, events: EventsByTick = new Map()): string {
  const digests: string[] = [];
  const last = state.nextTick + ticks;
  while (state.nextTick < last) {
    const tick = state.nextTick;
    const posted = events.get(tick);
    if (posted !== undefined) queueEvents(state, tick, posted);
    digests.push(answerDigest(computeTick(state, tick)));
  }
  return digests.join(",");
}

/** The tick at which crowd hour `hour` of game day `day` begins. */
export function tickOfHour(state: CityState, day: number, hour: number): number {
  return day * TICKS_PER_GAME_DAY + hour * TICKS_PER_GAME_HOUR - state.startHour * TICKS_PER_GAME_HOUR;
}
