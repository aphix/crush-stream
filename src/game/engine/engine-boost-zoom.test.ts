import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import "../kernel/rapier-node.test-util.ts";
import { FRAME_HZ } from "../kernel/constants.ts";
import { DRIVE } from "../vehicle/car-drive.ts";
import { setGround } from "../world/ground.ts";
import type { CrashEngine } from "./engine.ts";
import { bootEngine, stubBrowser } from "./engine-headless.test-util.ts";

const FRAME = 1 / FRAME_HZ;
/** At the zoom's full speed (`BOOST_ZOOM_FULL_SPEED` is below it), so the speed share is 1 and only the ease shows. */
const CRUISE = DRIVE.maxFwd;

type Play = { boosting: boolean; driving: boolean; toggle: boolean; speed: number; followed: boolean };
const BOOSTING: Play = { boosting: true, driving: true, toggle: true, speed: CRUISE, followed: true };
const COASTING: Play = { ...BOOSTING, boosting: false };

describe("given the real engine's director and the driven car cruising at the zoom's full speed", () => {
  let engine: CrashEngine;
  before(async () => {
    stubBrowser();
    engine = await bootEngine();
    engine.setFxTier("low");
  });
  after(() => {
    engine.dispose();
    setGround(null);
  });

  /** The zoom's strength after `seconds` of the director's update frames under `play`. */
  const strengthAfter = (seconds: number, play: Play): number => {
    const car = engine["live"]()[0]!;
    car.drive.boostK = play.boosting ? 1 : 0;
    car.speed = play.speed;
    for (let f = 0; f < Math.round(seconds * FRAME_HZ); f++) engine["cine"].update(FRAME, 0, [], play.followed ? car : null, play.driving, 1, false, play.toggle);
    return engine["cine"].post.radial;
  };

  it("when the player's own car boosts for 0.125 s, then the strength is half of full, and from 0.25 s on it is full", () => {
    strengthAfter(2, COASTING);
    assert.ok(Math.abs(strengthAfter(0.125, BOOSTING) - 0.5) < 0.05, "half way up");
    assert.equal(strengthAfter(0.125, BOOSTING), 1, "full at 0.25 s");
    assert.equal(strengthAfter(1, BOOSTING), 1, "holds");
  });

  it("when the boost ends, then the strength is half after 0.2 s and 0 after 0.4 s", () => {
    strengthAfter(1, BOOSTING);
    assert.ok(Math.abs(strengthAfter(0.2, COASTING) - 0.5) < 0.05, "half way down");
    assert.equal(strengthAfter(0.2, COASTING), 0, "gone at 0.4 s");
  });

  const OFF_CASES = [
    { it: "when the Boost zoom setting is off, then a boost draws no zoom", play: { ...BOOSTING, toggle: false } },
    { it: "when the camera follows nobody (a spectator's), then a boost draws no zoom", play: { ...BOOSTING, followed: false } },
    { it: "when the seat does not drive (it follows a car or watches), then a boost draws no zoom", play: { ...BOOSTING, driving: false } },
    { it: "when the car stands at the line, then a boost draws no zoom", play: { ...BOOSTING, speed: 0 } },
    { it: "when the car is not boosting, then there is no zoom", play: COASTING },
  ] as const;
  for (const testCase of OFF_CASES) {
    it(testCase.it, () => {
      strengthAfter(2, COASTING);
      assert.equal(strengthAfter(1, testCase.play), 0, "strength");
    });
  }
});
