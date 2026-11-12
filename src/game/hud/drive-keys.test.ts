import { describe, expect, it } from "vitest";
import { driveKeys, footKeys, SHOWCASE_THROW_KEYS, withShowcaseKeys } from "./drive-keys.ts";
import { boostPadButton } from "../vehicle/drive-input.ts";
import { padButtonName } from "../vehicle/gamepad.ts";
import { must } from "../kernel/must.test-util.ts";

describe("given the driven car's key line", () => {
  const testCases = [
    { it: "when a keyboard drives a car that may boost, then Shift boost is in the line", pad: false, boostable: true, expectedKeys: "W gas · S brake, then reverse · A/D steer · Space handbrake · Shift boost · drag look · V view · ` look back · R recover · Esc watch" },
    { it: "when a controller drives a car that may boost, then A boost is in the line", pad: true, boostable: true, expectedKeys: "RT gas · LT brake, then reverse · left stick steer · X handbrake · A boost · B view · R3 look back · right stick look · LB/RB car · D-pad ↓ recover · Back watch" },
    { it: "when a keyboard drives the Long jump's car, then the line has no boost and nothing else changes", pad: false, boostable: false, expectedKeys: "W gas · S brake, then reverse · A/D steer · Space handbrake · drag look · V view · ` look back · R recover · Esc watch" },
    { it: "when a controller drives the Long jump's car, then the line has no boost and nothing else changes", pad: true, boostable: false, expectedKeys: "RT gas · LT brake, then reverse · left stick steer · X handbrake · B view · R3 look back · right stick look · LB/RB car · D-pad ↓ recover · Back watch" },
  ] as const;
  for (const testCase of testCases) {
    it(testCase.it, () => {
      expect(driveKeys(testCase.pad, testCase.boostable)).toBe(testCase.expectedKeys);
    });
  }
});

describe("given the walker's key line", () => {
  const testCases = [
    { it: "when a keyboard walks him with nothing to say, then the keys that drive the car walk, run and look, and Enter gets in", pad: false, prompt: null, expectedKeys: "W/A/S/D walk · Shift run · drag look · ; mouse look · Enter get in at your car's driver door" },
    { it: "when a controller walks him with nothing to say, then the stick walks, A or RT runs, and Y gets in", pad: true, prompt: null, expectedKeys: "left stick walk · A or RT run · right stick look · Y get in at your car's driver door" },
    { it: "when he stands at a driver door, then the prompt leads the line", pad: false, prompt: "Enter or Y: get in", expectedKeys: "Enter or Y: get in · W/A/S/D walk · Shift run · drag look · ; mouse look · Enter get in at your car's driver door" },
  ] as const;
  for (const testCase of testCases) {
    it(testCase.it, () => {
      expect(footKeys(testCase.pad, testCase.prompt)).toBe(testCase.expectedKeys);
    });
  }

  // mutation: sed -i 's/(slot === arms.slot ? `▸${hint}` : hint)/hint/' src/game/hud/drive-keys.ts
  it("when he holds the shotgun, then the key line lists the four weapons with the shotgun marked", () => {
    expect(footKeys(false, null, { slot: 2 })).toContain("1 Fists · 2 Pistol · ▸3 Shotgun · 4 Rifle");
    expect(footKeys(false, null)).not.toContain("Pistol");
  });
});

describe("given the pad button the drive input binds to Boost", () => {
  it("when a controller drives a car that may boost, then the line names that button as boost", () => {
    const button = boostPadButton();
    must(button !== null, "a pad button boosts");
    const name = padButtonName("generic", button);
    expect(driveKeys(true, true).split(" · ").includes(`${name} boost`), `no "${name} boost" in: ${driveKeys(true, true)}`).toBeTruthy();
  });
});

describe("given the key line a seat shows in the showcase", () => {
  const seat = driveKeys(false, true);
  const testCases = [
    { it: "when a keyboard is in the showcase, then the seat's keys are followed by the throw keys", showcase: true, pad: false, expectedKeys: `${seat} · ${SHOWCASE_THROW_KEYS}` },
    { it: "when a keyboard is in the fleet, then the line carries no throw keys", showcase: false, pad: false, expectedKeys: seat },
    { it: "when a controller is in the showcase, then the line carries no throw keys: it has no number keys", showcase: true, pad: true, expectedKeys: seat },
  ] as const;
  for (const testCase of testCases) {
    it(testCase.it, () => {
      expect(withShowcaseKeys(seat, testCase.showcase, testCase.pad)).toBe(testCase.expectedKeys);
    });
  }

  it("when the throw keys are read, then each of 1 to 9 and 0 is named, with what it throws or clears", () => {
    const named = SHOWCASE_THROW_KEYS.split(" · ").map((key) => key.split(":")[0]!);
    expect(named, "one entry per key, 1 to 9 then 0").toEqual(["1 cone", "2 crate", "3 tyres", "4 hay bale", "5 bumper", "6 monster wheel", "7 wheel", "8 man", "9 woman", "0 clears them"]);
  });
});
