import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as THREE from "three";
import "../kernel/rapier-node.test-util.ts";
import { CAR_HIT, WALL_HIT, type HitSource } from "../present/hit-foot.ts";
import { Ground, setGround } from "../world/ground.ts";
import type { CrashEngine } from "./engine.ts";
import { bootEngine, stubBrowser } from "./engine-headless.test-util.ts";
import { FRAME_HZ } from "../kernel/constants.ts";

const FRAME = 1 / FRAME_HZ;
/** A raised deck as wide as the world, `DECK_HEIGHT` m up: a ramp's top. */
const DECK_HEIGHT = 3;
class Deck extends Ground {
  constructor() {
    super();
    this.addPlane(DECK_HEIGHT, -1e4, 1e4, -1e4, 1e4, Infinity);
  }
}

/** Open ground well away from the sandbox's barrier, lamp posts and balls. */
const SPOT = { x: 90, z: 90 };

describe("given the real engine's sandbox, a car against a wall on flat ground and on a deck 3 m up", () => {
  // One engine for the file: a second `CrashEngine` in the same process never resolves `ready`.
  let engine: CrashEngine;
  beforeAll(async () => {
    stubBrowser();
    engine = await bootEngine();
    engine.setFxTier("high");
  });
  afterAll(() => {
    engine.dispose();
    setGround(null);
  });

  /**
   * The crash cam's cuts that have an eye after the sandbox begins its cinematic on a wall hit at the car's height `y`, as the step hands it over.
   * The hitting car stands at the hit in both cases: the crash cam's sight counts the cars, so a car left 3 m over a flat-ground hit (where the row
   * before this one put it) hid nothing there and could hide an eye on the deck, whichever way the scene's seed had turned it.
   */
  const cutsWithAnEye = (y: number): number => {
    const crash = engine["cine"].crash;
    crash.reset();
    engine["world"].cars[0]!.group.position.set(SPOT.x, y, SPOT.z);
    engine["beginCinematic"](new THREE.Vector3(SPOT.x, y, SPOT.z), new THREE.Vector3(1, 0, 0), 12, true, WALL_HIT);
    crash["pick"].run(Infinity);
    return crash["camReach"].reduce((cuts, reach) => cuts + (reach > 0 ? 1 : 0), 0);
  };

  it("when a car meets a wall with its origin 3 m up, then the sandbox's hit carries that height as a wall hit, not the 0.4 m it once put every wall hit at", () => {
    engine.advance(FRAME, { frameDt: FRAME });
    const car = engine["world"].cars[0]!;
    car.group.position.set(SPOT.x, DECK_HEIGHT, SPOT.z);
    const strongest = engine["world"].strongest;
    strongest.clear();
    engine["offerWall"](0, 12, SPOT.x, SPOT.z, 1, 0);
    expect(strongest.wall, "a wall hit").toBe(true);
    expect(strongest.contact!.y, "the contact's height (m)").toBeCloseTo(DECK_HEIGHT, 6);
  });

  it("when the sandbox begins its cinematic on that wall hit on the deck, then the crash cam has an eye on as many cuts as for the same hit on flat ground", () => {
    setGround(null);
    const flat = cutsWithAnEye(0);
    setGround(new Deck());
    const deck = cutsWithAnEye(DECK_HEIGHT);
    setGround(null);
    expect(flat, "cuts with an eye on flat ground").toBeGreaterThan(0);
    expect(deck, "cuts with an eye on the deck").toBe(flat);
  });

  /** The height (m) a hit's debris starts at, read off the emitter after the sandbox begins its cinematic at height `y` with `source`: the debris leaves 0.08 m over where it is asked to start. */
  const debrisStart = (y: number, source: Readonly<HitSource>): { debris: number; sparksLow: number; sparksHigh: number } => {
    engine["debris"].reset();
    engine["sparks"].reset();
    engine["beginCinematic"](new THREE.Vector3(SPOT.x, y, SPOT.z), new THREE.Vector3(1, 0, 0), 12, false, source);
    const debris = engine["debris"].snapshot().items;
    const sparks = engine["sparks"].snapshot().items.map((spark) => spark.y);
    expect(debris.length, "debris pieces thrown").toBeGreaterThan(0);
    expect(sparks.length, "sparks thrown").toBeGreaterThan(0);
    return { debris: debris[0]!.y, sparksLow: Math.min(...sparks), sparksHigh: Math.max(...sparks) };
  };

  const effectCases = [
    { it: "when a car meets a wall with its origin on flat ground, then its debris and sparks start 0.4 m over the origin", y: 0, source: WALL_HIT, expectedStart: 0.4 },
    { it: "when a car meets a wall with its origin on the deck 3 m up, then its debris and sparks start 0.4 m over the origin", y: DECK_HEIGHT, source: WALL_HIT, expectedStart: DECK_HEIGHT + 0.4 },
    { it: "when two cars meet at a contact 0.5 m up, then their debris and sparks start at the contact", y: 0.5, source: CAR_HIT, expectedStart: 0.5 },
    { it: "when two cars meet at a contact on the deck 3.5 m up, then their debris and sparks start at the contact", y: DECK_HEIGHT + 0.5, source: CAR_HIT, expectedStart: DECK_HEIGHT + 0.5 },
  ];
  for (const testCase of effectCases) {
    it(testCase.it, () => {
      setGround(testCase.y >= DECK_HEIGHT ? new Deck() : null);
      const start = debrisStart(testCase.y, testCase.source);
      setGround(null);
      expect(start.debris, "the debris's start height (m)").toBeCloseTo(testCase.expectedStart + 0.08, 3);
      expect(start.sparksLow, "the lowest spark's start (m)").toBeGreaterThanOrEqual(testCase.expectedStart - 1e-6);
      expect(start.sparksHigh, "the highest spark's start (m)").toBeLessThanOrEqual(testCase.expectedStart + 0.12 + 1e-6);
    });
  }
});
