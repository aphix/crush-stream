import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import "../kernel/rapier-node.test-util.ts";
import { FRAME_HZ } from "../kernel/constants.ts";
import { DRIVE } from "../vehicle/car-drive.ts";
import { setGround } from "../world/ground.ts";
import type { CrashEngine } from "./engine.ts";
import { bootEngine, stubBrowser } from "./engine-headless.test-util.ts";

const FRAME = 1 / FRAME_HZ;
/** Above the zoom's full speed (`BOOST_ZOOM_FULL_SPEED`), so the speed share is 1 and only the ease shows. */
const CRUISE = DRIVE.maxFwd;

/** `watch`: which live car the camera follows (null: nobody); `boosting`: which cars have their boost thrust on. */
type Play = { watch: number | null; driving: boolean; toggle: boolean; speed: number; boosting: readonly number[] };
const DRIVING_CAR_BOOSTING: Play = { watch: 0, driving: true, toggle: true, speed: CRUISE, boosting: [0] };
const WATCHING_CAR_BOOSTING: Play = { ...DRIVING_CAR_BOOSTING, driving: false };
const COASTING: Play = { ...DRIVING_CAR_BOOSTING, boosting: [] };

describe("given the real engine and two live cars cruising at the zoom's full speed", () => {
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

  const setCars = (play: Play): void => {
    for (const [index, car] of engine["live"]().entries()) {
      car.drive.boostK = play.boosting.includes(index) ? 1 : 0;
      car.speed = play.speed;
    }
  };

  /** The zoom's strength after `seconds` of the director's update frames under `play`, as the engine's frame feeds it (`watchedCar`) or, for the seat's views, directly. */
  const strengthAfter = (seconds: number, play: Play): number => {
    setCars(play);
    const followed = play.watch === null ? null : engine["live"]()[play.watch]!;
    for (let f = 0; f < Math.round(seconds * FRAME_HZ); f++) engine["cine"].update(FRAME, 0, [], followed, play.driving, 1, false, play.toggle ? followed : null);
    return engine["cine"].post.radial;
  };

  describe("and the camera on the seat's car", () => {
    it("when the player's own car boosts for 0.125 s, then the strength is half of full, and from 0.25 s on it is full", () => {
      strengthAfter(2, COASTING);
      assert.ok(Math.abs(strengthAfter(0.125, DRIVING_CAR_BOOSTING) - 0.5) < 0.05, "half way up");
      assert.equal(strengthAfter(0.125, DRIVING_CAR_BOOSTING), 1, "full at 0.25 s");
      assert.equal(strengthAfter(1, DRIVING_CAR_BOOSTING), 1, "holds");
    });

    it("when the boost ends, then the strength is half after 0.2 s and 0 after 0.4 s", () => {
      strengthAfter(1, DRIVING_CAR_BOOSTING);
      assert.ok(Math.abs(strengthAfter(0.2, COASTING) - 0.5) < 0.05, "half way down");
      assert.equal(strengthAfter(0.2, COASTING), 0, "gone at 0.4 s");
    });

    it("when the camera watches an AI car that boosts (the seat does not drive), then the zoom eases up exactly as for the driven car", () => {
      strengthAfter(2, COASTING);
      assert.ok(Math.abs(strengthAfter(0.125, WATCHING_CAR_BOOSTING) - 0.5) < 0.05, "half way up");
      assert.equal(strengthAfter(0.125, WATCHING_CAR_BOOSTING), 1, "full at 0.25 s");
    });

    it("when the camera watches a car that is not boosting while another car boosts, then there is no zoom", () => {
      strengthAfter(2, COASTING);
      assert.equal(strengthAfter(1, { ...WATCHING_CAR_BOOSTING, watch: 1 }), 0, "the other car's boost is not the watched one's");
    });

    it("when the camera switches from the boosting car to a coasting one, then the zoom eases down over 0.4 s and does not snap", () => {
      strengthAfter(1, WATCHING_CAR_BOOSTING);
      const switched = { ...WATCHING_CAR_BOOSTING, watch: 1 };
      const first = strengthAfter(FRAME, switched);
      assert.ok(first > 0.9 && first < 1, `one frame after the switch the strength is ${first}`);
      assert.ok(Math.abs(strengthAfter(0.2 - FRAME, switched) - 0.5) < 0.05, "half way down");
      assert.equal(strengthAfter(0.2, switched), 0, "gone at 0.4 s");
    });

    it("when the camera switches from a coasting car to a boosting one, then the zoom eases up and does not snap", () => {
      strengthAfter(1, { ...WATCHING_CAR_BOOSTING, watch: 1 });
      const first = strengthAfter(FRAME, WATCHING_CAR_BOOSTING);
      assert.ok(first > 0 && first < 0.1, `one frame after the switch the strength is ${first}`);
      assert.equal(strengthAfter(0.25, WATCHING_CAR_BOOSTING), 1, "full by 0.25 s");
    });

    it("when the watched car's speed jumps from standing to full, then the strength follows over a fraction of a second, not in one frame", () => {
      strengthAfter(1, { ...WATCHING_CAR_BOOSTING, speed: 0 });
      const first = strengthAfter(FRAME, WATCHING_CAR_BOOSTING);
      assert.ok(first > 0.2 && first < 0.5, `one frame after the speed jump the strength is ${first}`);
      assert.equal(strengthAfter(1, WATCHING_CAR_BOOSTING), 1, "full once settled");
    });

    const OFF_CASES = [
      { it: "when the Boost zoom setting is off, then a boost draws no zoom", play: { ...DRIVING_CAR_BOOSTING, toggle: false } },
      { it: "when the setting is off and the camera watches a boosting car, then it draws no zoom either", play: { ...WATCHING_CAR_BOOSTING, toggle: false } },
      { it: "when the camera follows nobody (free fly or the whole field), then a boost draws no zoom", play: { ...DRIVING_CAR_BOOSTING, watch: null } },
      { it: "when the car stands at the line, then a boost draws no zoom", play: { ...DRIVING_CAR_BOOSTING, speed: 0 } },
      { it: "when the car is not boosting, then there is no zoom", play: COASTING },
    ] as const;
    for (const testCase of OFF_CASES) {
      it(testCase.it, () => {
        strengthAfter(2, COASTING);
        assert.equal(strengthAfter(1, testCase.play), 0, "strength");
      });
    }
  });

  describe("and a reel clip playing, its focus car the second live car and the seat following the first", () => {
    /** The engine's own frames with the reel stubbed as playing `focus` (the replay car): `frame` answers a step, `focus` the car, `aim` leaves the camera; the cars stay as `setCars` left them (the reel runs no live sim). */
    const reelStrengthAfter = (seconds: number, focus: number | null, play: Play): number => {
      const reel = engine["highlights"];
      const cars = engine["live"]();
      const { frame, focus: realFocus, aim } = reel;
      reel.frame = () => ((reel.playing = true), FRAME);
      reel.focus = () => (focus === null ? null : cars[focus]!);
      reel.aim = () => {};
      try {
        setCars(play);
        Object.assign(engine["seat"], { mode: "follow", carIndex: 0 });
        for (let f = 0; f < Math.round(seconds * FRAME_HZ); f++) engine.advance(FRAME, { frameDt: FRAME });
      } finally {
        reel.frame = frame;
        reel.focus = realFocus;
        reel.aim = aim;
        reel.playing = false;
        engine["seat"].clear();
      }
      return engine["cine"].post.radial;
    };
    it("when the clip's focus car boosts, then the zoom eases up for it, though the seat's car does not", () => {
      reelStrengthAfter(2, 1, { ...WATCHING_CAR_BOOSTING, boosting: [] });
      assert.ok(Math.abs(reelStrengthAfter(0.125, 1, { ...WATCHING_CAR_BOOSTING, boosting: [1] }) - 0.5) < 0.05, "half way up");
      assert.equal(reelStrengthAfter(0.125, 1, { ...WATCHING_CAR_BOOSTING, boosting: [1] }), 1, "full at 0.25 s");
    });

    it("when the clip's focus car does not boost while the seat's car does, then there is no zoom", () => {
      reelStrengthAfter(2, 1, { ...WATCHING_CAR_BOOSTING, boosting: [] });
      assert.equal(reelStrengthAfter(1, 1, { ...WATCHING_CAR_BOOSTING, boosting: [0] }), 0, "the seat's car is not what the reel shows");
    });

    it("when the reel flies between clips (no focus car), then a zoom in progress eases down over 0.4 s", () => {
      reelStrengthAfter(1, 1, { ...WATCHING_CAR_BOOSTING, boosting: [1] });
      assert.ok(Math.abs(reelStrengthAfter(0.2, null, { ...WATCHING_CAR_BOOSTING, boosting: [1] }) - 0.5) < 0.05, "half way down");
      assert.equal(reelStrengthAfter(0.2, null, { ...WATCHING_CAR_BOOSTING, boosting: [1] }), 0, "gone at 0.4 s");
    });
  });
});
