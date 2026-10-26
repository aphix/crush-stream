import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { blankIntent, readIntent, shapeDrive } from "../vehicle/drive-input.ts";
import { FRAME_HZ } from "../kernel/constants.ts";
import { idleDrive } from "../vehicle/car-drive.ts";
import { blankPad, mergeTouch, PAD_BUTTON, type TouchPad } from "../vehicle/gamepad.ts";
import { discReading, pedalsFor, pulledDown, schemeLayout, sliderSteer, stripReading, type TouchScheme } from "./touch-scheme.ts";

/** Where each thumb is, as the controls read it: the steering thumb (px from the bar's centre, px pulled down), the pedal thumb (strip height 0..1, or a Brake pad). */
type Thumbs = {
  scheme: TouchScheme;
  steerPx?: number;
  pullPx?: number;
  tiltSteer?: number;
  ebrakePad?: boolean;
  stripAt?: number;
  brakePad?: boolean;
  discPush?: { x: number; y: number };
  handbrakeButton?: boolean;
};

const BAR_HALF_TRAVEL = 60;
const BAR_MIDDLE_Y = 700;
const FORWARD_SPEED = 20;
const SLICE = 1 / FRAME_HZ;
const HALF_SECOND_SLICES = FRAME_HZ / 2;

/** What the controls write to the pad for these thumbs: the same functions the HUD calls. */
function touchPadFor(thumbs: Thumbs): TouchPad {
  const layout = schemeLayout(thumbs.scheme);
  const touch: TouchPad = { x: 0, y: 0, gas: 0, brake: 0, held: 0, tapped: 0 };
  if (layout.steer === "stick") {
    const reading = discReading((thumbs.discPush?.x ?? 0) / 36, (thumbs.discPush?.y ?? 0) / 36);
    touch.x = reading.x;
    touch.y = reading.y;
  }
  if (layout.steer === "slider") touch.x = sliderSteer(thumbs.steerPx ?? 0, BAR_HALF_TRAVEL);
  if (layout.steer === "tilt") touch.x = thumbs.tiltSteer ?? 0;
  const pulled = layout.ebrake === "pull" && pulledDown(false, BAR_MIDDLE_Y + (thumbs.pullPx ?? 0), BAR_MIDDLE_Y);
  if (pulled || thumbs.ebrakePad || thumbs.handbrakeButton) touch.held |= 1 << PAD_BUTTON.west;
  const strip = thumbs.stripAt === undefined ? { gas: 0, brake: 0, boost: false } : stripReading(thumbs.stripAt);
  if (strip.boost) touch.held |= 1 << PAD_BUTTON.south;
  const pedals = pedalsFor(thumbs.scheme, { gas: strip.gas, brake: thumbs.brakePad ? 1 : strip.brake }, true);
  touch.gas = pedals.gas;
  touch.brake = pedals.brake;
  return touch;
}

/** The car's shaped drive after half a second of these thumbs at a steady forward speed: pad -> intent -> shaped drive. */
function driveFor(thumbs: Thumbs) {
  const pad = blankPad();
  mergeTouch(touchPadFor(thumbs), pad, 0);
  const intent = readIntent(new Set(), pad, blankIntent());
  const feel = { wheel: 0, gas: 0, brake: 0, brakeHeld: 0, pulse: 0 };
  const out = idleDrive();
  for (let slice = 0; slice < HALF_SECOND_SLICES; slice++) shapeDrive(intent, feel, FORWARD_SPEED, SLICE, out);
  return { intent, out };
}

describe("given a scripted two-thumb drive at speed", () => {
  const cases = [
    { it: "when Pedals gets half gas on the strip and a full right push on the bar, then it pulls and turns right with no brake", thumbs: { scheme: "pedals", steerPx: 60, stripAt: 0.6 }, wheel: "right", gas: "some", brake: false, ebrake: false, boost: false, pulls: true },
    { it: "when Pedals gets the foot of the strip and a right push, then it brakes hard and turns right", thumbs: { scheme: "pedals", steerPx: 60, stripAt: 0 }, wheel: "right", gas: "none", brake: true, ebrake: false, boost: false, pulls: false },
    { it: "when Pedals strip is in the coast band, then neither pedal is pressed", thumbs: { scheme: "pedals", stripAt: 0.34 }, wheel: "straight", gas: "none", brake: false, ebrake: false, boost: false, pulls: false },
    { it: "when Pedals steering thumb pulls down mid-steer with gas held, then the e-brake comes on while the wheel stays right and the gas stays asked for (a drift)", thumbs: { scheme: "pedals", steerPx: 60, pullPx: 60, stripAt: 0.6 }, wheel: "right", gas: "some", brake: false, ebrake: true, boost: false, pulls: false },
    { it: "when Pedals steering thumb only sits low in the bar, then the e-brake stays off", thumbs: { scheme: "pedals", steerPx: 60, pullPx: 36, stripAt: 0.6 }, wheel: "right", gas: "some", brake: false, ebrake: false, boost: false, pulls: true },
    { it: "when Pedals strip thumb slides into the cap, then it is full gas with Boost", thumbs: { scheme: "pedals", stripAt: 0.95 }, wheel: "straight", gas: "full", brake: false, ebrake: false, boost: true, pulls: true },
    { it: "when Easy has no thumb down, then the gas is on by itself and the wheel is straight", thumbs: { scheme: "autogas" }, wheel: "straight", gas: "full", brake: false, ebrake: false, boost: false, pulls: true },
    { it: "when Easy holds Brake and steers left, then it brakes and turns left with the gas off", thumbs: { scheme: "autogas", steerPx: -60, brakePad: true }, wheel: "left", gas: "none", brake: true, ebrake: false, boost: false, pulls: false },
    { it: "when Easy steering thumb pulls down mid-steer, then the e-brake comes on under the automatic gas", thumbs: { scheme: "autogas", steerPx: 60, pullPx: 60 }, wheel: "right", gas: "full", brake: false, ebrake: true, boost: false, pulls: false },
    { it: "when Tilt is turned right with half gas, then it pulls and turns right with the e-brake off", thumbs: { scheme: "tilt", tiltSteer: 0.8, stripAt: 0.6 }, wheel: "right", gas: "some", brake: false, ebrake: false, boost: false, pulls: true },
    { it: "when Tilt is turned left and the left thumb holds the e-brake pad with gas held, then the e-brake is on while the wheel stays left", thumbs: { scheme: "tilt", tiltSteer: -0.8, ebrakePad: true, stripAt: 0.6 }, wheel: "left", gas: "some", brake: false, ebrake: true, boost: false, pulls: false },
    { it: "when Tilt strip thumb is at the foot while it is turned, then it brakes and keeps turning", thumbs: { scheme: "tilt", tiltSteer: 0.8, stripAt: 0 }, wheel: "right", gas: "none", brake: true, ebrake: false, boost: false, pulls: false },
    { it: "when the Disc is pushed up and right, then it pulls and turns right (unchanged)", thumbs: { scheme: "stick", discPush: { x: 36, y: -36 } }, wheel: "right", gas: "some", brake: false, ebrake: false, boost: false, pulls: true },
    { it: "when the Disc is pushed down and the Handbrake button is held, then it brakes with the e-brake (unchanged)", thumbs: { scheme: "stick", discPush: { x: 0, y: 36 }, handbrakeButton: true }, wheel: "straight", gas: "none", brake: true, ebrake: true, boost: false, pulls: false },
  ] as const satisfies readonly { it: string; thumbs: Thumbs; wheel: "left" | "right" | "straight"; gas: "none" | "some" | "full"; brake: boolean; ebrake: boolean; boost: boolean; pulls: boolean }[];
  for (const testCase of cases) {
    it(testCase.it, () => {
      const { intent, out } = driveFor(testCase.thumbs);
      const wheel = intent.wheel > 0.3 ? "left" : intent.wheel < -0.3 ? "right" : "straight";
      const gas = intent.gas === 0 ? "none" : intent.gas < 0.99 ? "some" : "full";
      assert.equal(wheel, testCase.wheel, `wheel ${intent.wheel.toFixed(2)}`);
      assert.equal(gas, testCase.gas, `gas ${intent.gas.toFixed(2)}`);
      assert.equal(intent.brake > 0.5, testCase.brake, `brake ${intent.brake.toFixed(2)}`);
      assert.equal(out.ebrake, testCase.ebrake, "e-brake");
      assert.equal(intent.boost, testCase.boost, "boost");
      assert.equal(out.throttle > 0, testCase.pulls, `throttle ${out.throttle.toFixed(2)}`);
    });
  }
});
