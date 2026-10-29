import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { blankIntent, readIntent } from "../vehicle/drive-input.ts";
import { blankPad, mergeTouch, PAD_BUTTON, type TouchPad } from "../vehicle/gamepad.ts";
import { discReading, drawnScheme, pedalsFor, schemeLayout, sliderSteer, stripReading, TOUCH_SCHEMES, type TouchScheme } from "../hud/touch-scheme.ts";
import { blankWalkIntent, readWalkIntent } from "./engine-walk-input.ts";

const blankTouch = (): TouchPad => ({ x: 0, y: 0, gas: 0, brake: 0, held: 0, tapped: 0 });

type DrivingField = "gas" | "brake" | "wheel" | "boost" | "handbrake";

const cases: readonly {
  it: string;
  keys: readonly string[];
  stickX: number;
  stickY: number;
  triggerRight: number;
  heldButton: number;
  connected: boolean;
  expectedForward: number;
  expectedStrafe: number;
  expectedSprint: boolean;
  expectedWalk: boolean;
  drivingField: DrivingField | null;
  drivingValue: number | boolean;
}[] = [
  { it: "when W is held, then he goes forward as the car would take gas", keys: ["KeyW"], stickX: 0, stickY: 0, triggerRight: 0, heldButton: 0, connected: false, expectedForward: 1, expectedStrafe: 0, expectedSprint: false, expectedWalk: false, drivingField: "gas", drivingValue: 1 },
  { it: "when the up arrow is held, then he goes forward as the car would take gas", keys: ["ArrowUp"], stickX: 0, stickY: 0, triggerRight: 0, heldButton: 0, connected: false, expectedForward: 1, expectedStrafe: 0, expectedSprint: false, expectedWalk: false, drivingField: "gas", drivingValue: 1 },
  { it: "when S is held, then he goes back as the car would brake", keys: ["KeyS"], stickX: 0, stickY: 0, triggerRight: 0, heldButton: 0, connected: false, expectedForward: -1, expectedStrafe: 0, expectedSprint: false, expectedWalk: false, drivingField: "brake", drivingValue: 1 },
  { it: "when the down arrow is held, then he goes back as the car would brake", keys: ["ArrowDown"], stickX: 0, stickY: 0, triggerRight: 0, heldButton: 0, connected: false, expectedForward: -1, expectedStrafe: 0, expectedSprint: false, expectedWalk: false, drivingField: "brake", drivingValue: 1 },
  { it: "when A is held, then he steps left as the car would steer left", keys: ["KeyA"], stickX: 0, stickY: 0, triggerRight: 0, heldButton: 0, connected: false, expectedForward: 0, expectedStrafe: -1, expectedSprint: false, expectedWalk: false, drivingField: "wheel", drivingValue: 1 },
  { it: "when the left arrow is held, then he steps left as the car would steer left", keys: ["ArrowLeft"], stickX: 0, stickY: 0, triggerRight: 0, heldButton: 0, connected: false, expectedForward: 0, expectedStrafe: -1, expectedSprint: false, expectedWalk: false, drivingField: "wheel", drivingValue: 1 },
  { it: "when D is held, then he steps right as the car would steer right", keys: ["KeyD"], stickX: 0, stickY: 0, triggerRight: 0, heldButton: 0, connected: false, expectedForward: 0, expectedStrafe: 1, expectedSprint: false, expectedWalk: false, drivingField: "wheel", drivingValue: -1 },
  { it: "when Shift is held, then he sprints as the car would boost", keys: ["ShiftLeft"], stickX: 0, stickY: 0, triggerRight: 0, heldButton: 0, connected: false, expectedForward: 0, expectedStrafe: 0, expectedSprint: true, expectedWalk: false, drivingField: "boost", drivingValue: true },
  { it: "when Space is held, then he is held to a walk as the car would handbrake", keys: ["Space"], stickX: 0, stickY: 0, triggerRight: 0, heldButton: 0, connected: false, expectedForward: 0, expectedStrafe: 0, expectedSprint: false, expectedWalk: true, drivingField: "handbrake", drivingValue: true },
  { it: "when W and S are held together, then they cancel", keys: ["KeyW", "KeyS"], stickX: 0, stickY: 0, triggerRight: 0, heldButton: 0, connected: false, expectedForward: 0, expectedStrafe: 0, expectedSprint: false, expectedWalk: false, drivingField: null, drivingValue: 0 },
  { it: "when the stick is pushed right, then he steps right as the car would steer right", keys: [], stickX: 0.8, stickY: 0, triggerRight: 0, heldButton: 0, connected: true, expectedForward: 0, expectedStrafe: 0.8, expectedSprint: false, expectedWalk: false, drivingField: "wheel", drivingValue: -0.8 },
  { it: "when the stick is pushed up, then he goes forward in proportion", keys: [], stickX: 0, stickY: -0.6, triggerRight: 0, heldButton: 0, connected: true, expectedForward: 0.6, expectedStrafe: 0, expectedSprint: false, expectedWalk: false, drivingField: null, drivingValue: 0 },
  { it: "when A on the pad is held, then he sprints as the car would boost", keys: [], stickX: 0, stickY: 0, triggerRight: 0, heldButton: 1 << PAD_BUTTON.south, connected: true, expectedForward: 0, expectedStrafe: 0, expectedSprint: true, expectedWalk: false, drivingField: "boost", drivingValue: true },
  { it: "when X on the pad is held, then he is held to a walk as the car would handbrake", keys: [], stickX: 0, stickY: 0, triggerRight: 0, heldButton: 1 << PAD_BUTTON.west, connected: true, expectedForward: 0, expectedStrafe: 0, expectedSprint: false, expectedWalk: true, drivingField: "handbrake", drivingValue: true },
  { it: "when the throttle trigger is pulled hard, then he sprints as the car would take gas", keys: [], stickX: 0, stickY: 0, triggerRight: 1, heldButton: 0, connected: true, expectedForward: 0, expectedStrafe: 0, expectedSprint: true, expectedWalk: false, drivingField: "gas", drivingValue: 1 },
  { it: "when the throttle trigger is pulled lightly, then he does not sprint", keys: [], stickX: 0, stickY: 0, triggerRight: 0.3, heldButton: 0, connected: true, expectedForward: 0, expectedStrafe: 0, expectedSprint: false, expectedWalk: false, drivingField: "gas", drivingValue: 0.3 },
  { it: "when a pad is not connected, then its stale stick reads nothing", keys: [], stickX: 1, stickY: -1, triggerRight: 1, heldButton: (1 << PAD_BUTTON.south) | (1 << PAD_BUTTON.west), connected: false, expectedForward: 0, expectedStrafe: 0, expectedSprint: false, expectedWalk: false, drivingField: "gas", drivingValue: 0 },
  { it: "when a key and the stick push the same axis, then the harder push wins", keys: ["KeyD"], stickX: 0.4, stickY: 0, triggerRight: 0, heldButton: 0, connected: true, expectedForward: 0, expectedStrafe: 1, expectedSprint: false, expectedWalk: false, drivingField: "wheel", drivingValue: -1 },
  { it: "when nothing is held, then he stands still", keys: [], stickX: 0, stickY: 0, triggerRight: 0, heldButton: 0, connected: true, expectedForward: 0, expectedStrafe: 0, expectedSprint: false, expectedWalk: false, drivingField: "gas", drivingValue: 0 },
];

describe("given the controls that drive the car", () => {
  for (const testCase of cases) {
    it(testCase.it, () => {
      const pad = { ...blankPad(), connected: testCase.connected, lx: testCase.stickX, ly: testCase.stickY, rt: testCase.triggerRight, held: testCase.heldButton };
      const keys = new Set(testCase.keys);
      const walk = readWalkIntent(keys, pad, blankTouch(), blankWalkIntent());
      assert.equal(walk.forward, testCase.expectedForward, "forward");
      assert.equal(walk.strafe, testCase.expectedStrafe, "strafe");
      assert.equal(walk.sprint, testCase.expectedSprint, "sprint");
      assert.equal(walk.walk, testCase.expectedWalk, "walk");
      if (testCase.drivingField === null) return;
      const driving = readIntent(keys, pad, blankIntent());
      assert.equal(driving[testCase.drivingField], testCase.drivingValue, `the same control drives ${testCase.drivingField}`);
    });
  }
});

/** A thumb on foot: `push` is up (+1) / down (-1) on the strip or the disc, `side` right (+1) / left (-1) on the bar, the tilt or the disc; `cap` the strip's Boost cap. */
type FootThumbs = { push: number; side: number; cap?: boolean };

const BAR_HALF_TRAVEL = 60;

/** What a scheme's controls write to the pad on foot, through the functions the HUD calls (Boost's cap as the held A it latches), merged as a poll merges it. */
function walkFor(chosen: TouchScheme, thumbs: FootThumbs) {
  const scheme = drawnScheme(chosen, true);
  const layout = schemeLayout(scheme);
  const touch = blankTouch();
  if (layout.steer === "stick") {
    const reading = discReading(thumbs.side, -thumbs.push);
    touch.x = reading.x;
    touch.y = reading.y;
  } else touch.x = layout.steer === "slider" ? sliderSteer(thumbs.side * BAR_HALF_TRAVEL, BAR_HALF_TRAVEL) : thumbs.side;
  if (layout.right === "strip") {
    const strip = stripReading(thumbs.cap ? 0.95 : thumbs.push > 0 ? 0.79 : thumbs.push < 0 ? 0 : 0.34);
    const pedals = pedalsFor(scheme, strip, true);
    touch.gas = pedals.gas;
    touch.brake = pedals.brake;
    if (strip.boost) touch.held |= 1 << PAD_BUTTON.south;
  }
  const pad = blankPad();
  mergeTouch(touch, pad, 0);
  return readWalkIntent(new Set(), pad, touch, blankWalkIntent());
}

describe("given each touch scheme with the player on foot", () => {
  for (const scheme of TOUCH_SCHEMES) {
    it(`when ${scheme}'s thumbs push up, down and sideways, then he goes forward, back and steps aside, and full gas alone does not sprint`, () => {
      const ahead = walkFor(scheme, { push: 1, side: 0 });
      assert.ok(ahead.forward > 0.9 && Math.abs(ahead.strafe) < 0.05, `forward ${ahead.forward} strafe ${ahead.strafe}`);
      assert.equal(ahead.sprint, false, "full gas runs, it does not sprint");
      const back = walkFor(scheme, { push: -1, side: 0 });
      assert.ok(back.forward < -0.9, `back ${back.forward}`);
      const right = walkFor(scheme, { push: 0, side: 1 });
      assert.ok(right.strafe > 0.9 && Math.abs(right.forward) < 0.05, `right ${right.strafe} forward ${right.forward}`);
      const left = walkFor(scheme, { push: 0, side: -1 });
      assert.ok(left.strafe < -0.9, `left ${left.strafe}`);
    });
  }
  for (const scheme of TOUCH_SCHEMES.filter((s) => schemeLayout(drawnScheme(s, true)).right === "strip")) {
    it(`when ${scheme}'s strip thumb slides into the Boost cap, then he sprints forward`, () => {
      const sprint = walkFor(scheme, { push: 1, side: 0, cap: true });
      assert.ok(sprint.forward > 0.9 && sprint.sprint, `forward ${sprint.forward} sprint ${sprint.sprint}`);
    });
  }
  it("when Easy's player is on foot, then the controls draw the Pedals strip, and at the wheel Easy's own", () => {
    assert.equal(drawnScheme("autogas", true), "pedals");
    assert.equal(drawnScheme("autogas", false), "autogas");
  });
});
