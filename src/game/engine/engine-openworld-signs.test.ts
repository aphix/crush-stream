import { describe, expect, it } from "vitest";
import { buildFixtureMap } from "../ai/civilians/civilian-graph.test-util.ts";
import { secondsOfGameMinutes } from "../ai/civilians/civilian-clock.ts";
import { POPULATION_TIER } from "../ai/civilians/civilian-crowd-constants.ts";
import { FRAME_HZ } from "../kernel/constants.ts";
import type { Place } from "../world/openworld/walk-graph.ts";
import { OpenWorldDirector } from "./engine-openworld.ts";
import { idleOpenWorldPorts } from "./openworld-cull-ports.test-util.ts";

const map = buildFixtureMap();
const FRAME = 1 / FRAME_HZ;
const EYE_X = 3;
/** A wreck closes a place for far longer than a test frame runs (ticks). */
const WRECKED_FOR_TICKS = 2 ** 30;
/** Frames enough for a game minute (a crowd second) to pass. */
const MINUTE_FRAMES = Math.ceil(secondsOfGameMinutes(1) * FRAME_HZ) + 2;

/** The director with signage ports that keep what they were asked: the places made from, each frame's eye and button state, and the signage disposed. */
class Harness {
  open = true;
  namesOn = false;
  made: (readonly Place[])[] = [];
  updates: { eyeX: number; namesOn: boolean; closed: Uint8Array | null; changed: boolean }[] = [];
  disposed = 0;
  readonly director = new OpenWorldDirector({
    ...idleOpenWorldPorts(),
    inOpenWorld: () => this.open,
    isClient: () => false,
    seed: () => 5,
    tier: () => POPULATION_TIER.phone,
    cars: () => [],
    now: () => 100,
    eye: (ray) => {
      ray.eyeX = EYE_X;
    },
    signsOn: () => this.namesOn,
    makeSigns: (places) => {
      this.made.push(places);
      return {
        update: (eyeX, _eyeZ, namesOn, _sight, closed, changed) => void this.updates.push({ eyeX, namesOn, closed, changed }),
        dispose: () => void this.disposed++,
      };
    },
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

  // mutation: sed -i 's/if (minute === this.closedMinute) return;/return;/' src/game/engine/engine-openworld.ts
  it("when a place is wrecked, then within a game minute the signage is handed it as shut, in a list of a byte for every place of the map, with the change flagged", () => {
    const harness = new Harness();
    harness.director.frame(FRAME);
    const state = harness.director["crowd"]!.state;
    state.closedUntilTick[0] = WRECKED_FOR_TICKS;
    const from = harness.updates.length;
    for (let frame = 0; frame < MINUTE_FRAMES; frame++) harness.director.frame(FRAME);
    const seen = harness.updates.slice(from);
    const closed = seen[seen.length - 1]!.closed!;
    expect(closed.length).toBe(state.index.placeCount);
    expect(closed[0]).toBe(1);
    expect(seen.some((update) => update.changed)).toBe(true);
    harness.director.stop();
  });

  // mutation: sed -i 's/if (sum !== this.closedSum) this.closedChanged = true;/this.closedChanged = true;/' src/game/engine/engine-openworld.ts
  it("when nothing changes after a refill, then every later frame is handed no change", () => {
    const harness = new Harness();
    for (let frame = 0; frame < 2 * MINUTE_FRAMES; frame++) harness.director.frame(FRAME);
    const refills = harness.updates.filter((update) => update.changed).length;
    expect(refills, "the first refill is the only change").toBeLessThanOrEqual(1);
    expect(harness.updates[harness.updates.length - 1]!.changed).toBe(false);
    harness.director.stop();
  });

  // mutation: sed -i 's/if (minute === this.closedMinute) return;/this.closedMinute = -1;/' src/game/engine/engine-openworld.ts
  it("when a place is wrecked mid-minute, then the list is not refilled until the game minute turns", () => {
    const harness = new Harness();
    harness.director.frame(FRAME);
    harness.director["crowd"]!.state.closedUntilTick[0] = WRECKED_FOR_TICKS;
    harness.director.frame(FRAME);
    expect(harness.updates[harness.updates.length - 1]!.closed![0]).toBe(0);
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
