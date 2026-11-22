import { describe, expect, it } from "vitest";
import { AMBULANCE_DELAY_SECONDS } from "./civilian-crowd-constants.ts";
import { EVENT_KIND, EVENT_TRIPLE, SPECIES } from "./civilian-constants.ts";
import { PLACE_NAMES } from "./civilian-cast.ts";
import { buildFixtureMap, placeNamed } from "./civilian-graph.test-util.ts";
import { carAtWalker, FRAME_SECONDS, newCrowd, shownResident } from "./civilian-crowd.test-util.ts";
import type { CivilianCrowd } from "./civilian-crowd.ts";

const map = buildFixtureMap();
const CAR_SPEED = 14;
/** Metres back the car starts: it closes in well under a second. */
const RUN_UP = 6;
const CHASE_SECONDS = 2;
/** A resting animal lies within this (m) of its place's door: out on the pavement in front of it. */
const AT_DOOR = 1.5;

/** A host crowd stepped once: the bodega's dog is resting at its door. */
function hostCrowd(): { crowd: CivilianCrowd; seconds: number } {
  const crowd = newCrowd(map);
  crowd.step(1, [], true);
  return { crowd, seconds: 1 };
}

/** The log's events as (kind, subject) pairs. */
function loggedPairs(crowd: CivilianCrowd): string[] {
  const log = crowd.eventLog();
  const pairs: string[] = [];
  for (let at = 0; at < log.length; at += EVENT_TRIPLE) pairs.push(`${log[at]}:${log[at + 1]}`);
  return pairs;
}

describe("given a host crowd with the bodega's dog", () => {
  // mutation: sed -i 's/        placeAnimal(state, resident, seconds, pose, this.poses, this.separation);//' /home/aphix/worktrees/Life/src/game/ai/civilians/civilian-crowd.ts
  it("when it rests at its place, then it is shown at the bodega's door, a dog by its look word", () => {
    const { crowd } = hostCrowd();
    const dog = shownResident(crowd, SPECIES.dog);
    expect(dog, "the dog shown").toBeGreaterThanOrEqual(0);
    const bodega = map.places[placeNamed(map, PLACE_NAMES.bodega)]!;
    expect(Math.hypot(crowd.poses.x[dog]! - bodega.doorX, crowd.poses.z[dog]! - bodega.doorZ), "at the door").toBeLessThan(AT_DOOR);
    expect(crowd.poses.look[dog]! >>> 30, "a dog's look").toBe(SPECIES.dog);
    expect(crowd.isAnimal(dog), "an animal").toBe(true);
  });

  // mutation: sed -i 's/        if (near \&\& runsDown(car, spotX, spotZ, spotY))/        if (!animal \&\& near \&\& runsDown(car, spotX, spotZ, spotY))/' /home/aphix/worktrees/Life/src/game/ai/civilians/civilian-crowd.ts
  // mutation: sed -i 's/this.isAnimal(resident) ? Infinity : seconds + AMBULANCE_DELAY_SECONDS/seconds + AMBULANCE_DELAY_SECONDS/' /home/aphix/worktrees/Life/src/game/ai/civilians/civilian-crowd.ts
  it("when a car drives into it, then it is knocked down by the host's hit rule, hidden, its knock in the log, and nobody calls it an ambulance", () => {
    const start = hostCrowd();
    const crowd = start.crowd;
    let seconds = start.seconds;
    const dog = shownResident(crowd, SPECIES.dog);
    const { car, place } = carAtWalker(crowd, dog, RUN_UP, CAR_SPEED);
    const struck = [];
    for (let travelled = FRAME_SECONDS; travelled < CHASE_SECONDS && struck.length === 0; travelled += FRAME_SECONDS) {
      place(travelled);
      seconds += FRAME_SECONDS;
      crowd.step(seconds, [car], true);
      struck.push(...crowd.takeStrikes());
    }
    expect(struck.map((strike) => strike.guard), "the dog struck").toEqual([dog]);
    expect(crowd.poses.shown[dog], "hidden").toBe(0);
    expect(loggedPairs(crowd), "the knock logged").toContain(`${EVENT_KIND.knock}:${dog}`);
    expect(crowd["ambulanceDue"][dog], "no ambulance call due for it, whoever is about").toBe(Infinity);
    const until = seconds + AMBULANCE_DELAY_SECONDS * 2;
    for (; seconds < until; seconds += 1) crowd.step(seconds, [], true);
    expect(loggedPairs(crowd), "no ambulance").not.toContain(`${EVENT_KIND.ambulance}:${dog}`);
  });
});
