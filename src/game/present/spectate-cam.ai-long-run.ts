import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { COURSE_IDS } from "../world/race-world.test-util.ts";
import { courseSolids, pickLap, watchRace } from "./spectate-cam.test-util.ts";

/**
 * Full-sanity sweeps, not per-commit tests: every course's lap picked at every 8 m, and a 90 s watched race on every course. The per-commit
 * `spectate-cam.test.ts` holds the same claims on the oval alone.
 */
const WATCHED_S = 90;
/** The share of a lap's spots that must find a clear eye. */
const FOUND_SHARE = 0.9;

describe("given the trackside cinematic camera (a fixed eye beside the course that cuts to the followed car)", () => {
  for (const id of COURSE_IDS) {
    it(`when a lap is driven on ${id}, then every spot the camera picks stands clear of every solid and sees the car`, (t) => {
      const lap = pickLap(courseSolids(id));
      t.diagnostic(`${id}: ${lap.found}/${lap.spots} spots framed, pick ${lap.meanMs.toFixed(2)} ms mean, ${lap.worstMs.toFixed(2)} ms worst`);
      assert.deepEqual(lap.bad, []);
      assert.ok(lap.found >= lap.spots * FOUND_SHARE, `${id}: only ${lap.found}/${lap.spots} spots found a clear eye`);
    });
  }
});

describe("given the Auto spectator camera (the shot director that cuts between shot kinds while watching a race)", () => {
  for (const id of COURSE_IDS) {
    it(`when a race is watched on ${id}, then every trackside or high cut stands clear and sees the car, and the cuts mix shot kinds`, (t) => {
      const race = watchRace(id, courseSolids(id), WATCHED_S);
      t.diagnostic(`${id}: ${race.cuts} cuts in ${WATCHED_S} s (${[...race.kinds].join(", ")}), ${race.checked} searched spots checked`);
      assert.deepEqual(race.bad, []);
      assert.ok(race.cuts >= 8, `${race.cuts} cuts in ${WATCHED_S} s`);
      assert.ok(race.kinds.size >= 3, `only ${[...race.kinds].join(", ")}`);
      assert.ok(race.checked >= 3, `${race.checked} searched spots`);
    });
  }
});
