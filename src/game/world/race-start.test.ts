import { describe, expect, it } from "vitest";
import { DEFAULT_RACE_OPTIONS } from "../match/types.ts";
import { COURSES } from "../ai/race-ai.test-util.ts";
import { kinematicContacts } from "./race-contact.test-util.ts";
import { WATCH } from "./race-start.test-util.ts";

const STUNT = COURSES.find((t) => t.id === "stunt")!;

describe("given a race started from the full grid of 8 on the stunt course (Crossover Canyon), as the brains decide (the kinematic race)", () => {
  it(`when every car is at the default aggression slider, then no two cars touch in the first ${WATCH} s of racing`, () => {
    expect(kinematicContacts(STUNT, 8, DEFAULT_RACE_OPTIONS.aggression, 2, "hard", WATCH).touches).toHaveLength(0);
  });

  it(`when every car is at the ramming maximum of the aggression slider, then some car drives into another in the first ${WATCH} s of racing (the check can fail)`, () => {
    expect(kinematicContacts(STUNT, 8, 1, 2, "hard", WATCH).hits.length, "no hit at the ramming maximum: the clean-start test above proves nothing").toBeGreaterThanOrEqual(1);
  });
});
