import { describe, expect, it } from "vitest";
import { FRAME_HZ } from "../kernel/constants.ts";
import type { UiName } from "../present/game-audio.ts";
import { coursePlace, hourOfDay, UiCues } from "./engine-audio-cues.ts";

/** Cues that keep their names in order. */
function cues(): { cues: UiCues; played: UiName[] } {
  const played: UiName[] = [];
  return { cues: new UiCues((name) => void played.push(name)), played };
}

describe("given a race counting down to green", () => {
  it("when its clock runs from -3 s to green, then the countdown sounds at 3, 2 and 1, go at green, and nothing between", () => {
    const { cues: ui, played } = cues();
    for (let t = -3; t < 0; t += 1 / FRAME_HZ) ui.frame("countdown", t, false, null);
    ui.frame("racing", 0.01, false, null);
    for (let t = 0.02; t < 2; t += 1 / FRAME_HZ) ui.frame("racing", t, false, null);
    expect(played).toEqual(["countdown", "countdown", "countdown", "go"]);
  });

  it("when the grid holds before the countdown, then nothing sounds", () => {
    const { cues: ui, played } = cues();
    for (let t = -10; t < -3.1; t += 1 / FRAME_HZ) ui.frame("grid", t, false, null);
    expect(played).toEqual([]);
  });

  it("when the race finishes, then finish sounds once; joining a race already finished sounds none", () => {
    const { cues: ui, played } = cues();
    ui.frame("racing", 30, false, null);
    ui.frame("finished", 31, false, null);
    ui.frame("finished", 32, false, null);
    expect(played).toEqual(["finish"]);
    const late = cues();
    late.cues.frame("finished", 40, false, null);
    expect(late.played).toEqual([]);
  });
});

describe("given the player's car and hands", () => {
  it("when the car is wrecked, then wrecked sounds once, not again while it stays wrecked", () => {
    const { cues: ui, played } = cues();
    ui.frame("racing", 5, false, null);
    ui.frame("racing", 6, true, null);
    ui.frame("racing", 7, true, null);
    expect(played).toEqual(["wrecked"]);
  });

  it("when a weapon is swapped for another, then equip sounds; taking the first one up after stepping out does not", () => {
    const { cues: ui, played } = cues();
    ui.frame(null, 0, false, "fists");
    ui.frame(null, 0, false, "pistol");
    ui.frame(null, 0, false, "pistol");
    ui.frame(null, 0, false, null);
    ui.frame(null, 0, false, "fists");
    expect(played).toEqual(["equip"]);
  });
});

describe("given the ambient bed's place and hour", () => {
  it("when courses are asked, then the city's streets are a city, a rally stage dirt, an oval a track, and an unknown course a track", () => {
    expect([coursePlace("city"), coursePlace("rally"), coursePlace("oval"), coursePlace("nowhere"), coursePlace(null)]).toEqual(["city", "dirt", "track", "track", "track"]);
  });

  it("when the hour is asked, then the open world's clock minute gives its hour, a race its light, anything else midday", () => {
    expect(hourOfDay(1265)).toBeCloseTo(21.083, 3);
    expect([hourOfDay(null, "daytime"), hourOfDay(null, "sunset"), hourOfDay(null, "nighttime"), hourOfDay(null)]).toEqual([13, 19, 23, 13]);
  });
});
