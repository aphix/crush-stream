import { afterAll, beforeAll, describe, it } from "vitest";
import assert from "node:assert/strict";
import * as THREE from "three";
import "../kernel/rapier-node.test-util.ts";
import { HudStore } from "../hud/hud-store.ts";
import { setGround } from "../world/ground.ts";
import type { CrashEngine } from "./engine.ts";
import { bootEngine, stubBrowser } from "./engine-headless.test-util.ts";

describe("given the real engine with a studio environment loaded", () => {
  let engine: CrashEngine;
  const studio = new THREE.Texture();

  beforeAll(async () => {
    stubBrowser();
    engine = await bootEngine({ hud: new HudStore(), fades: true });
    engine["envMap"] = studio;
    engine["envChoice"] = -2;
  });
  afterAll(() => {
    engine.dispose();
    setGround(null);
  });

  it("when an outdoor scene chooses its environment, then the cars reflect the daylight sky, built once and kept", () => {
    engine["sceneId"] = "fleet";
    engine["chooseEnvironment"]();
    const outdoors = engine["scene"].environment;
    assert.ok(outdoors && outdoors !== studio, "the sky over the ground, not the studio");
    engine["envChoice"] = -2;
    engine["chooseEnvironment"]();
    assert.equal(engine["scene"].environment, outdoors, "the same texture the second time: no rebuild");
  });

  it("when the scene is a studio's, then the studio environment is back, and the sky returns outdoors", () => {
    engine["sceneId"] = "garage";
    engine["chooseEnvironment"]();
    assert.equal(engine["scene"].environment, studio, "garage");
    engine["sceneId"] = "fleet";
    engine["chooseEnvironment"]();
    assert.notEqual(engine["scene"].environment, studio, "fleet again");
  });

  it("when the night comes, then the night's own environment is chosen, and the day's returns with the day", () => {
    engine["sceneId"] = "fleet";
    engine["stage"].setNight(false);
    engine["chooseEnvironment"]();
    const day = engine["scene"].environment;
    engine["stage"].setNight(true);
    engine["chooseEnvironment"]();
    const night = engine["scene"].environment;
    assert.notEqual(night, day, "night differs from day");
    engine["stage"].setNight(false);
    engine["chooseEnvironment"]();
    assert.equal(engine["scene"].environment, day, "the day's, kept");
  });
});
