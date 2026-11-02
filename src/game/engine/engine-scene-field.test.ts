import { afterAll, beforeAll, describe, expect, it } from "vitest";
import "../kernel/rapier-node.test-util.ts";
import { encodeShare, decodeShare } from "../hud/share-url.ts";
import { INITIAL_HUD } from "../hud/hud-store.ts";
import { setGround } from "../world/ground.ts";
import type { SceneId } from "../scenes/scene-id.ts";
import type { CrashEngine } from "./engine.ts";
import { bootEngine, runSeconds, stubBrowser } from "./engine-headless.test-util.ts";

/** The player's pick on the Cars slider: not the boot's 5, and not 1 (the one-car scenes' own). */
const PICK = 4;
/** The scenes that run a field of their own and give the sandbox's back (`OWN_FIELD_SCENES`), plus the derby, which a room grows. */
const AWAY = ["race", "range", "garage", "showcase", "lab", "stack", "derby"] as const satisfies readonly SceneId[];

describe("given the real engine with the player's car count picked on the slider", () => {
  // One engine for the file: a second `CrashEngine` in the same process never resolves `ready`.
  let engine: CrashEngine;
  beforeAll(async () => {
    stubBrowser();
    engine = await bootEngine();
  });
  afterAll(() => {
    engine.dispose();
    setGround(null);
  });

  /** The fleet with the player's pick, as the bar leaves it. */
  const fleet = (): void => {
    engine["setScene"]("fleet");
    engine.setCarCount(PICK);
    expect(engine["carCount"], "control: the pick is the fleet's field").toBe(PICK);
  };
  const fleetCars = (why: string): void => {
    expect(engine["sceneId"], `${why}: the scene`).toBe("fleet");
    expect(engine["carCount"], `${why}: the fleet's cars`).toBe(PICK);
    expect(engine["live"]().length, `${why}: the cars shown`).toBe(PICK);
  };

  it("when the fleet is left for each other scene and picked again, then it comes back with the player's cars, not that scene's own count", () => {
    for (const scene of AWAY) {
      fleet();
      engine["setScene"](scene);
      runSeconds(engine, 0.1);
      expect(engine["sceneId"], `${scene} was entered`).toBe(scene);
      engine["setScene"]("fleet");
      runSeconds(engine, 0.1);
      fleetCars(`from ${scene}`);
    }
  });

  it("when a scene is left for a second one with its own field and then the fleet, then the fleet still has the player's cars (a count a scene held is never the player's)", () => {
    for (const [a, b] of [["range", "race"], ["garage", "range"], ["showcase", "lab"], ["lab", "stack"], ["stack", "showcase"]] as const) {
      fleet();
      engine["setScene"](a);
      engine["setScene"](b);
      engine["setScene"]("fleet");
      runSeconds(engine, 0.1);
      fleetCars(`${a} then ${b}`);
    }
  });

  it("when a room host's race starts from the range and ends, then the fleet has the player's cars", () => {
    fleet();
    engine["setScene"]("range");
    // The host's `enterRace` calls this with no scene switch before it.
    engine["setRace"](true);
    engine["setRace"](false);
    fleetCars("net host race from the range");
  });

  it("when a room grows the derby's field and the derby is left, then the fleet has the player's cars", () => {
    fleet();
    engine["setScene"]("derby");
    engine["netDerbyMatch"](false, PICK + 3);
    expect(engine["carCount"], "control: the room's field grew").toBe(PICK + 3);
    engine["setScene"]("fleet");
    fleetCars("derby grown by a room");
  });

  it("when the link the showcase wrote is applied in the fleet and the fleet is picked again, then it has the player's cars", () => {
    fleet();
    engine["setScene"]("showcase");
    const link = encodeShare(engine["shareState"]());
    expect(link, "the showcase's link carries the player's cars").toContain(`cars=${PICK}`);
    engine["setScene"]("fleet");
    engine["applyShare"](decodeShare("#"), false);
    engine["applyShare"](decodeShare(`#${link}`), false);
    expect(engine["sceneId"], "the link opened the showcase").toBe("showcase");
    engine["setScene"]("fleet");
    fleetCars("showcase link");
  });

  it("when the cars slider moves in the Lab, the garage or the showcase, then their own field stands and the fleet has the slider's pick on leaving", () => {
    for (const scene of ["lab", "garage", "showcase"] as const) {
      fleet();
      engine["setScene"](scene);
      const own = engine["carCount"];
      engine.setCarCount(PICK + 2);
      expect(engine["carCount"], `${scene}'s own field`).toBe(own);
      engine["setScene"]("fleet");
      fleetCars(`slider in ${scene}`);
    }
  });

  it("when Defaults is pressed in the range, the Lab, the garage or the showcase, then the fleet is back with the default cars and none of them is left a scene's own", () => {
    for (const scene of ["range", "lab", "garage", "showcase"] as const) {
      fleet();
      engine["setScene"](scene);
      engine.resetDefaults();
      expect(engine["sceneId"], `Defaults from ${scene}: the scene`).toBe("fleet");
      expect(engine["live"]().length, `Defaults from ${scene}: the cars`).toBe(INITIAL_HUD.carCount);
      expect(engine["sandboxCars"], `Defaults from ${scene}: the player's field`).toBe(INITIAL_HUD.carCount);
    }
  });

  it("when the car was driven in the fleet and the showcase is entered, then no seat is on a car in the showcase", () => {
    fleet();
    engine["seat"].focus(0);
    engine["seat"].mode = "drive";
    engine["setScene"]("showcase");
    runSeconds(engine, 0.1);
    expect(engine["seat"].mode, "the seat's mode").toBe("global");
    expect(engine["seat"].carIndex, "the seat's car").toBe(-1);
  });

  it("when a scene left its own lens set (on foot, a scene shot) and another scene is picked, then the new scene starts on the base lens", () => {
    for (const [from, to] of [["derby", "fleet"], ["fleet", "range"], ["showcase", "fleet"]] as const) {
      engine["setScene"](from);
      runSeconds(engine, 0.1);
      engine["view"].setLens(28);
      engine["setScene"](to);
      runSeconds(engine, 0.1);
      expect(engine["view"]["sceneFov"], `${from} to ${to}: the lens a scene set`).toBe(null);
    }
  });
});
