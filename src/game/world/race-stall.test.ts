import { describe, expect, it } from "vitest";
import { setGround } from "./ground.ts";
import { FRAME, makeWorld, frame } from "./race-world.test-util.ts";
import { RESPAWN_REQUEST_DELAY } from "../match/session.ts";

/** The director's stall window (s): `STALL_WINDOW` in `engine-race-field.ts`. */
const STALL_WINDOW = 8;
/**
 * The owner's bar (2026-10-09): a car "goes" rather than sits; stuck for more than 10-20 s is the un-fun case, whatever holds it.
 * In a race the director's stall rule is what guarantees it for every car the AI drives: one that gains under `STALL_GAIN` m of track
 * in `STALL_WINDOW` s asks for a respawn (`stalls`). This stages the stuck car itself (an AI rival held in place on the throttle, as a
 * wedge on a wall would), where the stuck canary swept 32 police races and hoped to meet one. A stopped cop is put away by the
 * same rule (`police.test.ts`, the stall recall rows).
 */
describe("given an oval race with two AI rivals, rival 1 held in place on the throttle from the green", () => {
  it(`when it gains no track for ${STALL_WINDOW} s, then the director respawns it within the stall window plus the respawn delay`, () => {
    const w = makeWorld();
    w.race.enter();
    try {
      w.race.command({ type: "quit" });
      w.race.command({ type: "options", options: { trackId: "oval", laps: 3, aiCount: 2, noReset: false, aggression: 0 } });
      w.race.command({ type: "start" });
      w.seat.mode = "follow";
      const state = { acc: 0 };
      // The grid and countdown first.
      for (let n = 0; n * FRAME < 30 && w.race.phase !== "racing"; n++) frame(w, state);
      expect(w.race.phase, "the race never went green").toBe("racing");
      const car = w.live()[1]!;
      const at = car.group.position.clone();
      const yaw = car.yaw;
      const placed = car.placements;
      let respawnedAt = -1;
      const limit = STALL_WINDOW + RESPAWN_REQUEST_DELAY + 1;
      for (let n = 0; n * FRAME < limit && respawnedAt < 0; n++) {
        frame(w, state);
        if (car.placements !== placed) {
          respawnedAt = n * FRAME;
          break;
        }
        // Held where it stood, as a wedge would hold it: the AI keeps its foot down, the car gains nothing.
        car.group.position.copy(at);
        car.yaw = yaw;
        car.velocity.set(0, 0, 0);
        car.angular.set(0, 0, 0);
      }
      expect(respawnedAt, `the held car was not respawned within ${limit.toFixed(1)} s`).toBeGreaterThan(0);
      expect(respawnedAt, `respawned at ${respawnedAt.toFixed(2)} s, before its stall window ran out`).toBeGreaterThanOrEqual(STALL_WINDOW - FRAME);
    } finally {
      w.race.exit();
      setGround(null);
    }
  });
});
