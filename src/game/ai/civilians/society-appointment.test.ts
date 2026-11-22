import { describe, expect, it } from "vitest";
import { buildOpenWorldMap } from "../../world/openworld/openworld-map.ts";
import { layOutLots } from "../../world/openworld/openworld-lots.ts";
import { FLAG, MAX_PATH_NODES, RESIDENT_INT, TICKS_PER_GAME_HOUR, TICKS_PER_GAME_MINUTE } from "./civilian-constants.ts";
import { tickOfHour } from "./civilian-run.test-util.ts";
import { newAppointmentSlot, nextAppointment } from "./civilian-story.ts";
import { computeTick } from "./civilian-tick.ts";
import { createCityState } from "./society.ts";
import { intAt, stageResident } from "./society.test-util.ts";
import { walkMetres } from "./society-cars.ts";
import { PLACE_KIND } from "../../world/openworld/walk-graph.ts";

const map = buildOpenWorldMap(layOutLots());
const SEED = 5;
const RESIDENTS = 150;
/** Dee is visiting the home farthest on foot from the bodega (a walk of game hours: a crowd second is a game minute) with a decision due at 17:00, six hours before her 23:00 coffee there. */
const DAY = 1;
const DECIDE_HOUR = 17;
/** Fear a wreck leaves at its middle (the most `raiseFear` gives). */
const FULL_FEAR = 1;

/** Minutes Dee reaches the bodega after her 23:00 appointment (negative: early), with the corners of her usual way there (the shortest, nobody afraid) feared or not. */
function deeLateness(feared: boolean): number {
  const state = createCityState(SEED, map, RESIDENTS);
  const start = tickOfHour(state, DAY, DECIDE_HOUR);
  for (let tick = 0; tick < start; tick++) computeTick(state, tick);
  const dee = state.cast.findIndex((resolved) => resolved.member.key === "dee");
  const slot = newAppointmentSlot();
  nextAppointment(state, dee, start, slot);
  const homes = map.places.flatMap((place, index) => (place.kind === PLACE_KIND.home && place.doorNode >= 0 ? [index] : []));
  const visited = homes.reduce((far, home) => (walkMetres(state, home, slot.place) > walkMetres(state, far, slot.place) ? home : far));
  stageResident(state, dee, { place: visited, home: intAt(state, dee, RESIDENT_INT.home), tick: start, flags: FLAG.cast });
  const count = state.finder.find(state.index.doorNode[visited]!, state.index.doorNode[slot.place]!, state.noFear, 1, state.scratchPath, 0, MAX_PATH_NODES);
  if (feared) for (let step = 1; step + 1 < count; step++) state.fear[state.scratchPath[step]!] = FULL_FEAR;
  for (let tick = start; tick < slot.arriveTick + TICKS_PER_GAME_HOUR; tick++) {
    computeTick(state, tick);
    if (intAt(state, dee, RESIDENT_INT.place) === slot.place && intAt(state, dee, RESIDENT_INT.storyTick) === slot.arriveTick) return (intAt(state, dee, RESIDENT_INT.arriveTick) - slot.arriveTick) / TICKS_PER_GAME_MINUTE;
  }
  throw new Error("Dee never set out for her coffee");
}

describe("given Dee's 23:00 coffee at the bodega and a night when her usual way there is feared (a wreck on it), so her walk goes round", () => {
  // mutation: sed -i 's/walkMetres(state, from, to, state.fear, isNight(hourOfDay(tick, state.startHour)) ? NIGHT_FEAR_WEIGHT : 1)/walkMetres(state, from, to)/' /home/aphix/worktrees/OwFix/src/game/ai/civilians/civilian-plan.ts (the estimate ignores fear)
  it("when she sets out from a friend's at the far end of the neighbourhood, then she is there by the appointed time, as on a night with no fear", () => {
    expect(deeLateness(false), "control: minutes late with no fear").toBeLessThanOrEqual(0);
    expect(deeLateness(true), "minutes late with her way feared").toBeLessThanOrEqual(0);
  });
});
