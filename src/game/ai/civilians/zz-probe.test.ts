import { it } from "vitest";
import { buildOpenWorldMap } from "../../world/openworld/openworld-map.ts";
import { layOutLots } from "../../world/openworld/openworld-lots.ts";
import { HOURS_PER_GAME_DAY, RESIDENT_INT, RESIDENT_INT_STRIDE, TICKS_PER_GAME_DAY, TICKS_PER_GAME_MINUTE } from "./civilian-constants.ts";
import { hourOfDay } from "./civilian-clock.ts";
import { computeTick } from "./civilian-tick.ts";
import { createCityState } from "./society.ts";
import { staffTicksLeft } from "./society-hours.ts";

const map = buildOpenWorldMap(layOutLots());

it("probe staff at shut workplaces", () => {
  for (const seed of [5, 7]) {
    const state = createCityState(seed, map, 150);
    let staffShut = 0;
    let staffAt = 0;
    let guestShut = 0;
    const examples: string[] = [];
    const shutAt = (place: number, tick: number): boolean => {
      // shut at tick, and also 30 min before and after
      const m = 30 * TICKS_PER_GAME_MINUTE;
      for (const t of [tick - m, tick, tick + m]) if (state.venues.hourWeight[place * HOURS_PER_GAME_DAY + hourOfDay(t, state.startHour)]! >= 1) return false;
      return true;
    };
    for (let tick = 0; tick < 2 * TICKS_PER_GAME_DAY; tick++) {
      computeTick(state, tick);
      if (tick % 60 !== 0) continue;
      for (let r = 0; r < state.capacity; r++) {
        const b = r * RESIDENT_INT_STRIDE;
        if (state.ints[b + RESIDENT_INT.alive] === 0) continue;
        const place = state.ints[b + RESIDENT_INT.place]!;
        if (state.ints[b + RESIDENT_INT.arriveTick]! > tick) continue;
        const work = state.ints[b + RESIDENT_INT.work]!;
        const home = state.ints[b + RESIDENT_INT.home]!;
        if (place === work) {
          staffAt++;
          if (staffTicksLeft(state, place, tick, 1) === 0) {
            staffShut++;
            if (examples.length < 6) examples.push(`r${r} ${map.places[place]!.name} h${hourOfDay(tick, state.startHour)} shift${state.ints[b + RESIDENT_INT.shiftStart]}`);
          }
        } else if (place !== home && shutAt(place, tick) && state.ints[b + RESIDENT_INT.pathCount] === 0) guestShut++;
      }
    }
    console.log(`seed ${seed}: staff samples ${staffAt}, at shut ${staffShut}; guests at shut, no leg ${guestShut}`, examples);
  }
});
