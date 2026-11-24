import { afterAll, beforeAll, describe, expect, it } from "vitest";
import "../kernel/rapier-node.test-util.ts";
import { HudStore } from "../hud/hud-store.ts";
import { setGround } from "../world/ground.ts";
import { buildOpenWorldMap } from "../world/openworld/openworld-map.ts";
import { fixtureLots } from "../world/openworld/openworld-lots.test-util.ts";
import { openWorldCourse } from "../world/openworld/openworld-course.ts";
import { OFF_MENU } from "../world/tracks/index.ts";
import type { CrashEngine } from "./engine.ts";
import { bootEngine, runSeconds, stubBrowser } from "./engine-headless.test-util.ts";
import { detAtan2 } from "../kernel/physics-core.js";

const WALL_REACH = 8;
const SEED = 0xbeef;
const WARM_SECONDS = 3;
const WINDOW_SECONDS = 10;
/** The engine publishes about 7 times a second (every 0.12 s of wall time): a window of ten seconds holds this many tries at least. */
const MIN_TRIES = 60;
/** What a window of ten seconds may cost a view where nothing but a camera or a bubble moves: the gauge going or coming, the camera's name, a cut's bubble or two; the publishes that change nothing visible are no notification at all. */
const MOST_NOTIFICATIONS = 6;
/** His car is set this far (m) back down its street before the pedal goes down: ten seconds of full throttle cover about 350 m, and from the start place the street's end wall is 280 m ahead (measured: he hit it at 8.6 s and was thrown, so the window held a thrown driver and his look panel, not a view where only a camera moves). */
const ROAD_BACK_M = 100;

const lots = fixtureLots(WALL_REACH);
const map = buildOpenWorldMap(lots);
const course = openWorldCourse(lots);
const hud = new HudStore();
let engine: CrashEngine;
let tries = 0;
let notifications = 0;
let contentChanges = 0;
let missedByTheStore = 0;
let lastContent = "";

beforeAll(async () => {
  (OFF_MENU as unknown[]).push(course);
  stubBrowser();
  globalThis.location.hash = `#scene=openworld&seed=${SEED.toString(16)}`;
  const publish = hud.publish.bind(hud);
  hud.publish = (next) => {
    tries++;
    const content = JSON.stringify(next);
    const changed = content !== lastContent;
    const before = hud.get();
    publish(next);
    if (changed) contentChanges++;
    if (changed && hud.get() === before) missedByTheStore++;
    lastContent = JSON.stringify(hud.get());
  };
  engine = await bootEngine({ hud });
  engine.startOpenWorld(map);
  hud.subscribe(() => void notifications++);
  runSeconds(engine, WARM_SECONDS);
});
afterAll(() => {
  engine.dispose();
  setGround(null);
  (OFF_MENU as unknown[]).splice((OFF_MENU as unknown[]).indexOf(course), 1);
});

/** `seconds` of play; what the engine tried to publish in it and what the store told its listeners. */
function playWindow(seconds: number): { tries: number; notifications: number } {
  const [triesBefore, notificationsBefore] = [tries, notifications];
  runSeconds(engine, seconds);
  const counts = { tries: tries - triesBefore, notifications: notifications - notificationsBefore };
  if (process.env.HUD_PRINT) console.log(`hud publishes in ${seconds} s: the engine tried ${counts.tries} times, the HUD was told ${counts.notifications} times`);
  return counts;
}

describe("given the real engine in the open world, the HUD subscribed to its store", () => {
  it("when the car stands still for ten seconds with the crowd about, then the engine tries to publish many times and the HUD hears of almost none", () => {
    const quiet = playWindow(WINDOW_SECONDS);
    expect(quiet.tries, "tries the engine made").toBeGreaterThanOrEqual(MIN_TRIES);
    expect(quiet.notifications, "notifications of the HUD").toBeLessThanOrEqual(MOST_NOTIFICATIONS);
  });

  it("when the Auto camera is up and the pedal is down, then the car's gauge is not on screen and the HUD hears of almost nothing", () => {
    const car = engine["live"]()[engine["seat"].carIndex]!;
    const { x, z } = car.group.position;
    car.spawnFacing(x - car.fwdFlat.x * ROAD_BACK_M, z - car.fwdFlat.z * ROAD_BACK_M, detAtan2(car.fwdFlat.x, car.fwdFlat.z), 0);
    engine["openWorld"].setAuto(true);
    engine["keys"].add("KeyW");
    const watched = playWindow(WINDOW_SECONDS);
    engine["keys"].delete("KeyW");
    const atTheWheel = hud.get().foot?.out === false;
    const speed = car.velocity.length();
    engine["openWorld"].setAuto(false);
    expect(atTheWheel, "control: he is at the wheel at the window's end (no crash threw him)").toBe(true);
    expect(speed, "control: the car is at speed at the window's end (m/s)").toBeGreaterThan(30);
    expect(watched.tries, "tries the engine made").toBeGreaterThanOrEqual(MIN_TRIES);
    expect(watched.notifications, "notifications of the HUD").toBeLessThanOrEqual(MOST_NOTIFICATIONS);
  });

  it("when a setting changes, then the HUD hears of it", () => {
    const before = notifications;
    // Wet, not night: the open world's night follows its hour and ignores the night setting.
    engine.setWet(!hud.get().wet);
    runSeconds(engine, 1);
    expect(notifications - before, "notifications after a setting changed").toBeGreaterThanOrEqual(1);
  });

  it("when the whole session is looked at, then the store never kept a snapshot whose content had changed", () => {
    expect(contentChanges, "content changes in the session").toBeGreaterThan(0);
    expect(missedByTheStore, "content changes the store did not publish").toBe(0);
  });
});
