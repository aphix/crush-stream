import { afterAll, beforeAll, describe, expect, it } from "vitest";
import "../kernel/rapier-node.test-util.ts";
import { setGround } from "../world/ground.ts";
import type { CrashEngine } from "./engine.ts";
import { runSeconds, bootEngine, frameField, stubBrowser } from "./engine-headless.test-util.ts";
import { FRAME_HZ } from "../kernel/constants.ts";

const FRAME = 1 / FRAME_HZ;
const CANVAS_W = 800;
const CANVAS_H = 600;

describe("given the real engine in a derby match past its green light, nobody seated", () => {
  // One engine for the file: a second `CrashEngine` in the same process never resolves `ready`.
  let engine: CrashEngine;
  /** The opening shot of the field, pulled back until every car shows (the stand-in canvas has no size, so no view offset). */
  const frameCamera = (): void => frameField(engine, CANVAS_W, CANVAS_H);
  /** The canvas pixel a car's roof shows at, or null while the car is off the view. */
  const screenSpot = (index: number): { x: number; y: number } | null => {
    const camera = engine["camera"];
    const spot = engine["live"]()[index]!.group.position.clone();
    spot.y += 0.5;
    spot.project(camera);
    if (spot.z > 1 || Math.abs(spot.x) > 0.95 || Math.abs(spot.y) > 0.95) return null;
    return { x: (spot.x * 0.5 + 0.5) * CANVAS_W, y: (-spot.y * 0.5 + 0.5) * CANVAS_H };
  };
  beforeAll(async () => {
    stubBrowser();
    engine = await bootEngine({ pacer: true });
    engine.toggleDerby();
    runSeconds(engine, 8);
    frameCamera();
  });
  afterAll(() => {
    engine.dispose();
    setGround(null);
  });

  it("when each car on screen is clicked, then the seat follows that car, and a pedal press takes its wheel", () => {
    expect(engine.derbyMode, "the derby is on").toBe(true);
    expect(engine["derby"].time, "past the green light").toBeGreaterThan(0);
    let clicked = 0;
    for (let index = 0; index < engine["carCount"]; index++) {
      engine["seat"].mode = "global";
      engine["seat"].carIndex = -1;
      engine["keys"].clear();
      runSeconds(engine, FRAME); // one frame with no key down: the seat's pedal edge starts fresh
      frameCamera();
      const spot = screenSpot(index);
      // A car drawn over another's centre is the one a press there picks: that car's turn, not this one's.
      if (spot === null || engine["carAt"](spot.x, spot.y) !== index) continue;
      engine["watchCar"](engine["carAt"](spot.x, spot.y));
      expect(engine["seat"].mode, `a click on car ${index} follows it`).toBe("follow");
      expect(engine["seat"].carIndex, `a click on car ${index} follows that car`).toBe(index);
      engine["keys"].add("KeyW");
      runSeconds(engine, 0.1);
      engine["keys"].clear();
      expect(engine["seat"].mode, `W takes the wheel of car ${index}`).toBe("drive");
      expect(engine["seat"].carIndex, `W drives car ${index}`).toBe(index);
      clicked++;
    }
    expect(clicked, `at least two of the five cars were on screen to click (saw ${clicked})`).toBeGreaterThanOrEqual(2);
  });
});