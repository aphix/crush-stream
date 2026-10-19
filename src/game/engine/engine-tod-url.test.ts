import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import "../kernel/rapier-node.test-util.ts";
import { HudStore } from "../hud/hud-store.ts";
import { decodeShare } from "../hud/share-url.ts";
import { TIME_OF_DAY, type TimeOfDay } from "../match/types.ts";
import { setGround } from "../world/ground.ts";
import { CrashEngine } from "./engine.ts";
import { element, stubBrowser } from "./engine-headless.test-util.ts";

describe("given the real engine and a browser address bar that records every write", () => {
  // One engine for the file: a second `CrashEngine` in the same process never resolves `ready`.
  let engine: CrashEngine;
  const todIn = (hash: string): string | null => new URLSearchParams(hash.replace(/^#/, "")).get("tod");
  before(async () => {
    stubBrowser();
    globalThis.history.pushState = globalThis.history.replaceState = (_state, _unused, url) => {
      globalThis.location.hash = String(url).slice(String(url).indexOf("#"));
    };
    engine = new CrashEngine(element(), new HudStore(), element());
    Object.assign(engine["renderer"], { render() {}, compile() {}, compileAsync: () => Promise.resolve() });
    await engine.ready;
    engine.fadeScenes = false;
  });
  after(() => {
    engine.dispose();
    setGround(null);
  });

  const pick = (timeOfDay: TimeOfDay): string => {
    engine.raceCommand({ type: "options", options: { timeOfDay } });
    return globalThis.location.hash;
  };

  it("when Sunset, Night and Daytime are picked in Survival's menu, then the link holds tod=sunset, tod=nighttime and no tod", () => {
    engine.toggleSurvival();
    assert.equal(engine["race"].hud().menu, "survival", "Survival's own menu is up");
    const links = [TIME_OF_DAY.sunset, TIME_OF_DAY.night, TIME_OF_DAY.day].map(pick);
    assert.equal(links.map((h) => todIn(h) ?? "-").join(","), `${TIME_OF_DAY.sunset},${TIME_OF_DAY.night},-`, links.join("  |  "));
  });

  it("when a link naming Survival at sunset is pasted, then the run opens lit for sunset, and a link without tod puts it back to daytime", () => {
    engine["applyShare"](decodeShare("#"), false);
    assert.equal(engine["sceneId"], "fleet");
    engine["applyShare"](decodeShare("#scene=survival&tod=sunset"), false);
    assert.equal(engine["sceneId"], "survival");
    assert.equal(engine["stage"].time, TIME_OF_DAY.sunset, "the stage is lit for sunset");
    assert.equal(engine["race"].options.timeOfDay, TIME_OF_DAY.sunset, "the setup's pick");
    assert.equal(todIn(globalThis.location.hash), TIME_OF_DAY.sunset, "the bar keeps it");
    engine["applyShare"](decodeShare("#scene=survival"), false);
    assert.equal(engine["stage"].time, TIME_OF_DAY.day, "a link without tod is daytime");
  });
});
