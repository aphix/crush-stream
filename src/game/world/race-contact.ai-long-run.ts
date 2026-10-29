import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { AI_DIFFICULTIES } from "../ai/constants.ts";
import { COURSES } from "../ai/race-ai.test-util.ts";
import { kinematicContacts } from "./race-contact.test-util.ts";

/**
 * Full-sanity sweep, not a per-commit test: whole fields watched for any racer driving into another car, in the kinematic race (the brains
 * and the drive model, no crush: who drives into whom is the brains' decision). At aggression 0 every rival is as gentle as can be, and a
 * full grid (7 rivals and the AI-driven player slot) is the most crowded field. Medium and hard hold it: a medium rival is at most 10 ms
 * stale and its contact guard runs every slice. Easy rivals decide up to 200 ms late, so no clean-racing bar is claimed for them;
 * `race-ai.test.ts` holds their laps and road share. `race-contact.test.ts` runs the oval and the city per commit (so this sweep does not), with the
 * ramming field as its control. The mechanism, a holding driver's contact guard braking for a car ahead every slice, is pinned in `race-ai.test.ts`
 * ("given a stale medium driver ...").
 */
for (const difficulty of AI_DIFFICULTIES.slice(1)) {
  describe(`given every rival at aggression 0, as gentle as can be, at ${difficulty} AI, racing as the brains decide (the kinematic race)`, () => {
    for (const track of COURSES.filter((t) => t.id !== "oval" && t.id !== "city")) {
      it(`when a full grid of 8 races 2 laps of the ${track.id} course, then no racer drives into another car`, (t) => {
        const r = kinematicContacts(track, 8, 0, 2, difficulty);
        t.annotate(`${track.id}: ${r.touches.length} contacts, ${r.hits.length} racer-initiated, finished ${r.finished}/8`);
        assert.equal(r.finished, 8, "every car finished: the field raced");
        assert.deepEqual(r.hits, []);
      });
    }
  });
}
