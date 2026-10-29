import { afterAll, beforeAll, describe, expect, it } from "vitest";
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
    expect(outdoors && outdoors !== studio, "the sky over the ground, not the studio").toBeTruthy();
    engine["envChoice"] = -2;
    engine["chooseEnvironment"]();
    expect(engine["scene"].environment, "the same texture the second time: no rebuild").toBe(outdoors);
  });

  it("when the scene is a studio's, then the studio environment is back, and the sky returns outdoors", () => {
    engine["sceneId"] = "garage";
    engine["chooseEnvironment"]();
    expect(engine["scene"].environment, "garage").toBe(studio);
    engine["sceneId"] = "fleet";
    engine["chooseEnvironment"]();
    expect(engine["scene"].environment, "fleet again").not.toBe(studio);
  });

  it("when the night comes, then the night's own environment is chosen, and the day's returns with the day", () => {
    engine["sceneId"] = "fleet";
    engine["stage"].setNight(false);
    engine["chooseEnvironment"]();
    const day = engine["scene"].environment;
    engine["stage"].setNight(true);
    engine["chooseEnvironment"]();
    const night = engine["scene"].environment;
    expect(night, "night differs from day").not.toBe(day);
    engine["stage"].setNight(false);
    engine["chooseEnvironment"]();
    expect(engine["scene"].environment, "the day's, kept").toBe(day);
  });
});
