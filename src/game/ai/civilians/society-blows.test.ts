import { describe, expect, it } from "vitest";
import { EVENT_KIND, EVENT_LEAD_TICKS } from "./civilian-constants.ts";
import { applyReactionEvents, queueEvents } from "./civilian-events.ts";
import { CivilianBlow, findCivilianBlow, knockoutBlow } from "./society-activity.ts";
import { newCast, societyMap } from "./society-scenes.test-util.ts";
import { placeIn, stageResident } from "./society.test-util.ts";

const NOON = 12;
const HOME_A1 = placeIn(societyMap, "Rowhome A1-1");

/** Two neighbours at one door in a fight the lower id started; the crowd second they square up. */
function fight() {
  const cast = newCast(NOON);
  const { state, resident, neighbour } = cast;
  for (const person of [resident, neighbour]) stageResident(state, person, { place: HOME_A1, tick: cast.tick });
  queueEvents(state, cast.tick, [EVENT_KIND.fight, neighbour, cast.tick / 2, EVENT_KIND.alongside, resident, cast.tick / 2]);
  applyReactionEvents(state, cast.tick + EVENT_LEAD_TICKS);
  return { state, starter: resident, victim: neighbour, arrive: (cast.tick + EVENT_LEAD_TICKS) / 2 };
}

describe("given two civilians in a fight", () => {
  // mutation: sed -i 's/partner < 0 || partner <= resident || ints/partner < 0 || ints/' src/game/ai/civilians/society-activity.ts
  it("when its 8 s are searched for blows, then they land only on the one who did not start it, the first 0.3 s after they square up and the next 1.2 s later", () => {
    const { state, starter, victim, arrive } = fight();
    const out = new CivilianBlow();
    expect(findCivilianBlow(state, arrive + 0.2, arrive + 0.4, 0, out), "the first blow's striker").toBe(starter);
    expect(out.victim, "its victim").toBe(victim);
    expect(findCivilianBlow(state, arrive + 0.2, arrive + 0.4, victim, out), "searched from the victim on: she lands none").toBe(-1);
    expect(findCivilianBlow(state, arrive + 0.4, arrive + 1.4, 0, out), "between blows").toBe(-1);
    expect(findCivilianBlow(state, arrive + 1.4, arrive + 1.6, 0, out), "the second blow").toBe(starter);
  });

  // mutation: sed -i 's/^export const KNOCKOUT_SHARE = 0.6;/export const KNOCKOUT_SHARE = 0;/' src/game/ai/civilians/civilian-constants.ts
  it("when the knock-out blow is drawn for a thousand victims, then between 55 and 65 in a hundred have one, each from 2 to 5, and a victim's is the same every time it is asked", () => {
    let some = 0;
    for (let victim = 0; victim < 1000; victim++) {
      const blow = knockoutBlow(9, victim, 400);
      expect(knockoutBlow(9, victim, 400), `victim ${victim} asked again`).toBe(blow);
      if (blow === 0) continue;
      some++;
      expect(blow >= 2 && blow <= 5, `victim ${victim}: blow ${blow}`).toBe(true);
    }
    expect(some >= 550 && some <= 650, `${some} of 1000 fights end in a knock-out`).toBe(true);
  });

  // mutation: sed -i 's/KNOCKOUT_MIN_BLOWS + Math.floor((draw \/ KNOCKOUT_SHARE) \* KNOCKOUT_BLOW_SPAN)/KNOCKOUT_MIN_BLOWS/' src/game/ai/civilians/society-activity.ts
  it("when the knock-out blow is drawn for a thousand victims, then each of the blows 2, 3, 4 and 5 is the one for 100 to 200 of them", () => {
    const victims = [0, 0, 0, 0, 0, 0];
    for (let victim = 0; victim < 1000; victim++) victims[knockoutBlow(9, victim, 400)]!++;
    for (const blow of [2, 3, 4, 5]) expect(victims[blow]! >= 100 && victims[blow]! <= 200, `${victims[blow]} of 1000 victims are felled by blow ${blow}`).toBe(true);
  });
});
