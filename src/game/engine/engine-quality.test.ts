import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type * as THREE from "three";
import "../kernel/rapier-node.test-util.ts";
import { AI_EVERY_SLICE } from "../ai/constants.ts";
import { HudStore } from "../hud/hud-store.ts";
import { TIME_OF_DAY } from "../match/types.ts";
import { TRACK_ID } from "../world/constants.ts";
import { setGround } from "../world/ground.ts";
import { parseTrack } from "../world/track-schema.ts";
import city from "../world/tracks/city.json" with { type: "json" };
import type { CrashEngine } from "./engine.ts";
import { runSeconds, bootEngine, stubBrowser } from "./engine-headless.test-util.ts";


/** The sandbox's far plane (m) and fog density as a fresh page builds them (`CrashEngine`'s constructor). */
const SANDBOX_FAR = 180;
const SANDBOX_FOG = 0.008;
/** What Draw distance far and max multiply the scene's far plane (and divide its fog density) by. */
const FAR_REACH = 1.5;
const MAX_REACH = 2;

/** The city's own far plane and fog density, from its environment (defaults 900 m and 0.0035 where the course leaves them out). */
const COURSE = parseTrack(city).environment;

describe("given the real engine on a page whose URL says ?draw=max&scale=1.5&shadow=high", () => {
  // One engine for the file: a second `CrashEngine` in the same process never resolves `ready`.
  let engine: CrashEngine;
  let hud: HudStore;
  /** The far plane (m) and fog density the view is drawn with now. */
  const view = (): string => `${engine["camera"].far} ${(engine["scene"].fog as THREE.FogExp2).density}`;
  /** The sun's shadow map edge (texels) and its box's half width (m). */
  const sunShadow = (): string => `${engine["sun"].shadow.mapSize.x} ${engine["sun"].shadow.camera.right}`;
  /** The knobs in force: far plane, pixel ratio, sun map edge, and the FX tier's Auto. */
  const inForce = (): string => `${engine["camera"].far} ${engine["quality"].pixelRatio} ${engine["sun"].shadow.mapSize.x} ${engine["autoFx"].auto}`;

  beforeAll(async () => {
    stubBrowser();
    Object.assign(globalThis, { location: { pathname: "/", search: "?draw=max&scale=1.5&shadow=high", hash: "", href: "http://x/", origin: "http://x" } });
    hud = new HudStore();
    engine = await bootEngine({ hud });
  });
  afterAll(() => {
    engine.dispose();
    setGround(null);
  });

  it("when it is up, then those knobs are in force and the FX tier is still Auto", () => {
    expect(inForce()).toBe("360 1.5 2048 true");
  });

  it("when the bench starts a step over and the automatic quality is reset, then the URL's draw, scale and shadow settings stay in force", () => {
    engine.resetAdaptiveQuality();
    expect(inForce()).toBe("360 1.5 2048 true");
    expect(engine["quality"].pinnedKnobs).toBe("draw scale shadow");
  });

  it("when the player picks far, 2 and max, then each is in force and the FX tier's Auto stays on", () => {
    engine.setDrawDistance("far");
    engine.setRenderScale("2");
    engine.setShadows("max");
    expect(`${engine["camera"].far} ${engine["quality"].pixelRatio} ${engine["sun"].shadow.mapSize.x} | ${engine["autoFx"].auto} ${hud.get().fxAuto}`).toBe("270 2 4096 | true true");
  });

  it("when Draw distance is far, a race loads its course, the player switches to max mid-race and leaves, then the course draws at its far × 1.5 then × 2 and the sandbox comes back at 180 × 2 with its fog at 0.008 / 2", () => {
    expect(COURSE.far, "the control: the course's far plane is not the sandbox's").not.toBe(SANDBOX_FAR);
    engine.toggleRace();
    engine.raceCommand({ type: "program", options: { trackId: TRACK_ID.city, laps: 1, aiCount: 3, police: false, aggression: 0.5, aiDifficulty: AI_EVERY_SLICE, spectate: false, noReset: false, timeOfDay: TIME_OF_DAY.day } });
    engine.raceCommand({ type: "start" });
    runSeconds(engine, 1);
    expect(view(), "the course at far").toBe(`${COURSE.far * FAR_REACH} ${COURSE.fog / FAR_REACH}`);
    engine.setDrawDistance("max");
    expect(view(), "the course at max, mid-race").toBe(`${COURSE.far * MAX_REACH} ${COURSE.fog / MAX_REACH}`);
    engine["setScene"]("fleet");
    runSeconds(engine, 1);
    expect(view(), "the sandbox at max, from its authored 180 m and 0.008").toBe(`${SANDBOX_FAR * MAX_REACH} ${SANDBOX_FOG / MAX_REACH}`);
  });

  it("when Shadows are max and Ultra raises the sun's map to 2048 and goes off, then the map stays 4096 and the box ±48 m; and at Auto, Ultra's 2048 holds while it is on and 1024 comes back when it is off", () => {
    const stage = engine["stage"];
    engine.setShadows("max");
    stage.setUltraShadow(2048);
    expect(sunShadow(), "max, Ultra on").toBe("4096 48");
    stage.setUltraShadow(0);
    expect(sunShadow(), "max, Ultra off").toBe("4096 48");
    engine.setShadows("auto");
    stage.setUltraShadow(2048);
    expect(sunShadow(), "auto, Ultra on").toBe("2048 24");
    stage.setUltraShadow(0);
    expect(sunShadow(), "auto, Ultra off").toBe("1024 24");
  });
});
