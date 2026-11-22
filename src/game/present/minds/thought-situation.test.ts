import { describe, expect, it } from "vitest";
import { STIMULUS } from "../civilian-gaze.ts";
import { readResident } from "./minds-read.ts";
import { mindsWorld, putStimulus } from "./minds.test-util.ts";
import { Situation, fitsSituation, pickFallback } from "./thought-situation.ts";
import { THOUGHT, Thought, isArgOf } from "./thought-tools.ts";

/** What a thought can look at: the kinds the gaze table holds of the world. */
const LOOKABLE: readonly number[] = [STIMULUS.player, STIMULUS.car, STIMULUS.siren, STIMULUS.crash, STIMULUS.knock, STIMULUS.gunshot, STIMULUS.down, STIMULUS.person];

/** The fallback's thought for the staged resident with only a stimulus of `kind` (none: an empty table) where she stands. */
function fallbackWith(kind: number): { sit: Situation; thought: Thought } {
  const { world, resident, gaze } = mindsWorld();
  if (kind !== STIMULUS.none) putStimulus(gaze, 0, kind, 0, 0, 1, 1);
  const sit = new Situation();
  const thought = new Thought();
  readResident(sit, world, world.state!, world.poses!, resident);
  pickFallback(sit, thought);
  return { sit, thought };
}

describe("given a resident whose gaze table holds one stimulus where she stands, of each kind in turn, or none", () => {
  // mutation: sed -i 's/    if (!isArgOf(THOUGHT.look_at, kind)) continue;/    if (kind === 0) continue;/' src/game/present/minds/minds-read.ts
  it("when the fallback picks her thought, then it is a thought tool with a valid argument that fits her moment", () => {
    for (const [name, kind] of Object.entries(STIMULUS)) {
      const { sit, thought } = fallbackWith(kind);
      expect(isArgOf(thought.tool, thought.arg), `${name}: tool ${thought.tool} arg ${thought.arg} is a valid pick`).toBe(true);
      expect(fitsSituation(sit, thought), `${name}: tool ${thought.tool} arg ${thought.arg} fits`).toBe(true);
    }
  });

  // mutation: sed -i 's/    if (weight <= best) continue;/    if (weight <= 9) continue;/' src/game/present/minds/thought-situation.ts
  it("when the stimulus is one a thought can look at, then she looks at it", () => {
    for (const kind of LOOKABLE) {
      const { thought } = fallbackWith(kind);
      expect([thought.tool, thought.arg], `kind ${kind}`).toEqual([THOUGHT.look_at, kind]);
    }
  });
});
