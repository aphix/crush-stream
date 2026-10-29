import { afterAll, beforeAll, describe, expect, it } from "vitest";
import "../kernel/rapier-node.test-util.ts";
import { HudStore, INITIAL_HUD } from "../hud/hud-store.ts";
import { FLEET_EMPTY_S } from "../scenes/fleet.ts";
import { setGround } from "../world/ground.ts";
import type { CrashEngine } from "./engine.ts";
import { bootEngine, stubBrowser } from "./engine-headless.test-util.ts";
import { FRAME_HZ } from "../kernel/constants.ts";

const FRAME = 1 / FRAME_HZ;

describe("given the real engine on Fleet's default settings, every car driving straight out from the centre on its own bearing", () => {
  // One engine for the file: a second `CrashEngine` in the same process never resolves `ready`.
  let engine: CrashEngine;
  let hud: HudStore;
  beforeAll(async () => {
    stubBrowser();
    hud = new HudStore();
    engine = await bootEngine({ hud, fades: true });
  });
  afterAll(() => {
    engine.dispose();
    setGround(null);
  });

  it("when the last car has left the disc, then the loop resets the scene once the disc has been empty 1 s and within 1 s more", (t) => {
    expect(hud.get().carCount, "the HUD starts on its default car count").toBe(INITIAL_HUD.carCount);
    expect(INITIAL_HUD.carCount, "Fleet's default is 5 cars").toBe(5);
    const cars = engine["live"]();
    expect(cars.length, "the default Fleet runs 5 cars").toBe(5);
    expect(engine["looping"], "the default Fleet loops").toBeTruthy();
    // No car meets another: five bearings out from the centre, each at 20 m/s along it.
    for (const [k, car] of cars.entries()) {
      const a = (k / cars.length) * 2 * Math.PI;
      car.spawnFacing(Math.sin(a) * 10, Math.cos(a) * 10, a, 0);
      car.velocity.set(Math.sin(a) * 20, 0, Math.cos(a) * 20);
      car.speed = 20;
      car.spawnSpeed = 20;
    }
    const gen = engine["clearGen"]();
    let lastLeft = -1;
    let resetAt = -1;
    for (let frame = 0; frame < 20 * 60 && resetAt < 0; frame++) {
      const before = engine["elapsedWall"];
      engine.advance(FRAME, { frameDt: FRAME });
      const vaporAt = engine["vaporAt"];
      if (cars.every((c) => c.vaporized)) lastLeft = Math.max(...vaporAt.map((t) => t ?? 0));
      if (engine["clearGen"]() !== gen) resetAt = before + FRAME;
    }
    expect(lastLeft, "every car left the disc").toBeGreaterThanOrEqual(0);
    expect(resetAt, "the scene never reset").toBeGreaterThanOrEqual(0);
    const delay = resetAt - lastLeft;
    t.annotate(`reset ${delay.toFixed(3)} s after the last car left (FLEET_EMPTY_S ${FLEET_EMPTY_S})`);
    expect(delay, `reset ${delay.toFixed(3)} s after the last car left: before the disc had been empty ${FLEET_EMPTY_S} s`).toBeGreaterThanOrEqual(FLEET_EMPTY_S - FRAME);
    expect(delay, `reset ${delay.toFixed(3)} s after the last car left, over ${FLEET_EMPTY_S + 1} s`).toBeLessThanOrEqual(FLEET_EMPTY_S + 1);
  });

  it("when two cars meet head-on and crash, then every wreck has rolled to rest within 3 s", () => {
    const cars = engine["live"]();
    // The loop would reset the scene (respawn every car) before the 3 s are out; the rest is timed at 1× (the crash's own slow-mo would stretch it).
    engine["looping"] = false;
    engine.autoSlomo = false;
    // Two cars 20 m apart on the x axis, 12 m/s at each other, lanes 1 m apart so they glance and keep rolling; the rest stand aside, still.
    const crashed = (): boolean => cars[0]!.crashed && cars[0]!.deform.massActive && cars[1]!.crashed && cars[1]!.deform.massActive;
    for (const [k, car] of cars.entries()) {
      if (k < 2) {
        const dir = k === 0 ? 1 : -1;
        car.spawnFacing(-dir * 10, -dir * 0.5, (dir * Math.PI) / 2, 0);
        car.velocity.set(dir * 12, 0, 0);
        car.speed = 12;
      } else {
        car.spawnFacing(0, 8 + 4 * (k - 2), 0, 0);
        car.speed = 0;
      }
      car.spawnSpeed = car.speed;
    }
    for (let frame = 0; frame < 10 * 60 && !crashed(); frame++) engine.advance(FRAME, { frameDt: FRAME });
    expect(cars[0]!.crashed && cars[1]!.crashed, "the two cars crashed").toBeTruthy();
    for (let frame = 0; frame < 3 * 60; frame++) engine.advance(FRAME, { frameDt: FRAME });
    for (const [k, car] of cars.entries()) expect(car.velocity.length(), `car ${k} still moves at ${car.velocity.length().toFixed(2)} m/s 3 s after the crash`).toBeLessThan(0.5);
  });
});
