import { describe, expect, it } from "vitest";
import type { RaceView } from "../match/types.ts";
import { NO_DRIFT } from "../vehicle/car-drive.ts";
import { needsReset, resetGlow, resetInput, resetPromptLabel } from "./reset-prompt.ts";

const view = (wheelsOff: number, canReset = true): RaceView => ({
  id: 0,
  racer: null,
  speedKph: 0,
  gear: 1,
  rpm: 0.3,
  brakeCue: 0,
  damage: 1,
  chase: null,
  boost: null,
  boosting: 0,
  drift: NO_DRIFT,
  wheelsOff,
  canReset,
});

describe("given a car view reporting how many wheels are off and whether the game would allow a reset", () => {
  it("when the input in use is the keyboard, a pad or touch, then the reset prompt names that input's control: R, D-pad ↓, and Respawn in a race or Recover otherwise", () => {
    expect(resetPromptLabel(view(2), "keyboard", true)).toBe("R");
    expect(resetPromptLabel(view(2), "pad", true)).toBe("D-pad ↓");
    expect(resetPromptLabel(view(2), "touch", true)).toBe("Respawn");
    expect(resetPromptLabel(view(2), "touch", false)).toBe("Recover");
  });

  it("when 0, 1, 2 and 4 wheels are off, then the prompt stays down with one wheel off or none, and comes up with two or all four", () => {
    expect(resetPromptLabel(view(0), "keyboard", true)).toBe(null);
    expect(resetPromptLabel(view(1), "keyboard", true)).toBe(null);
    expect(resetPromptLabel(view(2), "keyboard", true)).toBe("R");
    expect(resetPromptLabel(view(4), "keyboard", true)).toBe("R");
  });

  it("when the game would refuse the reset, then the prompt never shows, whatever the wheels", () => {
    expect(resetPromptLabel(view(4, false), "keyboard", true)).toBe(null);
    expect(resetPromptLabel(view(3, false), "touch", false)).toBe(null);
  });

  it("when a pad is connected, only touch is in use, or neither, then a connected pad wins, touch resets only while driving, and the keyboard is used otherwise", () => {
    expect(resetInput(true, true, true)).toBe("pad");
    expect(resetInput(true, false, false)).toBe("pad");
    expect(resetInput(false, true, true)).toBe("touch");
    expect(resetInput(false, true, false)).toBe(null);
    expect(resetInput(false, false, false)).toBe("keyboard");
    expect(resetInput(false, false, true)).toBe("keyboard");
  });

  it("when 1, 2 and 4 wheels are off, and 4 are off but the game would refuse, then a reset is needed with two or more wheels off and an allowed reset, nothing else", () => {
    expect(needsReset(view(1))).toBe(false);
    expect(needsReset(view(2))).toBe(true);
    expect(needsReset(view(4))).toBe(true);
    expect(needsReset(view(4, false))).toBe(false);
  });

  describe("given the reset controls' glow, driven by the viewed car of the scene in play", () => {
    const none = { race: null, derbyView: null, fleetView: null };
    const race = (v: RaceView | null) => ({ ...none, race: { view: v } });

    it("when 0 to 4 wheels are off in a race, then the controls glow only with two, three or four off", () => {
      for (const [off, glows] of [[0, false], [1, false], [2, true], [3, true], [4, true]] as const) {
        expect(resetGlow(race(view(off))), `${off} off`).toBe(glows);
      }
    });

    it("when the game would refuse the reset, then the controls never glow in a race, a derby or the fleet, whatever the wheels", () => {
      for (const off of [2, 3, 4]) {
        expect(resetGlow(race(view(off, false))), `race ${off} off`).toBe(false);
        expect(resetGlow({ ...none, derbyView: view(off, false) }), `derby ${off} off`).toBe(false);
        expect(resetGlow({ ...none, fleetView: view(off, false) }), `fleet ${off} off`).toBe(false);
      }
    });

    it("when two wheels are off in a race, a derby or the fleet, then the controls glow, following the view of the scene in play", () => {
      expect(resetGlow(race(view(2)))).toBe(true);
      expect(resetGlow({ ...none, derbyView: view(2) })).toBe(true);
      expect(resetGlow({ ...none, fleetView: view(2) })).toBe(true);
    });

    it("when there is no driven or watched car, then the controls do not glow", () => {
      expect(resetGlow(none)).toBe(false);
      expect(resetGlow(race(null))).toBe(false);
    });

    it("when a race has its own view, then a stale derby or fleet view never makes the controls glow inside it", () => {
      expect(resetGlow({ race: { view: view(1) }, derbyView: view(4), fleetView: view(4) })).toBe(false);
      expect(resetGlow({ race: { view: null }, derbyView: view(4), fleetView: view(4) })).toBe(false);
    });
  });
});
