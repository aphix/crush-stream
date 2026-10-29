import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as THREE from "three";
import "../kernel/rapier-node.test-util.ts";
import { HudStore } from "../hud/hud-store.ts";
import { setGround } from "../world/ground.ts";
import type { CrashEngine } from "./engine.ts";
import { bootEngine, pressKey, runSeconds, stubBrowser } from "./engine-headless.test-util.ts";
import { FRAME_HZ } from "../kernel/constants.ts";
import { FreeCam } from "../present/free-cam.ts";

const FRAME = 1 / FRAME_HZ;
/** The fleet disc's free cruise (m/s), read off the eye itself: the view's own scale is `free-cam.test.ts`'s to pin. */
const DISC_CRUISE = new FreeCam().cruise;

describe("given the real engine in the fleet, watching a car", () => {
  // One engine for the file: a second `CrashEngine` in the same process never resolves `ready`.
  let engine: CrashEngine;
  let hud: HudStore;
  const press = (code: string): void => {
    pressKey(engine, code);
    engine["keys"].delete(code);
  };
  /** The fleet, its first car followed, View pressed until the HUD names the free view (at most one turn of the ring), no key held. */
  const flyFree = (): void => {
    engine["view"].leaveFree();
    engine["view"].spec = null;
    engine["setScene"]("fleet");
    engine["seat"].focus(0);
    engine["keys"].clear();
    runSeconds(engine, FRAME);
    for (let presses = 0; presses < 10 && hud.get().cam !== "free"; presses++) engine.cycleCamera();
    expect(hud.get().cam, "the free view is in the ring").toBe("free");
    runSeconds(engine, FRAME);
  };
  const eye = (): THREE.Vector3 => engine["camera"].position.clone();
  const level = (a: THREE.Vector3, b: THREE.Vector3): number => Math.hypot(a.x - b.x, a.z - b.z);

  beforeAll(async () => {
    stubBrowser();
    hud = new HudStore();
    engine = await bootEngine({ hud, pacer: true });
  });
  afterAll(() => {
    engine.dispose();
    setGround(null);
  });

  it("when View is cycled round to the free view, then the HUD names it, the seat still follows, and W flies the eye the cruise speed a second without taking the wheel", () => {
    flyFree();
    const start = eye();
    engine["keys"].add("KeyW");
    runSeconds(engine, 1);
    engine["keys"].clear();
    expect(engine["seat"].mode, "W flew the camera; it did not take the wheel").toBe("follow");
    expect(Math.abs(level(eye(), start) - DISC_CRUISE), `the eye flew ${level(eye(), start).toFixed(2)} m level in a second, cruise ${DISC_CRUISE} m/s`).toBeLessThan(0.5);
  });

  it("when Space is pressed and held in the free view, then the eye rises and the game does not pause; out of the free view the same Space pauses", () => {
    flyFree();
    const playing = engine["playing"];
    const start = eye();
    pressKey(engine, "Space");
    runSeconds(engine, 0.5);
    engine["keys"].clear();
    expect(engine["playing"], "Space in the free view left play as it was").toBe(playing);
    expect(eye().y - start.y, `Space raised the eye ${(eye().y - start.y).toFixed(2)} m in 0.5 s`).toBeGreaterThan(1);
    engine["view"].leaveFree();
    engine["seat"].esc();
    runSeconds(engine, FRAME);
    press("Space");
    expect(engine["playing"], "Space out of the free view, nobody driven, toggled play").not.toBe(playing);
    press("Space");
  });

  it("when Ctrl goes down in the free view (its keydown carries the Ctrl flag, as a browser's does) and W is pressed with it, then the eye sinks and flies on, and neither keydown reaches the browser", () => {
    flyFree();
    const start = eye();
    const down = (code: string) => Object.assign(new Event("keydown", { cancelable: true }), { code, repeat: false, ctrlKey: true, metaKey: false, altKey: false }) as KeyboardEvent;
    const ctrl = down("ControlLeft");
    const w = down("KeyW");
    engine["onKey"](ctrl);
    engine["onKey"](w);
    runSeconds(engine, 0.5);
    engine["onKeyUp"](Object.assign(new Event("keyup"), { code: "ControlLeft" }) as KeyboardEvent);
    engine["onKeyUp"](Object.assign(new Event("keyup"), { code: "KeyW" }) as KeyboardEvent);
    expect(start.y - eye().y, `Ctrl sank the eye ${(start.y - eye().y).toFixed(2)} m in 0.5 s`).toBeGreaterThan(1);
    expect(level(eye(), start), `Ctrl+W still flew it forward ${level(eye(), start).toFixed(2)} m`).toBeGreaterThan(1);
    expect(ctrl.defaultPrevented, "the Ctrl keydown is the game's").toBe(true);
    expect(w.defaultPrevented, "Ctrl+W is the game's, not the browser's").toBe(true);
    expect(engine["keys"].size, "both released").toBe(0);
  });

  it("when the same W is held without the free view, then the seat takes the wheel (the control for the test above)", () => {
    engine["view"].leaveFree();
    engine["view"].spec = null;
    engine["seat"].focus(0);
    engine["keys"].clear();
    runSeconds(engine, FRAME);
    engine["keys"].add("KeyW");
    runSeconds(engine, 0.1);
    engine["keys"].clear();
    expect(engine["seat"].mode, "W drives in the other views").toBe("drive");
    engine["seat"].esc();
  });

  it("when the free view is on and nothing is held, then the eye stays where it was while the watched car is carried 40 m away", () => {
    flyFree();
    const car = engine["cars"][0]!;
    const start = eye();
    car.group.position.x += 40;
    runSeconds(engine, 0.3);
    expect(eye().distanceTo(start), `the eye drifted ${eye().distanceTo(start)} m`).toBeLessThan(1e-6);
  });

  it("when the free view is on, then the camera runs in the free mode", () => {
    flyFree();
    expect(engine["cameraRig"]()).toBe("free");
  });

  it("when PageDown is held for five seconds in the free view, then the eye stops above the ground", () => {
    flyFree();
    engine["keys"].add("PageDown");
    runSeconds(engine, 5);
    engine["keys"].clear();
    expect(eye().y, `the eye sank to ${eye().y.toFixed(2)} m`).toBeGreaterThan(0.5);
    expect(eye().y, `and rests on the clearance, at ${eye().y.toFixed(2)} m`).toBeLessThan(1.5);
  });

  it("when Esc is pressed in the free view, then the view before it comes back with the seat still following, and a second Esc steps out to the whole field", () => {
    flyFree();
    press("Escape");
    expect(engine["view"].flying, "the free view ended").toBe(false);
    expect(hud.get().cam, "the HUD names the view it came from (Auto, just before the free one in the ring)").toBe("auto");
    expect(engine["seat"].mode, "the first Esc did not step out").toBe("follow");
    press("Escape");
    expect(engine["seat"].mode, "the second Esc steps out as before").toBe("global");
  });

  it("when View is pressed in the free view, then it goes back to the view before it", () => {
    flyFree();
    engine.cycleCamera();
    expect(hud.get().cam, "back to Auto, the view before the free one in the ring").toBe("auto");
  });

  it("when the seat is driven, then View cycles the car's own views and never reaches the free view", () => {
    engine["view"].leaveFree();
    engine["seat"].mode = "drive";
    engine["seat"].carIndex = 0;
    for (let presses = 0; presses < 8; presses++) {
      engine.cycleCamera();
      expect(engine["view"].flying, `press ${presses + 1}`).toBe(false);
    }
    engine["seat"].esc();
  });

  it("when the seat takes the wheel during the free view (a race handing the viewer its car), then the free view ends and the driven views are back", () => {
    flyFree();
    engine["seat"].mode = "drive";
    runSeconds(engine, FRAME);
    expect(engine["view"].flying, "driving is not spectating").toBe(false);
    engine["emitHud"]();
    expect(hud.get().cam, "and the HUD no longer names a spectator view").toBe(null);
    engine["seat"].esc();
  });

  it("when the highlight reel is playing its shots and the free view is on, then the viewer's eye holds the camera, not the reel's shot", () => {
    flyFree();
    const reel = engine["highlights"];
    const reelAim = reel.aim;
    const start = eye();
    reel.playing = true;
    reel.aim = (camera) => camera.position.set(500, 60, -400);
    try {
      engine["aimRigs"](FRAME);
      expect(eye().distanceTo(start), `the camera is at ${eye().toArray().join(", ")}, the reel's shot is at 500, 60, -400`).toBeLessThan(1e-6);
      expect(engine["cameraRig"](), "and the trace names the free rig").toBe("free");
    } finally {
      reel.playing = false;
      reel.aim = reelAim;
    }
  });

  it("when the whole field is shown, then View flies free from it and View again goes back", () => {
    engine["view"].leaveFree();
    engine["seat"].clear();
    engine["setScene"]("fleet");
    runSeconds(engine, FRAME);
    expect(hud.get().cam, "the whole field shows no camera name").toBe(null);
    engine.cycleCamera();
    expect(hud.get().cam, "View from the whole field").toBe("free");
    runSeconds(engine, FRAME);
    expect(engine["view"].flying).toBe(true);
    engine.cycleCamera();
    expect(hud.get().cam, "and back").toBe(null);
    expect(engine["view"].flying).toBe(false);
  });

  it("when a scene is picked in the free view, then the free view ends", () => {
    flyFree();
    engine["setScene"]("derby");
    expect(engine["view"].flying).toBe(false);
    engine["setScene"]("derby");
  });
});
