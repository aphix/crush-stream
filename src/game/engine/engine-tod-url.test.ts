import { afterAll, beforeAll, describe, expect, it } from "vitest";
import "../kernel/rapier-node.test-util.ts";
import { decodeShare } from "../hud/share-url.ts";
import { TIME_OF_DAY, type TimeOfDay } from "../match/types.ts";
import { setGround } from "../world/ground.ts";
import type { CrashEngine } from "./engine.ts";
import { bootEngine, stubBrowser } from "./engine-headless.test-util.ts";

describe("given the real engine and a browser address bar that records every write", () => {
  // One engine for the file: a second `CrashEngine` in the same process never resolves `ready`.
  let engine: CrashEngine;
  const todIn = (hash: string): string | null => new URLSearchParams(hash.replace(/^#/, "")).get("tod");
  beforeAll(async () => {
    stubBrowser();
    globalThis.history.pushState = globalThis.history.replaceState = (_state, _unused, url) => {
      globalThis.location.hash = String(url).slice(String(url).indexOf("#"));
    };
    engine = await bootEngine();
  });
  afterAll(() => {
    engine.dispose();
    setGround(null);
  });

  const pick = (timeOfDay: TimeOfDay): string => {
    engine.raceCommand({ type: "options", options: { timeOfDay } });
    return globalThis.location.hash;
  };

  it("when Sunset, Night and Daytime are picked in Survival's menu, then the link holds tod=sunset, tod=nighttime and no tod", () => {
    engine.toggleSurvival();
    expect(engine["race"].hud().menu, "Survival's own menu is up").toBe("survival");
    const links = [TIME_OF_DAY.sunset, TIME_OF_DAY.night, TIME_OF_DAY.day].map(pick);
    expect(links.map((h) => todIn(h) ?? "-").join(","), links.join("  |  ")).toBe(`${TIME_OF_DAY.sunset},${TIME_OF_DAY.night},-`);
  });

  it("when a link naming Survival at sunset is pasted, then the run opens lit for sunset, and a link without tod puts it back to daytime", () => {
    engine["applyShare"](decodeShare("#"), false);
    expect(engine["sceneId"]).toBe("fleet");
    engine["applyShare"](decodeShare("#scene=survival&tod=sunset"), false);
    expect(engine["sceneId"]).toBe("survival");
    expect(engine["stage"].time, "the stage is lit for sunset").toBe(TIME_OF_DAY.sunset);
    expect(engine["race"].options.timeOfDay, "the setup's pick").toBe(TIME_OF_DAY.sunset);
    expect(todIn(globalThis.location.hash), "the bar keeps it").toBe(TIME_OF_DAY.sunset);
    engine["applyShare"](decodeShare("#scene=survival"), false);
    expect(engine["stage"].time, "a link without tod is daytime").toBe(TIME_OF_DAY.day);
  });
});
