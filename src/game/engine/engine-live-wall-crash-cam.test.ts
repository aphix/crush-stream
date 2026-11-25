import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as THREE from "three";
import "../kernel/rapier-node.test-util.ts";
import { WALL_HIT } from "../present/engine-cine.ts";
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

  /** The crash cam's cuts that have an eye after the sandbox begins its cinematic on a wall hit at the car's height `y`, as the step hands it over. */
  const cutsWithAnEye = (y: number): number => {
    const crash = engine["cine"].crash;
    crash.reset();
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
});
