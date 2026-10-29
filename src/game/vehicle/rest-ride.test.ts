import { afterEach, describe, expect, it } from "vitest";
import * as THREE from "three";
import { applyDrive, type DriveInput } from "./car-drive.ts";
import { stepFree } from "./car-air.ts";
import { droop, SPRINGS } from "./car-suspension.ts";
import { makeCar } from "./ground-probe.test-util.ts";
import { layOnWedge, RAD, stepSlices, Wedge } from "./wedge.test-util.ts";
import { setGround } from "../world/ground.ts";
import { QUIET_HZ } from "../kernel/constants.ts";

/**
 * A body on its tyre springs rests where they hold it: parked, rolling, or let down from a little above, it comes to its rest ride
 * (origin on the ground, `Suspension`'s springs at their rest length) and stays, at every slice rate. The rigid step (`stepFree`) alone
 * moves the car here: no drive, no world, the ground the active one.
 */
const MILLIMETRE = 0.001;
const RATES_HZ = [60, 144, 240] as const;
const PARK_S = 5;
const WEDGE_DEG = 10;
/** The most (m) a car laid on the face is off its rest ride when the springs start to move it: their amplitude decays as e^(−ζωt) from it. */
const LARGEST_OFFSET = 0.05;

describe("given a car at its rest ride on flat ground, held by its tyre springs", () => {
  const testCases = RATES_HZ.flatMap((hz) => (["sedan", "monster"] as const).map((cls) => ({ it: `when a ${cls} is left for ${PARK_S} s at ${hz} Hz, then its origin stays within 1 mm of its rest ride`, cls, hz })));
  for (const testCase of testCases) {
    it(testCase.it, () => {
      const car = makeCar(testCase.cls);
      car.spawnFacing(0, 0, 0, 0);
      car.parked = true;
      stepSlices(car, PARK_S, testCase.hz);
      expect(Math.abs(car.group.position.y), `origin ${(car.group.position.y * 1000).toFixed(2)} mm off its rest ride`).toBeLessThanOrEqual(MILLIMETRE);
    });
  }
});

describe("given a car standing still on flat ground with the drive's throttle held", () => {
  const FULL_THROTTLE: DriveInput = { throttle: 1, steer: 0, brake: 0, ebrake: false, boost: false };

  for (const cls of ["sedan", "monster"] as const) {
    it(`when the drive pushes a ${cls} every slice for 0.5 s from rest, then its speed grows slice after slice instead of being held at rest`, () => {
      const car = makeCar(cls);
      car.spawnFacing(0, 0, 0, 0);
      const slice = 1 / QUIET_HZ;
      let speedBefore = 0;
      for (let s = 0; s < 60; s++) {
        applyDrive(car, FULL_THROTTLE, slice);
        stepFree(car, slice);
        const speed = car.velocity.length();
        expect(speed, `slice ${s}: speed ${speed.toFixed(4)} m/s after ${speedBefore.toFixed(4)}`).toBeGreaterThan(speedBefore);
        speedBefore = speed;
      }
    });
  }
});

describe("given a car rolling over flat ground at 5 m/s on its tyre springs", () => {
  const testCases = RATES_HZ.flatMap((hz) => (["sedan", "monster"] as const).map((cls) => ({ it: `when a ${cls} rolls for 4 s at ${hz} Hz, then it rides within 1 mm of its rest ride, not held up by its dampers`, cls, hz })));
  for (const testCase of testCases) {
    it(testCase.it, () => {
      const car = makeCar(testCase.cls);
      car.spawnFacing(0, 0, 0, 5);
      stepSlices(car, 4, testCase.hz);
      expect(Math.abs(car.group.position.y), `origin ${(car.group.position.y * 1000).toFixed(2)} mm off its rest ride`).toBeLessThanOrEqual(MILLIMETRE);
    });
  }
});

describe("given a car let down onto flat ground from above its rest ride", () => {
  const testCases = RATES_HZ.flatMap((hz) => (["sedan", "monster"] as const).map((cls) => ({ it: `when a ${cls} is released 0.3 m up at ${hz} Hz, then it lands and ends within 1 mm of its rest ride after ${PARK_S} s`, cls, hz })));
  for (const testCase of testCases) {
    it(testCase.it, () => {
      const car = makeCar(testCase.cls);
      car.spawnFacing(0, 0, 0, 0);
      car.parked = true;
      car.group.position.y = 0.3;
      stepSlices(car, PARK_S, testCase.hz);
      expect(Math.abs(car.group.position.y), `origin ${(car.group.position.y * 1000).toFixed(2)} mm off its rest ride`).toBeLessThanOrEqual(MILLIMETRE);
    });
  }

  it("when a monster is released 8 cm above its rest ride, then it falls instead of being held there at rest", () => {
    const car = makeCar("monster");
    car.spawnFacing(0, 0, 0, 0);
    car.group.position.y = 0.08;
    stepSlices(car, 0.05, 144);
    expect(car.velocity.y, `vertical speed ${car.velocity.y.toFixed(4)} m/s`).toBeLessThan(-0.01);
  });
});

describe("given a monster let down onto flat ground, on the springs of a heavy truck (Monster Jam: ζ 0.35-0.5, one or two cycles to settle)", () => {
  const DROP_M = 0.3;
  const TILT_DEG = 5;
  const LAND_S = 4;
  const LAND_HZ = 144;
  const SWING_M = 0.005;
  const SWING_DEG = 0.3;
  const SETTLE_AFTER_TOUCH_S = 1.5;
  const ZETA_BAND = { min: 0.4, max: 0.7 };

  /** The turning points of `series` standing more than `floor` from level, in order. */
  function turningPoints(series: readonly number[], floor: number): number[] {
    const out: number[] = [];
    for (let i = 1; i < series.length - 1; i++) {
      const v = series[i]!;
      if (Math.abs(v) > floor && ((v > series[i - 1]! && v >= series[i + 1]!) || (v < series[i - 1]! && v <= series[i + 1]!))) out.push(v);
    }
    return out;
  }

  /** The damping ratio a first swing and its rebound (opposite sign, `first` the larger) show: the log decrement of half a cycle. */
  function dampingRatio(first: number, rebound: number): number {
    const decrement = -Math.log(Math.abs(rebound / first));
    return decrement / Math.sqrt(Math.PI * Math.PI + decrement * decrement);
  }

  function letDown(tiltDeg: number): { ride: number[]; pitch: number[] } {
    const car = makeCar("monster");
    car.spawnFacing(0, 0, 0, 0);
    car.parked = true;
    car.group.rotation.set(tiltDeg * RAD, 0, 0, "YXZ");
    car.group.position.y = DROP_M;
    const ride: number[] = [];
    const pitch: number[] = [];
    for (let s = 0; s < LAND_S * LAND_HZ; s++) {
      stepFree(car, 1 / LAND_HZ);
      ride.push(car.group.position.y);
      pitch.push(new THREE.Euler().setFromQuaternion(car.group.quaternion, "YXZ").x / RAD);
    }
    return { ride, pitch };
  }

  it(`when it is let down ${DROP_M} m up, then its ride overshoots rest by over ${SWING_M * 1000} mm at most once, swings with a damping ratio of ${ZETA_BAND.min}-${ZETA_BAND.max}, and rests within ${SWING_M * 1000} mm ${SETTLE_AFTER_TOUCH_S} s after it touches`, (t) => {
    const { ride } = letDown(0);
    const points = turningPoints(ride, SWING_M);
    const touchedAt = ride.findIndex((y) => y <= droop("monster"));
    let unsettled = ride.length - 1;
    while (unsettled > 0 && Math.abs(ride[unsettled]!) <= SWING_M) unsettled--;
    expect(points.length - 1, `overshoots ${points.slice(1).map((p) => (p * 1000).toFixed(1)).join(", ")} mm after a ${(points[0]! * 1000).toFixed(0)} mm compression`).toBeLessThanOrEqual(1);
    const zeta = dampingRatio(points[0]!, points[1] ?? SWING_M);
    t.annotate(`let down ${DROP_M} m: turns ${points.map((p) => (p * 1000).toFixed(1)).join(", ")} mm, damping ratio ${zeta.toFixed(2)}, within ${SWING_M * 1000} mm ${((unsettled - touchedAt) / LAND_HZ).toFixed(2)} s after touching`);
    expect(zeta >= ZETA_BAND.min && zeta <= ZETA_BAND.max, `damping ratio ${zeta.toFixed(2)}`).toBeTruthy();
    expect((unsettled - touchedAt) / LAND_HZ, `${(((unsettled - touchedAt) / LAND_HZ)).toFixed(2)} s after touching it is still ${(Math.abs(ride[unsettled]!) * 1000).toFixed(1)} mm from rest`).toBeLessThanOrEqual(SETTLE_AFTER_TOUCH_S);
  });

  it(`when it is let down ${DROP_M} m up pitched ${TILT_DEG}°, then its pitch swings back past level over ${SWING_DEG}° at most once`, () => {
    const { pitch } = letDown(TILT_DEG);
    const points = turningPoints(pitch, SWING_DEG);
    expect(points.length - 1, `pitch turns at ${points.map((p) => p.toFixed(2)).join(", ")}°`).toBeLessThanOrEqual(1);
  });
});

describe("given a car standing with its tyres on a 10° wedge's face, held by its tyre springs", () => {
  afterEach(() => setGround(null));

  const testCases = RATES_HZ.flatMap((hz) =>
    (["sedan", "monster"] as const).flatMap((cls) => [
      { it: `when a ${cls} is left on the face facing up it for ${PARK_S} s at ${hz} Hz, then its origin is where it was once its springs had settled, within 1 mm`, cls, hz, yawDegrees: 90 },
      { it: `when a ${cls} is left on the face facing across it for ${PARK_S} s at ${hz} Hz, then its origin is where it was once its springs had settled, within 1 mm`, cls, hz, yawDegrees: 0 },
    ]),
  );
  for (const testCase of testCases) {
    it(testCase.it, () => {
      const wedge = new Wedge(WEDGE_DEG);
      setGround(wedge);
      const car = layOnWedge(testCase.cls, wedge, testCase.yawDegrees * RAD);
      car.parked = true;
      const spring = SPRINGS[testCase.cls];
      const settleS = Math.log(LARGEST_OFFSET / MILLIMETRE) / (spring.zeta * 2 * Math.PI * spring.hz);
      expect(settleS, "the spring envelope outlasts the test").toBeLessThan(PARK_S);
      stepSlices(car, settleS, testCase.hz);
      const restedAt = car.group.position.clone();
      stepSlices(car, PARK_S - settleS, testCase.hz);
      expect(Math.abs(car.group.position.y - restedAt.y), `origin sank ${((restedAt.y - car.group.position.y) * 1000).toFixed(2)} mm`).toBeLessThanOrEqual(MILLIMETRE);
      expect(Math.hypot(car.group.position.x - restedAt.x, car.group.position.z - restedAt.z), "origin crept along the face").toBeLessThanOrEqual(MILLIMETRE);
    });
  }
});
