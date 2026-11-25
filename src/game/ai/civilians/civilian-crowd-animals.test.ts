import { describe, expect, it } from "vitest";
import { AMBULANCE_DELAY_SECONDS } from "./civilian-crowd-constants.ts";
import { EVENT_KIND, EVENT_TRIPLE, SPECIES } from "./civilian-constants.ts";
import { PLACE_NAMES } from "./civilian-cast.ts";
import { buildFixtureMap, placeNamed } from "./civilian-graph.test-util.ts";
import { carAtWalker, FRAME_SECONDS, newCrowd, shownResident } from "./civilian-crowd.test-util.ts";
import type { CivilianCrowd } from "./civilian-crowd.ts";
import { chestMet, lookAtOf, LookRay } from "./civilian-look.ts";
import { residentNameText } from "./civilian-mood.ts";

const map = buildFixtureMap();
const CAR_SPEED = 14;
/** Metres back the car starts: it closes in well under a second. */
const RUN_UP = 6;
const CHASE_SECONDS = 2;
/** A resting animal lies within this (m) of its place's door: out on the pavement in front of it. */
const AT_DOOR = 1.5;
/** The eye stands this far (m) out in front of the dog; a dog's body is this high (m) over its feet (`ANIMAL_SHAPES`: 0.3 m legs); a ray this far (m) over that passes a person's chest; a bullet's radius (m, `SHOT_BODY_RADIUS`). */
const EYE_BACK = 5;
const DOG_BODY = 0.3;
const OVER_IT = 1.1;
const BULLET_RADIUS = 0.35;

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
  // mutation: sed -i 's/        placeAnimal(state, resident, seconds, pose, this.poses, this.separation);//' src/game/ai/civilians/civilian-crowd.ts
  it("when it rests at its place, then it is shown at the bodega's door, a dog by its look word", () => {
    const { crowd } = hostCrowd();
    const dog = shownResident(crowd, SPECIES.dog);
    expect(dog, "the dog shown").toBeGreaterThanOrEqual(0);
    const bodega = map.places[placeNamed(map, PLACE_NAMES.bodega)]!;
    expect(Math.hypot(crowd.poses.x[dog]! - bodega.doorX, crowd.poses.z[dog]! - bodega.doorZ), "at the door").toBeLessThan(AT_DOOR);
    expect(crowd.poses.look[dog]! >>> 30, "a dog's look").toBe(SPECIES.dog);
    expect(crowd.isAnimal(dog), "an animal").toBe(true);
  });

  // mutation: sed -i 's/        if (near \&\& runsDown(car, spotX, spotZ, spotY))/        if (!animal \&\& near \&\& runsDown(car, spotX, spotZ, spotY))/' src/game/ai/civilians/civilian-crowd.ts
  // mutation: sed -i 's/this.isAnimal(resident) ? Infinity : seconds + AMBULANCE_DELAY_SECONDS/seconds + AMBULANCE_DELAY_SECONDS/' src/game/ai/civilians/civilian-crowd.ts
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
    expect(struck.length, "strikes").toBe(1);
    expect(struck[0]!.guard, "the dog struck").toBe(dog);
    expect(crowd.poses.shown[dog], "hidden").toBe(0);
    expect(loggedPairs(crowd), "the knock logged").toContain(`${EVENT_KIND.knock}:${dog}`);
    expect(crowd.aftermath["ambulanceDue"][dog], "no ambulance call due for it, whoever is about").toBe(Infinity);
    const until = seconds + AMBULANCE_DELAY_SECONDS * 2;
    for (; seconds < until; seconds += 1) crowd.step(seconds, [], true);
    expect(loggedPairs(crowd), "no ambulance").not.toContain(`${EVENT_KIND.ambulance}:${dog}`);
  });

  // mutation: sed -i 's/    const toY = poses.feetY\[resident\]! + (poses.look\[resident\]! >>> LOOK.speciesShift === SPECIES.person ? CHEST_HEIGHT : ANIMAL_CHEST_HEIGHT) - ray.eyeY;/    const toY = poses.feetY[resident]! + CHEST_HEIGHT - ray.eyeY;/' src/game/ai/civilians/civilian-look.ts
  // mutation: sed -i 's/    const py = poses.feetY\[figure\]! + (poses.look\[figure\]! >>> LOOK.speciesShift === SPECIES.person ? CHEST_HEIGHT : ANIMAL_CHEST_HEIGHT) - ray.eyeY;/    const py = poses.feetY[figure]! + CHEST_HEIGHT - ray.eyeY;/' src/game/ai/civilians/civilian-look.ts
  it("when the eye looks level through its body from the street, then the look panel names it and a bullet's ray meets it; a ray 1.1 m above does neither", () => {
    const { crowd } = hostCrowd();
    const dog = shownResident(crowd, SPECIES.dog);
    const { x, z, yaw, feetY } = crowd.poses;
    const ray = (above: number): LookRay => {
      const out = new LookRay();
      out.eyeX = x[dog]! + Math.sin(yaw[dog]!) * EYE_BACK;
      out.eyeY = feetY[dog]! + DOG_BODY + above;
      out.eyeZ = z[dog]! + Math.cos(yaw[dog]!) * EYE_BACK;
      out.dirX = -Math.sin(yaw[dog]!);
      out.dirZ = -Math.cos(yaw[dog]!);
      out.dirY = 0;
      return out;
    };
    const name = residentNameText(crowd.state, dog);
    const met = (look: LookRay): number => chestMet(crowd.poses, crowd.poses.count, null, look, BULLET_RADIUS, EYE_BACK * 2, { index: -1, along: 0 }).index;
    expect(lookAtOf(crowd.state, crowd.poses, 0, ray(0))?.title ?? "", "the panel, level through its body").toContain(name);
    expect(met(ray(0)), "a bullet, level through its body").toBe(dog);
    expect(lookAtOf(crowd.state, crowd.poses, 0, ray(OVER_IT))?.title ?? "", "the panel, 1.1 m above it").not.toContain(name);
    expect(met(ray(OVER_IT)), "a bullet, 1.1 m above it").not.toBe(dog);
  });
});
