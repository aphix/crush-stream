import { afterAll, beforeAll, describe, expect, it } from "vitest";
import "../kernel/rapier-node.test-util.ts";
import { TRACK_ID } from "../world/constants.ts";
import { setGround } from "../world/ground.ts";
import type { CrashEngine } from "./engine.ts";
import { runSeconds, bootEngine, stubBrowser } from "./engine-headless.test-util.ts";
import { FRAME_HZ } from "../kernel/constants.ts";

/**
 * Where a Survival run's course is picked (docs/SURVIVAL.md): a shared `#` boots straight into a run on the course it names, the
 * scene bar's Survival opens Survival's own menu first (the run starts on Start survival), and the address follows the pick.
 */

const FRAME = 1 / FRAME_HZ;

describe("given the real engine booted on #scene=survival&track=national-mall", () => {
  // One engine for the file: a second `CrashEngine` in the same process never resolves `ready`.
  let engine: CrashEngine;
  const bar: string[] = [];
  beforeAll(async () => {
    stubBrowser();
    globalThis.location.hash = "#scene=survival&track=national-mall";
    // The address bar as the browser keeps it: a write lands in `location.hash`.
    globalThis.history.pushState = globalThis.history.replaceState = (_state, _unused, url) => {
      bar.push(String(url));
      globalThis.location.hash = String(url).slice(String(url).indexOf("#"));
    };
    engine = await bootEngine({ pacer: true });
  });
  afterAll(() => {
    engine.dispose();
    setGround(null);
  });

  it("when the page has loaded, then a Survival run is on the Mall at once, with no menu in front of it", () => {
    runSeconds(engine, 0.5);
    const hud = engine["race"].hud();
    expect(engine["race"].active).toBe(true);
    expect(engine["race"].survival).toBe(true);
    expect(engine["race"].courseId).toBe(TRACK_ID.nationalMall);
    expect(hud.menu, "a link starts the run like every other scene").toBe(null);
    expect(hud.survival, "a run, not a parked field").not.toBe(null);
  });

  it("when the scene bar's Survival is pressed from the fleet, then Survival's menu is up on the picked course with no run started, a pick moves the course behind it, and Start survival runs the picked course", () => {
    engine.toggleSurvival(); // in Survival: back to the fleet
    expect(engine["race"].active).toBe(false);
    engine.toggleSurvival(); // the bottom bar's way in
    const menu = engine["race"].hud();
    expect(engine["race"].active).toBe(true);
    expect(menu.menu, "the menu comes first").toBe("survival");
    expect(menu.phase, "no race session behind it").toBe(null);
    expect(menu.survival, "no run").toBe(null);
    expect(menu.time, "no clock").toBe(0);
    expect(menu.survivalCourse, "the last pick stands").toBe(TRACK_ID.nationalMall);
    engine.raceCommand({ type: "survivalCourse", id: "havana" });
    expect(engine["race"].hud().menu, "a pick keeps the menu up").toBe("survival");
    expect(engine["race"].courseId, "the course behind the menu follows").toBe("havana");
    runSeconds(engine, 0.5);
    expect(engine["race"].hud().phase, "waiting in the menu starts nothing").toBe(null);
    engine.raceCommand({ type: "survivalCourse", id: TRACK_ID.nationalMall });
    engine.raceCommand({ type: "start" });
    const started = engine["race"].hud();
    expect(started.menu).toBe(null);
    expect(started.survival).not.toBe(null);
    expect(engine["race"].courseId, "Start survival runs the picked course").toBe(TRACK_ID.nationalMall);
  });

  it("when Change course is pressed in a run, then Survival's menu is back with the run dropped, and the address names the course picked there", () => {
    runSeconds(engine, 1);
    engine.raceCommand({ type: "survivalMenu" });
    const menu = engine["race"].hud();
    expect(menu.menu).toBe("survival");
    expect(menu.survival, "the run is dropped").toBe(null);
    engine.raceCommand({ type: "survivalCourse", id: "havana" });
    engine.raceCommand({ type: "start" });
    runSeconds(engine, FRAME);
    expect(engine["race"].courseId).toBe("havana");
    expect(bar.at(-1)!, "the # follows the run").toMatch(/#scene=survival&track=havana$/);
  });

  it("when the # is edited to name the Mall again, then the run restarts on it", () => {
    runSeconds(engine, 1);
    const before = engine["race"].hud().time;
    globalThis.location.hash = "#scene=survival&track=national-mall";
    engine["onShareHash"]();
    expect(engine["race"].courseId).toBe(TRACK_ID.nationalMall);
    expect(engine["race"].survival).toBe(true);
    expect(engine["race"].hud().time, "a fresh run clock").toBeLessThan(before);
  });
});
