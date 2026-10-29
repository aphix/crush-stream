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
  setter: "setProceduralSky" | "setHalftone" | "setHatching" | "setRimLight";
  /** What the effect's own sink reads (see `sinkOf`) with the look at 0.6 and at its default. */
  sinkOn: number;
  sinkDefault: number;
  /** What null writes into the link: the cloud cover's null is the picture, the print looks' and the rim's is off, their default. */
  nullKey: string;
  /** What a typed 0 becomes: the cloud cover's 0 is a clear procedural sky, the print looks' and the rim's 0 is off. */
  atZero: number | null;
};

// What each look's own sink reads: the procedural cover drawn (-1 when the dome draws no procedural sky), the composite's drive, the shared uniform.
const sinkOf = {
  psky: (e: CrashEngine): number => (e["stage"].sky.drawn === SKY_DRAWN.procedural ? (e["stage"].sky["mat"].uniforms.uCover!.value as number) : -1),
  halftone: (e: CrashEngine): number => e["cine"].post.dots,
  hatch: (e: CrashEngine): number => e["cine"].post.hatch,
  rim: (): number => RIM_LIGHT.value,
} as const;

const cases = [
  { it: "the procedural sky", id: "psky", key: "psky", field: "proceduralSky", setter: "setProceduralSky", sinkOn: 0.6, sinkDefault: INITIAL_HUD.proceduralSky ?? -1, nullKey: "psky=picture", atZero: 0 },
  { it: "the halftone dots", id: "halftone", key: "dots", field: "halftone", setter: "setHalftone", sinkOn: 0.6, sinkDefault: 0, nullKey: "", atZero: null },
  { it: "the pencil hatching", id: "hatch", key: "hatch", field: "hatching", setter: "setHatching", sinkOn: 0.6, sinkDefault: 0, nullKey: "", atZero: null },
  { it: "the rim light", id: "rim", key: "rim", field: "rimLight", setter: "setRimLight", sinkOn: 0.6, sinkDefault: 0, nullKey: "", atZero: null },
] as const satisfies readonly LookCase[];

type StrengthCase = {
  it: string;
  id: SettingId;
  key: keyof ShareState;
  field: keyof CrashHudState;
  setter: "setMaterialStrength" | "setContourStrength";
  uniform: { value: number };
};

const strengthCases = [
  { it: "material strength", id: "materials", key: "mat", field: "materialStrength", setter: "setMaterialStrength", uniform: MATERIAL_STRENGTH },
  { it: "car contour strength", id: "contours", key: "cont", field: "contourStrength", setter: "setContourStrength", uniform: CONTOUR_SMOOTHING },
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

  for (const testCase of cases) {
    it(`when ${testCase.it} is set, then its effect, the HUD field, the changed dot and the share key follow, and its reset puts all of that back`, () => {
      expect(hud.get()[testCase.field], "the default at the start").toBe(INITIAL_HUD[testCase.field]);
      expect(sinkOf[testCase.id](engine), "its effect is the default's at the start").toBe(testCase.sinkDefault);
      engine[testCase.setter](0.6);
      expect(hud.get()[testCase.field], "the HUD field").toBe(0.6);
      expect(sinkOf[testCase.id](engine), "the effect's own sink").toBe(testCase.sinkOn);
      expect(isChanged(hud.get(), testCase.id), "the dot and the reset chip").toBe(true);
      expect(keyOf(testCase.key).join("&"), "the share key").toBe(`${testCase.key}=0.6`);
      engine.resetSetting(testCase.id);
      expect(hud.get()[testCase.field], "reset: the HUD field").toBe(INITIAL_HUD[testCase.field]);
      expect(sinkOf[testCase.id](engine), "reset: the effect").toBe(testCase.sinkDefault);
      expect(isChanged(hud.get(), testCase.id), "reset: not changed").toBe(false);
      expect(keyOf(testCase.key), "reset: the key is dropped").toHaveLength(0);
    });

    it(`when ${testCase.it} is set to 0, NaN, null or past its range, then 0 is ${testCase.atZero === null ? "off" : "a real value"}, an unreadable value and null are ${testCase.atZero === null ? "off" : "the picture"}, and a value past the range clamps to 1`, () => {
      engine[testCase.setter](0);
      expect(hud.get()[testCase.field], "0").toBe(testCase.atZero);
      engine[testCase.setter](Number.NaN);
      expect(hud.get()[testCase.field], "NaN").toBe(null);
      engine[testCase.setter](7);
      expect(hud.get()[testCase.field], "past the range").toBe(1);
      engine[testCase.setter](null);
      expect(hud.get()[testCase.field], "null").toBe(null);
      expect(keyOf(testCase.key).join("&"), "the key once null").toBe(testCase.nullKey);
      engine.resetSetting(testCase.id);
    });
  }

  it("when a link carrying the four keys is applied, then each look takes its value, a link without them puts them back, and Defaults puts all four back in the HUD, the effects and the URL", () => {
    engine["applyShare"](decodeShare("#cel=0.5&psky=0.7&dots=0.5&hatch=0.3&rim=0.6"), false);
    for (const [testCase, v] of [[cases[0], 0.7], [cases[1], 0.5], [cases[2], 0.3], [cases[3], 0.6]] as const) expect(hud.get()[testCase.field], testCase.id).toBe(v);
    expect(encodeShare(engine["shareState"]()), "in the order the menu shows them").toMatch(/(^|&)cel=0\.5&psky=0\.7&dots=0\.5&hatch=0\.3&rim=0\.6($|&)/);
    engine["applyShare"](decodeShare("#cel=0.5"), false);
    for (const testCase of cases) expect(hud.get()[testCase.field], `${testCase.id} left out of the link: back to its default`).toBe(INITIAL_HUD[testCase.field]);
    for (const testCase of cases) engine[testCase.setter](0.6);
    engine.resetDefaults();
    for (const testCase of cases) {
      expect(hud.get()[testCase.field], `Defaults: ${testCase.id}`).toBe(INITIAL_HUD[testCase.field]);
      expect(sinkOf[testCase.id](engine), `Defaults: the effect of ${testCase.id}`).toBe(testCase.sinkDefault);
    }
    for (const testCase of cases) expect(keyOf(testCase.key), `Defaults: no ${testCase.key} key`).toHaveLength(0);
  });

  for (const testCase of strengthCases) {
    it(`when the ${testCase.it} is set, then the HUD, the shared shader uniform, the changed dot and the share key follow, a value past the range clamps to 2, and its reset puts the default back`, () => {
      expect(hud.get()[testCase.field], "the default is full strength").toBe(1);
      expect(testCase.uniform.value, "the uniform at the start").toBe(1);
      engine[testCase.setter](0.6);
      expect(hud.get()[testCase.field], "the HUD field").toBe(0.6);
      expect(testCase.uniform.value, "the shader's uniform").toBe(0.6);
      expect(isChanged(hud.get(), testCase.id), "the dot and the reset chip").toBe(true);
      expect(keyOf(testCase.key).join("&"), "the share key").toBe(`${testCase.key}=0.6`);
      engine[testCase.setter](7);
      expect(testCase.uniform.value, "past the range").toBe(2);
      engine[testCase.setter](0);
      expect(testCase.uniform.value, "0 is a real value: the effect off").toBe(0);
      engine["applyShare"](decodeShare(`#${testCase.key}=1.5`), false);
      expect(testCase.uniform.value, "a link's value reaches the uniform").toBe(1.5);
      engine.resetSetting(testCase.id);
      expect(testCase.uniform.value, "reset: the uniform").toBe(1);
      expect(hud.get()[testCase.field], "reset: the HUD field").toBe(1);
      expect(isChanged(hud.get(), testCase.id), "reset: not changed").toBe(false);
      expect(keyOf(testCase.key), "reset: the key is dropped").toHaveLength(0);
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
