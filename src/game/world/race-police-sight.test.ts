import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { blankAiCar } from "../ai/derby-ai.ts";
import { RacerSight } from "../ai/cop-sight.ts";
import { racerSeeing } from "./race-police-sight.test-util.ts";
import { blankProjection, Track } from "./track.ts";
import fourCount from "./tracks/four-count.json" with { type: "json" };

const track = new Track(fourCount);
/** A seeded Four-Count police race's racer at 128.26 s: on the skip-city shortcut, 151 m off the main road, driving +x at 52 m/s. */
const SHORTCUT_RACER = { x: 401.4, z: 39.3 };
/** The two stakeout spots put on the road then, 225 m and 245 m behind it (the main road's arc puts them 167 m and 198 m "ahead"). */
const SPOTS = [
  { x: 182.8, z: -14.5 },
  { x: 162.8, z: -17.4 },
];

describe("given a racer on Four-Count's skip-city shortcut, off the main road's corridor, and the spots a stakeout put on the road behind it", () => {
  it("when the long-run's judge reads the spots, then it agrees with the game's sight: an off-road racer sees the ahead range round it, not the main road's arc", () => {
    const sight = new RacerSight(track, 1);
    sight.watch([{ ...blankAiCar(0), ...SHORTCUT_RACER }]);
    const proj = blankProjection();
    for (const spot of SPOTS) {
      const gameHidden = sight.hiddenAt(spot.x, spot.z, track.project(spot.x, spot.z, -1, proj).s, true);
      assert.equal(gameHidden, true, `the game reads (${spot.x}, ${spot.z}) as out of sight`);
      assert.equal(racerSeeing(track, [SHORTCUT_RACER], spot.x, spot.z).sees, false, `the judge reads (${spot.x}, ${spot.z}) as out of sight`);
    }
    const round = sight.range.ahead - 10;
    assert.equal(racerSeeing(track, [SHORTCUT_RACER], SHORTCUT_RACER.x - round, SHORTCUT_RACER.z).sees, true, "a spot inside the ahead range round it is seen");
  });
});
