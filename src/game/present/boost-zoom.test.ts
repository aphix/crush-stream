import { describe, expect, it } from "vitest";
import { FRAME_HZ } from "../kernel/constants.ts";
import { DRIVE } from "../vehicle/car-drive.ts";
import { BOOST_ZOOM_FULL_SPEED as FULL_SPEED, boostZoomStrength, easeBoostZoomSpeed, stepBoostZoom } from "./boost-zoom.ts";

const FRAME = 1 / FRAME_HZ;

/** The strength after one step of `seconds` wall s, boosting or not, from the ease's progress `from`: the spec's 0.25 s in and 0.4 s out. */
const EASE_CASES = [
  { it: "when the boost has run 0 s, then the strength is 0", from: 0, boosting: true, seconds: 0, expected: 0 },
  { it: "when the boost has run 1/16 s of its 0.25 s ease-in, then the strength is the smoothstep of a quarter, 0.15625", from: 0, boosting: true, seconds: 0.0625, expected: 0.15625 },
  { it: "when the boost has run half its ease-in, 0.125 s, then the strength is half", from: 0, boosting: true, seconds: 0.125, expected: 0.5 },
  { it: "when the boost has run 0.1875 s, then the strength is the smoothstep of three quarters, 0.84375", from: 0, boosting: true, seconds: 0.1875, expected: 0.84375 },
  { it: "when the boost has run 0.25 s, then the strength is full", from: 0, boosting: true, seconds: 0.25, expected: 1 },
  { it: "when the boost has run 2 s, then the strength stays at full", from: 0, boosting: true, seconds: 2, expected: 1 },
  { it: "when the boost has ended 0.1 s of the 0.4 s ease-out, then the strength is the smoothstep of three quarters, 0.84375", from: 1, boosting: false, seconds: 0.1, expected: 0.84375 },
  { it: "when the boost has ended half the ease-out, 0.2 s, then the strength is half", from: 1, boosting: false, seconds: 0.2, expected: 0.5 },
  { it: "when the boost has ended 0.3 s, then the strength is the smoothstep of a quarter, 0.15625", from: 1, boosting: false, seconds: 0.3, expected: 0.15625 },
  { it: "when the boost has ended 0.4 s, then the strength is 0", from: 1, boosting: false, seconds: 0.4, expected: 0 },
  { it: "when the boost has ended 3 s, then the strength stays at 0", from: 1, boosting: false, seconds: 3, expected: 0 },
] as const;

describe("given the boost zoom's ease at full speed", () => {
  for (const testCase of EASE_CASES) {
    it(testCase.it, () => {
      const strength = boostZoomStrength(stepBoostZoom(testCase.from, testCase.boosting, testCase.seconds), FULL_SPEED);
      expect(Math.abs(strength - testCase.expected), `strength ${strength} vs ${testCase.expected}`).toBeLessThan(1e-9);
    });
  }

  it(`when it runs frame by frame at ${FRAME_HZ} Hz, then it rises to full in 0.25 s and falls to 0 in 0.4 s, never reversing or jumping a fifth in a frame`, () => {
    let progress = 0;
    let last = 0;
    let frames = 0;
    for (; boostZoomStrength(progress, FULL_SPEED) < 1 && frames < 600; frames++) {
      progress = stepBoostZoom(progress, true, FRAME);
      const strength = boostZoomStrength(progress, FULL_SPEED);
      expect(strength >= last && strength - last <= 0.2, `a frame rose ${last} -> ${strength}`).toBeTruthy();
      last = strength;
    }
    expect(frames, "frames to full").toBe(Math.ceil(0.25 * FRAME_HZ - 1e-9));
    frames = 0;
    for (; boostZoomStrength(progress, FULL_SPEED) > 0 && frames < 600; frames++) {
      progress = stepBoostZoom(progress, false, FRAME);
      const strength = boostZoomStrength(progress, FULL_SPEED);
      expect(strength <= last && last - strength <= 0.2, `a frame fell ${last} -> ${strength}`).toBeTruthy();
      last = strength;
    }
    expect(frames, "frames to zero").toBe(Math.ceil(0.4 * FRAME_HZ - 1e-9));
  });

  it("when the boost is released half way up, then the ease turns round from where it stood and never jumps", () => {
    const up = stepBoostZoom(0, true, 0.125);
    const down = stepBoostZoom(up, false, FRAME);
    expect(up - down > 0 && up - down < 0.1, `progress ${up} -> ${down}`).toBeTruthy();
    expect(Math.abs(boostZoomStrength(up, FULL_SPEED) - 0.5), "the turn starts at the half-way strength").toBeLessThan(1e-9);
  });
});

const SPEED_CASES = [
  { it: "when the car stands still at full ease, then there is no zoom", speed: 0, expected: 0 },
  { it: "when the car is at half the full speed, then half the zoom", speed: FULL_SPEED / 2, expected: 0.5 },
  { it: "when the car is at the full speed, then the full zoom", speed: FULL_SPEED, expected: 1 },
  { it: "when the car is far past the full speed, then the zoom holds at full", speed: DRIVE.maxFwd * 3, expected: 1 },
  { it: "when the car runs backwards, then there is no zoom", speed: -20, expected: 0 },
] as const;

describe("given the boost zoom fully eased in, and a car at some speed", () => {
  for (const testCase of SPEED_CASES) {
    it(testCase.it, () => {
      expect(Math.abs(boostZoomStrength(1, testCase.speed) - testCase.expected), `${boostZoomStrength(1, testCase.speed)} vs ${testCase.expected}`).toBeLessThan(1e-9);
    });
  }
});

describe("given the speed the boost zoom scales by, following a watched car's", () => {
  it("when the watched car's speed jumps by 20 m/s, then each frame moves the held speed part of the way, never backwards, and it lands exactly on the car's", () => {
    let held = 0;
    let frames = 0;
    for (; held !== 20 && frames < 600; frames++) {
      const next = easeBoostZoomSpeed(held, 20, FRAME);
      expect(next >= held && next - held <= 20 * 0.2, `a frame moved the speed ${held} -> ${next}`).toBeTruthy();
      held = next;
    }
    expect(held, "lands exactly").toBe(20);
    expect(frames * FRAME > 0.15 && frames * FRAME < 0.8, `took ${(frames * FRAME).toFixed(2)} s`).toBeTruthy();
  });

  it("when the watched car and the held speed are both 0, then the held speed stays exactly 0", () => {
    expect(easeBoostZoomSpeed(0, 0, FRAME)).toBe(0);
  });
});
