import { afterAll, beforeAll, describe, expect, it } from "vitest";
import "../kernel/rapier-node.test-util.ts";
import { HudStore } from "../hud/hud-store.ts";
import { PLATFORM_CAMERA } from "../vehicle/car-styles/platform.ts";
import { setGround } from "../world/ground.ts";
import type { CrashEngine } from "./engine.ts";
import { runSeconds, bootEngine, stubBrowser } from "./engine-headless.test-util.ts";
import { FRAME_HZ } from "../kernel/constants.ts";
import { G } from "../vehicle/car-air-body.ts";
import type { DeformableCar } from "../vehicle/car.ts";
import { firstMismatch } from "../kernel/compare-arrays.test-util.ts";

const FRAME = 1 / FRAME_HZ;
type Rig = "press" | "pistons" | "doors" | "corkscrew";
/** The share of its spawn's kinetic energy a coasting rig car still holds a second after a reset (rolling drag costs it under a tenth). */
const COAST_SHARE = 0.9;

describe("given the real engine in a rig scene, watching its car", () => {
  // One engine for the file: a second `CrashEngine` in the same process never resolves `ready`.
  let engine: CrashEngine;
  let hud: HudStore;
  /** Enter `id` from the fleet (a pick of the scene in play goes back to the fleet), its car watched (Q/E or a click), no key held. */
  const watch = (id: Rig): void => {
    engine["seat"].mode = "global";
    engine["view"].spec = null;
    engine["setScene"]("fleet");
    engine["setScene"](id);
    engine["seat"].focus(0);
    engine["keys"].clear();
    runSeconds(engine, FRAME); // one frame with no key down: the seat's pedal edge starts fresh
    engine["emitHud"]();
  };
  /**
   * A rig car that coasts keeps its energy: the corkscrew's mouth takes it up 7.7 m in the second after a reset (24 -> 21.1 m/s at the lip, 66 J/kg of
   * speed into height), so the bar is its mechanical energy (speed and height), 0.9 of the spawn's kinetic energy, not 0.9 of its speed. Measured
   * on the engine: 100 % of the spawn's at the mount's start, 96 % at its dip, 103 % at the lip. A car braked or parked after the reset holds none of it.
   */
  const assertCoasting = (car: DeformableCar): void => {
    const spawn = 0.5 * car.spawnSpeed * car.spawnSpeed;
    const held = 0.5 * car.velocity.lengthSq() + G * car.group.position.y;
    expect(held, `the car holds ${held.toFixed(0)} J/kg (speed ${car.velocity.length().toFixed(1)} m/s, ${car.group.position.y.toFixed(1)} m up) of the ${spawn.toFixed(0)} J/kg it spawned with, under ${COAST_SHARE}`).toBeGreaterThan(COAST_SHARE * spawn);
  };
  /** W for a moment (the seat takes the wheel), then released. */
  const takeWheel = (): void => {
    engine["keys"].add("KeyW");
    runSeconds(engine, 0.1);
    engine["keys"].clear();
  };
  beforeAll(async () => {
    stubBrowser();
    hud = new HudStore();
    engine = await bootEngine({ hud, pacer: true });
    // The rig car's spawn speed is drawn from the speed range at a random scene seed (10-32 m/s): a slow draw loses more than 10% in a second to rolling drag, which the 0.9 coast bars read as a stall. A fixed 24 m/s coasts the same every run.
    engine.setSpeedRange(24, 24);
  });
  afterAll(() => {
    engine.dispose();
    setGround(null);
  });

  it("when V is pressed in each rig scene, then the HUD names the next spectator view, and the orbit is where it starts and where nine presses end", () => {
    for (const id of ["press", "pistons", "doors", "corkscrew"] as const) {
      watch(id);
      expect(engine["sceneId"]).toBe(id);
      expect(hud.get().cam, `${id}: the rig's default view is the orbit`).toBe("orbit");
      const seen: unknown[] = [];
      for (let i = 0; i < 9; i++) {
        engine.cycleCamera();
        seen.push(hud.get().cam);
      }
      expect(firstMismatch(seen, ["auto", "free", "auto", "third", "far", "first", "cine", "dutch", "orbit"]), `${id}: the views V cycles from the orbit (the free view after Auto, and V from it back to Auto), round to it`).toBeUndefined();
      engine.cycleCamera();
      expect(hud.get().cam, `${id}: and round again`).toBe("auto");
    }
  });

  it("when the chase view is picked on the corkscrew, then the camera sits behind the car within the chase distance, and the view and the run's coast survive a reset", () => {
    watch("corkscrew");
    const car = engine["carA"];
    runSeconds(engine, 0.5);
    // The orbit's next is Auto, then the free view (V from it comes back to Auto), then the chase.
    for (let presses = 0; presses < 4; presses++) engine.cycleCamera();
    expect(engine["view"].specView(false)).toBe("third");
    runSeconds(engine, 0.7);
    const cam = engine["camera"].position;
    const dx = cam.x - car.group.position.x;
    const dz = cam.z - car.group.position.z;
    const dist = Math.hypot(dx, cam.y - car.group.position.y, dz);
    const along = dx * car.fwdFlat.x + dz * car.fwdFlat.z;
    expect(car.velocity.length(), `the car is under way at ${car.velocity.length().toFixed(1)} m/s`).toBeGreaterThan(5);
    expect(along, `the camera is ahead of the car (${along.toFixed(2)} m along its heading)`).toBeLessThan(0);
    expect(dist, `the camera is ${dist.toFixed(2)} m off, the chase distance is ${PLATFORM_CAMERA.third.dist}`).toBeLessThanOrEqual(PLATFORM_CAMERA.third.dist + 1.5);
    engine.reset();
    expect(engine["view"].specView(false), "the reset keeps the view").toBe("third");
    runSeconds(engine, 1);
    assertCoasting(car);
  });

  it("when the car was driven and the scene resets (the HUD's reset, or the loop), then the seat hands the car back and it coasts the run at its spawn speed again", () => {
    watch("corkscrew");
    const car = engine["carA"];
    takeWheel();
    expect(engine["seat"].mode, "W took the wheel").toBe("drive");
    engine.reset();
    expect(engine["seat"].mode, "the reset handed the car back to the rig").toBe("follow");
    expect(hud.get().seat, "the HUD says so").toBe("follow");
    runSeconds(engine, 1);
    assertCoasting(car);
  });

  it("when the car was driven, Esc steps back and the scene resets, then it coasts the run at its spawn speed", () => {
    watch("corkscrew");
    const car = engine["carA"];
    takeWheel();
    engine["seat"].esc();
    expect(engine["seat"].mode).toBe("follow");
    engine.reset();
    runSeconds(engine, 1);
    assertCoasting(car);
  });
});
