import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { setImmediate as yieldToLoop } from "node:timers/promises";
import * as THREE from "three";
import "../kernel/rapier-node.test-util.ts";
import { HudStore } from "../hud/hud-store.ts";
import { setGround } from "../world/ground.ts";
import { CrashEngine } from "./engine.ts";
import { element, stubBrowser } from "./engine-headless.test-util.ts";

/** What a finish program's key carries (`applyFinish`). */
const FINISH_KEY_MARK = "|finish-";
/** Every output the car finish must be linked and drawn for: plain paint on both, the finish into the HDR target only (it draws only at the post tiers). */
const FINISH_PASSES = "canvas plain,hdr finish,hdr plain";

describe("given the engine warming its programs before the loop starts", () => {
  let engine: CrashEngine;
  const drawnDebugViews = new Set<string>();
  const compiledPasses = new Set<string>();
  const drawnPasses = new Set<string>();
  const isDrawn = (object: THREE.Object3D): boolean => {
    for (let node: THREE.Object3D | null = object; node; node = node.parent) if (!node.visible) return false;
    return true;
  };
  const paintKey = (): string => engine["live"]()[0]!.lookMeshes().bodyPaint.customProgramCacheKey();
  /** The output the renderer is on and whether car 0's paint wears the finish now, e.g. "hdr finish". */
  const pass = (): string => `${engine["renderer"].getRenderTarget() === null ? "canvas" : "hdr"} ${paintKey().includes(FINISH_KEY_MARK) ? "finish" : "plain"}`;
  before(async () => {
    stubBrowser();
    engine = new CrashEngine(element(), new HudStore(), element());
    const render = (scene: THREE.Scene): void => {
      if (scene === engine["scene"]) drawnPasses.add(pass());
      scene.traverse((object) => {
        if (object.parent?.name === "ragdoll-debug" && isDrawn(object)) drawnDebugViews.add(object.type);
      });
    };
    const compileAsync = async (scene: THREE.Object3D): Promise<void> => {
      if (scene === engine["scene"]) compiledPasses.add(pass());
    };
    Object.assign(engine["renderer"], { render, compile() {}, compileAsync });
    await engine.ready;
  });
  after(() => {
    engine.dispose();
    setGround(null);
  });

  it("when the boot warm-up draws the scene, then the thrown dummies' rig lines and particle spheres are drawn too, and both views are off again after", () => {
    assert.deepEqual([...drawnDebugViews].sort(), ["LineSegments", "Mesh"]);
    assert.equal(engine["ragdolls"].debug.on, false);
  });

  it("when the boot warm-up runs on a tier without the finish, then car paint is linked and drawn plain for both outputs and finished for the HDR target only, and is plain again after", () => {
    assert.equal([...compiledPasses].sort().join(), FINISH_PASSES, "linked");
    assert.equal([...drawnPasses].sort().join(), FINISH_PASSES, "drawn");
    assert.equal(paintKey().includes(FINISH_KEY_MARK), false, `key ${paintKey()}`);
  });

  it("when the FX tier rises to High after boot, then the switch queues the warm-up, which links plain paint for both outputs and the finish for the HDR target only, and the paint keeps the finish after", async () => {
    compiledPasses.clear();
    engine.setFxTier("high");
    await yieldToLoop();
    assert.equal([...compiledPasses].sort().join(), FINISH_PASSES);
    assert.ok(paintKey().includes(FINISH_KEY_MARK), `key ${paintKey()}`);
  });
});
