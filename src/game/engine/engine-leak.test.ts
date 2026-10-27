import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import "../kernel/rapier-node.test-util.ts";
import { setGround } from "../world/ground.ts";
import type { CrashEngine } from "./engine.ts";
import { bootEngine, runSeconds, stubBrowser } from "./engine-headless.test-util.ts";

/**
 * O4: `renderer.info.memory` and the dummies' Rapier world stay flat across resets and scene switches. A warm-up pass builds what the
 * engine keeps for life (range art, garage, showcase, minigame art, course tiles); every later pass must add nothing.
 */

/** A rolled seed would change the counts between passes: every pick of the run derives from this one. */
const SEED = 0x5eed;
/** Sim seconds from a reset to the sandbox's crash, with parts torn and drivers thrown. */
const CRASH_S = 0.8;
const CRASH_RESETS = 3;
const TOURS = 2;

type Counts = Record<string, number>;
interface Held {
  gpu: Counts;
  rapier: Counts;
}
type Tour = Record<string, Held>;
interface Stop {
  name: string;
  go: (engine: CrashEngine) => void;
}

/** Every scene and mode a player switches between, each entered from the one before, with the exits a pick, Exit and a course change take. */
const STOPS: readonly Stop[] = [
  { name: "sandbox reset", go: (e) => e.reset() },
  { name: "stack", go: (e) => e.toggleStack() },
  { name: "lab", go: (e) => e.toggleLab() },
  { name: "garage", go: (e) => e.toggleGarage() },
  { name: "showcase", go: (e) => e.toggleShowcase() },
  { name: "press", go: (e) => e.toggleCompactor() },
  { name: "pistons", go: (e) => e.togglePistons() },
  { name: "doors", go: (e) => e.toggleDoors() },
  { name: "corkscrew", go: (e) => e.toggleCorkscrew() },
  { name: "derby", go: (e) => e.toggleDerby() },
  { name: "derby exit", go: (e) => e.toggleDerby() },
  { name: "range", go: (e) => e.toggleRange() },
  { name: "high jump", go: (e) => e.startMinigame("highJump") },
  { name: "ring fling", go: (e) => e.startMinigame("ringFling") },
  { name: "minigame exit", go: (e) => e.exitMinigame() },
  {
    name: "race on the oval",
    go: (e) => {
      e.toggleRace();
      e.raceCommand({ type: "options", options: { trackId: "oval", aiCount: 2, laps: 1, police: true } });
      e.raceCommand({ type: "start" });
    },
  },
  {
    name: "race on the rally course",
    go: (e) => {
      e.raceCommand({ type: "quit" });
      e.raceCommand({ type: "options", options: { trackId: "rally", aiCount: 2, laps: 1, police: false } });
      e.raceCommand({ type: "start" });
    },
  },
  { name: "race exit", go: (e) => e.toggleRace() },
  {
    name: "survival",
    go: (e) => {
      e.toggleSurvival();
      e.raceCommand({ type: "start" });
    },
  },
  { name: "survival exit", go: (e) => e.toggleSurvival() },
];

/** Every count in `held` is `first`'s; a failure names where, the count and both values. */
function assertSame(held: Counts, first: Counts, where: string): void {
  for (const [count, value] of Object.entries(held)) assert.equal(value, first[count], `${where}: ${count} is ${value}, was ${first[count]}`);
}

describe("given the real engine drawing on the stub GL", () => {
  // One engine for the file: a second `CrashEngine` in the same process never resolves `ready`.
  let engine: CrashEngine;

  const gpu = (): Counts => {
    const { geometries, textures } = engine["renderer"].info.memory;
    return { geometries, textures };
  };

  /** Every stop in turn with a driver thrown at each: what the GPU and the Rapier world hold once it has settled. */
  const tour = (): Tour => {
    const world = engine["ragdolls"]["world"]!;
    const held: Tour = {};
    for (const { name, go } of STOPS) {
      go(engine);
      runSeconds(engine, 0.05);
      engine["ejection"].throwDriverNow(engine["live"](), 0);
      runSeconds(engine, 0.15);
      held[name] = { gpu: gpu(), rapier: { bodies: world.bodies.len(), colliders: world.colliders.len(), joints: world.impulseJoints.len() + world.multibodyJoints.len() } };
    }
    return held;
  };

  before(async () => {
    stubBrowser();
    engine = await bootEngine({ pacer: true, draw: true });
    await engine["ragdolls"].preload();
    engine["pinnedSeed"] = SEED;
  });
  after(() => {
    engine.dispose();
    setGround(null);
  });

  it(`when the sandbox crash is reset ${CRASH_RESETS} times after a warm-up crash, then the geometries and textures held are the same after each`, () => {
    const crash = (): Counts => {
      runSeconds(engine, CRASH_S);
      const held = gpu();
      engine.reset();
      return held;
    };
    engine.reset();
    crash();
    const held = Array.from({ length: CRASH_RESETS }, crash);
    for (const [k, counts] of held.slice(1).entries()) assertSame(counts, held[0]!, `reset ${k + 2}`);
  });

  describe(`when every scene and mode is toured ${TOURS} times after a warm-up tour`, () => {
    let tours: Tour[];
    before(() => {
      tour();
      tours = Array.from({ length: TOURS }, tour);
      assert.equal(engine["ragdolls"].placement, "inline", "the dummies' world runs on this thread, where its counts can be read");
    });

    /** Each stop of every tour after the first holds what it held in the first. */
    const assertFlat = (side: keyof Held): void => {
      for (const [k, later] of tours.slice(1).entries()) {
        for (const [stop, held] of Object.entries(later)) assertSame(held[side], tours[0]![stop]![side], `tour ${k + 2}, ${stop}`);
      }
    };

    it("then each stop holds the same geometries and textures in every tour", () => assertFlat("gpu"));

    it("then each stop holds the same Rapier bodies, colliders and joints in every tour", () => assertFlat("rapier"));
  });
});
