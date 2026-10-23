import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { blankIntent, readIntent } from "../vehicle/drive-input.ts";
import { blankPad, PAD_BUTTON } from "../vehicle/gamepad.ts";
import { blankWalkIntent, readWalkIntent } from "./engine-walk-input.ts";

type DrivingField = "gas" | "brake" | "wheel" | "boost";

const cases: readonly {
  it: string;
  keys: readonly string[];
  stickX: number;
  stickY: number;
  triggerRight: number;
  southHeld: boolean;
  connected: boolean;
  expectedForward: number;
  expectedStrafe: number;
  expectedRun: boolean;
  drivingField: DrivingField | null;
  drivingValue: number | boolean;
}[] = [
  { it: "when W is held, then he walks forward as the car would take gas", keys: ["KeyW"], stickX: 0, stickY: 0, triggerRight: 0, southHeld: false, connected: false, expectedForward: 1, expectedStrafe: 0, expectedRun: false, drivingField: "gas", drivingValue: 1 },
  { it: "when the up arrow is held, then he walks forward as the car would take gas", keys: ["ArrowUp"], stickX: 0, stickY: 0, triggerRight: 0, southHeld: false, connected: false, expectedForward: 1, expectedStrafe: 0, expectedRun: false, drivingField: "gas", drivingValue: 1 },
  { it: "when S is held, then he walks back as the car would brake", keys: ["KeyS"], stickX: 0, stickY: 0, triggerRight: 0, southHeld: false, connected: false, expectedForward: -1, expectedStrafe: 0, expectedRun: false, drivingField: "brake", drivingValue: 1 },
  { it: "when the down arrow is held, then he walks back as the car would brake", keys: ["ArrowDown"], stickX: 0, stickY: 0, triggerRight: 0, southHeld: false, connected: false, expectedForward: -1, expectedStrafe: 0, expectedRun: false, drivingField: "brake", drivingValue: 1 },
  { it: "when A is held, then he steps left as the car would steer left", keys: ["KeyA"], stickX: 0, stickY: 0, triggerRight: 0, southHeld: false, connected: false, expectedForward: 0, expectedStrafe: -1, expectedRun: false, drivingField: "wheel", drivingValue: 1 },
  { it: "when the left arrow is held, then he steps left as the car would steer left", keys: ["ArrowLeft"], stickX: 0, stickY: 0, triggerRight: 0, southHeld: false, connected: false, expectedForward: 0, expectedStrafe: -1, expectedRun: false, drivingField: "wheel", drivingValue: 1 },
  { it: "when D is held, then he steps right as the car would steer right", keys: ["KeyD"], stickX: 0, stickY: 0, triggerRight: 0, southHeld: false, connected: false, expectedForward: 0, expectedStrafe: 1, expectedRun: false, drivingField: "wheel", drivingValue: -1 },
  { it: "when Shift is held, then he runs as the car would boost", keys: ["ShiftLeft"], stickX: 0, stickY: 0, triggerRight: 0, southHeld: false, connected: false, expectedForward: 0, expectedStrafe: 0, expectedRun: true, drivingField: "boost", drivingValue: true },
  { it: "when W and S are held together, then they cancel", keys: ["KeyW", "KeyS"], stickX: 0, stickY: 0, triggerRight: 0, southHeld: false, connected: false, expectedForward: 0, expectedStrafe: 0, expectedRun: false, drivingField: null, drivingValue: 0 },
  { it: "when the stick is pushed right, then he steps right as the car would steer right", keys: [], stickX: 0.8, stickY: 0, triggerRight: 0, southHeld: false, connected: true, expectedForward: 0, expectedStrafe: 0.8, expectedRun: false, drivingField: "wheel", drivingValue: -0.8 },
  { it: "when the stick is pushed up, then he walks forward", keys: [], stickX: 0, stickY: -0.6, triggerRight: 0, southHeld: false, connected: true, expectedForward: 0.6, expectedStrafe: 0, expectedRun: false, drivingField: null, drivingValue: 0 },
  { it: "when A on the pad is held, then he runs as the car would boost", keys: [], stickX: 0, stickY: 0, triggerRight: 0, southHeld: true, connected: true, expectedForward: 0, expectedStrafe: 0, expectedRun: true, drivingField: "boost", drivingValue: true },
  { it: "when the throttle trigger is pulled hard, then he runs as the car would take gas", keys: [], stickX: 0, stickY: 0, triggerRight: 1, southHeld: false, connected: true, expectedForward: 0, expectedStrafe: 0, expectedRun: true, drivingField: "gas", drivingValue: 1 },
  { it: "when the throttle trigger is pulled lightly, then he does not run", keys: [], stickX: 0, stickY: 0, triggerRight: 0.3, southHeld: false, connected: true, expectedForward: 0, expectedStrafe: 0, expectedRun: false, drivingField: "gas", drivingValue: 0.3 },
  { it: "when a pad is not connected, then its stale stick reads nothing", keys: [], stickX: 1, stickY: -1, triggerRight: 1, southHeld: true, connected: false, expectedForward: 0, expectedStrafe: 0, expectedRun: false, drivingField: "gas", drivingValue: 0 },
  { it: "when a key and the stick push the same axis, then the harder push wins", keys: ["KeyD"], stickX: 0.4, stickY: 0, triggerRight: 0, southHeld: false, connected: true, expectedForward: 0, expectedStrafe: 1, expectedRun: false, drivingField: "wheel", drivingValue: -1 },
  { it: "when nothing is held, then he stands still", keys: [], stickX: 0, stickY: 0, triggerRight: 0, southHeld: false, connected: true, expectedForward: 0, expectedStrafe: 0, expectedRun: false, drivingField: "gas", drivingValue: 0 },
];

describe("given the controls that drive the car", () => {
  for (const testCase of cases) {
    it(testCase.it, () => {
      const pad = { ...blankPad(), connected: testCase.connected, lx: testCase.stickX, ly: testCase.stickY, rt: testCase.triggerRight, held: testCase.southHeld ? 1 << PAD_BUTTON.south : 0 };
      const keys = new Set(testCase.keys);
      const walk = readWalkIntent(keys, pad, blankWalkIntent());
      assert.equal(walk.forward, testCase.expectedForward, "forward");
      assert.equal(walk.strafe, testCase.expectedStrafe, "strafe");
      assert.equal(walk.run, testCase.expectedRun, "run");
      if (testCase.drivingField === null) return;
      const driving = readIntent(keys, pad, blankIntent());
      assert.equal(driving[testCase.drivingField], testCase.drivingValue, `the same control drives ${testCase.drivingField}`);
    });
  }
});
