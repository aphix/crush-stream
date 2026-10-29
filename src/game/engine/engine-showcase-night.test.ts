import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as THREE from "three";
import "../kernel/rapier-node.test-util.ts";
import { setGround } from "../world/ground.ts";
import type { CrashEngine } from "./engine.ts";
import { runSeconds, bootEngine, stubBrowser } from "./engine-headless.test-util.ts";

/** The showcase's light posts and its cars' lamps at night: lit only there, and only at night. */

const POST_COUNT = 4;
/** The stand-in canvas is 800 x 600 but is never laid out: the camera's aspect and view box are NaN until set. */
const STUB_ASPECT = 800 / 600;
/** Frames the lamps' fade takes to reach full weight (`FADE_S`), with margin. */
const FADE_SECONDS = 1;

describe("given the real engine booted on the sandbox, its Night toggle and the showcase", () => {
  let engine: CrashEngine;
  /** The lights three would light the scene with: the visible ones only, as `projectObject` counts them. */
  const litLights = (): THREE.Light[] => {
    const lights: THREE.Light[] = [];
    engine["scene"].traverseVisible((o) => {
      if (o instanceof THREE.Light) lights.push(o);
    });
    return lights;
  };
  const postLights = (): THREE.SpotLight[] => engine["showcase"]!.art["postLights"];
  const headSpotsLit = (): number => engine["lampLights"].spots.filter((s: THREE.SpotLight) => s.intensity > 0).length;
  const visit = (scene: "fleet" | "showcase", night: boolean): void => {
    if (engine["sceneId"] !== scene) engine["setScene"](scene);
    if (scene === "showcase") {
      engine["frameShowcase"]();
      engine["camera"].aspect = STUB_ASPECT;
      engine["camera"].clearViewOffset();
    }
    engine.setNight(night);
    runSeconds(engine, FADE_SECONDS);
  };

  beforeAll(async () => {
    stubBrowser();
    globalThis.location.hash = "";
    engine = await bootEngine();
    await engine["ragdolls"].preload();
    runSeconds(engine, 0.5);
  });
  afterAll(() => {
    engine.dispose();
    setGround(null);
  });

  it("when the sandbox is lit at night and then the showcase is entered and left, then the showcase adds exactly its posts' spots while it is up, burning, and the sandbox ends with the lights it began with", () => {
    visit("fleet", true);
    const sandboxLights = litLights().length;
    visit("showcase", true);
    expect(litLights().length, "the showcase adds exactly its posts' spots").toBe(sandboxLights + POST_COUNT);
    expect(postLights().filter((light) => light.intensity > 0 && litLights().includes(light)).length, "every post's spot is in the lit set and burning").toBe(POST_COUNT);
    visit("fleet", true);
    expect(litLights().length, "back in the sandbox at night: no light added").toBe(sandboxLights);
    expect(postLights().filter((light) => litLights().includes(light)).length, "no post's spot is in the scene's lit set").toBe(0);
  });

  it("when the showcase is up by day, then its posts' spots and the cars' headlamp spots are dark, and at night the posts burn and the cars' headlamps light with real spots and glow", () => {
    engine["lampLights"].middleTile = true;
    visit("showcase", false);
    expect(postLights().filter((light) => light.intensity > 0).length, "no post spot burns by day").toBe(0);
    expect(headSpotsLit(), "no headlamp spot by day").toBe(0);
    visit("showcase", true);
    expect(postLights().filter((light) => light.intensity > 0).length, "every post spot burns at night").toBe(POST_COUNT);
    expect(headSpotsLit(), "the showcase cars' headlamps cast real light at night").toBeGreaterThan(0);
    expect(engine["lampLights"].glow.geometry.drawRange.count, "every car's lamps glow at night").toBeGreaterThanOrEqual(engine["showcase"]!.cars.length);
  });

  it("when a scene other than the showcase has its cars' lamps updated at night, then the podium's cars stay out of the lamp lights", () => {
    visit("fleet", true);
    const podiumCar = engine["showcase"]!.cars[0]!;
    const seen: unknown[] = [];
    const lampLights = engine["lampLights"];
    const update = lampLights.update.bind(lampLights);
    lampLights.update = (...args: Parameters<typeof update>) => {
      seen.push(...args[0]);
      return update(...args);
    };
    engine["podium"].cars = () => [podiumCar];
    runSeconds(engine, 0.2);
    lampLights.update = update;
    expect(seen.length, "the control: the lamp lights were updated").toBeGreaterThan(0);
    expect(seen.includes(podiumCar), "the podium's car is not among the cars the sandbox lights").toBe(false);
  });
});
