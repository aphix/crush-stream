import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { FRAME_HZ } from "../kernel/constants.ts";
import { Gait, GAIT } from "./walker-gait.ts";
import { Locomotion, RUN_SPEED, SPRINT_SPEED, WALK_SPEED } from "./walker-locomotion.ts";

const FRAME = 1 / FRAME_HZ;
const DEGREES = 180 / Math.PI;
const flat = () => 0;
/** The torso's centre height standing (m): the gait seeds from it. */
const STANDING_TORSO = 1.11;

type Frame = { planted: number[]; pivot: number[]; feet: number[]; contact: number[]; hipY: number; targets: number[]; twist: number; anchorY: number };

/** A walker asked for `command` along +z for `warm` s, then watched for `seconds` more (`turnTo` rad: the heading asked for at the watch's start). */
function watch(command: number, seconds: number, turnTo = 0): Frame[] {
  const loco = new Locomotion();
  const gait = new Gait();
  loco.reset(0);
  gait.seed(0, STANDING_TORSO, 0, 0, flat);
  const frames: Frame[] = [];
  const warm = Math.round(3 * FRAME_HZ);
  for (let f = 0; f < warm + Math.round(seconds * FRAME_HZ); f++) {
    loco.update(FRAME, f < warm ? 0 : turnTo, command);
    gait.update(FRAME, loco, flat);
    if (f >= warm) frames.push({ planted: Array.from(gait["planted"]), pivot: Array.from(gait["pivot"]), feet: Array.from(gait["foot"]), contact: Array.from(gait["plant"]), hipY: gait["hipY"], targets: Array.from(gait.targets), twist: gait.twist, anchorY: gait.anchor[1]! });
  }
  return frames;
}

const range = (values: number[]) => Math.max(...values) - Math.min(...values);

/** The worst a planted foot's pivot (the heel, then the toe it rolls onto: the ankle rides over it) moved between two frames (m) over `frames`, and how many frames found a foot planted on the same pivot in both. */
function plantedSlide(frames: Frame[]): { worst: number; samples: number } {
  let worst = 0;
  let samples = 0;
  for (let i = 1; i < frames.length; i++) {
    for (let f = 0; f < 2; f++) {
      if (!frames[i]!.planted[f] || !frames[i - 1]!.planted[f] || frames[i]!.pivot[f] !== frames[i - 1]!.pivot[f]) continue;
      samples++;
      worst = Math.max(worst, Math.hypot(frames[i]!.contact[f * 3]! - frames[i - 1]!.contact[f * 3]!, frames[i]!.contact[f * 3 + 2]! - frames[i - 1]!.contact[f * 3 + 2]!));
    }
  }
  return { worst, samples };
}

const share = (frames: Frame[], test: (frame: Frame) => boolean) => frames.filter(test).length / frames.length;

const stanceCases: readonly { it: string; command: number; turnTo: number; expectedMinSamples: number }[] = [
  { it: "when he walks, then a planted foot does not move at all until it lifts", command: WALK_SPEED, turnTo: 0, expectedMinSamples: 100 },
  { it: "when he runs, then a planted foot does not move at all until it lifts", command: RUN_SPEED, turnTo: 0, expectedMinSamples: 80 },
  { it: "when he sprints, then a planted foot does not move at all until it lifts", command: SPRINT_SPEED, turnTo: 0, expectedMinSamples: 40 },
  { it: "when he sprints and cuts 90 degrees, then the planted feet stay put while he pivots round them", command: SPRINT_SPEED, turnTo: Math.PI / 2, expectedMinSamples: 25 },
  { it: "when he runs and turns about, then the planted feet stay put through the reversal", command: RUN_SPEED, turnTo: Math.PI, expectedMinSamples: 25 },
];

describe("given a gait over flat ground", () => {
  for (const testCase of stanceCases) {
    it(testCase.it, () => {
      const { worst, samples } = plantedSlide(watch(testCase.command, 3, testCase.turnTo));
      assert.ok(samples >= testCase.expectedMinSamples, `${samples} planted frames seen (a gait that never plants proves nothing)`);
      assert.ok(worst < 1e-9, `a planted foot moved ${worst} m in a frame`);
    });
  }

  it("when he runs, then his feet do move: each swing carries a foot over a metre", () => {
    const frames = watch(RUN_SPEED, 3);
    for (let f = 0; f < 2; f++) assert.ok(range(frames.map((frame) => frame.feet[f * 3 + 2]!)) > 3 * RUN_SPEED * 0.8, `foot ${f} travelled with him`);
  });

  const flightCases: readonly { it: string; command: number; expectedMinFlight: number; expectedMaxFlight: number; expectedMinBoth: number; expectedMaxBoth: number }[] = [
    { it: "when he walks, then one foot is always down and both for a fifth of the time", command: WALK_SPEED, expectedMinFlight: 0, expectedMaxFlight: 0, expectedMinBoth: 0.15, expectedMaxBoth: 0.4 },
    { it: "when he runs, then there is a flight phase (5-25 % of the time) and never both feet down", command: RUN_SPEED, expectedMinFlight: 0.05, expectedMaxFlight: 0.3, expectedMinBoth: 0, expectedMaxBoth: 0.05 },
    { it: "when he sprints, then the flight is longer and the feet are never both down", command: SPRINT_SPEED, expectedMinFlight: 0.2, expectedMaxFlight: 0.6, expectedMinBoth: 0, expectedMaxBoth: 0.02 },
  ];
  for (const testCase of flightCases) {
    it(testCase.it, () => {
      const frames = watch(testCase.command, 4);
      const flight = share(frames, (frame) => frame.planted[0] === 0 && frame.planted[1] === 0);
      const both = share(frames, (frame) => frame.planted[0] === 1 && frame.planted[1] === 1);
      assert.ok(flight >= testCase.expectedMinFlight && flight <= testCase.expectedMaxFlight, `flight ${flight.toFixed(2)} within ${testCase.expectedMinFlight}-${testCase.expectedMaxFlight}`);
      assert.ok(both >= testCase.expectedMinBoth && both <= testCase.expectedMaxBoth, `both down ${both.toFixed(2)} within ${testCase.expectedMinBoth}-${testCase.expectedMaxBoth}`);
    });
  }
});

const settleCases: readonly { it: string; command: number; expectedMaxSettleSeconds: number }[] = [
  { it: "when he walks and stops, then he stands still within 1 s", command: WALK_SPEED, expectedMaxSettleSeconds: 1 },
  { it: "when he runs and stops, then he stands still within 1 s", command: RUN_SPEED, expectedMaxSettleSeconds: 1 },
  { it: "when he sprints and stops, then he stands still within 1.5 s", command: SPRINT_SPEED, expectedMaxSettleSeconds: 1.5 },
];

describe("given a gait that has walked and been asked to stop", () => {
  for (const testCase of settleCases) {
    it(testCase.it, () => {
      const loco = new Locomotion();
      const gait = new Gait();
      loco.reset(0);
      gait.seed(0, STANDING_TORSO, 0, 0, flat);
      for (let f = 0; f < 3 * FRAME_HZ; f++) {
        loco.update(FRAME, 0, testCase.command);
        gait.update(FRAME, loco, flat);
      }
      let settledAt = Infinity;
      let liftedAfter = 0;
      for (let f = 0; f < 5 * FRAME_HZ; f++) {
        loco.update(FRAME, 0, 0);
        gait.update(FRAME, loco, flat);
        if (gait.standing && settledAt === Infinity) settledAt = f * FRAME;
        if (settledAt < Infinity && !gait.standing) liftedAfter++;
      }
      assert.ok(settledAt <= testCase.expectedMaxSettleSeconds, `stood still after ${settledAt.toFixed(2)} s within ${testCase.expectedMaxSettleSeconds}`);
      assert.equal(liftedAfter, 0, `${liftedAfter} frames of stepping after he stood still`);
    });
  }
});

/** Peak-to-peak (degrees) of target `index` over frames, one value per cycle's worth (the whole watch: several cycles of the same). */
const spread = (frames: Frame[], index: number) => range(frames.map((frame) => frame.targets[index]! * DEGREES));

const jointCases: readonly {
  it: string;
  command: number;
  expectedHipPP: readonly [number, number];
  expectedKneePeak: readonly [number, number];
  expectedShoulderPP: readonly [number, number];
  expectedElbowPeak: readonly [number, number];
  expectedTwistPP: readonly [number, number];
  expectedBobCm: readonly [number, number];
}[] = [
  { it: "when he walks, then his hips swing 30-45 degrees, knees flex 40-70, arms 20-60, elbows stay open, the pelvis turns 8-18 and bobs 2-10 cm", command: WALK_SPEED, expectedHipPP: [30, 45], expectedKneePeak: [40, 70], expectedShoulderPP: [20, 60], expectedElbowPeak: [10, 50], expectedTwistPP: [8, 18], expectedBobCm: [2, 10] },
  { it: "when he runs, then his hips swing 50-70 degrees, knees flex 70-110, arms 35-80, elbows are held bent 70-100, the pelvis turns 10-25 and bobs 4-14 cm", command: RUN_SPEED, expectedHipPP: [50, 70], expectedKneePeak: [70, 110], expectedShoulderPP: [35, 80], expectedElbowPeak: [70, 100], expectedTwistPP: [10, 25], expectedBobCm: [4, 14] },
  { it: "when he sprints, then his hips swing 50-70 degrees, knees flex 90-130, arms 50-100, elbows are held bent 70-110, the pelvis turns 15-35 and bobs 4-16 cm", command: SPRINT_SPEED, expectedHipPP: [50, 70], expectedKneePeak: [90, 130], expectedShoulderPP: [50, 100], expectedElbowPeak: [70, 110], expectedTwistPP: [15, 35], expectedBobCm: [4, 16] },
];

describe("given a gait at each speed", () => {
  for (const testCase of jointCases) {
    it(testCase.it, () => {
      const frames = watch(testCase.command, 4);
      const hip = spread(frames, GAIT.HIP_L);
      const knee = Math.max(...frames.map((frame) => frame.targets[GAIT.KNEE_L]! * DEGREES));
      const shoulder = spread(frames, GAIT.ARM_L);
      const elbow = Math.abs(Math.min(...frames.map((frame) => frame.targets[GAIT.ELBOW_L]! * DEGREES)));
      const twist = range(frames.map((frame) => frame.twist * DEGREES));
      const bob = range(frames.map((frame) => frame.anchorY)) * 100;
      const within = (value: number, [low, high]: readonly [number, number], name: string) => assert.ok(value >= low && value <= high, `${name} ${value.toFixed(1)} within ${low}-${high}`);
      within(hip, testCase.expectedHipPP, "hip swing");
      within(knee, testCase.expectedKneePeak, "knee flexion");
      within(shoulder, testCase.expectedShoulderPP, "shoulder swing");
      within(elbow, testCase.expectedElbowPeak, "elbow bend");
      within(twist, testCase.expectedTwistPP, "pelvis turn");
      within(bob, testCase.expectedBobCm, "pelvis bob (cm)");
    });
  }

  it("when he runs, then each arm swings against the leg on its own side and with the other's", () => {
    const frames = watch(RUN_SPEED, 4);
    const mean = (index: number) => frames.reduce((sum, frame) => sum + frame.targets[index]!, 0) / frames.length;
    const centred = (frame: Frame, index: number) => frame.targets[index]! - mean(index);
    let against = 0;
    let withOther = 0;
    for (const frame of frames) {
      against += centred(frame, GAIT.ARM_L) * centred(frame, GAIT.HIP_L);
      withOther += centred(frame, GAIT.ARM_L) * centred(frame, GAIT.HIP_R);
    }
    assert.ok(against < 0 && withOther > 0, `arm against own leg ${against.toFixed(2)}, with the other ${withOther.toFixed(2)}`);
  });

  it("when he runs, then the pelvis turns against the legs: the hips ahead lead it round", () => {
    const frames = watch(RUN_SPEED, 4);
    let product = 0;
    for (const frame of frames) product += frame.twist * (frame.targets[GAIT.HIP_R]! - frame.targets[GAIT.HIP_L]!);
    assert.ok(product > 0, `twist follows the hip difference (${product.toFixed(3)})`);
  });
});

const smoothCases: readonly { it: string; command: number; expectedMaxStepCm: number; expectedMaxKneeStepDegrees: number }[] = [
  { it: "when he walks, then the pelvis moves under 1.2 cm a frame and no knee jumps more than 22 degrees in one", command: WALK_SPEED, expectedMaxStepCm: 1.2, expectedMaxKneeStepDegrees: 22 },
  { it: "when he runs, then the pelvis moves under 1.5 cm a frame and no knee jumps more than 25 degrees in one", command: RUN_SPEED, expectedMaxStepCm: 1.5, expectedMaxKneeStepDegrees: 25 },
  { it: "when he sprints, then the pelvis moves under 2.8 cm a frame and no knee jumps more than 40 degrees in one", command: SPRINT_SPEED, expectedMaxStepCm: 2.8, expectedMaxKneeStepDegrees: 40 },
];

describe("given a steady gait", () => {
  for (const testCase of smoothCases) {
    it(testCase.it, () => {
      const frames = watch(testCase.command, 4);
      let step = 0;
      let kneeStep = 0;
      for (let i = 1; i < frames.length; i++) {
        step = Math.max(step, Math.abs(frames[i]!.anchorY - frames[i - 1]!.anchorY) * 100);
        for (const index of [GAIT.KNEE_L, GAIT.KNEE_R]) kneeStep = Math.max(kneeStep, Math.abs(frames[i]!.targets[index]! - frames[i - 1]!.targets[index]!) * DEGREES);
      }
      assert.ok(step <= testCase.expectedMaxStepCm, `pelvis step ${step.toFixed(2)} cm within ${testCase.expectedMaxStepCm}`);
      assert.ok(kneeStep <= testCase.expectedMaxKneeStepDegrees, `knee step ${kneeStep.toFixed(1)} degrees within ${testCase.expectedMaxKneeStepDegrees}`);
    });
  }
});

/** A hand's reach along the way he faces from the pelvis (m, negative: behind it): the upper arm swings back by `shoulder` rad (positive back) and the forearm closes `elbow` rad forward (negative). */
const handReach = (shoulder: number, elbow: number) => -0.28 * Math.sin(shoulder) + 0.38 * Math.sin(-elbow - shoulder);

const armCases: readonly { it: string; command: number; expectedMaxRearReach: number; expectedMinOpposite: number }[] = [
  { it: "when he runs, then the back hand ends more than 10 cm behind the pelvis and the hands are on opposite sides of it for over half the cycle", command: RUN_SPEED, expectedMaxRearReach: -0.1, expectedMinOpposite: 0.5 },
  { it: "when he sprints, then the back hand ends more than 10 cm behind the pelvis and the hands are on opposite sides of it for over half the cycle", command: SPRINT_SPEED, expectedMaxRearReach: -0.1, expectedMinOpposite: 0.5 },
];

describe("given the arms of a steady gait", () => {
  for (const testCase of armCases) {
    it(testCase.it, () => {
      const frames = watch(testCase.command, 4);
      const left = frames.map((frame) => handReach(frame.targets[GAIT.ARM_L]!, frame.targets[GAIT.ELBOW_L]!));
      const right = frames.map((frame) => handReach(frame.targets[GAIT.ARM_R]!, frame.targets[GAIT.ELBOW_R]!));
      const opposite = left.filter((reach, i) => Math.sign(reach - 0.05) !== Math.sign(right[i]! - 0.05)).length / left.length;
      assert.ok(Math.min(...left, ...right) < testCase.expectedMaxRearReach, `rear hand ${Math.min(...left, ...right).toFixed(2)} m`);
      assert.ok(Math.max(...left, ...right) > 0.2, "the front hand comes forward too");
      assert.ok(opposite > testCase.expectedMinOpposite, `opposite sides ${opposite.toFixed(2)} of the cycle`);
    });
  }
});

describe("given a gait at a run", () => {
  it("when a foot is under him at mid-stance, then its knee is under 45 degrees and the pelvis dips under 6 cm: he does not sit", () => {
    const frames = watch(RUN_SPEED, 4);
    const mid = frames.filter((frame) => frame.planted[0] === 1 && Math.abs(frame.targets[GAIT.HIP_L]!) < 0.15);
    assert.ok(mid.length > 10, `${mid.length} mid-stance frames seen`);
    assert.ok(Math.max(...mid.map((frame) => frame.targets[GAIT.KNEE_L]! * DEGREES)) < 45, "mid-stance knee");
    assert.ok(range(frames.map((frame) => frame.hipY)) * 100 < 6, `pelvis range ${(range(frames.map((frame) => frame.hipY)) * 100).toFixed(1)} cm`);
  });
});
