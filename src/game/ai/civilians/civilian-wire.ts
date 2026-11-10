import type { OpenWorldMap } from "../../world/openworld/walk-graph.ts";
import { completeEvents } from "./civilian-events.ts";
import { MAX_PATH_NODES, NEVER_TICK, NO_SEAT, RESIDENT_FLOAT_STRIDE, RESIDENT_INT, RESIDENT_INT_STRIDE } from "./civilian-constants.ts";
import { CityState, commitResident, measurePath, retractResident } from "./civilian-state.ts";
import { releaseSeat } from "./society-seats.ts";

/**
 * What the main thread and the brain's Web Worker (`civilian-worker.ts`) say to each other. The main thread posts the map and seed once, then the
 * events of each tick; the worker answers every tick, in order, with the rows that tick changed. Typed arrays travel by transfer both ways.
 */
export type ToCivilianWorker = { kind: "init"; seed: number; playableResidents: number; map: OpenWorldMap; signals: boolean } | { kind: "plan"; tick: number; events: Float64Array };

/** What one tick changed: the residents whose rows changed with their integer rows, float rows and the path nodes of those on a leg (in row order), the places whose closing changed as (place, closed until tick) pairs, and the whole fear field when it moved (else empty). */
export type TickAnswer = {
  tick: number;
  residents: Int32Array;
  ints: Int32Array;
  floats: Float32Array;
  paths: Uint16Array;
  closures: Int32Array;
  fear: Float32Array;
};

export type FromCivilianWorker = { kind: "answer"; answer: TickAnswer } | { kind: "failed"; message: string };

/** The buffers of an answer, for the transfer list. */
export function answerBuffers(answer: TickAnswer): ArrayBuffer[] {
  return [answer.residents.buffer, answer.ints.buffer, answer.floats.buffer, answer.paths.buffer, answer.closures.buffer, answer.fear.buffer].filter((buffer): buffer is ArrayBuffer => buffer instanceof ArrayBuffer);
}

/** Packs what the step changed (the dirty rows, closings, fear) into an answer and clears the change marks. */
export function buildAnswer(state: CityState, tick: number): TickAnswer {
  const count = state.dirtyCount;
  let pathNodes = 0;
  for (let at = 0; at < count; at++) pathNodes += state.ints[state.dirty[at]! * RESIDENT_INT_STRIDE + RESIDENT_INT.pathCount]!;
  const answer: TickAnswer = {
    tick,
    residents: new Int32Array(count),
    ints: new Int32Array(count * RESIDENT_INT_STRIDE),
    floats: new Float32Array(count * RESIDENT_FLOAT_STRIDE),
    paths: new Uint16Array(pathNodes),
    closures: state.closureChanges.slice(0, state.closureCount * 2),
    fear: state.fearDirty ? state.fear.slice() : new Float32Array(0),
  };
  let pathAt = 0;
  for (let at = 0; at < count; at++) {
    const resident = state.dirty[at]!;
    answer.residents[at] = resident;
    answer.ints.set(state.ints.subarray(resident * RESIDENT_INT_STRIDE, (resident + 1) * RESIDENT_INT_STRIDE), at * RESIDENT_INT_STRIDE);
    answer.floats.set(state.floats.subarray(resident * RESIDENT_FLOAT_STRIDE, (resident + 1) * RESIDENT_FLOAT_STRIDE), at * RESIDENT_FLOAT_STRIDE);
    const nodes = state.ints[resident * RESIDENT_INT_STRIDE + RESIDENT_INT.pathCount]!;
    answer.paths.set(state.pathNodes.subarray(resident * MAX_PATH_NODES, resident * MAX_PATH_NODES + nodes), pathAt);
    pathAt += nodes;
    state.dirtyMark[resident] = 0;
  }
  state.dirtyCount = 0;
  state.closureCount = 0;
  state.fearDirty = false;
  return answer;
}

/** Applies an answer to a mirror state that has stepped every tick before it: the rows, paths, closings and fear it carries, and the tick's event bookkeeping. Cheap: copies, no search. */
export function applyAnswer(state: CityState, answer: TickAnswer): void {
  if (answer.tick !== state.nextTick) throw new Error(`civilian answer for tick ${answer.tick} applied at tick ${state.nextTick}`);
  let pathAt = 0;
  for (let at = 0; at < answer.residents.length; at++) {
    const resident = answer.residents[at]!;
    const intBase = resident * RESIDENT_INT_STRIDE;
    const floatBase = resident * RESIDENT_FLOAT_STRIDE;
    retractResident(state, resident);
    releaseSeat(state, resident);
    for (let field = 0; field < RESIDENT_INT_STRIDE; field++) state.ints[intBase + field] = answer.ints[at * RESIDENT_INT_STRIDE + field]!;
    const seat = state.ints[intBase + RESIDENT_INT.seat]!;
    if (seat !== NO_SEAT) state.seatOwner[state.venues.seatBase[state.ints[intBase + RESIDENT_INT.place]!]! + seat] = resident;
    for (let field = 0; field < RESIDENT_FLOAT_STRIDE; field++) state.floats[floatBase + field] = answer.floats[at * RESIDENT_FLOAT_STRIDE + field]!;
    const nodes = state.ints[intBase + RESIDENT_INT.pathCount]!;
    for (let step = 0; step < nodes; step++) state.pathNodes[resident * MAX_PATH_NODES + step] = answer.paths[pathAt + step]!;
    pathAt += nodes;
    if (nodes > 0) measurePath(state, resident);
    if (state.ints[intBase + RESIDENT_INT.alive] === 0) {
      state.hiddenFromTick[resident] = NEVER_TICK;
      state.hiddenUntilTick[resident] = NEVER_TICK;
    }
    commitResident(state, resident);
  }
  for (let at = 0; at < answer.closures.length; at += 2) state.closedUntilTick[answer.closures[at]!] = answer.closures[at + 1]!;
  if (answer.fear.length > 0) state.fear.set(answer.fear);
  completeEvents(state, answer.tick);
  state.nextTick = answer.tick + 1;
}
