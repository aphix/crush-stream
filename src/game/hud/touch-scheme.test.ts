import { describe, expect, it } from "vitest";
import { blankPad, mergeTouch, readPad } from "../vehicle/gamepad.ts";
import { DEFAULT_TOUCH_SCHEME, discReading, EBRAKE_PULL, parseMirror, parseTouchScheme, pedalsFor, pulledDown, schemeLayout, sliderSteer, STRIP, stripReading, TOUCH_SCHEMES, TOUCH_SCHEME_HINT, TOUCH_SCHEME_LABEL } from "./touch-scheme.ts";

const none = { gas: 0, brake: 0 };

describe("given the stored touch scheme", () => {
  it("when nothing or an unknown value is stored, then it is the driving disc", () => {
    expect(DEFAULT_TOUCH_SCHEME).toBe("stick");
    expect(parseTouchScheme("")).toBe("stick");
    expect(parseTouchScheme("wheel")).toBe("stick");
    expect(schemeLayout(DEFAULT_TOUCH_SCHEME).steer).toBe("stick");
  });

  it("when each scheme's id is stored, then it reads back as itself, with a label and a hint", () => {
    for (const scheme of TOUCH_SCHEMES) {
      expect(parseTouchScheme(scheme)).toBe(scheme);
      expect(TOUCH_SCHEME_LABEL[scheme].length > 0 && TOUCH_SCHEME_HINT[scheme].length > 0, scheme).toBeTruthy();
    }
  });

  it("when the mirror flag is read, then only '1' is on", () => {
    expect(parseMirror("1")).toBe(true);
    expect(parseMirror("")).toBe(false);
    expect(parseMirror("0")).toBe(false);
  });
});

describe("given a scheme's pedals", () => {
  const testCases = [
    { it: "when Easy has no finger down, then the gas is on by itself", scheme: "autogas", thumb: none, expected: { gas: 1, brake: 0 } },
    { it: "when Easy's Brake is held, then the gas lifts and the brake is full", scheme: "autogas", thumb: { gas: 0, brake: 1 }, expected: { gas: 0, brake: 1 } },
    { it: "when Easy is shown a gas reading, then it is ignored: the gas is its own", scheme: "autogas", thumb: { gas: 0.3, brake: 0 }, expected: { gas: 1, brake: 0 } },
    { it: "when Tilt's strip is untouched, then there is no gas and no brake", scheme: "tilt", thumb: none, expected: { gas: 0, brake: 0 } },
    { it: "when Tilt's strip reads half gas, then the gas is a half", scheme: "tilt", thumb: { gas: 0.5, brake: 0 }, expected: { gas: 0.5, brake: 0 } },
    { it: "when Tilt's strip reads a brake, then the brake is that much and the gas is none", scheme: "tilt", thumb: { gas: 0, brake: 0.6 }, expected: { gas: 0, brake: 0.6 } },
    { it: "when Pedals' strip is untouched, then there is no gas and no brake", scheme: "pedals", thumb: none, expected: { gas: 0, brake: 0 } },
    { it: "when Pedals' strip reads full gas, then the gas is full", scheme: "pedals", thumb: { gas: 1, brake: 0 }, expected: { gas: 1, brake: 0 } },
    { it: "when Pedals is given both, then the brake wins", scheme: "pedals", thumb: { gas: 1, brake: 1 }, expected: { gas: 0, brake: 1 } },
    { it: "when Stick is given a reading, then the pedals stay at zero (the disc owns them)", scheme: "stick", thumb: { gas: 1, brake: 1 }, expected: { gas: 0, brake: 0 } },
  ] as const;
  for (const testCase of testCases) {
    it(testCase.it, () => {
      const pedals = pedalsFor(testCase.scheme, testCase.thumb, true);
      expect(pedals.gas, "gas").toBe(testCase.expected.gas);
      expect(pedals.brake, "brake").toBe(testCase.expected.brake);
    });
  }

  it("when the car is not the player's to drive, then no scheme writes a pedal", () => {
    for (const scheme of TOUCH_SCHEMES) {
      const pedals = pedalsFor(scheme, { gas: 1, brake: 1 }, false);
      expect(pedals.gas, `${scheme} gas`).toBe(0);
      expect(pedals.brake, `${scheme} brake`).toBe(0);
    }
  });
});

describe("given each scheme's layout", () => {
  const testCases = [
    { it: "when Easy is drawn, then it has a Brake pad over automatic gas and the e-brake pulled down on the bar", scheme: "autogas", steer: "slider", right: "brake", ebrake: "pull", autoGas: true },
    { it: "when Pedals is drawn, then it has the pedal strip and the e-brake pulled down on the bar", scheme: "pedals", steer: "slider", right: "strip", ebrake: "pull", autoGas: false },
    { it: "when Tilt is drawn, then it has the pedal strip and an e-brake pad under the left thumb", scheme: "tilt", steer: "tilt", right: "strip", ebrake: "pad", autoGas: false },
    { it: "when Stick is drawn, then it keeps the disc with Boost and Handbrake buttons on the right", scheme: "stick", steer: "stick", right: "buttons", ebrake: "button", autoGas: false },
  ] as const;
  for (const testCase of testCases) {
    it(testCase.it, () => {
      const layout = schemeLayout(testCase.scheme);
      expect(layout.steer, "steer").toBe(testCase.steer);
      expect(layout.right, "right").toBe(testCase.right);
      expect(layout.ebrake, "ebrake").toBe(testCase.ebrake);
      expect(layout.autoGas, "autoGas").toBe(testCase.autoGas);
    });
  }
});

describe("given the pedal strip", () => {
  const testCases = [
    { it: "when the thumb is at the foot, then the brake is full", position: 0, gas: 0, brake: 1, boost: false },
    { it: "when the thumb is halfway up the brake zone, then the brake is a half", position: STRIP.brakeTop / 2, gas: 0, brake: 0.5, boost: false },
    { it: "when the thumb is at the top of the brake zone, then nothing is pressed", position: STRIP.brakeTop, gas: 0, brake: 0, boost: false },
    { it: "when the thumb is in the coast band, then nothing is pressed", position: (STRIP.brakeTop + STRIP.coastTop) / 2, gas: 0, brake: 0, boost: false },
    { it: "when the thumb is halfway up the gas zone, then the gas is a half", position: (STRIP.coastTop + STRIP.gasTop) / 2, gas: 0.5, brake: 0, boost: false },
    { it: "when the thumb enters the cap, then the gas is full and Boost is asked", position: STRIP.gasTop, gas: 1, brake: 0, boost: true },
    { it: "when the thumb is past either end, then it clamps to the end's reading", position: 1.5, gas: 1, brake: 0, boost: true },
    { it: "when the thumb is below the foot, then the brake is full", position: -0.5, gas: 0, brake: 1, boost: false },
  ] as const;
  for (const testCase of testCases) {
    it(testCase.it, () => {
      const reading = stripReading(testCase.position);
      expect(Math.abs(reading.gas - testCase.gas), `gas ${reading.gas}`).toBeLessThan(1e-9);
      expect(Math.abs(reading.brake - testCase.brake), `brake ${reading.brake}`).toBeLessThan(1e-9);
      expect(reading.boost, "boost").toBe(testCase.boost);
    });
  }
});

describe("given the e-brake pull on the steering bar", () => {
  const middle = 700;
  const testCases = [
    { it: "when the thumb rests at the bar's middle, then the e-brake is off", held: false, fingerY: middle, expected: false },
    { it: "when the thumb is pulled less than the pull distance, then the e-brake is still off", held: false, fingerY: middle + EBRAKE_PULL.on, expected: false },
    { it: "when the thumb is pulled past the pull distance, then the e-brake is on", held: false, fingerY: middle + EBRAKE_PULL.on + 1, expected: true },
    { it: "when the e-brake is on and the thumb eases back above the let-go distance, then it stays on", held: true, fingerY: middle + EBRAKE_PULL.off + 1, expected: true },
    { it: "when the e-brake is on and the thumb comes back past the let-go distance, then it lets go", held: true, fingerY: middle + EBRAKE_PULL.off, expected: false },
    { it: "when the thumb goes up from the middle, then the e-brake is off", held: false, fingerY: middle - 60, expected: false },
  ] as const;
  for (const testCase of testCases) {
    it(testCase.it, () => {
      expect(pulledDown(testCase.held, testCase.fingerY, middle)).toBe(testCase.expected);
    });
  }
});

describe("given the steering slider", () => {
  it("when the finger is left of centre, then it steers left in the stick's signs, linearly", () => {
    expect(sliderSteer(-44, 88)).toBe(-0.5);
    expect(sliderSteer(22, 88)).toBe(0.25);
  });

  it("when the finger is past the bar's end or the bar has no length, then it clamps and never divides by zero", () => {
    expect(sliderSteer(500, 88)).toBe(1);
    expect(sliderSteer(-500, 88)).toBe(-1);
    expect(sliderSteer(10, 0)).toBe(0);
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
    const centre = discReading(0, 0);
    expect(centre.x, "centre x").toBe(0);
    expect(centre.y, "centre y").toBe(0);
    const jitter = discReading(0.02, -0.02);
    expect(jitter.x, "jitter x").toBe(0);
    expect(jitter.y, "jitter y").toBe(0);
  });

  const nudges = [0.1, 0.25, 0.5, 1];
  for (const offset of nudges) {
    it(`when the thumb pushes up ${offset} of the way, then the car gets ${offset} of the gas, and the same down is that much brake`, () => {
      const up = throughPad(discReading(0, -offset));
      expect(Math.abs(up.rt - offset), `gas ${up.rt}`).toBeLessThan(1e-9);
      const down = throughPad(discReading(0, offset));
      expect(Math.abs(down.lt - offset), `brake ${down.lt}`).toBeLessThan(1e-9);
    });
  }

  it("when the thumb pushes a little sideways, then the wheel gets that little, to the side the thumb went", () => {
    const right = throughPad(discReading(0.2, 0));
    expect(Math.abs(right.lx - 0.2), `right ${right.lx}`).toBeLessThan(1e-9);
    const left = throughPad(discReading(-0.2, 0));
    expect(Math.abs(left.lx + 0.2), `left ${left.lx}`).toBeLessThan(1e-9);
  });

  it("when the thumb goes past the rim, then it stays at one", () => {
    const far = discReading(0, -3);
    expect(Math.hypot(far.x, far.y)).toBeLessThanOrEqual(1 + 1e-9);
  });
});
