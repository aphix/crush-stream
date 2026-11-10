import { describe, expect, it } from "vitest";
import { HOURS_PER_GAME_DAY, TICKS_PER_GAME_HOUR } from "./civilian-constants.ts";
import { fillClosedPlaces } from "./society-hours.ts";

const PLACES = 3;
const EVENING_FROM = 18;
const EVENING_TO = 22;
const WRECKED_UNTIL_HOUR = 15;
/** Place 0 is open all day, place 1 only in the evening, place 2 was wrecked and is shut until mid-afternoon. */
const state = {
  startHour: 0,
  closedUntilTick: Int32Array.from([0, 0, WRECKED_UNTIL_HOUR * TICKS_PER_GAME_HOUR]),
  venues: {
    hourWeight: Float32Array.from({ length: PLACES * HOURS_PER_GAME_DAY }, (_, at) => {
      const place = Math.floor(at / HOURS_PER_GAME_DAY);
      const hour = at % HOURS_PER_GAME_DAY;
      return place === 1 && !(hour >= EVENING_FROM && hour < EVENING_TO) ? 0 : 1;
    }),
  },
};
const closedAt = (hour: number): string => {
  const out = new Uint8Array(PLACES);
  fillClosedPlaces(state, hour * TICKS_PER_GAME_HOUR, out);
  return out.join("");
};

describe("given a city with an all-day place, an evening place and a wrecked one", () => {
  // mutation: sed -i 's/state.closedUntilTick\[place\]! > tick || //' src/game/ai/civilians/society-hours.ts (a wreck does not shut a place)
  // mutation: sed -i 's/ || state.venues.hourWeight\[place \* HOURS_PER_GAME_DAY + hour\]! < 1//' src/game/ai/civilians/society-hours.ts (hours do not shut a place)
  it("when the places are read at noon, before the evening and in it, then each is shut by its hours or its wreck", () => {
    expect(closedAt(12), "noon: the evening place and the wrecked one are shut").toBe("011");
    expect(closedAt(16), "after the wreck, before the evening: the evening place is shut").toBe("010");
    expect(closedAt(19), "evening: all open").toBe("000");
  });
});
