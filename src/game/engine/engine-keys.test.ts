import { afterAll, beforeAll, describe, expect, it } from "vitest";
import "../kernel/rapier-node.test-util.ts";
import { setGround } from "../world/ground.ts";
import { DRIVE_KEYS } from "../vehicle/drive-input.ts";
import type { CrashEngine } from "./engine.ts";
import { bootEngine, pressKey, stubBrowser } from "./engine-headless.test-util.ts";
import { SCENE_KEY_BINDINGS, SEAT_KEYS } from "./engine-keys.ts";

const DRIVING_CODES: string[] = [...Object.values(DRIVE_KEYS).flat(), ...Object.values(SEAT_KEYS).flat()];
const SEAT_MODES = ["global", "follow", "drive"] as const;

describe("given the key tables the engine reads", () => {
  it("when the driving keys are listed, then the wheel, pedals, handbrake, boost, camera and reset are in the list", () => {
    for (const code of ["KeyW", "KeyA", "KeyS", "KeyD", "ArrowUp", "ArrowLeft", "ArrowDown", "ArrowRight", "Space", "ShiftLeft", "KeyV", "KeyR", "Escape", "Backquote"]) {
      expect(DRIVING_CODES.includes(code), `${code} is a driving key`).toBeTruthy();
    }
  });

  for (const binding of SCENE_KEY_BINDINGS) {
    it(`when the ${binding.scene} key (${binding.label}) is set against the driving keys, then it is none of them`, () => {
      expect(DRIVING_CODES.includes(binding.code), `${binding.code} drives and picks ${binding.scene}`).toBe(false);
      expect(/^Digit/.test(binding.code), `${binding.code} is a rig's fire key`).toBe(false);
      expect(SCENE_KEY_BINDINGS.filter((other) => other.code === binding.code).length, `${binding.code} picks one scene`).toBe(1);
    });
  }
});

describe("given the real engine in the sandbox", () => {
  // One engine for the file: a second `CrashEngine` in the same process never resolves `ready`.
  let engine: CrashEngine;
  const seatAs = (mode: (typeof SEAT_MODES)[number]): void => {
    engine["seat"].mode = mode;
    engine["seat"].carIndex = mode === "global" ? -1 : 0;
    engine["keys"].clear();
    engine["sceneFade"].pending = null;
  };
  beforeAll(async () => {
    stubBrowser();
    engine = await bootEngine({ fades: true });
  });
  afterAll(() => {
    engine.dispose();
    setGround(null);
  });

  const driveCases = SEAT_MODES.flatMap((mode) => Object.values(DRIVE_KEYS).flat().map((code) => ({ it: `when ${code} is pressed with the seat in ${mode}, then no scene is picked`, mode, code })));
  for (const testCase of driveCases) {
    it(testCase.it, () => {
      seatAs(testCase.mode);
      pressKey(engine, testCase.code);
      expect(engine["sceneFade"].pending, "the scene is not switched").toBe(null);
    });
  }

  const sceneCases = SEAT_MODES.flatMap((mode) => SCENE_KEY_BINDINGS.map((binding) => ({ it: `when ${binding.label} is pressed with the seat in ${mode}, then ${binding.scene} is picked`, mode, code: binding.code, expectedScene: binding.scene })));
  for (const testCase of sceneCases) {
    it(testCase.it, () => {
      seatAs(testCase.mode);
      pressKey(engine, testCase.code);
      expect(engine["sceneFade"].pending, "the picked scene").toBe(testCase.expectedScene);
    });
  }
});
