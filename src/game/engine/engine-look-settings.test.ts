import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import "../kernel/rapier-node.test-util.ts";
import { HudStore, INITIAL_HUD, type CrashHudState } from "../hud/hud-store.ts";
import { isChanged, type SettingId } from "../hud/settings-changes.ts";
import { decodeShare, encodeShare, type ShareState } from "../hud/share-url.ts";
import { RIM_LIGHT } from "../present/rim-light.ts";
import { SKY_DRAWN } from "../present/sky-dome.ts";
import { settingsOf } from "./bench-measure.ts";
import { setGround } from "../world/ground.ts";
import { CrashEngine } from "./engine.ts";
import { element, stubBrowser } from "./engine-headless.test-util.ts";

type LookCase = {
  it: string;
  /** The settings menu's id (`SETTINGS`, `resetSetting`) and the share link's key. */
  id: SettingId;
  key: keyof ShareState;
  field: keyof CrashHudState;
  set: (e: CrashEngine, v: number | null) => void;
  /** What the effect's own sink reads (the dome's drawn state, the composite's drive, the shared uniform) with the look at 0.6 and with it off. */
  sink: (e: CrashEngine) => number;
  sinkOn: number;
  sinkOff: number;
  /** What a typed 0 becomes: the cloud cover's 0 is a clear procedural sky, the print looks' and the rim's 0 is off. */
  atZero: number | null;
};

const cases = [
  { it: "the procedural sky", id: "psky", key: "psky", field: "proceduralSky", set: (e, v) => e.setProceduralSky(v), sink: (e) => e["stage"].sky.drawn, sinkOn: SKY_DRAWN.procedural, sinkOff: SKY_DRAWN.off, atZero: 0 },
  { it: "the halftone dots", id: "halftone", key: "dots", field: "halftone", set: (e, v) => e.setHalftone(v), sink: (e) => e["cine"].post.dots, sinkOn: 0.6, sinkOff: 0, atZero: null },
  { it: "the pencil hatching", id: "hatch", key: "hatch", field: "hatching", set: (e, v) => e.setHatching(v), sink: (e) => e["cine"].post.hatch, sinkOn: 0.6, sinkOff: 0, atZero: null },
  { it: "the rim light", id: "rim", key: "rim", field: "rimLight", set: (e, v) => e.setRimLight(v), sink: () => RIM_LIGHT.value, sinkOn: 0.6, sinkOff: 0, atZero: null },
] as const satisfies readonly LookCase[];

describe("given the real engine and the look sliders under Cel in the Playback section", () => {
  // One engine for the file: a second `CrashEngine` in the same process never resolves `ready`.
  let engine: CrashEngine;
  let hud: HudStore;
  const keys = (): string[] => encodeShare(engine["shareState"]()).split("&");
  const keyOf = (key: keyof ShareState): string[] => keys().filter((kv) => kv.startsWith(`${key}=`));
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

  for (const c of cases) {
    it(`when ${c.it} is set, then its effect, the HUD field, the changed dot and the share key follow, and its reset puts all of that back`, () => {
      assert.equal(hud.get()[c.field], null, "off at the start");
      assert.equal(c.sink(engine), c.sinkOff, "its effect is off at the start");
      c.set(engine, 0.6);
      assert.equal(hud.get()[c.field], 0.6, "the HUD field");
      assert.equal(c.sink(engine), c.sinkOn, "the effect's own sink");
      assert.equal(isChanged(hud.get(), c.id), true, "the dot and the reset chip");
      assert.equal(keyOf(c.key).join("&"), `${c.key}=0.6`, "the share key");
      engine.resetSetting(c.id);
      assert.equal(hud.get()[c.field], null, "reset: the HUD field");
      assert.equal(c.sink(engine), c.sinkOff, "reset: the effect");
      assert.equal(isChanged(hud.get(), c.id), false, "reset: not changed");
      assert.deepEqual(keyOf(c.key), [], "reset: the key is dropped");
    });

    it(`when ${c.it} is set to 0, NaN, null or past its range, then 0 is ${c.atZero === null ? "off" : "a real value"}, an unreadable value and null are off, and a value past the range clamps to 1`, () => {
      c.set(engine, 0);
      assert.equal(hud.get()[c.field], c.atZero, "0");
      c.set(engine, Number.NaN);
      assert.equal(hud.get()[c.field], null, "NaN");
      c.set(engine, 7);
      assert.equal(hud.get()[c.field], 1, "past the range");
      c.set(engine, null);
      assert.equal(hud.get()[c.field], null, "null");
      assert.deepEqual(keyOf(c.key), [], "no key once off");
    });
  }

  it("when a link carrying the four keys is applied, then each look takes its value, a link without them puts them back, and Defaults clears all four from the HUD, the effects and the URL", () => {
    engine["applyShare"](decodeShare("#cel=0.5&psky=0.4&dots=0.5&hatch=0.3&rim=0.6"), false);
    for (const [c, v] of [[cases[0], 0.4], [cases[1], 0.5], [cases[2], 0.3], [cases[3], 0.6]] as const) assert.equal(hud.get()[c.field], v, c.id);
    assert.match(encodeShare(engine["shareState"]()), /(^|&)cel=0\.5&psky=0\.4&dots=0\.5&hatch=0\.3&rim=0\.6($|&)/, "in the order the menu shows them");
    engine["applyShare"](decodeShare("#cel=0.5"), false);
    for (const c of cases) assert.equal(hud.get()[c.field], INITIAL_HUD[c.field], `${c.id} left out of the link: back to off`);
    for (const c of cases) c.set(engine, 0.6);
    engine.resetDefaults();
    for (const c of cases) {
      assert.equal(hud.get()[c.field], null, `Defaults: ${c.id}`);
      assert.equal(c.sink(engine), c.sinkOff, `Defaults: the effect of ${c.id}`);
    }
    for (const c of cases) assert.deepEqual(keyOf(c.key), [], `Defaults: no ${c.key} key`);
  });

  it("when the Sky is set off while the procedural sky is on, then the dome draws nothing, and auto brings the procedural sky back", () => {
    engine.setProceduralSky(0.3);
    assert.equal(engine["stage"].sky.drawn, SKY_DRAWN.procedural);
    engine.setSky("off");
    assert.equal(engine["stage"].sky.drawn, SKY_DRAWN.off);
    engine.setSky("auto");
    assert.equal(engine["stage"].sky.drawn, SKY_DRAWN.procedural);
    engine.resetDefaults();
  });

  it("when the dots, the hatching and the rim light are held on, then the settings a bench card records read them off the HUD, and off they read null", () => {
    const looks = (): (number | null)[] => {
      const s = settingsOf(engine.benchParts(), { ...hud.get() }, "high");
      return [s.halftone, s.hatching, s.rimLight];
    };
    assert.deepEqual(looks(), [null, null, null], "off at the start");
    engine.setHalftone(0.5);
    engine.setHatching(0.4);
    engine.setRimLight(0.6);
    assert.deepEqual(looks(), [0.5, 0.4, 0.6], "held on");
    engine.resetDefaults();
    assert.deepEqual(looks(), [null, null, null], "Defaults");
  });
});
