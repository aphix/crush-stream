import { describe, expect, it } from "vitest";
import { audioLevels, type AudioSetters } from "./audio-levels.ts";
import { INITIAL_HUD } from "./hud-store.ts";

/** An engine stand-in that records every sound setter call, in order. */
function recordingEngine() {
  const calls: string[] = [];
  const setters: AudioSetters = {
    toggleAudio: () => calls.push("toggleAudio"),
    setMusicVolume: (value) => calls.push(`setMusicVolume ${value}`),
    setEngineVolume: (value) => calls.push(`setEngineVolume ${value}`),
  };
  return { calls, engine: { current: setters } };
}

describe("given the sound settings the race menus and the settings panel's Audio section share", () => {
  it("when the HUD says audio is on with the music at 0.4 and the engines at 0.7, then the levels read exactly those values", () => {
    const { engine } = recordingEngine();
    const levels = audioLevels({ audioOn: true, musicVolume: 0.4, engineVolume: 0.7 }, engine);
    expect(levels.on, "on").toBe(true);
    expect(levels.music, "music").toBe(0.4);
    expect(levels.engines, "engines").toBe(0.7);
  });

  it("when the HUD is untouched, then the levels are the defaults: audio off, music 0.15, engines 0.25", () => {
    const { engine } = recordingEngine();
    const levels = audioLevels(INITIAL_HUD, engine);
    expect(levels.on, "on").toBe(false);
    expect(levels.music, "music").toBe(0.15);
    expect(levels.engines, "engines").toBe(0.25);
  });

  it("when the toggle, the music slider and the engines slider are used, then each calls the engine's own setter once and nothing else", () => {
    const { calls, engine } = recordingEngine();
    const levels = audioLevels(INITIAL_HUD, engine);
    levels.onToggle();
    levels.onMusic(0.3);
    levels.onEngines(0.9);
    expect(calls.length, "calls").toBe(3);
    expect(calls[0], "toggle").toBe("toggleAudio");
    expect(calls[1], "music").toBe("setMusicVolume 0.3");
    expect(calls[2], "engines").toBe("setEngineVolume 0.9");
  });

  it("when the engine is not up yet, then the controls do nothing instead of throwing", () => {
    const levels = audioLevels(INITIAL_HUD, { current: null });
    levels.onToggle();
    levels.onMusic(0.3);
    levels.onEngines(0.9);
    expect(levels.on, "still off").toBe(false);
  });
});
