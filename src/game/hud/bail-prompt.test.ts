import { describe, expect, it } from "vitest";
import { bailArmed, bailControlName, bailPromptText, bailResultText } from "./bail-prompt.ts";
import { blankIntent, boostPadButton, DRIVE_KEYS, readIntent } from "../vehicle/drive-input.ts";
import { blankPad, PAD_BUTTON_COUNT, padButtonName, type PadFamily } from "../vehicle/gamepad.ts";

describe("given the Long jump's bail state", () => {
  const cases = [
    { it: "when it is ready with no verdict, then the bail is armed", state: { bail: { pressed: false, verdict: null }, phase: "ready" }, expected: true },
    { it: "when it is running with no verdict, then the bail is armed", state: { bail: { pressed: true, verdict: null }, phase: "running" }, expected: true },
    { it: "when the throw has gone, then it is not armed", state: { bail: { pressed: true, verdict: null }, phase: "thrown" }, expected: false },
    { it: "when a verdict is in, then it is not armed", state: { bail: { pressed: true, verdict: { kind: "perfect", offsetSeconds: 0 } }, phase: "running" }, expected: false },
    { it: "when the mode has no bail, then it is not armed", state: { bail: null, phase: "ready" }, expected: false },
  ] as const;
  for (const testCase of cases) {
    it(testCase.it, () => expect(bailArmed(testCase.state as Parameters<typeof bailArmed>[0])).toBe(testCase.expected));
  }
});

describe("given the pad button the drive input binds to Boost", () => {
  it("when every button is held in turn, then exactly the found one boosts, and no key does", () => {
    const found = boostPadButton();
    expect(found, "a button boosts").not.toBe(null);
    const boosting: number[] = [];
    for (let button = 0; button < PAD_BUTTON_COUNT; button++) {
      const pad = blankPad();
      pad.connected = true;
      pad.held = 1 << button;
      if (readIntent(new Set(), pad, blankIntent()).boost) boosting.push(button);
    }
    expect(boosting.length, `boosting buttons ${boosting.join(", ")}`).toBe(1);
    expect(boosting[0], "the found button is the one that boosts").toBe(found);
    expect(DRIVE_KEYS.boost.every((code) => readIntent(new Set([code]), null, blankIntent()).boost), "the boost keys boost").toBeTruthy();
  });
});

describe("given the control the bail prompt names", () => {
  const cases = [
    { it: "when the keyboard is in use, then it is Shift", padFamily: null, touch: false, expectedName: "Shift" },
    { it: "when a touch screen has no pad, then it is the Boost button", padFamily: null, touch: true, expectedName: "Boost" },
  ] as const;
  for (const testCase of cases) {
    it(testCase.it, () => {
      expect(bailControlName(testCase.padFamily, testCase.touch)).toBe(testCase.expectedName);
    });
  }

  const padFamilies: readonly PadFamily[] = ["xbox", "playstation", "generic"];
  for (const family of padFamilies) {
    it(`when a ${family} pad is connected, then the name is what that pad calls the button the drive input binds to Boost`, () => {
      const button = boostPadButton()!;
      expect(bailControlName(family, false)).toBe(padButtonName(family, button));
    });
  }

  it("when a pad is connected on a touch screen too, then the pad's button is named, not the touch button", () => {
    expect(bailControlName("xbox", true)).not.toBe("Boost");
  });

  it("when an Xbox pad and a PlayStation pad are connected, then they name the one binding differently", () => {
    expect(bailControlName("xbox", false)).not.toBe(bailControlName("playstation", false));
  });

  it("when a generic pad is connected, then it is named as an Xbox layout", () => {
    expect(bailControlName("generic", false)).toBe(bailControlName("xbox", false));
  });
});

describe("given the bail's texts", () => {
  it("when the prompt is named for a control, then it says to press it as the car hits the barrier", () => {
    expect(bailPromptText("Cross", false)).toBe("Press Cross as you hit the barrier");
    expect(bailPromptText("Cross", true)).toBe("Bail pressed");
  });

  it("when a verdict has a timing, then the result is rounded to hundredths of a second without a sign", () => {
    expect(bailResultText({ kind: "early", offsetSeconds: -0.1234, quality: 0.5 })).toBe("Early 0.12 s");
    expect(bailResultText({ kind: "late", offsetSeconds: 0.0849, quality: 0.5 })).toBe("Late 0.08 s");
  });
});
