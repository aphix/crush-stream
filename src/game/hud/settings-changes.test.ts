import { describe, expect, it } from "vitest";
import { INITIAL_HUD, type CrashHudState } from "./hud-store.ts";
import { changedSettings, isChanged, SETTING_IDS, SETTINGS, type SettingId } from "./settings-changes.ts";
import { DRIVER_CARS } from "../match/types.ts";
import { KNOBS, type KnobId } from "./knobs.ts";
import { firstMismatch } from "../kernel/compare-arrays.test-util.ts";

/** The menu after the user moved a Cinematic FX pick (Auto off) and the crumple stroke. */
const touched: CrashHudState = { ...INITIAL_HUD, fxAuto: false, fxTier: "high", squash: 0.2 };
/** What putting setting `id` back to its default does to the HUD state: its own fields go back, nothing else moves. */
const reset = (s: CrashHudState, id: SettingId): CrashHudState => ({ ...s, ...SETTINGS[id].defaults });

describe("given the settings menu, where each setting is a group of HUD fields with its own defaults and its own reset", () => {
  it("when the menu is untouched, then no setting reads as changed", () => {
    expect(changedSettings(INITIAL_HUD)).toHaveLength(0);
  });

  it("when a Cinematic FX pick and the crumple stroke are changed, then each changed setting is marked and counted in its own section only", () => {
    expect(firstMismatch(changedSettings(touched), ["fx", "stroke"])).toBeUndefined();
    expect(firstMismatch(changedSettings(touched, "playback"), ["fx"])).toBeUndefined();
    expect(firstMismatch(changedSettings(touched, "tuning"), ["stroke"])).toBeUndefined();
    expect(changedSettings(touched, "driving")).toHaveLength(0);
    expect(changedSettings(touched, "debug")).toHaveLength(0);
  });

  it("when the FX setting is reset on its own or the stroke setting is, then only that setting is restored and the other stays changed", () => {
    const afterFx = reset(touched, "fx");
    expect(firstMismatch(changedSettings(afterFx), ["stroke"])).toBeUndefined();
    expect(afterFx.squash).toBe(0.2);
    const afterStroke = reset(touched, "stroke");
    expect(firstMismatch(changedSettings(afterStroke), ["fx"])).toBeUndefined();
    expect(afterStroke.fxAuto).toBe(false);
    expect(afterStroke.fxTier).toBe("high");
  });

  it("when Rumble is switched off, then it reads as a changed Driving setting alone, and on by default", () => {
    expect(INITIAL_HUD.rumble).toBe(true);
    const off: CrashHudState = { ...INITIAL_HUD, rumble: false };
    expect(firstMismatch(changedSettings(off), ["rumble"])).toBeUndefined();
    expect(firstMismatch(changedSettings(off, "driving"), ["rumble"])).toBeUndefined();
    expect(changedSettings(reset(off, "rumble"))).toHaveLength(0);
  });

  it("when audio is switched on and the music and engine volumes are moved, then all three read as changed Audio settings, none as Playback ones, and each resets on its own", () => {
    const sound: CrashHudState = { ...INITIAL_HUD, audioOn: true, musicVolume: 0.4, engineVolume: 0.6 };
    expect(firstMismatch(changedSettings(sound, "audio"), ["audio", "music", "engines"])).toBeUndefined();
    expect(changedSettings(sound, "playback")).toHaveLength(0);
    expect(firstMismatch(changedSettings(reset(sound, "audio"), "audio"), ["music", "engines"])).toBeUndefined();
    expect(firstMismatch(changedSettings(reset(sound, "music"), "audio"), ["audio", "engines"])).toBeUndefined();
    expect(firstMismatch(changedSettings(reset(sound, "engines"), "audio"), ["audio", "music"])).toBeUndefined();
  });

  it("when the fields each setting resets are listed, then every setting resets on its own and no two settings share a field", () => {
    const owner = new Map<string, SettingId>();
    for (const id of SETTING_IDS) {
      for (const k of Object.keys(SETTINGS[id].defaults)) {
        expect(owner.get(k), `${k} is owned by ${owner.get(k)} and ${id}`).toBe(undefined);
        owner.set(k, id);
      }
    }
  });

  it("when every setting is changed and then each is reset in turn, then each reads as unchanged right after its reset and the menu ends as the defaults", () => {
    const camera: Partial<Record<KnobId, number>> = {};
    for (const k of KNOBS) camera[k.id] = INITIAL_HUD[k.id] === k.max ? k.min : k.max;
    const all: CrashHudState = {
      ...INITIAL_HUD,
      looping: !INITIAL_HUD.looping,
      autoSlomo: !INITIAL_HUD.autoSlomo,
      autoRotate: !INITIAL_HUD.autoRotate,
      audioOn: true,
      night: true,
      wet: true,
      sky: "off",
      fxAuto: false,
      celLook: 0.4,
      proceduralSky: 0.35,
      halftone: 0.5,
      hatching: 0.4,
      rimLight: 0.6,
      materialStrength: 0.5,
      contourStrength: 1.5,
      candyStrength: 0.5,
      userTimeScale: 0.5,
      playerCar: "truck",
      realism: 0.9,
      rumble: false,
      boostZoom: false,
      carCount: 9,
      speedMin: 3,
      speedMax: 40,
      squash: 0.2,
      buckle: 0.9,
      fxDensity: 0.3,
      musicVolume: 0.2,
      engineVolume: 0.8,
      deformMode: "lattice",
      showRig: true,
      showParticles: true,
      captureTrace: true,
      ...camera,
    };
    let s = all;
    const order = changedSettings(s);
    expect(order.length, "every setting differs in this state").toBe(SETTING_IDS.length);
    for (const id of order) {
      s = reset(s, id);
      expect(isChanged(s, id), id).toBe(false);
    }
    expect(changedSettings(s)).toHaveLength(0);
  });

  it("when a slider is a hair off its default or a scene's own value differs, then a slider within a hair of its default is not changed, a real change is, and the range's one car is the scene's and not counted", () => {
    expect(isChanged({ ...INITIAL_HUD, squash: INITIAL_HUD.squash + 1e-6 }, "stroke")).toBe(false);
    expect(isChanged({ ...INITIAL_HUD, squash: INITIAL_HUD.squash + 0.01 }, "stroke")).toBe(true);
    const range = { ...INITIAL_HUD, carCount: 1, range: { distance: null, landed: false } };
    expect(isChanged(range, "cars"), "the range's one car is the scene's").toBe(false);
    expect(isChanged({ ...INITIAL_HUD, carCount: 1 }, "cars")).toBe(true);
  });

  it("when the Clouds row's Picture is picked, then it reads as changed (the procedural sky is the default), and its reset brings the default cover back", () => {
    expect(isChanged(INITIAL_HUD, "psky")).toBe(false);
    const picture = { ...INITIAL_HUD, proceduralSky: null };
    expect(firstMismatch(changedSettings(picture), ["psky"])).toBeUndefined();
    expect(reset(picture, "psky").proceduralSky).toBe(INITIAL_HUD.proceduralSky);
  });

  it("when a camera slider is moved off its default or only a hair off, then it is a changed Debug setting only when moved, and resetting it clears it", () => {
    expect(isChanged({ ...INITIAL_HUD, "cam.pos.lon": INITIAL_HUD["cam.pos.lon"] + 1e-6 }, "cam.pos.lon")).toBe(false);
    const moved = { ...INITIAL_HUD, "cam.pos.lon": INITIAL_HUD["cam.pos.lon"] + 1 };
    expect(firstMismatch(changedSettings(moved), ["cam.pos.lon"])).toBeUndefined();
    expect(firstMismatch(changedSettings(moved, "debug"), ["cam.pos.lon"])).toBeUndefined();
    expect(changedSettings(moved, "playback")).toHaveLength(0);
    expect(changedSettings(reset(moved, "cam.pos.lon"))).toHaveLength(0);
  });
});

describe("given the settings menu's Car pick", () => {
  for (const car of DRIVER_CARS) {
    const changed = car.id !== INITIAL_HUD.playerCar;
    it(`when the ${car.label} is picked, then the Car setting reads as ${changed ? "changed" : "unchanged"}`, () => {
      expect(isChanged({ ...INITIAL_HUD, playerCar: car.id }, "car")).toBe(changed);
    });
  }
});
