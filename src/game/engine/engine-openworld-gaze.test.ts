import { describe, expect, it } from "vitest";
import { FRAME_HZ } from "../kernel/constants.ts";
import { buildFixtureMap } from "../ai/civilians/civilian-graph.test-util.ts";
import { LookRay } from "../ai/civilians/civilian-look.ts";
import { createCrowdPoses } from "../ai/civilians/crowd-poses.ts";
import { STIMULUS } from "../present/civilian-gaze-constants.ts";
import { OpenWorldGaze } from "./engine-openworld-gaze.ts";

const CAPACITY = 4;
/** A street of the fixture map runs along z at this x: nothing stands between two points on it. */
const STREET_X = -68;

function gazeOn() {
  const poses = createCrowdPoses(CAPACITY);
  const map = buildFixtureMap();
  const gaze = new OpenWorldGaze(CAPACITY, map, { cars: () => [], foot: () => false, lineOfSight: null });
  return { poses, map, gaze };
}

/** The crash rows in the gaze's stimulus table. */
function crashes(gaze: OpenWorldGaze): number {
  const stimuli = gaze.gaze.stimuli;
  let found = 0;
  for (let at = 0; at < stimuli.count; at++) if (stimuli.kind[at] === STIMULUS.crash) found++;
  return found;
}

describe("given the open world's gaze and a car that meets a wall", () => {
  // mutation: sed -i 's/^const CRASH_LOOK_SPEED = 6;/const CRASH_LOOK_SPEED = 0;/' src/game/engine/engine-openworld-gaze.ts
  it("when it closes at 5 m/s, then nobody is called to look; at 7 m/s a crash pulses there; a second hit at once pulses nothing, one after half a second does", () => {
    const { poses, gaze } = gazeOn();
    gaze.noteWallHit(5, STREET_X, 0);
    expect(crashes(gaze), "5 m/s").toBe(0);
    gaze.noteWallHit(7, STREET_X, 0);
    expect(crashes(gaze), "7 m/s").toBe(1);
    gaze.noteWallHit(10, STREET_X, 0);
    expect(crashes(gaze), "again at once").toBe(1);
    gaze.frame(poses, STREET_X, 0, 0.6, null);
    gaze.noteWallHit(10, STREET_X, 0);
    expect(crashes(gaze), "again after 0.6 s").toBe(2);
  });
});

describe("given a civilian standing 6 m up a street from the look panel's eye", () => {
  // mutation: sed -i 's/    return { title: text.title, lines: \[...text.lines, this.gaze.describe(resident.index)\] };/    return text;/' src/game/engine/engine-openworld-gaze.ts
  it("when the panel's ray meets her, then her panel ends with what she looks at; with nobody on the ray the panel is as it was", () => {
    const { poses, map, gaze } = gazeOn();
    poses.x[0] = STREET_X;
    poses.z[0] = 6;
    poses.feetY[0] = 0;
    poses.yaw[0] = Math.PI;
    poses.shown[0] = 1;
    gaze.frame(poses, STREET_X, 0, 1 / FRAME_HZ, null);
    const ray = new LookRay();
    ray.eyeX = STREET_X;
    ray.eyeY = 1.3;
    const text = { title: "Ann", lines: ["Walking"] };
    const met = gaze.describe(text, poses, map, ray);
    expect(met?.lines.length, "lines on her panel").toBe(2);
    expect(met?.lines[0], "her own line kept").toBe("Walking");
    expect(met?.lines[1], "what she looks at").toBe(gaze.gaze.describe(0));
    expect(met?.lines[1], "said as a look").toMatch(/^Looking at /);
    ray.dirX = 1;
    ray.dirZ = 0;
    expect(gaze.describe(text, poses, map, ray), "the ray turned off her").toBe(text);
  });
});
