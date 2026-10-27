import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { FRAME_HZ } from "../kernel/constants.ts";
import { Locomotion, RUN_SPEED, SPRINT_SPEED, WALK_SPEED, type TurnBand } from "./walker-locomotion.ts";

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
      assert.ok(seconds >= testCase.expectedMinSeconds && seconds <= testCase.expectedMaxSeconds, `${seconds.toFixed(2)} s within ${testCase.expectedMinSeconds}-${testCase.expectedMaxSeconds}`);
    });
  }
});

const stopCases: readonly { it: string; command: number; expectedMaxSeconds: number; expectedMinMetres: number; expectedMaxMetres: number }[] = [
  { it: "when a run is let go, then he stops in a third of a second inside half a metre", command: RUN_SPEED, expectedMaxSeconds: 0.35, expectedMinMetres: 0.15, expectedMaxMetres: 0.55 },
  { it: "when a sprint is let go, then he stops inside 3.5 m and a second", command: SPRINT_SPEED, expectedMaxSeconds: 1, expectedMinMetres: 1.5, expectedMaxMetres: 3.5 },
];

describe("given a walker at speed", () => {
  for (const testCase of stopCases) {
    it(testCase.it, () => {
      const { seconds, distance } = stopFrom(testCase.command);
      assert.ok(seconds <= testCase.expectedMaxSeconds, `stopped in ${seconds.toFixed(2)} s within ${testCase.expectedMaxSeconds}`);
      assert.ok(distance >= testCase.expectedMinMetres && distance <= testCase.expectedMaxMetres, `stopped in ${distance.toFixed(2)} m within ${testCase.expectedMinMetres}-${testCase.expectedMaxMetres}`);
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
    const faced = Math.abs(Math.atan2(Math.sin(loco.yaw - heading), Math.cos(loco.yaw - heading))) < 0.2;
    if (faced && cut.secondsToFace === Infinity) cut.secondsToFace = f * FRAME;
    if (cut.secondsToFace < Infinity && cut.secondsToSpeedAgain === Infinity && loco.speed >= 0.9 * command) cut.secondsToSpeedAgain = f * FRAME;
  }
  return cut;
}

const cutCases: readonly { it: string; degrees: number; expectedMaxFace: number; expectedMinSpeedAbove: number; expectedMinSpeedBelow: number; expectedMaxRegain: number }[] = [
  { it: "when a sprint is turned 45 degrees, then he curves to it in half a second and keeps most of his speed", degrees: 45, expectedMaxFace: 0.55, expectedMinSpeedAbove: 5.5, expectedMinSpeedBelow: 7, expectedMaxRegain: 0.8 },
  { it: "when a sprint is turned 90 degrees, then he slows to a pivot and is facing the new way inside a second", degrees: 90, expectedMaxFace: 1, expectedMinSpeedAbove: 1.5, expectedMinSpeedBelow: 4.5, expectedMaxRegain: 1.6 },
  { it: "when a sprint is turned 180 degrees, then he slows to a pivot's pace and turns about inside a second", degrees: 180, expectedMaxFace: 1, expectedMinSpeedAbove: -1, expectedMinSpeedBelow: 2, expectedMaxRegain: 1.8 },
];

describe("given a walker sprinting along +z", () => {
  for (const testCase of cutCases) {
    it(testCase.it, () => {
      const cut = cutAt(SPRINT_SPEED, testCase.degrees);
      assert.ok(cut.secondsToFace <= testCase.expectedMaxFace, `facing in ${cut.secondsToFace.toFixed(2)} s within ${testCase.expectedMaxFace}`);
      assert.ok(cut.minSpeed > testCase.expectedMinSpeedAbove && cut.minSpeed < testCase.expectedMinSpeedBelow, `slowest ${cut.minSpeed.toFixed(2)} m/s within ${testCase.expectedMinSpeedAbove}-${testCase.expectedMinSpeedBelow}`);
      assert.ok(cut.secondsToSpeedAgain - cut.secondsToFace <= testCase.expectedMaxRegain, `back to speed ${(cut.secondsToSpeedAgain - cut.secondsToFace).toFixed(2)} s after facing, within ${testCase.expectedMaxRegain}`);
      assert.ok(cut.worstLateral <= LATERAL_ACCEL_BAR, `sideways acceleration ${cut.worstLateral.toFixed(1)} m/s² within ${LATERAL_ACCEL_BAR}`);
    });
  }

  it("when a sprint is turned 90 degrees toward +x, then he banks toward the inside of the turn, 6 to 26 degrees", () => {
    const left = cutAt(SPRINT_SPEED, 90);
    const right = cutAt(SPRINT_SPEED, -90);
    assert.ok(left.worstRoll > 0.1 && left.worstRoll <= 0.45, `banked ${left.worstRoll.toFixed(2)} rad`);
    assert.equal(left.rollSign, -right.rollSign, "banks the other way for the other turn");
    assert.equal(left.rollSign, -1, "roll about +z by a negative angle leans the head toward +x, the inside of a turn toward +x");
  });
});

describe("given a heading that hovers at the edge of a band", () => {
  it("when the heading error alternates across the pivot threshold every frame, then the turn changes kind at most twice, not every frame", () => {
    const loco = atSpeed(RUN_SPEED);
    const bands: TurnBand[] = [];
    for (let f = 0; f < 60; f++) {
      loco.update(FRAME, loco.yaw + 1.3 + (f % 2 === 0 ? 0.04 : -0.04), RUN_SPEED);
      if (bands[bands.length - 1] !== loco.band) bands.push(loco.band);
    }
    assert.ok(bands.length <= 3, `bands ${bands.join(" ")}`);
    assert.ok(bands.includes("pivot"), "the pivot band was entered (a flat run never leaves the curve)");
  });
});

describe("given a walker at each speed", () => {
  it("when he runs and sprints, then his forward lean grows with speed (research: 5-15 degrees at a run, more at a sprint)", () => {
    const walk = atSpeed(WALK_SPEED).pitch;
    const run = atSpeed(RUN_SPEED).pitch;
    const sprint = atSpeed(SPRINT_SPEED).pitch;
    assert.ok(walk < run && run < sprint, `lean ${walk.toFixed(2)} < ${run.toFixed(2)} < ${sprint.toFixed(2)}`);
    assert.ok(run >= 0.087 && run <= 0.26, `run lean ${run.toFixed(2)} rad`);
    assert.ok(sprint >= 0.17 && sprint <= 0.3, `sprint lean ${sprint.toFixed(2)} rad`);
  });
});
