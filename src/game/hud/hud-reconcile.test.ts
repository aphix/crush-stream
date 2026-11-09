import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { HUD_READOUT, sameSettings, UNSEEN_BY_SETTINGS } from "./hud-readout.ts";
import { reconcile } from "./hud-reconcile.ts";
import { HudStore, INITIAL_HUD, type CrashHudState } from "./hud-store.ts";

const fresh = () => ({ speed: 40, standings: [{ name: "Ann", place: 1 }, { name: "Bo", place: 2 }], view: { gear: 3, drift: { s: 0, clean: true } }, label: "Racing" });

describe("given a snapshot the engine builds fresh each time", () => {
  it("when every value is what was published, then it is the published snapshot itself", () => {
    const first = fresh();
    expect(reconcile(first, fresh()), "the same snapshot").toBe(first);
  });

  it("when one value deep in it changes, then only the path to it is new and every other part is the same object as before", () => {
    const first = fresh();
    const next = fresh();
    next.view.gear = 4;
    const kept = reconcile(first, next);
    expect(kept, "a new root").not.toBe(first);
    expect(kept.view, "the changed branch is new").not.toBe(first.view);
    expect(kept.view.gear, "its new gear").toBe(4);
    expect(kept.view.drift, "an unchanged part of the changed branch").toBe(first.view.drift);
    expect(kept.standings, "an unchanged sibling").toBe(first.standings);
  });

  it("when a list grows or loses a row, then it is a new list, and the rows that stay are the same objects", () => {
    const first = fresh();
    const longer = fresh();
    longer.standings.push({ name: "Cy", place: 3 });
    const kept = reconcile(first, longer);
    expect(kept.standings.length, "rows").toBe(3);
    expect(kept.standings[0], "the first row stays").toBe(first.standings[0]);
    expect(reconcile(kept, fresh()).standings.length, "rows after the list shrinks again").toBe(2);
  });

  it("when a key comes or goes, then it is a change", () => {
    const first = fresh();
    const gone: Record<string, unknown> = fresh();
    delete gone.label;
    expect(reconcile(first, gone as ReturnType<typeof fresh>), "a key gone").not.toBe(first);
    expect(reconcile(first, { ...fresh(), label: undefined as unknown as string }), "a key undefined").not.toBe(first);
  });

  it("when a part is a typed array, then it is the same only when it is the very same array", () => {
    const array = new Float32Array(4);
    const first = { array, copy: 1 };
    expect(reconcile(first, { array, copy: 1 }), "the same array").toBe(first);
    expect(reconcile(first, { array: new Float32Array(4), copy: 1 }), "an equal array of its own").not.toBe(first);
  });
});

describe("given the HUD store a listener is subscribed to", () => {
  function published(): { store: HudStore; heard: ReturnType<typeof vi.fn>; snapshot: () => CrashHudState } {
    const store = new HudStore();
    const heard = vi.fn();
    store.publish({ ...INITIAL_HUD });
    store.subscribe(heard);
    return { store, heard, snapshot: () => ({ ...INITIAL_HUD }) };
  }

  it("when the engine publishes what is already there, then the listener hears nothing and the snapshot is the same object", () => {
    const { store, heard, snapshot } = published();
    const before = store.get();
    store.publish(snapshot());
    store.publish(snapshot());
    expect(heard, "notifications").not.toHaveBeenCalled();
    expect(store.get(), "the snapshot").toBe(before);
  });

  it("when one field changes, then the listener hears once, and a field that did not is the same object as before", () => {
    const { store, heard, snapshot } = published();
    const before = store.get();
    store.publish({ ...snapshot(), night: !before.night });
    expect(heard, "notifications").toHaveBeenCalledTimes(1);
    expect(store.get().night, "the field").toBe(!before.night);
    expect(store.get().pistons, "a field that did not change").toBe(before.pistons);
  });
});

describe("given a settings screen that shows no readout", () => {
  it("when only a readout changes, then it reads the same, and when a setting changes, it does not", () => {
    const before = { ...INITIAL_HUD };
    expect(sameSettings(before, { ...before, speedA: 30, elapsed: 12 }), "speeds and the clock moved").toBe(true);
    expect(sameSettings(before, { ...before, night: !before.night }), "night changed").toBe(false);
    expect(sameSettings(before, { ...before, fxTier: before.fxTier === "off" ? "high" : "off" }), "the FX tier changed").toBe(false);
  });

  it("when a readout comes or goes (a race starts), then it reads different, so the screen's rows that hide for a race do", () => {
    const before = { ...INITIAL_HUD };
    const race = { ...INITIAL_HUD, race: {} as unknown as CrashHudState["race"] };
    expect(sameSettings(before, race), "a race came").toBe(false);
    expect(sameSettings(race, { ...race, race: {} as unknown as CrashHudState["race"] }), "another race object").toBe(true);
  });

  it("when the quality rows' readings change, then the settings screen is told, as they are shown there", () => {
    const before = { ...INITIAL_HUD };
    expect(sameSettings(before, { ...before, viewFar: before.viewFar + 10 }), "the draw distance changed").toBe(false);
    expect(sameSettings(before, { ...before, pixelRatio: before.pixelRatio + 0.25 }), "the render scale changed").toBe(false);
  });

  it("when the readouts are listed, then each is a field the state has", () => {
    for (const key of HUD_READOUT) expect(key in INITIAL_HUD, `${key} in the state`).toBe(true);
  });
});

/** The files that draw the settings accordion and what it reads: their source is read for the fields `sameSettings` takes no notice of. */
const ACCORDION_FILES = ["src/components/hud-sections.tsx", "src/components/hud-look-rows.tsx", "src/components/quality-rows.tsx", "src/components/controls-section.tsx", "src/components/station-row.tsx", "src/components/voice-device-pickers.tsx", "src/game/hud/settings-changes.ts", "src/game/hud/submit-rules.ts", "src/game/hud/audio-levels.ts"];
/** The one readout the accordion reads at all, and only whether it is there (`!s.race` hides the car-count rows in a race): in that file. */
const READ_FOR_PRESENCE = { race: "src/game/hud/settings-changes.ts" } as const;

describe("given the files that draw the settings accordion", () => {
  it("when their source is read, then none reads a readout `sameSettings` ignores, but a race's presence", () => {
    const reads: string[] = [];
    for (const file of ACCORDION_FILES) {
      const source = readFileSync(file, "utf8");
      for (const key of UNSEEN_BY_SETTINGS) {
        if (new RegExp(`\\b(?:state|hud|s)\\.${key}\\b`).test(source) && READ_FOR_PRESENCE[key as keyof typeof READ_FOR_PRESENCE] !== file) reads.push(`${file} reads ${key}`);
      }
    }
    expect(reads, "accordion files that read an ignored readout").toHaveLength(0);
  });
});
