import { describe, expect, it } from "vitest";
import { INITIAL_HUD } from "../game/hud/hud-store.ts";
import { MINIGAME_MODES, MODE_LABELS, THROWS_PER_SET } from "../game/scenes/minigame-constants.ts";
import type { MinigameHudState } from "../game/scenes/minigame-session.ts";
import { minigamePanelView } from "./minigame-panel-view.ts";
import { firstMismatch } from "../game/kernel/compare-arrays.test-util.ts";

const LONG_JUMP_READY: MinigameHudState = {
  mode: "longJump",
  phase: "ready",
  attempt: 1,
  throwsPerSet: null,
  liveValue: null,
  lastScore: null,
  setScores: [],
  setTotal: 0,
  setComplete: false,
  best: { thisCar: null, overall: null },
  bail: null,
  noThrow: false,
};
const KEYBOARD_CONTROL = "Shift";
const RING_SET_LENGTH = 5;
const RING_READY: MinigameHudState = { ...LONG_JUMP_READY, mode: "ringFling", throwsPerSet: RING_SET_LENGTH };

describe("given the minigame HUD slice", () => {
  it("when the HUD starts, then no minigame is running", () => {
    expect(INITIAL_HUD.minigame).toBe(null);
  });
});

describe("given a long jump in each phase", () => {
  it("when ready, then Reset run works and Retry does not", () => {
    const view = minigamePanelView(LONG_JUMP_READY, KEYBOARD_CONTROL);
    expect(view.resetEnabled).toBe(true);
    expect(view.retryEnabled).toBe(false);
    expect(view.retryLabel).toBe("Retry");
  });

  it("when running, then Reset run works and the live value reads in metres", () => {
    const view = minigamePanelView({ ...LONG_JUMP_READY, phase: "running", liveValue: 12.34 }, KEYBOARD_CONTROL);
    expect(view.resetEnabled).toBe(true);
    expect(view.retryEnabled).toBe(false);
    expect(view.live).toBe("Distance 12.3 m");
  });

  it("when thrown, then neither Retry nor Reset run works", () => {
    const view = minigamePanelView({ ...LONG_JUMP_READY, phase: "thrown", liveValue: 20 }, KEYBOARD_CONTROL);
    expect(view.resetEnabled).toBe(false);
    expect(view.retryEnabled).toBe(false);
  });

  it("when scored, then Retry works, Reset run does not and the Score line shows", () => {
    const view = minigamePanelView({ ...LONG_JUMP_READY, phase: "scored", lastScore: 31.25, best: { thisCar: 31.25, overall: 40 } }, KEYBOARD_CONTROL);
    expect(view.retryEnabled).toBe(true);
    expect(view.resetEnabled).toBe(false);
    expect(view.score).toBe("31.3 m");
    expect(view.bestThisCar).toBe("31.3 m");
    expect(view.bestOverall).toBe("40.0 m");
  });

  it("when the attempt ended with nobody thrown, then Retry works, Reset run does not, and the card says no throw instead of a score", () => {
    const view = minigamePanelView({ ...LONG_JUMP_READY, phase: "scored", noThrow: true, lastScore: 31.25, best: { thisCar: 31.25, overall: 40 } }, KEYBOARD_CONTROL);
    expect(view.retryEnabled, "Retry works").toBe(true);
    expect(view.resetEnabled, "Reset run does not").toBe(false);
    expect(view.noThrow, "the no-throw line").toBe("No throw: nobody was thrown out");
    expect(view.score, "no Score line: the last score belongs to an earlier attempt").toBe(null);
    expect(view.bestThisCar, "the best stays").toBe("31.3 m");
  });

  it("when the attempt was thrown and scored, then there is no no-throw line", () => {
    const view = minigamePanelView({ ...LONG_JUMP_READY, phase: "scored", lastScore: 31.25 }, KEYBOARD_CONTROL);
    expect(view.noThrow).toBe(null);
  });

  it("when a Ring Fling attempt ended with nobody thrown, then Retry reads Retry, not Next throw, and the throw counter is unchanged", () => {
    const view = minigamePanelView({ ...RING_READY, phase: "scored", noThrow: true, attempt: 3 }, KEYBOARD_CONTROL);
    expect(view.retryLabel).toBe("Retry");
    expect(view.throwCounter).toBe(`Throw 3 / ${RING_SET_LENGTH}`);
    expect(view.scoreHint).toBe(null);
  });

  it("when it is not a Ring Fling, then there is no throw counter, set line or stepper", () => {
    const view = minigamePanelView(LONG_JUMP_READY, KEYBOARD_CONTROL);
    expect(view.throwCounter).toBe(null);
    expect(view.setScores).toBe(null);
    expect(view.total).toBe(null);
    expect(view.stepper).toBe(null);
  });

  it("when no score is yet recorded, then the bests read as a dash", () => {
    expect(minigamePanelView(LONG_JUMP_READY, KEYBOARD_CONTROL).bestOverall).toBe("–");
  });
});

describe("given the quick-switch list", () => {
  const testCases = MINIGAME_MODES.map((mode) => ({ it: `when the mode is ${mode}, then the list holds the other modes with their labels`, mode }));
  for (const testCase of testCases) {
    it(testCase.it, () => {
      const { mode } = testCase;
      const others = minigamePanelView({ ...LONG_JUMP_READY, mode }, KEYBOARD_CONTROL).otherModes;
      const expected = MINIGAME_MODES.filter((other) => other !== mode);
      expect(others.length).toBe(expected.length);
      for (let index = 0; index < expected.length; index++) {
        expect(others[index]?.mode).toBe(expected[index]);
        expect(others[index]?.label).toBe(MODE_LABELS[expected[index]!]);
      }
    });
  }
});

describe("given a Ring Fling", () => {
  it("when between throws, then the button reads Next throw and the counter shows the place", () => {
    const view = minigamePanelView({ ...RING_READY, phase: "scored", attempt: 2, lastScore: 30, setScores: [20, 30], setTotal: 50 }, KEYBOARD_CONTROL);
    expect(view.retryLabel).toBe("Next throw");
    expect(view.throwCounter).toBe("Throw 2 / 5");
    expect(view.setScores, "the scored throw is the Score line, not repeated in the set line").toBe("Set: 20");
    expect(view.total).toBe("50 pts");
    expect(view.totalLabel).toBe("Total");
    expect(view.score).toBe("30 pts");
  });

  it("when the set is complete, then the button reads New set and the total is the Best", () => {
    const view = minigamePanelView({ ...RING_READY, phase: "scored", attempt: 5, lastScore: 10, setScores: [10, 10, 10, 10, 10], setTotal: 50, setComplete: true }, KEYBOARD_CONTROL);
    expect(view.retryLabel).toBe("New set");
    expect(view.totalLabel).toBe("Best");
    expect(view.total).toBe("50 pts");
    expect(view.score).toBe("50 pts");
    expect(view.retryEnabled).toBe(true);
  });

  it("when the stepper is shown, then its bounds are the fewest and most throws a set may have", () => {
    const atMin = minigamePanelView({ ...RING_READY, throwsPerSet: THROWS_PER_SET.min }, KEYBOARD_CONTROL).stepper;
    const atMax = minigamePanelView({ ...RING_READY, throwsPerSet: THROWS_PER_SET.max }, KEYBOARD_CONTROL).stepper;
    const between = minigamePanelView({ ...RING_READY, throwsPerSet: THROWS_PER_SET.min + 1 }, KEYBOARD_CONTROL).stepper;
    expect(atMin?.value, "value at the min").toBe(THROWS_PER_SET.min);
    expect(atMin?.canDecrease, "no decrease at the min").toBe(false);
    expect(atMin?.canIncrease, "increase at the min").toBe(true);
    expect(atMax?.value, "value at the max").toBe(THROWS_PER_SET.max);
    expect(atMax?.canDecrease, "decrease at the max").toBe(true);
    expect(atMax?.canIncrease, "no increase at the max").toBe(false);
    expect(between?.value, "value between the bounds").toBe(THROWS_PER_SET.min + 1);
    expect(between?.canDecrease, "decrease between the bounds").toBe(true);
    expect(between?.canIncrease, "increase between the bounds").toBe(true);
  });

  it("when a set is under way, then the stepper is locked", () => {
    const midSet = minigamePanelView({ ...RING_READY, phase: "scored", attempt: 2, setScores: [10], setTotal: 10 }, KEYBOARD_CONTROL).stepper;
    const running = minigamePanelView({ ...RING_READY, phase: "running" }, KEYBOARD_CONTROL).stepper;
    expect(firstMismatch([midSet?.canDecrease, midSet?.canIncrease, running?.canDecrease, running?.canIncrease], [false, false, false, false])).toBeUndefined();
  });

  it("when the set is complete, then the stepper opens again", () => {
    const done = minigamePanelView({ ...RING_READY, phase: "scored", setScores: [1], setTotal: 1, setComplete: true }, KEYBOARD_CONTROL).stepper;
    expect(done?.canIncrease).toBe(true);
  });

  it("when the first throw is scored, then there is no set line to repeat it", () => {
    const view = minigamePanelView({ ...RING_READY, phase: "scored", lastScore: 30, setScores: [30], setTotal: 30 }, KEYBOARD_CONTROL);
    expect(view.score).toBe("30 pts");
    expect(view.setScores).toBe(null);
  });

  it("when the set is complete, then the set line lists every throw", () => {
    const view = minigamePanelView({ ...RING_READY, phase: "scored", attempt: 3, lastScore: 5, setScores: [10, 20, 5], setTotal: 35, setComplete: true }, KEYBOARD_CONTROL);
    expect(view.setScores).toBe("Set: 10 · 20 · 5");
  });

  it("when the next throw is ready, then the set line lists the finished throws", () => {
    const view = minigamePanelView({ ...RING_READY, attempt: 3, setScores: [10, 20], setTotal: 30 }, KEYBOARD_CONTROL);
    expect(view.setScores).toBe("Set: 10 · 20");
  });

  it("when the dummy is out, then the live ring is captioned", () => {
    expect(minigamePanelView({ ...RING_READY, phase: "thrown", liveValue: 30 }, KEYBOARD_CONTROL).live).toBe("Ring: 30");
  });

  it("when a throw scores nothing, then it reads 0 pts with the hint", () => {
    const view = minigamePanelView({ ...RING_READY, phase: "scored", lastScore: 0, setScores: [0] }, KEYBOARD_CONTROL);
    expect(view.score).toBe("0 pts");
    expect(view.scoreHint).toBe("Short of the cups");
  });

  it("when a throw scores, then there is no hint", () => {
    expect(minigamePanelView({ ...RING_READY, phase: "scored", lastScore: 10, setScores: [10] }, KEYBOARD_CONTROL).scoreHint).toBe(null);
  });

  it("when a long jump scores nothing, then there is no hint", () => {
    expect(minigamePanelView({ ...LONG_JUMP_READY, phase: "scored", lastScore: 0 }, KEYBOARD_CONTROL).scoreHint).toBe(null);
  });

  it("when the long jump is thrown, then the live reading is captioned Distance", () => {
    expect(minigamePanelView({ ...LONG_JUMP_READY, phase: "thrown", liveValue: 61.3 }, KEYBOARD_CONTROL).live).toBe("Distance 61.3 m");
  });

  it("when the high jump is thrown, then the live reading is captioned Height", () => {
    expect(minigamePanelView({ ...LONG_JUMP_READY, mode: "highJump", phase: "thrown", liveValue: 2.14 }, KEYBOARD_CONTROL).live).toBe("Height 2.1 m");
  });
});

describe("given a long jump with its bail", () => {
  const BAILING: MinigameHudState = { ...LONG_JUMP_READY, bail: { pressed: false, verdict: null } };
  const testCases = [
    { it: "when it is ready and nothing is pressed, then the prompt names the control and the barrier", state: BAILING, control: "Shift", expectedPrompt: "Press Shift as you hit the barrier", expectedResult: null },
    { it: "when it is running on a pad whose boost button is named Cross, then the prompt names Cross", state: { ...BAILING, phase: "running" }, control: "Cross", expectedPrompt: "Press Cross as you hit the barrier", expectedResult: null },
    { it: "when the bail is pressed and the barrier is not hit yet, then the prompt says so", state: { ...BAILING, phase: "running", bail: { pressed: true, verdict: null } }, control: "Shift", expectedPrompt: "Bail pressed", expectedResult: null },
    { it: "when he is thrown after a perfect bail, then the prompt is gone and the result reads Perfect", state: { ...BAILING, phase: "thrown", bail: { pressed: true, verdict: { kind: "perfect", offsetSeconds: 0.01, quality: 1 } } }, control: "Shift", expectedPrompt: null, expectedResult: "Perfect" },
    { it: "when he is thrown after an early press, then the result reads the seconds early", state: { ...BAILING, phase: "scored", lastScore: 70, bail: { pressed: true, verdict: { kind: "early", offsetSeconds: -0.12, quality: 0.5 } } }, control: "Shift", expectedPrompt: null, expectedResult: "Early 0.12 s" },
    { it: "when he is thrown after a late press, then the result reads the seconds late", state: { ...BAILING, phase: "scored", lastScore: 70, bail: { pressed: true, verdict: { kind: "late", offsetSeconds: 0.08, quality: 0.6 } } }, control: "Shift", expectedPrompt: null, expectedResult: "Late 0.08 s" },
    { it: "when the only press was far too early, then the result says the bail was wasted", state: { ...BAILING, phase: "scored", lastScore: 50, bail: { pressed: true, verdict: { kind: "tooEarly", offsetSeconds: -0.9, quality: 0 } } }, control: "Shift", expectedPrompt: null, expectedResult: "Too early (0.90 s): no bail" },
    { it: "when the press came after the throw, then the result says it was too late", state: { ...BAILING, phase: "scored", lastScore: 50, bail: { pressed: true, verdict: { kind: "tooLate", offsetSeconds: 0.6, quality: 0 } } }, control: "Shift", expectedPrompt: null, expectedResult: "Too late (0.60 s): no bail" },
    { it: "when nothing was pressed, then the result reads No bail", state: { ...BAILING, phase: "scored", lastScore: 50, bail: { pressed: false, verdict: { kind: "none", offsetSeconds: null, quality: 0 } } }, control: "Shift", expectedPrompt: null, expectedResult: "No bail" },
    { it: "when it is another mode with no bail, then there is neither prompt nor result", state: { ...LONG_JUMP_READY, mode: "highJump" }, control: "Shift", expectedPrompt: null, expectedResult: null },
  ] as const;
  for (const testCase of testCases) {
    it(testCase.it, () => {
      const view = minigamePanelView(testCase.state, testCase.control);
      expect(view.bailPrompt, "prompt").toBe(testCase.expectedPrompt);
      expect(view.bailResult, "result").toBe(testCase.expectedResult);
    });
  }
});

describe("given the card on a touch screen, which shows Retry inline only once the attempt is scored", () => {
  const testCases = [
    { it: "when the attempt is ready, then Retry is disabled", phase: "ready" },
    { it: "when the attempt is running, then Retry is disabled", phase: "running" },
    { it: "when the attempt is thrown, then Retry is disabled", phase: "thrown" },
    { it: "when the attempt is scored, then Retry is enabled", phase: "scored" },
  ] as const;
  for (const testCase of testCases) {
    it(testCase.it, () => {
      const { phase } = testCase;
      expect(minigamePanelView({ ...LONG_JUMP_READY, phase }, "Boost").retryEnabled).toBe(phase === "scored");
    });
  }
});

describe("given a long jump whose bail is armed", () => {
  const BAILING: MinigameHudState = { ...LONG_JUMP_READY, bail: { pressed: false, verdict: null } };

  it("when the verdict is in but the phase is still running, then the prompt is gone", () => {
    const state: MinigameHudState = { ...BAILING, phase: "running", bail: { pressed: true, verdict: { kind: "perfect", offsetSeconds: 0, quality: 1 } } };
    expect(minigamePanelView(state, KEYBOARD_CONTROL).bailPrompt).toBe(null);
  });

  it("when the phase is thrown with no verdict yet, then the prompt is gone", () => {
    expect(minigamePanelView({ ...BAILING, phase: "thrown" }, KEYBOARD_CONTROL).bailPrompt).toBe(null);
  });
});
