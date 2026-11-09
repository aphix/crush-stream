import { describe, expect, it } from "vitest";
import { NO_PLACE, NO_SEAT, RESIDENT_INT } from "./civilian-constants.ts";
import { stateDigest } from "./civilian-run.test-util.ts";
import type { CityState } from "./civilian-state.ts";
import { computeTick } from "./civilian-tick.ts";
import { applyAnswer } from "./civilian-wire.ts";
import { createCityState } from "./society.ts";
import { societyMap } from "./society-scenes.test-util.ts";
import { intAt } from "./society.test-util.ts";

const SEED = 5;
/** A game day and a half in ticks, looked at every thirty. */
const TICKS = 3600;
const SAMPLE_EVERY = 30;

/** Everything wrong with how seats are held at this moment, and how many are held: one holder per seat, only by the living, each in the seat's place, and the owner table says the same. */
function auditSeats(state: CityState, tick: number, problems: string[]): number {
  const held = new Set<number>();
  for (let resident = 0; resident < state.capacity; resident++) {
    const seat = intAt(state, resident, RESIDENT_INT.seat);
    if (seat === NO_SEAT) continue;
    const place = intAt(state, resident, RESIDENT_INT.place);
    const slot = state.venues.seatBase[place]! + seat;
    if (intAt(state, resident, RESIDENT_INT.alive) === 0) problems.push(`dead resident ${resident} holds a seat at tick ${tick}`);
    if (seat >= state.venues.seatCount[place]!) problems.push(`resident ${resident} holds seat ${seat} of ${societyMap.places[place]!.name}, which has ${state.venues.seatCount[place]}`);
    if (held.has(slot)) problems.push(`two residents hold seat ${seat} of ${societyMap.places[place]!.name} at tick ${tick}`);
    if (state.seatOwner[slot] !== resident) problems.push(`the owner table names ${state.seatOwner[slot]} for resident ${resident}'s seat at tick ${tick}`);
    held.add(slot);
  }
  for (let slot = 0; slot < state.seatOwner.length; slot++) {
    if (state.seatOwner[slot] !== NO_PLACE && !held.has(slot)) problems.push(`slot ${slot} is owned by ${state.seatOwner[slot]}, whose row holds no such seat, at tick ${tick}`);
  }
  return held.size;
}

function ownersDigest(state: CityState): number {
  let hash = 2166136261;
  for (let slot = 0; slot < state.seatOwner.length; slot++) hash = Math.imul(hash ^ state.seatOwner[slot]!, 16777619);
  return hash >>> 0;
}

describe("given the neighbourhood living a game day and a half, with seats at the coffee shop, the bar and every stoop", () => {
  const state = createCityState(SEED, societyMap, 60);
  const mirror = createCityState(SEED, societyMap, 60);
  const problems: string[] = [];
  let mostHeld = 0;
  for (let tick = 0; tick < TICKS; tick++) {
    applyAnswer(mirror, computeTick(state, tick));
    if (tick % SAMPLE_EVERY === 0) mostHeld = Math.max(mostHeld, auditSeats(state, tick, problems));
  }

  it("when it is sampled all along, then no seat ever has two holders and the owner table always agrees with the rows", () => {
    expect(problems.slice(0, 3), "problems found").toEqual([]);
    expect(mostHeld, "most seats held at one sample").toBeGreaterThan(0);
  });

  it("when a city that only hears the answers has lived the same time, then it holds the same seats", () => {
    expect(ownersDigest(mirror), "digest of who owns which seat").toBe(ownersDigest(state));
    expect(stateDigest(mirror), "digest of the whole state").toBe(stateDigest(state));
  });
});
