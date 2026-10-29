import { afterAll, beforeAll, describe, it } from "vitest";
import assert from "node:assert/strict";
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
    assert.deepEqual(camKeys(), [], "no camera key at the defaults");
    engine.setKnob("cam.pos.lon", 12);
    assert.equal(CHASE.pos.lon, 12, "the camera's own value");
    assert.equal(hud.get()["cam.pos.lon"], 12, "the HUD field");
    assert.deepEqual(changedSettings(hud.get(), "debug"), ["cam.pos.lon"], "the dot, the count and the reset chip");
    assert.deepEqual(camKeys(), ["cam.pos.lon=12"], "the share URL key");
    engine.resetSetting("cam.pos.lon");
    assert.equal(CHASE.pos.lon, INITIAL_HUD["cam.pos.lon"], "reset: the camera's value");
    assert.deepEqual(changedSettings(hud.get(), "debug"), [], "reset: nothing changed");
    assert.deepEqual(camKeys(), [], "reset: the key is dropped");
  });

  it("when a slider is set past its range, then it clamps to the range", () => {
    engine.setKnob("cam.zeta.lat", 0);
    assert.equal(CHASE.zeta.lat, 0.3);
    engine.resetSetting("cam.zeta.lat");
  });

  it("when a link carrying camera keys is applied, then each slider takes its value, a key left out is the default, and Defaults puts every slider back", () => {
    engine["applyShare"](decodeShare("#cam.landing.hold=1.2&cam.driftLean=0.1"), false);
    assert.equal(CHASE.landing.hold, 1.2);
    assert.deepEqual(changedSettings(hud.get(), "debug"), ["cam.driftLean", "cam.landing.hold"]);
    engine["applyShare"](decodeShare("#cam.landing.hold=1.2"), false);
    assert.deepEqual(changedSettings(hud.get(), "debug"), ["cam.landing.hold"], "driftLean left out of the link: back to its default");
    engine.resetDefaults();
    assert.deepEqual(changedSettings(hud.get(), "debug"), [], "Defaults: no slider changed");
    for (const k of CHASE_KNOBS) assert.equal(k.get(), INITIAL_HUD[k.id], `${k.id} is at its default`);
    assert.deepEqual(camKeys(), []);
  });

  it("when a link carrying the epicenter keys is applied, then the activation and its thresholds take them, a link without them puts them back, and #epi.on=0 is the whole of what turns it off", () => {
    engine["applyShare"](decodeShare("#epi.on=0&epi.relockHold=0.5"), false);
    assert.equal(EPICENTER.on, 0, "on");
    assert.equal(EPICENTER.relockHold, 0.5, "relockHold");
    assert.deepEqual(changedSettings(hud.get(), "debug"), ["epi.relockHold"], "the Debug views list the threshold, not the activation");
    assert.deepEqual(changedSettings(hud.get(), "tuning"), ["epi.on"], "Cars & crash lists the activation beside Solver");
    assert.equal(SETTINGS["epi.on"].label, "Activation");
    assert.deepEqual(
      encodeShare(engine["shareState"]()).split("&").filter((kv) => kv.startsWith("epi.")),
      ["epi.on=0", "epi.relockHold=0.5"],
      "the share URL carries them, so the bar the engine writes keeps them through a race start",
    );
    engine["applyShare"](decodeShare("#"), false);
    for (const [i, k] of EPICENTER_KNOBS.entries()) assert.equal(k.get(), EPICENTER_AT_LOAD[i], `${k.id} back to its default`);
  });

  it("when a camera preset is applied, then every value it names is on the camera, the HUD and the share URL in one publish, Default puts today's values back, and a link carrying the preset's keys picks the same preset", () => {
    for (const p of CAMERA_PRESETS) {
      engine.setKnobs({ "cam.pos.lon": 14, "cam.shake": 2 });
      engine.setKnobs(cameraPresetValues(p));
      for (const [id, want] of Object.entries(cameraPresetValues(p))) {
        assert.equal(hud.get()[id as ChaseKnobId], want, `${p.label}: ${id} on the HUD`);
      }
      assert.equal(activeCameraPreset(hud.get()), p, `${p.label} is the one the HUD reads as picked`);
      for (const k of CHASE_KNOBS) assert.equal(k.get(), cameraPresetValues(p)[k.id], `${p.label}: ${k.id} on the camera`);
      const link = encodeShare(engine["shareState"]());
      engine.resetDefaults();
      engine["applyShare"](decodeShare(`#${link}`), false);
      assert.equal(activeCameraPreset(hud.get()), p, `${p.label}: restored from its link (${link})`);
    }
    engine.setKnobs(cameraPresetValues(CAMERA_PRESETS[0]!));
    assert.deepEqual(changedSettings(hud.get(), "debug"), [], "Default: nothing changed");
    assert.deepEqual(camKeys(), [], "Default: no camera key in the URL");
    engine.resetDefaults();
  });

  it("when the activation toggle's knob (epi.on) is set, then the HUD field the toggle reads follows, the link carries it, and a link restores it", () => {
    engine.setKnob("epi.on", 0);
    assert.equal(hud.get()["epi.on"], 0);
    assert.equal(EPICENTER.on, 0);
    assert.match(encodeShare(engine["shareState"]()), /(^|&)epi\.on=0(&|$)/);
    engine.resetDefaults();
    assert.equal(hud.get()["epi.on"], 1, "Defaults: epicenter");
    engine["applyShare"](decodeShare("#epi.on=0"), false);
    assert.equal(hud.get()["epi.on"], 0, "the link");
    engine["applyShare"](decodeShare("#"), false);
    assert.equal(hud.get()["epi.on"], 1);
  });
});
