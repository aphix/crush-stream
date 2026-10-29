import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { aroundCentre, parseTiltSettings, TILT, tiltSteer, wheelAngle } from "./tilt-steer.ts";

const near = (actual: number, expected: number, message: string) => assert.ok(Math.abs(actual - expected) < 1e-6, `${message}: ${actual} vs ${expected}`);

describe("given the phone's orientation angles", () => {
  // Each attitude is a 20 degree clockwise turn of the wheel (the screen's right side down) in a different screen rotation,
  // worked out by hand from world-down in the device frame (cos b sin g, -sin b, -cos b cos g).
  const clockwise20 = [
    { it: "when it is held upright in portrait, then the wheel reads 20", beta: 70, gamma: 90, screenAngle: 0 },
    { it: "when it is held upright in landscape with the top to the left, then the wheel reads 20", beta: 20, gamma: -90, screenAngle: 90 },
    { it: "when it is held upright in landscape with the top to the right, then the wheel reads 20", beta: -20, gamma: 90, screenAngle: 270 },
    { it: "when it is held upright upside down, then the wheel reads 20", beta: -70, gamma: -90, screenAngle: 180 },
  ] as const;
  for (const attitude of clockwise20) {
    it(attitude.it, () => near(wheelAngle(attitude.beta, attitude.gamma, attitude.screenAngle), 20, "clockwise 20"));
  }

  it("when the wheel is level, then it reads zero in every rotation", () => {
    near(wheelAngle(90, 0, 0), 0, "portrait");
    near(wheelAngle(0, -90, 90), 0, "landscape left");
    near(wheelAngle(0, 90, 270), 0, "landscape right");
  });

  it("when the screen angle is a multiple of 90 outside 0..270, then it wraps to the same rotation", () => {
    near(wheelAngle(20, -90, 450), wheelAngle(20, -90, 90), "450");
    near(wheelAngle(20, -90, -270), wheelAngle(20, -90, 90), "-270");
  });
});

describe("given a calibrated centre", () => {
  it("when the angle is measured from a centre, then it is the difference wrapped to half a turn either way", () => {
    assert.equal(aroundCentre(30, 10), 20);
    assert.equal(aroundCentre(-170, 170), 20);
    assert.equal(aroundCentre(170, -170), -20);
  });
});

describe("given the wheel angle and the tilt settings", () => {
  const settings = { fullLockDegrees: 25, deadZoneDegrees: 5 };

  it("when the angle is inside the dead zone, then it steers nothing, either way", () => {
    assert.equal(tiltSteer(4.9, settings), 0);
    assert.equal(tiltSteer(-4.9, settings), 0);
  });

  it("when the angle is halfway between the dead zone and full lock, then it steers half, with the angle's sign", () => {
    near(tiltSteer(15, settings), 0.5, "right half");
    near(tiltSteer(-15, settings), -0.5, "left half");
  });

  it("when the angle is at or past full lock, then it holds at one", () => {
    assert.equal(tiltSteer(25, settings), 1);
    assert.equal(tiltSteer(80, settings), 1);
    assert.equal(tiltSteer(-80, settings), -1);
  });
});

describe("given the stored tilt settings", () => {
  it("when nothing is stored, then the defaults apply", () => {
    for (const [fullLock, deadZone] of [["", ""], ["nope", "NaN"]]) {
      const settings = parseTiltSettings(fullLock, deadZone);
      assert.equal(settings.fullLockDegrees, TILT.fullLockDegrees.default);
      assert.equal(settings.deadZoneDegrees, TILT.deadZoneDegrees.default);
    }
  });

  it("when a value is out of range, then it clamps to the nearest bound", () => {
    const high = parseTiltSettings("500", "-3");
    assert.equal(high.fullLockDegrees, TILT.fullLockDegrees.max);
    assert.equal(high.deadZoneDegrees, TILT.deadZoneDegrees.min);
    const low = parseTiltSettings("1", "99");
    assert.equal(low.fullLockDegrees, TILT.fullLockDegrees.min);
    assert.equal(low.deadZoneDegrees, TILT.deadZoneDegrees.max);
  });

  it("when a value is in range, then it is kept", () => {
    assert.deepEqual(parseTiltSettings("30", "3.5"), { fullLockDegrees: 30, deadZoneDegrees: 3.5 });
  });

  it("when the widest dead zone meets the narrowest full lock, then full lock is still past the dead zone", () => {
    assert.ok(TILT.fullLockDegrees.min > TILT.deadZoneDegrees.max);
  });
});
