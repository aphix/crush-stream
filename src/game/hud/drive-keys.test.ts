import { describe, expect, it } from "vitest";
import { driveKeys, footKeys } from "./drive-keys.ts";
import { boostPadButton } from "../vehicle/drive-input.ts";
import { padButtonName } from "../vehicle/gamepad.ts";
import { must } from "../kernel/must.test-util.ts";

describe("given the driven car's key line", () => {
  const cases = [
    { it: "when a keyboard drives a car that may boost, then Shift boost is in the line", pad: false, boostable: true, expectedKeys: "W gas · S brake, then reverse · A/D steer · Space handbrake · Shift boost · drag look · V view · ` look back · R recover · Esc watch" },
    { it: "when a controller drives a car that may boost, then A boost is in the line", pad: true, boostable: true, expectedKeys: "RT gas · LT brake, then reverse · left stick steer · X handbrake · A boost · Y view · R3 look back · right stick look · LB/RB car · D-pad ↓ recover · Back watch" },
    { it: "when a keyboard drives the Long jump's car, then the line has no boost and nothing else changes", pad: false, boostable: false, expectedKeys: "W gas · S brake, then reverse · A/D steer · Space handbrake · drag look · V view · ` look back · R recover · Esc watch" },
    { it: "when a controller drives the Long jump's car, then the line has no boost and nothing else changes", pad: true, boostable: false, expectedKeys: "RT gas · LT brake, then reverse · left stick steer · X handbrake · Y view · R3 look back · right stick look · LB/RB car · D-pad ↓ recover · Back watch" },
  ] as const;
  for (const testCase of cases) {
    it(testCase.it, () => {
      expect(driveKeys(testCase.pad, testCase.boostable)).toBe(testCase.expectedKeys);
    });
  }
});

describe("given the walker's key line", () => {
  const cases = [
    { it: "when a keyboard walks him with nothing to say, then the keys that drive the car walk, run and look, and Enter gets in", pad: false, prompt: null, expectedKeys: "W/A/S/D walk · Shift run · drag look · ; mouse look · Enter get in at your car's driver door" },
    { it: "when a controller walks him with nothing to say, then the stick walks, A or RT runs, and B gets in", pad: true, prompt: null, expectedKeys: "left stick walk · A or RT run · right stick look · B get in at your car's driver door" },
    { it: "when he stands at a driver door, then the prompt leads the line", pad: false, prompt: "Enter or B: get in", expectedKeys: "Enter or B: get in · W/A/S/D walk · Shift run · drag look · ; mouse look · Enter get in at your car's driver door" },
  ] as const;
  for (const testCase of cases) {
    it(testCase.it, () => {
      expect(footKeys(testCase.pad, testCase.prompt)).toBe(testCase.expectedKeys);
    });
  }
});

describe("given the pad button the drive input binds to Boost", () => {
  it("when a controller drives a car that may boost, then the line names that button as boost", () => {
    const button = boostPadButton();
    must(button !== null, "a pad button boosts");
    const name = padButtonName("generic", button);
    expect(driveKeys(true, true).split(" · ").includes(`${name} boost`), `no "${name} boost" in: ${driveKeys(true, true)}`).toBeTruthy();
  });
});
