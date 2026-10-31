import { afterAll, beforeAll, describe, expect, it } from "vitest";
import "../kernel/rapier-node.test-util.ts";
import { FRAME_HZ } from "../kernel/constants.ts";
import { HudStore } from "../hud/hud-store.ts";
import { decodeShare } from "../hud/share-url.ts";
import { worstHoldOverRest } from "../vehicle/skin-stretch.test-util.ts";
import { setGround } from "../world/ground.ts";
import type { CrashEngine } from "./engine.ts";
import { bootEngine, stubBrowser } from "./engine-headless.test-util.ts";

/**
 * The owner's piston capture (2026-10-30): one front piston shot into the parked sedan at a tenth of real time, where the crushed bay
 * floor and its walls stood up through the drawn hood for a third of a second (sim 0.44-0.47 s, 241 mm past where they may stand).
 */
const FRAME = 1 / FRAME_HZ;
const LINK = "#scene=pistons&seed=79a4b8&ts=0.1&slomo=0&squash=0.32&buckle=0.45&real=0.25&deform=shape&car=sedan&loop=0";
/** The front piston (`PISTON_IDS` index) and the drawn frame it fires on: its head meets the nose at sim 0.38 s, as in the capture. */
const FRONT_PISTON = 1;
const FIRE_FRAME = 186;
/** The sim window (s) the hit crushes and settles the nose in. */
const FROM_S = 0.38;
const TO_S = 0.6;
/** How far (m) past what the hold may ask a drawn point may stand: car-tyre-skin.test.ts's envelope slack. */
const OVER_SLACK_M = 0.005;
/** A car skinned on one frame of this many (the LoD's small-on-screen stride): the hold sees the crush at a third of the steps. */
const SPARSE_STRIDE = 3;
/** The crush the shot leaves (measured 0.371): the fixture's hit landed. */
const CRUSHED = 0.3;
/** The capture's time scale, and the sim time (s) its head met the nose at, within this much. */
const TIME_SCALE = 0.1;
const HIT_S = 0.39;
const HIT_SLACK_S = 0.03;

describe("given the owner's front piston shot into the parked sedan at a tenth of real time", () => {
  let engine: CrashEngine;

  /** Runs the shot from a fresh park to `TO_S`, skinned on one frame of `stride`; the worst a drawn body point stands past what the hold may ask, over `FROM_S`..`TO_S`. */
  function shoot(stride: number): { over: number; at: string; crush: number; hitAt: number } {
    engine["applyShare"](decodeShare(LINK), false);
    engine.reset();
    engine.setTimeScale(TIME_SCALE);
    if (stride > 1) Object.assign(engine, { followedCar: () => null, skinStride: () => stride });
    const car = engine["live"]()[0]!;
    let worst = { over: 0, at: "" };
    let hitAt = NaN;
    for (let frame = 0; engine["elapsedSim"] < TO_S; frame++) {
      if (frame === FIRE_FRAME) engine.firePiston(FRONT_PISTON);
      engine.advance(FRAME, { frameDt: FRAME });
      if (Number.isNaN(hitAt) && car.crashed) hitAt = engine["elapsedSim"];
      if (engine["elapsedSim"] < FROM_S) continue;
      const held = worstHoldOverRest(car);
      if (held.over > worst.over) worst = { over: held.over, at: `${held.at} at sim ${engine["elapsedSim"].toFixed(3)} s` };
    }
    return { ...worst, crush: car.deform.crushAmount, hitAt };
  }

  beforeAll(async () => {
    stubBrowser();
    engine = await bootEngine({ hud: new HudStore(), pacer: true });
  });
  afterAll(() => {
    engine.dispose();
    setGround(null);
  });

  for (const stride of [1, SPARSE_STRIDE]) {
    it(`when its skin is drawn on one frame of ${stride} through the hit, then no drawn body point stands past its rest or the tyres' top and gap`, () => {
      const shot = shoot(stride);
      expect(shot.crush, "fixture: the shot crushed the nose").toBeGreaterThan(CRUSHED);
      expect(Math.abs(shot.hitAt - HIT_S), `fixture: the head met the nose at sim ${shot.hitAt.toFixed(3)} s`).toBeLessThan(HIT_SLACK_S);
      expect(shot.over, `${(shot.over * 1000).toFixed(1)} mm over: ${shot.at}`).toBeLessThanOrEqual(OVER_SLACK_M);
    });
  }
});
