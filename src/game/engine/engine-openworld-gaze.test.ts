import { describe, expect, it } from "vitest";
import { FRAME_HZ } from "../kernel/constants.ts";
import { buildFixtureMap } from "../ai/civilians/civilian-graph.test-util.ts";
import { LookRay } from "../ai/civilians/civilian-look.ts";
import { createCrowdPoses } from "../ai/civilians/crowd-poses.ts";
import type { CrowdGaze } from "../present/civilian-gaze.ts";
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
    expect(met?.lines[1], "said as a look").toMatch(/^Looking /);
    ray.dirX = 1;
    ray.dirZ = 0;
    expect(gaze.describe(text, poses, map, ray), "the ray turned off her").toBe(text);
  });
});

describe("given two civilians by the look panel's ray: one 4 m up it and 0.6 m to its side, one 8 m up it on its line", () => {
  it("when the panel is about the one on its line (its title is hers, the ray passing closest to her chest), then its look line is hers, not the nearer one's", () => {
    const { poses, map, gaze } = gazeOn();
    for (const [civilian, x, z] of [[0, STREET_X + 0.6, 4], [1, STREET_X, 8]] as const) {
      poses.x[civilian] = x;
      poses.z[civilian] = z;
      poses.feetY[civilian] = 0;
      poses.shown[civilian] = 1;
    }
    poses.partner[1] = 0;
    gaze.frame(poses, STREET_X, 0, 1 / FRAME_HZ, null);
    const ray = new LookRay();
    ray.eyeX = STREET_X;
    ray.eyeY = 1.3;
    expect(gaze.gaze.describe(1), "control: their looks read apart").not.toBe(gaze.gaze.describe(0));
    const met = gaze.describe({ title: "Bea", lines: [] }, poses, map, ray);
    expect(met?.lines[0], "the look line").toBe(gaze.gaze.describe(1));
  });
});

describe("given the foot cops drawn by an art of their own beside the crowd's", () => {
  const COPS = 8;
  /** The crowd's gaze with the player on foot at (STREET_X, 0), and the cops' art following it; the cops stand on the street from z = `from` every 0.5 m, facing -z toward him. */
  function copsOn(from: number) {
    const crowd = createCrowdPoses(CAPACITY);
    const map = buildFixtureMap();
    const foot = (out: { x: number; z: number }): boolean => {
      out.x = STREET_X;
      out.z = 0;
      return true;
    };
    const gaze = new OpenWorldGaze(CAPACITY, map, { cars: () => [], foot, lineOfSight: null });
    const art: { gaze?: CrowdGaze | null; update(): void; dispose(): void } = { gaze: null, update: () => {}, dispose: () => {} };
    const drawn = gaze.follow(art, COPS);
    const cops = createCrowdPoses(COPS);
    for (let cop = 0; cop < COPS; cop++) {
      cops.x[cop] = STREET_X;
      cops.z[cop] = from + 0.5 * cop;
      cops.yaw[cop] = Math.PI;
      cops.shown[cop] = 1;
    }
    /** `seconds` of frames: the crowd's gaze, then the cops' art. */
    const run = (seconds: number): void => {
      for (let frame = 0; frame < Math.round(seconds * FRAME_HZ); frame++) {
        gaze.frame(crowd, STREET_X, 0, 1 / FRAME_HZ, null);
        drawn.update(cops, STREET_X, 0, { seen: () => true }, 1 / FRAME_HZ);
      }
    };
    return { gaze, art, cops, run };
  }

  it("when the player stands on foot 2 m in front of the nearest of them, then within a second that cop's art turns his head to the player", () => {
    const { art, run } = copsOn(2);
    run(1);
    expect(art.gaze?.lookKind[0], "what the nearest cop looks at").toBe(STIMULUS.player);
  });

  it("when a car crashes 10 m to their side, then some of the cops turn to the crash", () => {
    const { gaze, art, run } = copsOn(30);
    run(0.5);
    gaze.noteWallHit(15, STREET_X + 10, 31);
    let turned = 0;
    for (let frame = 0; frame < 3 * FRAME_HZ; frame++) {
      run(1 / FRAME_HZ);
      for (let cop = 0; cop < COPS; cop++) if (art.gaze?.lookKind[cop] === STIMULUS.crash) turned |= 1 << cop;
    }
    expect(turned, "cops who looked at the crash (a bit each)").toBeGreaterThan(0);
  });
});
