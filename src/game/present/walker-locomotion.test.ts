import { describe, expect, it } from "vitest";
import { detAtan2, detCos, detSin } from "../kernel/physics-core.js";
import { FRAME_HZ } from "../kernel/constants.ts";
import { Locomotion, RUN_SPEED, SPRINT_SPEED, WALK_SPEED } from "./walker-locomotion.ts";

const FRAME = 1 / FRAME_HZ;
/** The most sideways acceleration (m/s²) a turn may show: the design's 10, plus a frame's rounding. */
const LATERAL_ACCEL_BAR = 10.5;

/** A walker that has been asked for `command` along +z for long enough to be at it. */
function atSpeed(command: number): Locomotion {
  const loco = new Locomotion();
  loco.reset(0);
  for (let f = 0; f < 4 * FRAME_HZ; f++) loco.update(FRAME, 0, command);
  return loco;
}

type Run = { seconds: number; distance: number };

/** Seconds from the ask until `loco` reaches `share` of `command`, and the metres covered. */
function timeToSpeed(command: number, share: number): Run {
  const loco = new Locomotion();
  loco.reset(0);
  let distance = 0;
  for (let f = 1; f < 10 * FRAME_HZ; f++) {
    loco.update(FRAME, 0, command);
    distance += loco.speed * FRAME;
    if (loco.speed >= share * command) return { seconds: f * FRAME, distance };
  }
  return { seconds: Infinity, distance };
}

/** Seconds and metres from letting go at `command` until he has stopped. */
function stopFrom(command: number): Run {
  const loco = atSpeed(command);
  let distance = 0;
  for (let f = 1; f < 10 * FRAME_HZ; f++) {
    loco.update(FRAME, 0, 0);
    distance += loco.speed * FRAME;
    if (loco.speed === 0) return { seconds: f * FRAME, distance };
  }
  return { seconds: Infinity, distance };
}

const speedCases: readonly { it: string; command: number; expectedMinSeconds: number; expectedMaxSeconds: number }[] = [
  { it: "when a walk is asked for, then he is at it within a fifth of a second", command: WALK_SPEED, expectedMinSeconds: 0.05, expectedMaxSeconds: 0.2 },
  { it: "when a run is asked for, then he is at it in 0.3 s", command: RUN_SPEED, expectedMinSeconds: 0.2, expectedMaxSeconds: 0.35 },
  { it: "when a sprint is asked for, then he builds to it over about a second", command: SPRINT_SPEED, expectedMinSeconds: 0.9, expectedMaxSeconds: 1.5 },
];

describe("given a walker standing still", () => {
  for (const testCase of speedCases) {
    it(testCase.it, () => {
      const { seconds } = timeToSpeed(testCase.command, 0.98);
      expect(seconds >= testCase.expectedMinSeconds && seconds <= testCase.expectedMaxSeconds, `${seconds.toFixed(2)} s within ${testCase.expectedMinSeconds}-${testCase.expectedMaxSeconds}`).toBeTruthy();
    });
  }

  // mutation: sed -i 's/^const JERK = 175;/const JERK = 1e9;/' src/game/present/walker-locomotion.ts
  it("when he is asked to run from a stand, sampled at 240 Hz for a second, then his acceleration never changes faster than the jerk limit and starts from nothing", () => {
    const SUB = FRAME / 4;
    const loco = new Locomotion();
    loco.reset(0);
    loco.update(SUB, 0, RUN_SPEED);
    expect(Math.abs(loco.accel), "the first frame's acceleration").toBeLessThanOrEqual(175 * SUB + 1e-9);
    for (let f = 1; f < 240; f++) {
      const before = loco.accel;
      loco.update(SUB, 0, RUN_SPEED);
      expect(Math.abs(loco.accel - before) / SUB, `frame ${f}`).toBeLessThanOrEqual(1.05 * 175);
    }
  });

  // mutation: sed -i 's/^const ACCEL_TO_RUN = 12;/const ACCEL_TO_RUN = 6;/' src/game/present/walker-locomotion.ts
  it("when he is asked to run from a stand, sampled at 240 Hz for a second, then his acceleration peaks at the push rate of 12 m/s² and he is at 3.5 m/s", () => {
    const SUB = FRAME / 4;
    const loco = new Locomotion();
    loco.reset(0);
    let peak = 0;
    for (let f = 0; f < 240; f++) {
      loco.update(SUB, 0, RUN_SPEED);
      peak = Math.max(peak, loco.accel);
    }
    expect(peak, "the greatest acceleration (m/s²)").toBeCloseTo(12, 6);
    expect(loco.speed, "his speed after a second (m/s)").toBeCloseTo(RUN_SPEED, 6);
  });
});

const stopCases: readonly { it: string; command: number; expectedMaxSeconds: number; expectedMinMetres: number; expectedMaxMetres: number }[] = [
  { it: "when a run is let go, then he stops in a third of a second inside half a metre", command: RUN_SPEED, expectedMaxSeconds: 0.35, expectedMinMetres: 0.15, expectedMaxMetres: 0.55 },
  { it: "when a sprint is let go, then he stops inside 3.5 m and a second", command: SPRINT_SPEED, expectedMaxSeconds: 1, expectedMinMetres: 1.5, expectedMaxMetres: 3.5 },
];

describe("given a walker at speed", () => {
  for (const testCase of stopCases) {
    it(testCase.it, () => {
      const { seconds, distance } = stopFrom(testCase.command);
      expect(seconds, `stopped in ${seconds.toFixed(2)} s within ${testCase.expectedMaxSeconds}`).toBeLessThanOrEqual(testCase.expectedMaxSeconds);
      expect(distance >= testCase.expectedMinMetres && distance <= testCase.expectedMaxMetres, `stopped in ${distance.toFixed(2)} m within ${testCase.expectedMinMetres}-${testCase.expectedMaxMetres}`).toBeTruthy();
    });
  }
});

type Cut = { secondsToFace: number; minSpeed: number; secondsToSpeedAgain: number; worstLateral: number; worstRoll: number; rollSign: number };

/** A cut by `degrees` (positive: toward +x) at `command` from a steady run along +z: how long it takes and what it costs. */
function cutAt(command: number, degrees: number): Cut {
  const loco = atSpeed(command);
  const heading = (degrees * Math.PI) / 180;
  const cut: Cut = { secondsToFace: Infinity, minSpeed: loco.speed, secondsToSpeedAgain: Infinity, worstLateral: 0, worstRoll: 0, rollSign: 0 };
  for (let f = 1; f < 6 * FRAME_HZ; f++) {
    loco.update(FRAME, heading, command);
    cut.minSpeed = Math.min(cut.minSpeed, loco.speed);
    cut.worstLateral = Math.max(cut.worstLateral, Math.abs(loco.speed * loco.turnRate));
    if (Math.abs(loco.roll) > cut.worstRoll) {
      cut.worstRoll = Math.abs(loco.roll);
      cut.rollSign = Math.sign(loco.roll);
    }
    const faced = Math.abs(detAtan2(detSin(loco.yaw - heading), detCos(loco.yaw - heading))) < 0.2;
    if (faced && cut.secondsToFace === Infinity) cut.secondsToFace = f * FRAME;
    if (cut.secondsToFace < Infinity && cut.secondsToSpeedAgain === Infinity && loco.speed >= 0.9 * command) cut.secondsToSpeedAgain = f * FRAME;
  }
  return cut;
}

const cutCases: readonly { it: string; degrees: number; expectedMaxFace: number; expectedMinSpeedAbove: number; expectedMinSpeedBelow: number; expectedMaxRegain: number }[] = [
  { it: "when a sprint is turned 45 degrees, then he curves to it in half a second and keeps most of his speed", degrees: 45, expectedMaxFace: 0.55, expectedMinSpeedAbove: 5.5, expectedMinSpeedBelow: 7, expectedMaxRegain: 0.8 },
  { it: "when a sprint is turned 90 degrees, then he slows to a pivot and is facing the new way inside a second", degrees: 90, expectedMaxFace: 1, expectedMinSpeedAbove: 1.5, expectedMinSpeedBelow: 5.2, expectedMaxRegain: 1.6 },
  { it: "when a sprint is turned 180 degrees, then he slows to a pivot's pace and turns about inside a second", degrees: 180, expectedMaxFace: 1, expectedMinSpeedAbove: -1, expectedMinSpeedBelow: 2, expectedMaxRegain: 1.8 },
];

describe("given a walker sprinting along +z", () => {
  for (const testCase of cutCases) {
    it(testCase.it, () => {
      const cut = cutAt(SPRINT_SPEED, testCase.degrees);
      expect(cut.secondsToFace, `facing in ${cut.secondsToFace.toFixed(2)} s within ${testCase.expectedMaxFace}`).toBeLessThanOrEqual(testCase.expectedMaxFace);
      expect(cut.minSpeed > testCase.expectedMinSpeedAbove && cut.minSpeed < testCase.expectedMinSpeedBelow, `slowest ${cut.minSpeed.toFixed(2)} m/s within ${testCase.expectedMinSpeedAbove}-${testCase.expectedMinSpeedBelow}`).toBeTruthy();
      expect(cut.secondsToSpeedAgain - cut.secondsToFace, `back to speed ${(cut.secondsToSpeedAgain - cut.secondsToFace).toFixed(2)} s after facing, within ${testCase.expectedMaxRegain}`).toBeLessThanOrEqual(testCase.expectedMaxRegain);
      expect(cut.worstLateral, `sideways acceleration ${cut.worstLateral.toFixed(1)} m/s² within ${LATERAL_ACCEL_BAR}`).toBeLessThanOrEqual(LATERAL_ACCEL_BAR);
    });
  }

  it("when a sprint is turned 90 degrees toward +x, then he banks toward the inside of the turn, 6 to 26 degrees", () => {
    const left = cutAt(SPRINT_SPEED, 90);
    const right = cutAt(SPRINT_SPEED, -90);
    expect(left.worstRoll > 0.1 && left.worstRoll <= 0.45, `banked ${left.worstRoll.toFixed(2)} rad`).toBeTruthy();
    expect(left.rollSign, "banks the other way for the other turn").toBe(-right.rollSign);
    expect(left.rollSign, "roll about +z by a negative angle leans the head toward +x, the inside of a turn toward +x").toBe(-1);
  });
});

describe("given a heading error that rises past the pivot threshold and falls back", () => {
  // mutation: sed -i 's/^const SLOW_TURN_LOSS = 0.3;/const SLOW_TURN_LOSS = 0;/' src/game/present/walker-locomotion.ts
  it("when the error is held at 1.5 rad for a second and then at 1.2 rad for a second, then he runs at the speed 1.2 rad asks for, as when it only rose to 1.2: no band holds the pivot's", () => {
    const hold = (legs: readonly (readonly [error: number, frames: number])[]): number => {
      const loco = atSpeed(RUN_SPEED);
      for (const [error, frames] of legs) for (let f = 0; f < frames; f++) loco.update(FRAME, loco.yaw + error, RUN_SPEED);
      return loco.speed;
    };
    expect(hold([[1.5, 60], [1.2, 60]]), "fallen back to 1.2 rad").toBeCloseTo(2.585, 2);
    expect(hold([[1.2, 120]]), "risen to 1.2 rad").toBeCloseTo(2.585, 2);
  });
});

describe("given a walker at each speed", () => {
  it("when he runs and sprints, then his forward lean grows with speed (research: 5-15 degrees at a run, more at a sprint)", () => {
    const walk = atSpeed(WALK_SPEED).pitch;
    const run = atSpeed(RUN_SPEED).pitch;
    const sprint = atSpeed(SPRINT_SPEED).pitch;
    expect(walk < run && run < sprint, `lean ${walk.toFixed(2)} < ${run.toFixed(2)} < ${sprint.toFixed(2)}`).toBeTruthy();
    expect(run >= 0.087 && run <= 0.26, `run lean ${run.toFixed(2)} rad`).toBeTruthy();
    expect(sprint >= 0.17 && sprint <= 0.3, `sprint lean ${sprint.toFixed(2)} rad`).toBeTruthy();
  });
});

describe("given the target speed against the heading error", () => {
  /** The target speed at heading error `e` for a sprint. */
  const target = (e: number) => new Locomotion()["targetSpeed"](SPRINT_SPEED, e);
  // mutation: sed -i 's/const turning = curve + (pivot - curve) \* Math.max(0, Math.min(1, (aError - PIVOT_IN) \/ PIVOT_RAMP));/const turning = aError > PIVOT_IN ? pivot : curve;/' src/game/present/walker-locomotion.ts
  it("when the error crosses the pivot edge, then the target moves by under 0.05 m/s", () => {
    expect(Math.abs(target(1.301) - target(1.299)), "jump at the pivot edge").toBeLessThan(0.05);
  });
  // mutation: sed -i 's/return turning \* Math.max(0, Math.min(1, 1 - (aError - STOP_IN) \/ STOP_FADE));/return aError > STOP_IN ? 0 : turning;/' src/game/present/walker-locomotion.ts
  it("when the error crosses the stop edge and the fade's end, then the target moves by under 0.05 m/s and is 0 beyond", () => {
    expect(Math.abs(target(2.101) - target(2.099)), "jump at the stop edge").toBeLessThan(0.05);
    expect(Math.abs(target(2.401) - target(2.399)), "jump where the fade ends").toBeLessThan(0.05);
    expect(target(2.6)).toBe(0);
  });
});
