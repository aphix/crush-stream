import { describe, expect, it } from "vitest";
import { ACTIVITY } from "../civilians/civilian-activity.ts";
import { EVENT_KIND } from "../civilians/civilian-constants.ts";
import { MOOD } from "../civilians/civilian-names.ts";
import { COP_RUN_SPEED, EVENT_SECONDS } from "./auto-constants.ts";
import { activityInterest, copInterest, driverInterest, eventInterest, moodInterest } from "./auto-interest.ts";

const DRIVING_MPS = 12;
const CRAWL_MPS = 2;

describe("given what the Auto camera finds interesting", () => {
  it("when civilians fight, are arrested or shove, then each is more to watch than buying, and buying more than a stroll", () => {
    const fight = [ACTIVITY.swing, ACTIVITY.hit, ACTIVITY.block, ACTIVITY.arresting, ACTIVITY.cuffing].map(activityInterest);
    expect(Math.min(...fight), "the least of a fight and an arrest").toBeGreaterThan(activityInterest(ACTIVITY.bump));
    expect(activityInterest(ACTIVITY.bump), "a shove").toBeGreaterThan(activityInterest(ACTIVITY.buy));
    expect(activityInterest(ACTIVITY.buy), "buying at a counter").toBeGreaterThan(activityInterest(ACTIVITY.none));
  });

  it("when moods are weighed, then anger and fear are more to watch than a fine day", () => {
    expect(moodInterest(MOOD.angry), "anger").toBeGreaterThan(moodInterest(MOOD.fine));
    expect(moodInterest(MOOD.afraid), "fear").toBeGreaterThan(moodInterest(MOOD.busy));
  });

  it("when a fight begins, then it is at its hottest, falls over its window, and is nothing once it is over or before it began", () => {
    const window = EVENT_SECONDS[EVENT_KIND.fight]!;
    expect(eventInterest(EVENT_KIND.fight, 0), "the moment it begins").toBe(1);
    expect(eventInterest(EVENT_KIND.fight, window / 2), "half way through its window").toBeCloseTo(0.5, 6);
    expect(eventInterest(EVENT_KIND.fight, window), "the end of its window").toBe(0);
    expect(eventInterest(EVENT_KIND.fight, -1), "before it began").toBe(0);
    expect(eventInterest(EVENT_KIND.bust, 0), "a bust").toBeGreaterThan(eventInterest(EVENT_KIND.push, 0));
    expect(eventInterest(EVENT_KIND.alongside, 0), "an event that only names the other party").toBe(0);
  });

  it("when cars are weighed, then a lit siren beats a car at speed, a car at speed beats a crawl, and a parked car is the least", () => {
    const readings = [driverInterest(DRIVING_MPS, true), driverInterest(DRIVING_MPS, false), driverInterest(CRAWL_MPS, false), driverInterest(0, false)];
    expect(readings, "siren, speed, crawl, parked").toEqual([...readings].sort((a, b) => b - a));
    expect(new Set(readings).size, "four different readings").toBe(4);
  });

  it("when a foot cop runs, then he is in pursuit and more to watch than one on his beat, and making an arrest is more still", () => {
    expect(copInterest(ACTIVITY.none, COP_RUN_SPEED), "at a run").toBeGreaterThan(copInterest(ACTIVITY.none, 1));
    expect(copInterest(ACTIVITY.arresting, 0), "making an arrest").toBeGreaterThan(copInterest(ACTIVITY.none, COP_RUN_SPEED));
  });
});
