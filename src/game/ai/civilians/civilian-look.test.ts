import { describe, expect, it } from "vitest";
import { tickAt } from "./civilian-clock.ts";
import { RESIDENT_INT } from "./civilian-constants.ts";
import { CHEST_HEIGHT, LOOK_REACH } from "./civilian-crowd-constants.ts";
import type { CivilianCrowd } from "./civilian-crowd.ts";
import { buildFixtureMap } from "./civilian-graph.test-util.ts";
import { lookAtOf, LookRay } from "./civilian-look.ts";
import { historyLines, residentNameText } from "./civilian-mood.ts";
import { newCrowd, shownResident, stepUntilShown } from "./civilian-crowd.test-util.ts";

const map = buildFixtureMap();
const EYE_HEIGHT = 1.5;
/** Metres the eye stands back from what it looks at. */
const STAND_BACK = 8;
/** A unit vector from the eye towards the point (x, y, z). */
function aimedAt(ray: LookRay, x: number, y: number, z: number): LookRay {
  const length = Math.hypot(x - ray.eyeX, y - ray.eyeY, z - ray.eyeZ);
  ray.dirX = (x - ray.eyeX) / length;
  ray.dirY = (y - ray.eyeY) / length;
  ray.dirZ = (z - ray.eyeZ) / length;
  return ray;
}

function eyeAt(x: number, z: number): LookRay {
  const ray = new LookRay();
  ray.eyeX = x;
  ray.eyeY = EYE_HEIGHT;
  ray.eyeZ = z;
  return ray;
}

/** The eye `STAND_BACK` m behind civilian `resident`, along the way they walk, looking at their chest. */
function behind(crowd: CivilianCrowd, resident: number): LookRay {
  const { x, z, yaw } = crowd.poses;
  const ray = eyeAt(x[resident]! - Math.sin(yaw[resident]!) * STAND_BACK, z[resident]! - Math.cos(yaw[resident]!) * STAND_BACK);
  return aimedAt(ray, x[resident]!, CHEST_HEIGHT, z[resident]!);
}

function crowdWithWalker(): { crowd: CivilianCrowd; resident: number; tick: number } {
  const crowd = newCrowd(map);
  const seconds = stepUntilShown(crowd);
  return { crowd, resident: shownResident(crowd), tick: tickAt(seconds) };
}

describe("given a crowd with a civilian walking on the street", () => {
  const { crowd, resident, tick } = crowdWithWalker();

  it("when the eye looks at them, then the panel is titled with their name and lists their life log", () => {
    const text = lookAtOf(crowd.state, crowd.poses, tick, behind(crowd, resident));
    expect(text?.title.startsWith(residentNameText(crowd.state, resident)), `title ${text?.title}`).toBe(true);
    expect(text?.lines, "life log").toEqual(historyLines(crowd.state, resident));
  });

  it("when the eye looks past them, or at the sky, then the panel is empty", () => {
    const ray = behind(crowd, resident);
    ray.dirX = -ray.dirX;
    ray.dirZ = -ray.dirZ;
    expect(lookAtOf(crowd.state, crowd.poses, tick, ray), "looking away").toBeNull();
    expect(lookAtOf(crowd.state, crowd.poses, tick, aimedAt(eyeAt(crowd.poses.x[resident]!, crowd.poses.z[resident]!), crowd.poses.x[resident]!, 100, crowd.poses.z[resident]!)), "looking up").toBeNull();
  });

  it("when they are beyond the look reach, then the panel does not name them", () => {
    const ray = behind(crowd, resident);
    const far = eyeAt(ray.eyeX - ray.dirX * LOOK_REACH, ray.eyeZ - ray.dirZ * LOOK_REACH);
    const text = lookAtOf(crowd.state, crowd.poses, tick, aimedAt(far, crowd.poses.x[resident]!, CHEST_HEIGHT, crowd.poses.z[resident]!));
    expect(text?.title.startsWith(residentNameText(crowd.state, resident)) ?? false, "named").toBe(false);
  });
});

describe("given a crowd and the eye aimed at the door of a home", () => {
  it("when the ray meets the building, then the panel is its name and says who lives there", () => {
    const crowd = newCrowd(map);
    const home = crowd.state.ints[RESIDENT_INT.home]!;
    const house = map.places[home]!;
    const eye = eyeAt(house.x - house.depth / 2 - 3, house.z);
    const text = lookAtOf(crowd.state, crowd.poses, 0, aimedAt(eye, house.x, EYE_HEIGHT, house.z));
    expect(text?.title, "title").toBe(house.name);
    expect(text?.lines.some((line) => line.startsWith("lives here:") && line.includes(residentNameText(crowd.state, 0))), `lines ${text?.lines}`).toBe(true);
  });

  it("when the ray runs over the roof, or the eye is behind the ray, then the panel is empty", () => {
    const crowd = newCrowd(map);
    const house = map.places[crowd.state.ints[RESIDENT_INT.home]!]!;
    const eye = eyeAt(house.x - house.depth / 2 - 3, house.z);
    expect(lookAtOf(crowd.state, crowd.poses, 0, aimedAt(eye, house.x, 200, house.z)), "over the roof").toBeNull();
    const away = aimedAt(eyeAt(house.x - house.depth / 2 - 3, house.z), house.x - 50, EYE_HEIGHT, house.z);
    expect(lookAtOf(crowd.state, crowd.poses, 0, away), "looking away").toBeNull();
  });
});
