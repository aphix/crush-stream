import { describe, expect, it } from "vitest";
import { blankPad, mergeTouch, PAD_BUTTON, PAD_DEAD, padButtonName, padFamily, padLabel, readPad, stickScale, triggerValue, type PadSource } from "./gamepad.ts";
import { blankIntent, readIntent, shapeDrive } from "./drive-input.ts";
import { idleDrive } from "./car-drive.ts";
import { assertSameDigest } from "./test-support.ts";
import { FRAME_HZ } from "../kernel/constants.ts";

/** A connected standard-mapping pad: `down` lists held button indices. */
function pad(axes: number[], down: number[] = [], lt = 0, rt = 0): PadSource {
  const buttons = Array.from({ length: 17 }, (_, i) => {
    const value = i === PAD_BUTTON.lt ? lt : i === PAD_BUTTON.rt ? rt : down.includes(i) ? 1 : 0;
    return { pressed: value > 0.5, value };
  });
  return { connected: true, axes, buttons };
}

describe("given a gamepad's sticks and triggers", () => {
  it("when a stick rests inside the radial deadzone, then it reads exactly zero in any direction", () => {
    expect(stickScale(0.1, 0)).toBe(0);
    expect(stickScale(0.1, -0.1)).toBe(0);
    expect(stickScale(0, PAD_DEAD.stick * 0.99)).toBe(0);
    expect(stickScale(0.12, 0.12), "a diagonal past the radius must register").toBeGreaterThan(0);
  });

  it("when a stick is pushed to full throw, then it reaches 1 and a diagonal corner never exceeds 1", () => {
    expect(Math.abs(1 * stickScale(1, 0) - 1)).toBeLessThan(1e-9);
    const s = stickScale(1, 1);
    expect(Math.hypot(s, s), `corner magnitude ${Math.hypot(s, s)}`).toBeLessThanOrEqual(1 + 1e-9);
  });

  it("when a stick moves through its range, then the curve is gentler than linear mid-throw and continuous at the deadzone edge", () => {
    const mid = PAD_DEAD.stick + (1 - PAD_DEAD.stick) * 0.5;
    expect(mid * stickScale(mid, 0), "mid-throw should steer less than half lock").toBeLessThan(0.5);
    const edge = PAD_DEAD.stick + 1e-3;
    expect(edge * stickScale(edge, 0), "no step at the deadzone edge").toBeLessThan(1e-3);
    let last = 0;
    for (let x = 0; x <= 1; x += 0.01) {
      const out = x * stickScale(x, 0);
      expect(out, `non-monotonic at ${x}`).toBeGreaterThanOrEqual(last - 1e-12);
      last = out;
    }
  });

  it("when a trigger is pulled, then it ignores resting noise and reaches 1 at full pull", () => {
    expect(triggerValue(PAD_DEAD.trigger * 0.9)).toBe(0);
    expect(triggerValue(1)).toBe(1);
    expect(triggerValue(0.5) > 0.4 && triggerValue(0.5) < 0.5).toBeTruthy();
  });
});

describe("given a gamepad being polled", () => {
  it("when a button goes down, then it reports pressed only on the poll it went down", () => {
    const s = blankPad();
    const bit = 1 << PAD_BUTTON.north;
    readPad(pad([0, 0, 0, 0], [PAD_BUTTON.north]), s);
    expect(s.pressed & bit).toBe(bit);
    readPad(pad([0, 0, 0, 0], [PAD_BUTTON.north]), s);
    expect(s.pressed & bit, "held, not pressed again").toBe(0);
    expect(s.held & bit).toBe(bit);
    readPad(pad([0, 0, 0, 0]), s);
    readPad(pad([0, 0, 0, 0], [PAD_BUTTON.north]), s);
    expect(s.pressed & bit, "a second press registers").toBe(bit);
  });

  it("when the pad is unplugged, then every axis and button reads zero", () => {
    const s = blankPad();
    readPad(pad([-1, 0, 1, 0], [PAD_BUTTON.south], 1, 1), s);
    expect(s.connected && s.lx < -0.9 && s.rt === 1).toBeTruthy();
    readPad(null, s);
    assertSameDigest({ ...s }, blankPad(), "unplugged pad");
    readPad({ ...pad([-1, 0, 0, 0]), connected: false }, s);
    expect(s.lx).toBe(0);
  });

  const idCases = [
    { it: "when Chrome names an Xbox One pad, then it is Xbox", id: "Xbox Wireless Controller (STANDARD GAMEPAD Vendor: 045e Product: 0b13)", expectedFamily: "xbox", expectedLabel: "Xbox controller" },
    { it: "when Chrome names an Xbox 360 pad through XInput, then it is Xbox", id: "Xbox 360 Controller (XInput STANDARD GAMEPAD)", expectedFamily: "xbox", expectedLabel: "Xbox controller" },
    { it: "when Firefox names an Xbox pad by vendor and product, then it is Xbox", id: "045e-0b13-Xbox Wireless Controller", expectedFamily: "xbox", expectedLabel: "Xbox controller" },
    { it: "when Chrome names a DualSense, then it is PlayStation", id: "DualSense Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 0ce6)", expectedFamily: "playstation", expectedLabel: "PlayStation controller" },
    { it: "when Chrome names a DualShock 4 'Wireless Controller', then it is PlayStation", id: "Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 09cc)", expectedFamily: "playstation", expectedLabel: "PlayStation controller" },
    { it: "when Firefox names a DualSense by vendor and product, then it is PlayStation", id: "054c-0ce6-DualSense Wireless Controller", expectedFamily: "playstation", expectedLabel: "PlayStation controller" },
    { it: "when Firefox names a DualShock 4 by vendor and product, then it is PlayStation", id: "054c-09cc-Wireless Controller", expectedFamily: "playstation", expectedLabel: "PlayStation controller" },
    { it: "when a bare 'Wireless Controller' names no vendor, then it is PlayStation", id: "Wireless Controller", expectedFamily: "playstation", expectedLabel: "PlayStation controller" },
    { it: "when a generic joystick is named, then it is generic", id: "Generic USB Joystick", expectedFamily: "generic", expectedLabel: "Controller" },
  ] as const;
  for (const testCase of idCases) {
    it(testCase.it, () => {
      expect(padFamily(testCase.id), "family").toBe(testCase.expectedFamily);
      expect(padLabel(testCase.id), "label").toBe(testCase.expectedLabel);
    });
  }

  const buttonCases = [
    { it: "when an Xbox pad's four face buttons are named, then they are A, B, X and Y", family: "xbox", expectedNames: ["A", "B", "X", "Y"] },
    { it: "when a PlayStation pad's four face buttons are named, then they are Cross, Circle, Square and Triangle", family: "playstation", expectedNames: ["Cross", "Circle", "Square", "Triangle"] },
    { it: "when a generic pad's four face buttons are named, then they follow the Xbox layout", family: "generic", expectedNames: ["A", "B", "X", "Y"] },
  ] as const;
  for (const testCase of buttonCases) {
    it(testCase.it, () => {
      const faceButtons = [PAD_BUTTON.south, PAD_BUTTON.east, PAD_BUTTON.west, PAD_BUTTON.north];
      for (let at = 0; at < faceButtons.length; at++) expect(padButtonName(testCase.family, faceButtons[at]!), `face button ${at}`).toBe(testCase.expectedNames[at]);
    });
  }
});

describe("given a gamepad driving a car", () => {
  it("when the right trigger is held with the left stick pushed left, then the car gets gas and a left yaw (positive steer) rolling forward, and a right push steers the other way", () => {
    const s = blankPad();
    readPad(pad([-1, 0, 0, 0], [], 0, 1), s);
    const intent = readIntent(new Set(), s, blankIntent());
    expect(intent.wheel > 0.99 && intent.analogWheel).toBeTruthy();
    expect(intent.gas).toBe(1);
    const feel = { wheel: 0, gas: 0, brake: 0, brakeHeld: 0, pulse: 0 };
    const out = idleDrive();
    for (let i = 0; i < 30; i++) shapeDrive(intent, feel, 6, 1 / FRAME_HZ, out);
    expect(out.steer, `steer ${out.steer}`).toBeGreaterThan(0.5);
    expect(out.throttle).toBe(1);
    readPad(pad([1, 0, 0, 0], [], 0, 1), s);
    readIntent(new Set(), s, intent);
    for (let i = 0; i < 30; i++) shapeDrive(intent, feel, 6, 1 / FRAME_HZ, out);
    expect(out.steer, `stick right steer ${out.steer}`).toBeLessThan(-0.5);
  });

  it("when the left trigger is pulled, then it is an analog brake and, once stopped, reverse", () => {
    const s = blankPad();
    readPad(pad([0, 0, 0, 0], [], 0.6, 0), s);
    const intent = readIntent(new Set(), s, blankIntent());
    const feel = { wheel: 0, gas: 0, brake: 0, brakeHeld: 0, pulse: 0 };
    const out = idleDrive();
    shapeDrive(intent, feel, 8, 1 / FRAME_HZ, out);
    expect(Math.abs(out.brake - triggerValue(0.6)) < 1e-9 && out.throttle === 0, "partial pull = partial brake, no ramp").toBeTruthy();
    shapeDrive(intent, feel, 0, 1 / FRAME_HZ, out);
    expect(out.throttle < 0 && out.brake === 0).toBeTruthy();
  });

  it("when keyboard and pad inputs are used together, then per axis the larger magnitude wins", () => {
    const s = blankPad();
    readPad(pad([-0.4, 0, 0, 0], [], 0.4, 0), s);
    const i = readIntent(new Set(["KeyD", "KeyW"]), s, blankIntent());
    expect(i.wheel, "full D beats a light left stick").toBe(-1);
    expect(i.analogWheel).toBe(false);
    expect(i.gas).toBe(1);
    expect(i.brake > 0 && i.analogBrake, "LT still reads while W is held").toBeTruthy();
    readPad(pad([-1, 0, 0, 0]), s);
    readIntent(new Set(), s, i);
    expect(i.wheel > 0.99 && i.analogWheel).toBeTruthy();
  });

  it("when X (Square) and A (Cross) are pressed, then they act as the handbrake and the boost, alongside Space and Shift", () => {
    const s = blankPad();
    readPad(pad([0, 0, 0, 0], [PAD_BUTTON.west, PAD_BUTTON.south]), s);
    const i = readIntent(new Set(), s, blankIntent());
    expect(i.handbrake && i.boost).toBeTruthy();
    readPad(pad([0, 0, 0, 0], [PAD_BUTTON.east]), s);
    readIntent(new Set(), s, i);
    expect(!i.handbrake && !i.boost).toBeTruthy();
    readIntent(new Set(["Space", "ShiftRight"]), null, i);
    expect(i.handbrake && i.boost).toBeTruthy();
  });

  it("when A (Cross) alone is held, then it is the boost and not the handbrake, and X (Square) alone is the handbrake and not the boost", () => {
    const s = blankPad();
    readPad(pad([0, 0, 0, 0], [PAD_BUTTON.south]), s);
    const i = readIntent(new Set(), s, blankIntent());
    expect(i.boost && !i.handbrake, `A: boost ${i.boost} handbrake ${i.handbrake}`).toBeTruthy();
    readPad(pad([0, 0, 0, 0], [PAD_BUTTON.west]), s);
    readIntent(new Set(), s, i);
    expect(i.handbrake && !i.boost, `X: boost ${i.boost} handbrake ${i.handbrake}`).toBeTruthy();
  });

  it("when the touch stick is held up-left with no pad plugged in, then it is gas and a left wheel, and a sub-frame tap still presses once", () => {
    const s = blankPad();
    const t = { x: -0.7, y: -0.7, gas: 0, brake: 0, held: 0, tapped: 0 };
    readPad(null, s);
    mergeTouch(t, s, 0);
    const i = readIntent(new Set(), s, blankIntent());
    expect(i.wheel > 0.5 && i.analogWheel, `wheel ${i.wheel}`).toBeTruthy();
    expect(i.gas > 0.5 && i.brake === 0, `gas ${i.gas} brake ${i.brake}`).toBeTruthy();
    t.x = 0;
    t.y = 1;
    readPad(null, s);
    mergeTouch(t, s, s.held);
    const down = readIntent(new Set(), s, i);
    expect(down.brake === 1 && down.gas === 0, "stick down brakes, then reverses").toBeTruthy();
    const view = 1 << PAD_BUTTON.north;
    t.y = 0;
    t.tapped = view;
    let prev = s.held;
    readPad(null, s);
    mergeTouch(t, s, prev);
    expect(s.pressed & view, "tap released before the poll").toBe(view);
    prev = s.held;
    readPad(null, s);
    mergeTouch(t, s, prev);
    expect(s.pressed, "one tap, one press").toBe(0);
  });
});

describe("given the touch pedals", () => {
  const resting = () => ({ x: 0, y: 0, gas: 0, brake: 0, held: 0, tapped: 0 });

  it("when only the gas pedal is down with no pad plugged in, then it is full gas, no brake and a centred wheel, and it connects the touch pad", () => {
    const s = blankPad();
    readPad(null, s);
    mergeTouch({ ...resting(), gas: 1 }, s, 0);
    const i = readIntent(new Set(), s, blankIntent());
    expect(s.connected, "a pedal alone counts as the touch pad being in use").toBeTruthy();
    expect(i.gas).toBe(1);
    expect(i.brake).toBe(0);
    expect(i.wheel).toBe(0);
  });

  it("when the brake pedal is down, then it is full brake and, once stopped, reverse like the stick's down", () => {
    const s = blankPad();
    readPad(null, s);
    mergeTouch({ ...resting(), brake: 1 }, s, 0);
    const i = readIntent(new Set(), s, blankIntent());
    expect(i.brake).toBe(1);
    expect(i.gas).toBe(0);
    const out = idleDrive();
    shapeDrive(i, { wheel: 0, gas: 0, brake: 0, brakeHeld: 0, pulse: 0 }, 0, 1 / FRAME_HZ, out);
    expect(out.throttle < 0 && out.brake === 0, `standing still reverses: throttle ${out.throttle} brake ${out.brake}`).toBeTruthy();
  });

  it("when the stick steers half right while the gas pedal is down, then the steering is the stick's own scaled value and the gas is full", () => {
    const s = blankPad();
    readPad(null, s);
    mergeTouch({ ...resting(), x: 0.5, gas: 1 }, s, 0);
    expect(Math.abs(s.lx - 0.5 * stickScale(0.5, 0)), `lx ${s.lx}`).toBeLessThan(1e-9);
    expect(s.rt).toBe(1);
    expect(s.lt).toBe(0);
  });

  it("when the stick is pushed up and the gas pedal is half down, then the larger of the two wins", () => {
    const s = blankPad();
    readPad(null, s);
    mergeTouch({ ...resting(), y: -1, gas: 0.25 }, s, 0);
    expect(s.rt).toBe(1);
    readPad(null, s);
    mergeTouch({ ...resting(), y: -0.1, gas: 0.25 }, s, 0);
    expect(s.rt).toBe(0.25);
  });

  it("when nothing is touched, then the pad stays disconnected", () => {
    const s = blankPad();
    readPad(null, s);
    mergeTouch(resting(), s, 0);
    expect(s.connected).toBe(false);
    expect(s.rt + s.lt).toBe(0);
  });
});
