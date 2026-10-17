import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import "../kernel/rapier-node.test-util.ts";
import { HudStore, INITIAL_HUD } from "../hud/hud-store.ts";
import { changedSettings } from "../hud/settings-changes.ts";
import { decodeShare, encodeShare } from "../hud/share-url.ts";
import { CHASE, CHASE_KNOBS } from "../present/drive-cam.ts";
import { EPICENTER, EPICENTER_KNOBS } from "../deform/epicenter.ts";
import { EPICENTER_AT_LOAD } from "../deform/epicenter.test-util.ts";
import { setGround } from "../world/ground.ts";
import { CrashEngine } from "./engine.ts";
import { element, stubBrowser } from "./engine-headless.test-util.ts";

describe("given the real engine and a camera slider of the debug panel", () => {
  // One engine for the file: a second `CrashEngine` in the same process never resolves `ready`.
  let engine: CrashEngine;
  let hud: HudStore;
  const camKeys = (): string[] =>
    encodeShare(engine["shareState"]())
      .split("&")
      .filter((kv) => kv.startsWith("cam."));
  before(async () => {
    stubBrowser();
    hud = new HudStore();
    engine = new CrashEngine(element(), hud, element());
    Object.assign(engine["renderer"], { render() {}, compile() {}, compileAsync: () => Promise.resolve() });
    await engine.ready;
  });
  after(() => {
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

  it("when a link carrying the epicenter keys is applied, then the activation and its thresholds take them, a link without them puts them back, and the phone's #epi.on=1 is the whole of what turns it on", () => {
    engine["applyShare"](decodeShare("#epi.on=1&epi.relockHold=0.5"), false);
    assert.equal(EPICENTER.on, 1, "on");
    assert.equal(EPICENTER.relockHold, 0.5, "relockHold");
    assert.deepEqual(changedSettings(hud.get(), "debug"), ["epi.on", "epi.relockHold"], "the dots");
    assert.deepEqual(
      encodeShare(engine["shareState"]()).split("&").filter((kv) => kv.startsWith("epi.")),
      ["epi.on=1", "epi.relockHold=0.5"],
      "the share URL carries them, so the bar the engine writes keeps them through a race start",
    );
    engine["applyShare"](decodeShare("#"), false);
    for (const [i, k] of EPICENTER_KNOBS.entries()) assert.equal(k.get(), EPICENTER_AT_LOAD[i], `${k.id} back to its default`);
  });
});
