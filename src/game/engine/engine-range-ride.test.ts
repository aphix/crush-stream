import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";
import * as THREE from "three";
import "../kernel/rapier-node.test-util.ts";
import { FRAME_HZ } from "../kernel/constants.ts";
import { setGround } from "../world/ground.ts";
import type { CrashEngine } from "./engine.ts";
import { bootEngine, stubBrowser } from "./engine-headless.test-util.ts";

/**
 * The Range's thrown driver in the real engine, watched by the ride-along through the slow-mo: where his head sits in the
 * frame, frame by frame (the owner: the camera "flickers" in portrait, a few seconds into the slow-mo).
 */

const FRAME = 1 / FRAME_HZ;
/** Wall seconds of the throw's ride the rows watch: the windshield, the change to the follow shot, and the crash cam's three cuts (1.3, 2.9 and 4.5 s after the hit) and hand-back (6.1 s). */
const WATCHED_S = 7;
const HEAD_STEP_BAR = 0.05;
/** The most (degrees) the lens may change between two frames: the ride owns it, the crash cam's cut lenses (50 to 46, then to 21 degrees) are not set over it. */
const LENS_STEP_BAR = 0.5;
const _ndc = new THREE.Vector3();
const _was = new THREE.Vector3();

const screens = [
  { it: "a phone held upright, 720 x 1280", width: 720, height: 1280 },
  { it: "a phone on its side, 1280 x 720", width: 1280, height: 720 },
] as const;

describe("given the real engine in the Range, its thrown driver ridden through the slow-mo", () => {
  let engine: CrashEngine;
  before(async () => {
    setGround(null);
    stubBrowser();
    engine = await bootEngine({ pacer: true });
    for (let wait = 0; wait < 200 && engine["ragdolls"]["world"] === null; wait++) await delay(50);
  });
  after(() => {
    engine.dispose();
    setGround(null);
  });

  /** Where the drawn head (the ride's own framing centre) projects on the camera's screen, NDC, into `out`. */
  function headOnScreen(out: THREE.Vector3): THREE.Vector3 {
    const camera = engine["camera"];
    camera.updateMatrixWorld();
    const top = camera.near * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    camera.projectionMatrix.makePerspective(-top * camera.aspect, top * camera.aspect, top, -top, camera.near, camera.far);
    camera.matrixWorldInverse.copy(camera.matrixWorld).invert();
    return out.copy(engine["ragdolls"]["ride"].cam.framing.c).project(camera);
  }

  for (const screen of screens) {
    it(`when ${screen.it} watches the driver thrown over the barrier, then for ${WATCHED_S} s of the ride his head never leaves the frame, never moves more than ${HEAD_STEP_BAR} of it and the lens never changes more than ${LENS_STEP_BAR} degrees between two frames`, () => {
      engine["setScene"]("fleet");
      engine["setScene"]("range");
      const camera = engine["camera"];
      const ragdolls = engine["ragdolls"];
      let framed = 0;
      let worstStep = 0;
      let worstAt = 0;
      let leftFrame = 0;
      let worstLens = 0;
      let worstLensAt = 0;
      let lens = camera.fov;
      for (let frame = 0; frame < 30 * FRAME_HZ && framed < WATCHED_S * FRAME_HZ; frame++) {
        camera.aspect = screen.width / screen.height;
        engine.advance(FRAME, { frameDt: FRAME });
        if (!ragdolls.rideAlong || ragdolls["ride"].cam.fresh) continue;
        headOnScreen(_ndc);
        if (framed > 0 && Math.abs(camera.fov - lens) > worstLens) [worstLens, worstLensAt] = [Math.abs(camera.fov - lens), framed / FRAME_HZ];
        lens = camera.fov;
        if (framed > 0) {
          const step = _ndc.distanceTo(_was);
          if (step > worstStep) [worstStep, worstAt] = [step, framed / FRAME_HZ];
        }
        if (Math.abs(_ndc.x) > 1 || Math.abs(_ndc.y) > 1) leftFrame++;
        _was.copy(_ndc);
        framed++;
      }
      assert.ok(framed >= WATCHED_S * FRAME_HZ, `the ride lasted ${(framed / FRAME_HZ).toFixed(1)} s`);
      assert.equal(leftFrame, 0, `his head was off screen for ${leftFrame} frames`);
      assert.ok(worstStep <= HEAD_STEP_BAR, `his head moved ${worstStep.toFixed(3)} of the frame in one frame, ${worstAt.toFixed(2)} s into the ride`);
      assert.ok(worstLens <= LENS_STEP_BAR, `the lens changed ${worstLens.toFixed(2)} degrees in one frame, ${worstLensAt.toFixed(2)} s into the ride`);
    });
  }
});
