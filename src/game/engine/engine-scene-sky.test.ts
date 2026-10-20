import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import "../kernel/rapier-node.test-util.ts";
import { AI_EVERY_SLICE } from "../ai/constants.ts";
import { HudStore, INITIAL_HUD } from "../hud/hud-store.ts";
import { TIME_OF_DAY, type TimeOfDay } from "../match/types.ts";
import { SKY_DRAWN, SKY_LOOKS } from "../present/sky-dome.ts";
import { PROCEDURAL_LOOKS, SANDBOX_SKY, type ProceduralLook, type SkyStops } from "../present/sky-procedural.ts";
import type { SceneId } from "../scenes/scene-id.ts";
import { TRACK_ID } from "../world/constants.ts";
import { setGround } from "../world/ground.ts";
import { CrashEngine } from "./engine.ts";
import { element, stubBrowser } from "./engine-headless.test-util.ts";
import { FRAME_HZ } from "../kernel/constants.ts";

const FRAME = 1 / FRAME_HZ;

/** Race, then the scene picked after it: a race's time of day and night toggle leave the sandbox scene as a fresh page has it. */
const cases = [
  { it: "a Mall race at sunset with Night toggled on in the settings goes to the fleet", trackId: TRACK_ID.nationalMall, timeOfDay: TIME_OF_DAY.sunset, nightToggled: true, next: "fleet" },
  { it: "a city race at sunset goes to the fleet", trackId: TRACK_ID.city, timeOfDay: TIME_OF_DAY.sunset, nightToggled: false, next: "fleet" },
  { it: "a Mall race by day (no change made) goes to the fleet", trackId: TRACK_ID.nationalMall, timeOfDay: TIME_OF_DAY.day, nightToggled: false, next: "fleet" },
  { it: "a city race at night goes to the corkscrew", trackId: TRACK_ID.city, timeOfDay: TIME_OF_DAY.night, nightToggled: false, next: "corkscrew" },
  { it: "a Mall race at sunset with Night toggled on goes to the derby", trackId: TRACK_ID.nationalMall, timeOfDay: TIME_OF_DAY.sunset, nightToggled: true, next: "derby" },
] as const satisfies readonly { it: string; trackId: string; timeOfDay: TimeOfDay; nightToggled: boolean; next: SceneId }[];

describe("given the real engine, its sandbox sky as a fresh page has it", () => {
  // One engine for the file: a second `CrashEngine` in the same process never resolves `ready`.
  let engine: CrashEngine;
  const stage = (): CrashEngine["stage"] => engine["stage"];
  const scene = (): THREE.Scene => engine["scene"];
  const run = (seconds: number): void => {
    for (let i = 0; i < seconds * 60; i++) engine.advance(FRAME, { frameDt: FRAME });
  };
  /** What the sandbox's sky is made of: the background and fog, the three lights, the night setting, the dome and the far plane. */
  const sandboxSky = (): Record<string, string | number | boolean> => {
    const fog = scene().fog as THREE.FogExp2;
    const { sun, sky } = stage();
    return {
      background: (scene().background as THREE.Color).getHexString(),
      fog: fog.color.getHexString(),
      fogDensity: fog.density,
      sun: `${sun.color.getHexString()} ${sun.intensity}`,
      hemisphere: `${stage()["hemi"].color.getHexString()} ${stage()["hemi"].intensity}`,
      fill: `${stage()["fill"].color.getHexString()} ${stage()["fill"].intensity}`,
      night: stage().night,
      time: String(stage().time),
      dome: sky.mesh.visible,
      far: engine["camera"].far,
    };
  };
  let fresh: Record<string, string | number | boolean>;
  let freshDrawn: number;

  before(async () => {
    stubBrowser();
    engine = new CrashEngine(element(), new HudStore(), element());
    Object.assign(engine["renderer"], { render() {}, compile() {}, compileAsync: () => Promise.resolve() });
    await engine.ready;
    engine.fadeScenes = false;
    run(1);
    fresh = sandboxSky();
    freshDrawn = stage().sky.drawn;
  });
  after(() => {
    engine.dispose();
    setGround(null);
  });

  for (const testCase of cases) {
    it(`when ${testCase.it}, then the scene's sky, fog, lights, night setting and far plane are as on a fresh load`, () => {
      engine.toggleRace();
      engine.raceCommand({ type: "program", options: { trackId: testCase.trackId, laps: 1, aiCount: 3, police: false, aggression: 0.5, aiDifficulty: AI_EVERY_SLICE, spectate: false, noReset: false, timeOfDay: testCase.timeOfDay } });
      engine.raceCommand({ type: "start" });
      run(3);
      const racing = sandboxSky();
      assert.notEqual(racing.background, fresh.background, "the race has its own sky (the control: the colours below are not trivially equal)");
      if (testCase.nightToggled) engine.setNight(true);
      engine["setScene"](testCase.next);
      run(1);
      const after = sandboxSky();
      for (const key of Object.keys(fresh)) assert.equal(after[key], fresh[key], `${key} after the race, in the ${testCase.next}`);
      engine["setScene"]("fleet");
    });
  }

  it("when a fresh engine runs under the Sky setting auto, then on the minimal tier it draws no sky (the studio's colour), and on high the default procedural sky, its background and fog that sky's horizon", () => {
    assert.equal(engine["cine"].tier, "minimal", "the control: a fresh page's tier");
    assert.equal(freshDrawn, SKY_DRAWN.off, "no sky on minimal");
    assert.equal(fresh.background, "12141a", "the studio's colour");
    engine.setFxTier("high");
    run(1);
    const procedural = sandboxSky();
    const horizon = new THREE.Color(SANDBOX_SKY.day.horizon).getHexString();
    assert.equal(stage().sky.drawn, SKY_DRAWN.procedural);
    assert.equal(stage().sky["mat"].uniforms.uCover!.value, INITIAL_HUD.proceduralSky);
    assert.equal(procedural.background, horizon);
    assert.equal(procedural.fog, horizon);
    stage().setProceduralSky(null);
    run(1);
    assert.equal(stage().sky.drawn, SKY_DRAWN.off, "the picture: the sandbox has none");
    assert.equal(sandboxSky().background, "12141a", "the picture: the studio's colour");
    stage().setProceduralSky(INITIAL_HUD.proceduralSky);
    engine.setFxTier("minimal");
    run(1);
    for (const key of Object.keys(fresh)) assert.equal(sandboxSky()[key], fresh[key], key);
  });

  /** The dome's stops, clouds, disc and stars as drawn, each beside the look it should take. */
  const assertDomeLook = (look: SkyStops & ProceduralLook, label: string): void => {
    const dome = stage().sky;
    const u = dome["mat"].uniforms;
    assert.equal(dome.drawn, SKY_DRAWN.procedural, `${label}: procedural`);
    for (const [key, uniform] of [["horizon", "horizonColor"], ["mid", "midColor"], ["zenith", "zenith"]] as const) assert.equal((u[uniform]!.value as THREE.Color).getHexString(), new THREE.Color(look[key]).getHexString(), `${label}: ${key}`);
    assert.equal(u.zenithEl!.value, look.zenithElevation, `${label}: zenith elevation`);
    assert.equal(dome["cloudLit"].getHexString(), new THREE.Color(look.cloudLit).getHexString(), `${label}: cloud lit`);
    assert.equal(dome["cloudShade"].getHexString(), new THREE.Color(look.cloudShade).getHexString(), `${label}: cloud shade`);
    assert.deepEqual(dome["discTint"].toArray(), [...look.discTint], `${label}: disc tint`);
    assert.equal(u.uStars!.value, look.stars ? 1 : 0, `${label}: stars`);
  };

  it("when the default procedural sky runs on high, then each race's dome takes its time of day's look (night: its stops, moon and stars on), and the sandbox's Night toggle the sandbox night look", () => {
    engine.setFxTier("high");
    for (const time of [TIME_OF_DAY.night, TIME_OF_DAY.sunset, TIME_OF_DAY.day]) {
      engine.toggleRace();
      engine.raceCommand({ type: "program", options: { trackId: TRACK_ID.city, laps: 1, aiCount: 3, police: false, aggression: 0.5, aiDifficulty: AI_EVERY_SLICE, spectate: false, noReset: false, timeOfDay: time } });
      engine.raceCommand({ type: "start" });
      run(1);
      assertDomeLook({ ...SKY_LOOKS[time], ...PROCEDURAL_LOOKS[time] }, time);
      engine["setScene"]("fleet");
      run(1);
    }
    assertDomeLook(SANDBOX_SKY.day, "sandbox day");
    engine.setNight(true);
    run(1);
    assertDomeLook(SANDBOX_SKY.night, "sandbox night");
    engine.setNight(false);
    engine.setFxTier("minimal");
    run(1);
  });
});
