import { describe, expect, it } from "vitest";
import { buildFixtureMap } from "../ai/civilians/civilian-graph.test-util.ts";
import { POPULATION_TIER } from "../ai/civilians/civilian-crowd-constants.ts";
import { FRAME_HZ } from "../kernel/constants.ts";
import type { Place } from "../world/openworld/walk-graph.ts";
import { OpenWorldDirector } from "./engine-openworld.ts";
import { idleCullPorts } from "./openworld-cull-ports.test-util.ts";

const map = buildFixtureMap();
const FRAME = 1 / FRAME_HZ;
const EYE_X = 3;

/** The director with signage ports that keep what they were asked: the places made from, each frame's eye and button state, and the signage disposed. */
class Harness {
  open = true;
  namesOn = false;
  made: (readonly Place[])[] = [];
  updates: { eyeX: number; namesOn: boolean }[] = [];
  disposed = 0;
  readonly director = new OpenWorldDirector({
    inOpenWorld: () => this.open,
    isClient: () => false,
    seed: () => 5,
    tier: () => POPULATION_TIER.phone,
    cars: () => [],
    foot: () => false,
    now: () => 100,
    eye: (ray) => {
      ray.eyeX = EYE_X;
    },
    throwFigure: () => {},
    hookWallHits: () => () => {},
    makeArt: () => ({ update: () => {}, dispose: () => {} }),
    signsOn: () => this.namesOn,
    makeSigns: (places) => {
      this.made.push(places);
      return {
        update: (eyeX, _eyeZ, namesOn) => void this.updates.push({ eyeX, namesOn }),
        dispose: () => void this.disposed++,
      };
    },
    cull: idleCullPorts(),
  });

  constructor() {
    this.director.startOpenWorld(map);
  }
}

describe("given the open world director in the open world", () => {
  it("when frames run, then the signage is made once from the map's places and each frame it gets the eye and whether the Track debug button is on", () => {
    const harness = new Harness();
    harness.director.frame(FRAME);
    harness.director.frame(FRAME);
    harness.namesOn = true;
    harness.director.frame(FRAME);
    expect(harness.made.length).toBe(1);
    expect(harness.made[0]).toBe(map.places);
    expect(harness.updates.map((update) => `${update.eyeX}:${update.namesOn}`).join(" ")).toBe(`${EYE_X}:false ${EYE_X}:false ${EYE_X}:true`);
    harness.director.stop();
  });

  it("when the course is left, then the signage is disposed, and it is made again on re-entering", () => {
    const harness = new Harness();
    harness.director.frame(FRAME);
    harness.open = false;
    harness.director.frame(FRAME);
    expect(harness.disposed).toBe(1);
    harness.open = true;
    harness.director.frame(FRAME);
    expect(harness.made.length).toBe(2);
    harness.director.stop();
    expect(harness.disposed).toBe(2);
  });
});
