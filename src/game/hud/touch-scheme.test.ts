import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { blankPad, mergeTouch, readPad } from "../vehicle/gamepad.ts";
import { DEFAULT_TOUCH_SCHEME, discReading, parseMirror, parseTouchScheme, pedalsFor, schemeLayout, sliderSteer, TOUCH_SCHEMES, TOUCH_SCHEME_HINT, TOUCH_SCHEME_LABEL } from "./touch-scheme.ts";

const none = { gas: false, brake: false };

describe("given the stored touch scheme", () => {
  it("when nothing or an unknown value is stored, then it is the driving disc", () => {
    assert.equal(DEFAULT_TOUCH_SCHEME, "stick");
    assert.equal(parseTouchScheme(""), "stick");
    assert.equal(parseTouchScheme("wheel"), "stick");
    assert.equal(schemeLayout(DEFAULT_TOUCH_SCHEME).steer, "stick");
  });

  it("when each scheme's id is stored, then it reads back as itself, with a label and a hint", () => {
    for (const scheme of TOUCH_SCHEMES) {
      assert.equal(parseTouchScheme(scheme), scheme);
      assert.ok(TOUCH_SCHEME_LABEL[scheme].length > 0 && TOUCH_SCHEME_HINT[scheme].length > 0, scheme);
    }
  });

  it("when the mirror flag is read, then only '1' is on", () => {
    assert.equal(parseMirror("1"), true);
    assert.equal(parseMirror(""), false);
    assert.equal(parseMirror("0"), false);
  });
});

describe("given a scheme's pedals", () => {
  const cases = [
    { it: "when Easy has no finger down, then the gas is on by itself", scheme: "autogas", fingers: none, expected: { gas: 1, brake: 0 } },
    { it: "when Easy's Brake is held, then the gas lifts and the brake is full", scheme: "autogas", fingers: { gas: false, brake: true }, expected: { gas: 0, brake: 1 } },
    { it: "when Easy is shown a Gas finger, then there is no Gas pedal to hold and nothing changes", scheme: "autogas", fingers: { gas: true, brake: false }, expected: { gas: 1, brake: 0 } },
    { it: "when Tilt has no finger down, then the gas is on by itself", scheme: "tilt", fingers: none, expected: { gas: 1, brake: 0 } },
    { it: "when Tilt's Brake is held, then the gas lifts and the brake is full", scheme: "tilt", fingers: { gas: false, brake: true }, expected: { gas: 0, brake: 1 } },
    { it: "when Pedals has no finger down, then there is no gas and no brake", scheme: "pedals", fingers: none, expected: { gas: 0, brake: 0 } },
    { it: "when Pedals' Gas is held, then the gas is full", scheme: "pedals", fingers: { gas: true, brake: false }, expected: { gas: 1, brake: 0 } },
    { it: "when Pedals' Brake is held, then the brake is full", scheme: "pedals", fingers: { gas: false, brake: true }, expected: { gas: 0, brake: 1 } },
    { it: "when Pedals has both held, then the brake wins", scheme: "pedals", fingers: { gas: true, brake: true }, expected: { gas: 0, brake: 1 } },
    { it: "when Stick has fingers on screen, then the pedals stay at zero (the stick owns them)", scheme: "stick", fingers: { gas: true, brake: true }, expected: { gas: 0, brake: 0 } },
  ] as const;
  for (const testCase of cases) {
    it(testCase.it, () => {
      const pedals = pedalsFor(testCase.scheme, testCase.fingers, true);
      assert.equal(pedals.gas, testCase.expected.gas, "gas");
      assert.equal(pedals.brake, testCase.expected.brake, "brake");
    });
  }

  it("when the car is not the player's to drive, then no scheme writes a pedal", () => {
    for (const scheme of TOUCH_SCHEMES) assert.deepEqual(pedalsFor(scheme, { gas: true, brake: true }, false), { gas: 0, brake: 0 }, scheme);
  });
});

describe("given each scheme's layout", () => {
  it("when Easy and Tilt are drawn, then they have a Brake and no Gas pedal, and Pedals has both", () => {
    assert.deepEqual([schemeLayout("autogas").gasPedal, schemeLayout("autogas").brakePedal], [false, true]);
    assert.deepEqual([schemeLayout("tilt").gasPedal, schemeLayout("tilt").brakePedal], [false, true]);
    assert.deepEqual([schemeLayout("pedals").gasPedal, schemeLayout("pedals").brakePedal], [true, true]);
  });

  it("when Stick is drawn, then it has the stick and neither pedal", () => {
    assert.deepEqual(schemeLayout("stick"), { steer: "stick", gasPedal: false, brakePedal: false, autoGas: false });
  });
});

describe("given the steering slider", () => {
  it("when the finger is left of centre, then it steers left in the stick's signs, linearly", () => {
    assert.equal(sliderSteer(-44, 88), -0.5);
    assert.equal(sliderSteer(22, 88), 0.25);
  });

  it("when the finger is past the bar's end or the bar has no length, then it clamps and never divides by zero", () => {
    assert.equal(sliderSteer(500, 88), 1);
    assert.equal(sliderSteer(-500, 88), -1);
    assert.equal(sliderSteer(10, 0), 0);
  });
});

describe("given the driving disc's reading", () => {
  /** What the pad turns a reading into (the stick's deadzone and curve), to be compared with the offset the thumb made. */
  const throughPad = (reading: { x: number; y: number }) => {
    const pad = blankPad();
    readPad(null, pad);
    mergeTouch({ x: reading.x, y: reading.y, gas: 0, brake: 0, held: 0, tapped: 0 }, pad, 0);
    return pad;
  };

  it("when the thumb rests on the middle, then the disc reads nothing", () => {
    assert.deepEqual(discReading(0, 0), { x: 0, y: 0 });
    assert.deepEqual(discReading(0.02, -0.02), { x: 0, y: 0 });
  });

  const nudges = [0.1, 0.25, 0.5, 1];
  for (const offset of nudges) {
    it(`when the thumb pushes up ${offset} of the way, then the car gets ${offset} of the gas, and the same down is that much brake`, () => {
      const up = throughPad(discReading(0, -offset));
      assert.ok(Math.abs(up.rt - offset) < 1e-9, `gas ${up.rt}`);
      const down = throughPad(discReading(0, offset));
      assert.ok(Math.abs(down.lt - offset) < 1e-9, `brake ${down.lt}`);
    });
  }

  it("when the thumb pushes a little sideways, then the wheel gets that little, to the side the thumb went", () => {
    const right = throughPad(discReading(0.2, 0));
    assert.ok(Math.abs(right.lx - 0.2) < 1e-9, `right ${right.lx}`);
    const left = throughPad(discReading(-0.2, 0));
    assert.ok(Math.abs(left.lx + 0.2) < 1e-9, `left ${left.lx}`);
  });

  it("when the thumb goes past the rim, then it stays at one", () => {
    const far = discReading(0, -3);
    assert.ok(Math.hypot(far.x, far.y) <= 1 + 1e-9);
  });
});
