import { describe, expect, it } from "vitest";
import { OnFootFlow, type OnFootPhase, type OnFootRefusal, type OnFootStep } from "./onfoot-flow.ts";

const AT_REST = { car: 0, speed: 0, doorBlocked: false };

/** Brings a fresh flow to `start` by the controls that lead there. */
function flowAt(start: OnFootPhase): OnFootFlow {
  const flow = new OnFootFlow();
  if (start === "inCar") return flow;
  flow.press(AT_REST);
  if (start === "exiting") return flow;
  flow.tick(5);
  if (start === "onFoot") return flow;
  flow.press(AT_REST);
  return flow;
}

const pressCases: readonly {
  it: string;
  start: OnFootPhase;
  car: number;
  speed: number;
  doorBlocked: boolean;
  expectedStep: OnFootStep;
  expectedPhase: OnFootPhase;
  expectedRefusal: OnFootRefusal | null;
  expectedCar: number;
}[] = [
  { it: "when pressed at rest with the door clear, then he starts getting out of that car", start: "inCar", car: 2, speed: 0.5, doorBlocked: false, expectedStep: "exitStarted", expectedPhase: "exiting", expectedRefusal: null, expectedCar: 2 },
  { it: "when pressed in a car above the exit speed, then he stays in and is told it is too fast", start: "inCar", car: 0, speed: 8, doorBlocked: false, expectedStep: "refused", expectedPhase: "inCar", expectedRefusal: "tooFast", expectedCar: -1 },
  { it: "when pressed with the driver door blocked, then he stays in and is told the door is blocked", start: "inCar", car: 0, speed: 0, doorBlocked: true, expectedStep: "refused", expectedPhase: "inCar", expectedRefusal: "doorBlocked", expectedCar: -1 },
  { it: "when pressed on foot beside a parked car, then he starts getting into that car", start: "onFoot", car: 1, speed: 0, doorBlocked: false, expectedStep: "enterStarted", expectedPhase: "entering", expectedRefusal: null, expectedCar: 1 },
  { it: "when pressed on foot with no car in reach, then he stays out and is told there is none", start: "onFoot", car: -1, speed: 0, doorBlocked: false, expectedStep: "refused", expectedPhase: "onFoot", expectedRefusal: "noCarInReach", expectedCar: 0 },
  { it: "when pressed on foot beside a car moving above the enter speed, then he stays out and is told it is too fast", start: "onFoot", car: 1, speed: 6, doorBlocked: false, expectedStep: "refused", expectedPhase: "onFoot", expectedRefusal: "tooFast", expectedCar: 0 },
  { it: "when pressed while getting out, then nothing changes and he is told he is busy", start: "exiting", car: 0, speed: 0, doorBlocked: false, expectedStep: "refused", expectedPhase: "exiting", expectedRefusal: "busy", expectedCar: 0 },
  { it: "when pressed while getting in, then nothing changes and he is told he is busy", start: "entering", car: 0, speed: 0, doorBlocked: false, expectedStep: "refused", expectedPhase: "entering", expectedRefusal: "busy", expectedCar: 0 },
];

describe("given a player at the control", () => {
  for (const testCase of pressCases) {
    it(testCase.it, () => {
      const flow = flowAt(testCase.start);
      const step = flow.press({ car: testCase.car, speed: testCase.speed, doorBlocked: testCase.doorBlocked });
      expect(step, "step").toBe(testCase.expectedStep);
      expect(flow.phase, "phase").toBe(testCase.expectedPhase);
      expect(flow.refusal, "refusal").toBe(testCase.expectedRefusal);
      expect(flow.car, "car").toBe(testCase.expectedCar);
    });
  }
});

const tickCases: readonly {
  it: string;
  start: OnFootPhase;
  seconds: number;
  expectedStep: OnFootStep;
  expectedPhase: OnFootPhase;
}[] = [
  { it: "when a short time passes while getting out, then he is still getting out", start: "exiting", seconds: 0.2, expectedStep: "none", expectedPhase: "exiting" },
  { it: "when the exit has run its course, then he stands on foot", start: "exiting", seconds: 2, expectedStep: "standing", expectedPhase: "onFoot" },
  { it: "when a short time passes while getting in, then he is still getting in", start: "entering", seconds: 0.2, expectedStep: "none", expectedPhase: "entering" },
  { it: "when the entry has run its course, then he is seated in the car", start: "entering", seconds: 2, expectedStep: "seated", expectedPhase: "inCar" },
  { it: "when time passes on foot, then he stays on foot", start: "onFoot", seconds: 10, expectedStep: "none", expectedPhase: "onFoot" },
  { it: "when time passes in the car, then he stays in the car", start: "inCar", seconds: 10, expectedStep: "none", expectedPhase: "inCar" },
];

describe("given a player part way round the cycle", () => {
  for (const testCase of tickCases) {
    it(testCase.it, () => {
      const flow = flowAt(testCase.start);
      const step = flow.tick(testCase.seconds);
      expect(step, "step").toBe(testCase.expectedStep);
      expect(flow.phase, "phase").toBe(testCase.expectedPhase);
    });
  }
});

describe("given a player who got out and wants to drive on", () => {
  it("when he walks back and gets in, then the car he left is the car he is in and the control is free again", () => {
    const flow = flowAt("onFoot");
    flow.press({ car: 0, speed: 0, doorBlocked: false });
    flow.tick(5);
    expect(flow.phase, "back in the car").toBe("inCar");
    expect(flow.car, "no car left or entered").toBe(-1);
    expect(flow.press(AT_REST), "the control gets him out again").toBe("exitStarted");
  });
});
