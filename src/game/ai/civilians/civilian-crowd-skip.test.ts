import { describe, expect, it } from "vitest";
import { buildFixtureMap } from "./civilian-graph.test-util.ts";
import { newCrowd } from "./civilian-crowd.test-util.ts";
import { stateDigest } from "./civilian-run.test-util.ts";
import { DECISION_HZ, EVENT_KIND, EVENT_TRIPLE, NEVER_TICK, RESIDENT_INT, RESIDENT_INT_STRIDE, TICKS_PER_GAME_HOUR } from "./civilian-constants.ts";
import type { CivilianCrowd } from "./civilian-crowd.ts";

const map = buildFixtureMap();
/** A crowd on the fixture map in which resident 91 commits a crime at tick 601 (hour 5 of its day): found by a probe, a bigger town having one in a few game hours. */
const CRIME_SEED = 9;
const CRIME_RESIDENTS = 120;
const CRIMINAL = 91;
const CRIME_TICK = 601;
const STEPPED_HOURS = 3;
const SKIPPED_TO_HOUR = 6;

const secondsOfHour = (hour: number): number => (hour * TICKS_PER_GAME_HOUR) / DECISION_HZ;

/** A host crowd stepped a tick at a time through the first `hours` game hours: started, and ready to skip. */
function steppedCrowd(hours: number): CivilianCrowd {
  const crowd = newCrowd(map, CRIME_RESIDENTS, CRIME_SEED);
  for (let tick = 0; tick <= hours * TICKS_PER_GAME_HOUR; tick++) crowd.step(tick / DECISION_HZ, [], true);
  return crowd;
}

describe("given a host crowd skipped through hours of its day", () => {
  // mutation: sed -i '/^    while (this.advancedThrough < last) {$/,/^    }$/{/this.postBatch();/d}' src/game/ai/civilians/civilian-crowd.ts
  it("when a crime falls due in the hours skipped, then it is raised in the log at its own time and the brain has committed it before any step", () => {
    const crowd = steppedCrowd(STEPPED_HOURS);
    const before = crowd.eventLog().length;
    expect(crowd.state.ints[CRIMINAL * RESIDENT_INT_STRIDE + RESIDENT_INT.crimeTick], "control: the crime is not committed yet").toBe(NEVER_TICK);
    expect(crowd.skipThrough(secondsOfHour(SKIPPED_TO_HOUR)), "the skip is taken").toBe(true);
    const log = crowd.eventLog();
    let raised = -1;
    for (let at = before; at + EVENT_TRIPLE <= log.length; at += EVENT_TRIPLE) if (log[at] === EVENT_KIND.crime && log[at + 1] === CRIMINAL) raised = log[at + 2]!;
    expect(raised, "raised at the tick it came due").toBe(CRIME_TICK / DECISION_HZ);
    expect(crowd.state.ints[CRIMINAL * RESIDENT_INT_STRIDE + RESIDENT_INT.crimeTick], "committed by the brain").toBe(CRIME_TICK);
  });

  // mutation: sed -i 's/    const last = tickAt(crowdSeconds) - 1;/    const last = tickAt(crowdSeconds) - 2;/' src/game/ai/civilians/civilian-crowd.ts
  it("when it skips to a time, then the society has lived every tick before the one that time falls in, the crowd's clock stands there, and the next step takes the last tick", () => {
    const crowd = steppedCrowd(STEPPED_HOURS);
    const seconds = secondsOfHour(SKIPPED_TO_HOUR) + 0.25;
    crowd.skipThrough(seconds);
    expect(crowd.state.nextTick, "the society's next tick is the one the time falls in").toBe(SKIPPED_TO_HOUR * TICKS_PER_GAME_HOUR);
    expect(crowd.crowdSeconds, "the clock").toBe(seconds);
    crowd.step(seconds, [], true);
    expect(crowd.state.nextTick, "the step took that tick").toBe(SKIPPED_TO_HOUR * TICKS_PER_GAME_HOUR + 1);
  });

  // mutation: sed -i 's/    if (!this.authority) return false;/    if (false) return false;/' src/game/ai/civilians/civilian-crowd.ts
  it("when a client's crowd, or one that has not stepped, is asked to skip, then nothing happens", () => {
    const client = newCrowd(map, CRIME_RESIDENTS, CRIME_SEED);
    for (let tick = 0; tick <= STEPPED_HOURS * TICKS_PER_GAME_HOUR; tick++) client.step(tick / DECISION_HZ, [], false);
    const digest = stateDigest(client.state);
    const seconds = client.crowdSeconds;
    expect(client.skipThrough(secondsOfHour(SKIPPED_TO_HOUR)), "a client's").toBe(false);
    expect(stateDigest(client.state), "the client's society").toBe(digest);
    expect(client.crowdSeconds, "the client's clock").toBe(seconds);
    const fresh = newCrowd(map, CRIME_RESIDENTS, CRIME_SEED);
    expect(fresh.skipThrough(secondsOfHour(SKIPPED_TO_HOUR)), "a crowd that has not stepped").toBe(false);
    expect(fresh.state.nextTick, "its society").toBe(0);
  });
});
