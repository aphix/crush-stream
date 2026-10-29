import { afterAll, beforeAll, describe, expect, it } from "vitest";
import "../kernel/rapier-node.test-util.ts";
import { HudStore, INITIAL_HUD, type CrashHudState } from "../hud/hud-store.ts";
import { isChanged, type SettingId } from "../hud/settings-changes.ts";
import { decodeShare, encodeShare, type ShareState } from "../hud/share-url.ts";
import { RIM_LIGHT } from "../present/rim-light.ts";
import { CONTOUR_SMOOTHING } from "../vehicle/normal-smooth.ts";
import { MATERIAL_STRENGTH } from "../vehicle/material-class.ts";
import { SKY_DRAWN } from "../present/sky-dome.ts";
import { settingsOf } from "./bench-measure.ts";
import { setGround } from "../world/ground.ts";
import type { CrashEngine } from "./engine.ts";
import { bootEngine, stubBrowser } from "./engine-headless.test-util.ts";
import { firstMismatch } from "../kernel/compare-arrays.test-util.ts";

type LookCase = {
  it: string;
  /** The settings menu's id (`SETTINGS`, `resetSetting`) and the share link's key. */
  id: SettingId;
  key: keyof ShareState;
  field: keyof CrashHudState;
  set: (e: CrashEngine, v: number | null) => void;
  /** What the effect's own sink reads (the procedural cover drawn, the composite's drive, the shared uniform) with the look at 0.6 and at its default. */
  sink: (e: CrashEngine) => number;
  sinkOn: number;
  sinkDefault: number;
  /** What null writes into the link: the cloud cover's null is the picture, the print looks' and the rim's is off, their default. */
  nullKey: string;
  /** What a typed 0 becomes: the cloud cover's 0 is a clear procedural sky, the print looks' and the rim's 0 is off. */
  atZero: number | null;
};

const cases = [
  // The cover the dome draws, -1 when it draws no procedural sky.
  { it: "the procedural sky", id: "psky", key: "psky", field: "proceduralSky", set: (e, v) => e.setProceduralSky(v), sink: (e) => (e["stage"].sky.drawn === SKY_DRAWN.procedural ? (e["stage"].sky["mat"].uniforms.uCover!.value as number) : -1), sinkOn: 0.6, sinkDefault: INITIAL_HUD.proceduralSky ?? -1, nullKey: "psky=picture", atZero: 0 },
  { it: "the halftone dots", id: "halftone", key: "dots", field: "halftone", set: (e, v) => e.setHalftone(v), sink: (e) => e["cine"].post.dots, sinkOn: 0.6, sinkDefault: 0, nullKey: "", atZero: null },
  { it: "the pencil hatching", id: "hatch", key: "hatch", field: "hatching", set: (e, v) => e.setHatching(v), sink: (e) => e["cine"].post.hatch, sinkOn: 0.6, sinkDefault: 0, nullKey: "", atZero: null },
  { it: "the rim light", id: "rim", key: "rim", field: "rimLight", set: (e, v) => e.setRimLight(v), sink: () => RIM_LIGHT.value, sinkOn: 0.6, sinkDefault: 0, nullKey: "", atZero: null },
] as const satisfies readonly LookCase[];

type StrengthCase = {
  it: string;
  id: SettingId;
  key: keyof ShareState;
  field: keyof CrashHudState;
  set: (e: CrashEngine, v: number) => void;
  uniform: { value: number };
};

const strengthCases = [
  { it: "material strength", id: "materials", key: "mat", field: "materialStrength", set: (e, v) => e.setMaterialStrength(v), uniform: MATERIAL_STRENGTH },
  { it: "car contour strength", id: "contours", key: "cont", field: "contourStrength", set: (e, v) => e.setContourStrength(v), uniform: CONTOUR_SMOOTHING },
] as const satisfies readonly StrengthCase[];

describe("given the real engine and the look sliders under Cel in the Playback section", () => {
  // One engine for the file: a second `CrashEngine` in the same process never resolves `ready`.
  let engine: CrashEngine;
  let hud: HudStore;
  const keys = (): string[] => encodeShare(engine["shareState"]()).split("&");
  const keyOf = (key: keyof ShareState): string[] => keys().filter((kv) => kv.startsWith(`${key}=`));
  beforeAll(async () => {
    stubBrowser();
    hud = new HudStore();
    engine = await bootEngine({ hud, fades: true });
    // Under auto a fresh page's minimal tier draws no sky.
    engine["stage"].setSkyTier("high");
  });
  afterAll(() => {
    engine.dispose();
    setGround(null);
  });

  for (const c of cases) {
    it(`when ${c.it} is set, then its effect, the HUD field, the changed dot and the share key follow, and its reset puts all of that back`, () => {
      expect(hud.get()[c.field], "the default at the start").toBe(INITIAL_HUD[c.field]);
      expect(c.sink(engine), "its effect is the default's at the start").toBe(c.sinkDefault);
      c.set(engine, 0.6);
      expect(hud.get()[c.field], "the HUD field").toBe(0.6);
      expect(c.sink(engine), "the effect's own sink").toBe(c.sinkOn);
      expect(isChanged(hud.get(), c.id), "the dot and the reset chip").toBe(true);
      expect(keyOf(c.key).join("&"), "the share key").toBe(`${c.key}=0.6`);
      engine.resetSetting(c.id);
      expect(hud.get()[c.field], "reset: the HUD field").toBe(INITIAL_HUD[c.field]);
      expect(c.sink(engine), "reset: the effect").toBe(c.sinkDefault);
      expect(isChanged(hud.get(), c.id), "reset: not changed").toBe(false);
      expect(keyOf(c.key), "reset: the key is dropped").toHaveLength(0);
    });

    it(`when ${c.it} is set to 0, NaN, null or past its range, then 0 is ${c.atZero === null ? "off" : "a real value"}, an unreadable value and null are ${c.atZero === null ? "off" : "the picture"}, and a value past the range clamps to 1`, () => {
      c.set(engine, 0);
      expect(hud.get()[c.field], "0").toBe(c.atZero);
      c.set(engine, Number.NaN);
      expect(hud.get()[c.field], "NaN").toBe(null);
      c.set(engine, 7);
      expect(hud.get()[c.field], "past the range").toBe(1);
      c.set(engine, null);
      expect(hud.get()[c.field], "null").toBe(null);
      expect(keyOf(c.key).join("&"), "the key once null").toBe(c.nullKey);
      engine.resetSetting(c.id);
    });
  }

  it("when a link carrying the four keys is applied, then each look takes its value, a link without them puts them back, and Defaults puts all four back in the HUD, the effects and the URL", () => {
    engine["applyShare"](decodeShare("#cel=0.5&psky=0.7&dots=0.5&hatch=0.3&rim=0.6"), false);
    for (const [c, v] of [[cases[0], 0.7], [cases[1], 0.5], [cases[2], 0.3], [cases[3], 0.6]] as const) expect(hud.get()[c.field], c.id).toBe(v);
    expect(encodeShare(engine["shareState"]()), "in the order the menu shows them").toMatch(/(^|&)cel=0\.5&psky=0\.7&dots=0\.5&hatch=0\.3&rim=0\.6($|&)/);
    engine["applyShare"](decodeShare("#cel=0.5"), false);
    for (const c of cases) expect(hud.get()[c.field], `${c.id} left out of the link: back to its default`).toBe(INITIAL_HUD[c.field]);
    for (const c of cases) c.set(engine, 0.6);
    engine.resetDefaults();
    for (const c of cases) {
      expect(hud.get()[c.field], `Defaults: ${c.id}`).toBe(INITIAL_HUD[c.field]);
      expect(c.sink(engine), `Defaults: the effect of ${c.id}`).toBe(c.sinkDefault);
    }
    for (const c of cases) expect(keyOf(c.key), `Defaults: no ${c.key} key`).toHaveLength(0);
  });

  for (const c of strengthCases) {
    it(`when the ${c.it} is set, then the HUD, the shared shader uniform, the changed dot and the share key follow, a value past the range clamps to 2, and its reset puts the default back`, () => {
      expect(hud.get()[c.field], "the default is full strength").toBe(1);
      expect(c.uniform.value, "the uniform at the start").toBe(1);
      c.set(engine, 0.6);
      expect(hud.get()[c.field], "the HUD field").toBe(0.6);
      expect(c.uniform.value, "the shader's uniform").toBe(0.6);
      expect(isChanged(hud.get(), c.id), "the dot and the reset chip").toBe(true);
      expect(keyOf(c.key).join("&"), "the share key").toBe(`${c.key}=0.6`);
      c.set(engine, 7);
      expect(c.uniform.value, "past the range").toBe(2);
      c.set(engine, 0);
      expect(c.uniform.value, "0 is a real value: the effect off").toBe(0);
      engine["applyShare"](decodeShare(`#${c.key}=1.5`), false);
      expect(c.uniform.value, "a link's value reaches the uniform").toBe(1.5);
      engine.resetSetting(c.id);
      expect(c.uniform.value, "reset: the uniform").toBe(1);
      expect(hud.get()[c.field], "reset: the HUD field").toBe(1);
      expect(isChanged(hud.get(), c.id), "reset: not changed").toBe(false);
      expect(keyOf(c.key), "reset: the key is dropped").toHaveLength(0);
    });
  }

  it("when the Sky is set off under the default procedural sky, then the dome draws nothing, and auto brings the procedural sky back", () => {
    expect(engine["stage"].sky.drawn, "the default").toBe(SKY_DRAWN.procedural);
    engine.setSky("off");
    expect(engine["stage"].sky.drawn).toBe(SKY_DRAWN.off);
    engine.setSky("auto");
    expect(engine["stage"].sky.drawn).toBe(SKY_DRAWN.procedural);
    engine.resetDefaults();
  });

  it("when the dots, the hatching and the rim light are held on, then the settings a bench card records read them off the HUD, and off they read null", () => {
    const looks = (): (number | null)[] => {
      const s = settingsOf(engine.benchParts(), { ...hud.get() }, "high");
      return [s.halftone, s.hatching, s.rimLight];
    };
    expect(firstMismatch(looks(), [null, null, null]), "off at the start").toBeUndefined();
    engine.setHalftone(0.5);
    engine.setHatching(0.4);
    engine.setRimLight(0.6);
    expect(firstMismatch(looks(), [0.5, 0.4, 0.6]), "held on").toBeUndefined();
    engine.resetDefaults();
    expect(firstMismatch(looks(), [null, null, null]), "Defaults").toBeUndefined();
  });
});
