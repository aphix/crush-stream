import { afterAll, beforeAll, describe, expect, it } from "vitest";
import "../kernel/rapier-node.test-util.ts";
import { HudStore, INITIAL_HUD } from "../hud/hud-store.ts";
import { changedSettings, SETTINGS } from "../hud/settings-changes.ts";
import { decodeShare, encodeShare } from "../hud/share-url.ts";
import { CHASE, CHASE_KNOBS, type ChaseKnobId } from "../present/drive-cam.ts";
import { activeCameraPreset, CAMERA_PRESETS, cameraPresetValues } from "../hud/camera-presets.ts";
import { EPICENTER, EPICENTER_KNOBS } from "../deform/epicenter.ts";
import { EPICENTER_AT_LOAD } from "../deform/epicenter.test-util.ts";
import { setGround } from "../world/ground.ts";
import type { CrashEngine } from "./engine.ts";
import { bootEngine, stubBrowser } from "./engine-headless.test-util.ts";
import { firstMismatch } from "../kernel/compare-arrays.test-util.ts";

describe("given the real engine and a camera slider of the debug panel", () => {
  // One engine for the file: a second `CrashEngine` in the same process never resolves `ready`.
  let engine: CrashEngine;
  let hud: HudStore;
  const camKeys = (): string[] =>
    encodeShare(engine["shareState"]())
      .split("&")
      .filter((kv) => kv.startsWith("cam."));
  beforeAll(async () => {
    stubBrowser();
    hud = new HudStore();
    engine = await bootEngine({ hud, fades: true });
  });
  afterAll(() => {
    engine.dispose();
    setGround(null);
  });

  it("when a slider is moved, then the camera reads it, the HUD shows it changed, the share state carries its key, and its reset puts all of that back", () => {
    expect(camKeys(), "no camera key at the defaults").toHaveLength(0);
    engine.setKnob("cam.pos.lon", 12);
    expect(CHASE.pos.lon, "the camera's own value").toBe(12);
    expect(hud.get()["cam.pos.lon"], "the HUD field").toBe(12);
    expect(firstMismatch(changedSettings(hud.get(), "debug"), ["cam.pos.lon"]), "the dot, the count and the reset chip").toBeUndefined();
    expect(firstMismatch(camKeys(), ["cam.pos.lon=12"]), "the share URL key").toBeUndefined();
    engine.resetSetting("cam.pos.lon");
    expect(CHASE.pos.lon, "reset: the camera's value").toBe(INITIAL_HUD["cam.pos.lon"]);
    expect(changedSettings(hud.get(), "debug"), "reset: nothing changed").toHaveLength(0);
    expect(camKeys(), "reset: the key is dropped").toHaveLength(0);
  });

  it("when a slider is set past its range, then it clamps to the range", () => {
    engine.setKnob("cam.zeta.lat", 0);
    expect(CHASE.zeta.lat).toBe(0.3);
    engine.resetSetting("cam.zeta.lat");
  });

  it("when a link carrying camera keys is applied, then each slider takes its value, a key left out is the default, and Defaults puts every slider back", () => {
    engine["applyShare"](decodeShare("#cam.landing.hold=1.2&cam.driftLean=0.1"), false);
    expect(CHASE.landing.hold).toBe(1.2);
    expect(firstMismatch(changedSettings(hud.get(), "debug"), ["cam.driftLean", "cam.landing.hold"])).toBeUndefined();
    engine["applyShare"](decodeShare("#cam.landing.hold=1.2"), false);
    expect(firstMismatch(changedSettings(hud.get(), "debug"), ["cam.landing.hold"]), "driftLean left out of the link: back to its default").toBeUndefined();
    engine.resetDefaults();
    expect(changedSettings(hud.get(), "debug"), "Defaults: no slider changed").toHaveLength(0);
    for (const k of CHASE_KNOBS) expect(k.get(), `${k.id} is at its default`).toBe(INITIAL_HUD[k.id]);
    expect(camKeys()).toHaveLength(0);
  });

  it("when a link carrying the epicenter keys is applied, then the activation and its thresholds take them, a link without them puts them back, and #epi.on=0 is the whole of what turns it off", () => {
    engine["applyShare"](decodeShare("#epi.on=0&epi.relockHold=0.5"), false);
    expect(EPICENTER.on, "on").toBe(0);
    expect(EPICENTER.relockHold, "relockHold").toBe(0.5);
    expect(firstMismatch(changedSettings(hud.get(), "debug"), ["epi.relockHold"]), "the Debug views list the threshold, not the activation").toBeUndefined();
    expect(firstMismatch(changedSettings(hud.get(), "tuning"), ["epi.on"]), "Cars & crash lists the activation beside Solver").toBeUndefined();
    expect(SETTINGS["epi.on"].label).toBe("Activation");
    expect(firstMismatch(encodeShare(engine["shareState"]()).split("&").filter((kv) => kv.startsWith("epi.")), ["epi.on=0", "epi.relockHold=0.5"]), "the share URL carries them, so the bar the engine writes keeps them through a race start").toBeUndefined();
    engine["applyShare"](decodeShare("#"), false);
    for (const [i, k] of EPICENTER_KNOBS.entries()) expect(k.get(), `${k.id} back to its default`).toBe(EPICENTER_AT_LOAD[i]);
  });

  it("when a camera preset is applied, then every value it names is on the camera, the HUD and the share URL in one publish, Default puts today's values back, and a link carrying the preset's keys picks the same preset", () => {
    for (const p of CAMERA_PRESETS) {
      engine.setKnobs({ "cam.pos.lon": 14, "cam.shake": 2 });
      engine.setKnobs(cameraPresetValues(p));
      for (const [id, want] of Object.entries(cameraPresetValues(p))) {
        expect(hud.get()[id as ChaseKnobId], `${p.label}: ${id} on the HUD`).toBe(want);
      }
      expect(activeCameraPreset(hud.get()), `${p.label} is the one the HUD reads as picked`).toBe(p);
      for (const k of CHASE_KNOBS) expect(k.get(), `${p.label}: ${k.id} on the camera`).toBe(cameraPresetValues(p)[k.id]);
      const link = encodeShare(engine["shareState"]());
      engine.resetDefaults();
      engine["applyShare"](decodeShare(`#${link}`), false);
      expect(activeCameraPreset(hud.get()), `${p.label}: restored from its link (${link})`).toBe(p);
    }
    engine.setKnobs(cameraPresetValues(CAMERA_PRESETS[0]!));
    expect(changedSettings(hud.get(), "debug"), "Default: nothing changed").toHaveLength(0);
    expect(camKeys(), "Default: no camera key in the URL").toHaveLength(0);
    engine.resetDefaults();
  });

  it("when the activation toggle's knob (epi.on) is set, then the HUD field the toggle reads follows, the link carries it, and a link restores it", () => {
    engine.setKnob("epi.on", 0);
    expect(hud.get()["epi.on"]).toBe(0);
    expect(EPICENTER.on).toBe(0);
    expect(encodeShare(engine["shareState"]())).toMatch(/(^|&)epi\.on=0(&|$)/);
    engine.resetDefaults();
    expect(hud.get()["epi.on"], "Defaults: epicenter").toBe(1);
    engine["applyShare"](decodeShare("#epi.on=0"), false);
    expect(hud.get()["epi.on"], "the link").toBe(0);
    engine["applyShare"](decodeShare("#"), false);
    expect(hud.get()["epi.on"]).toBe(1);
  });
});
