import { describe, expect, it } from "vitest";
import { DEFAULT_RACE_OPTIONS } from "../match/types.ts";
import { COURSES } from "../ai/race-ai.test-util.ts";
import { kinematicContacts } from "./race-contact.test-util.ts";
import { startWrecks, WATCH } from "./race-start.test-util.ts";

/**
 * Full-sanity sweep, not a per-commit test: the first `WATCH` s of racing from every course's full grid, every car at the default aggression
 * slider (the top of the field's roll), watched for any two cars touching, as the brains decide (the kinematic race). The per-commit
 * `race-start.test.ts` holds the stunt start (the owner's report; so this sweep does not) with the ramming field as its control.
 */
describe("given races started from the grid with every slot AI-driven, clean racing, as the brains decide (the kinematic race)", () => {
  for (const track of COURSES.filter((t) => t.id !== "stunt")) {
    it(`when a full grid of 8 races the ${track.id} course at the default aggression slider, then no two cars touch in the first ${WATCH} s of racing`, () => {
      expect(kinematicContacts(track, 8, DEFAULT_RACE_OPTIONS.aggression, 2, "hard", WATCH).touches).toHaveLength(0);
    });
  }
});

describe("given a race started from the grid of the city course on the real race stack, oncoming street traffic included", () => {
  it(`when 5 rivals race with the aggression slider at 0 (a clean field), then the oncoming street traffic round the first corner wrecks nobody in the first ${WATCH} s`, () => {
    expect(startWrecks("city", 1, 5, 0)).toHaveLength(0);
  });
});
