import { parseTrack } from "../world/track-schema.ts";
import { Track } from "../world/track.ts";
import city from "../world/tracks/city.json" with { type: "json" };
import { raceOn } from "./reel-view.test-util.ts";
import { chain, crashes, reelViewClaims } from "./reel-view-claims.test-util.ts";

/**
 * Full-sanity run (`npm run test:ai-long-run`), not per commit: the reel view's claims (`reel-view-claims.test-util.ts`) over the city's
 * places, a ramming city race's own clips among them. The per-commit `reel-view.test.ts` stages one crash of each kind; this walks
 * each kind along the lap (six shifts of the head-ons, wall hits and T-bones, three chains at three shifts), in case a building hides a
 * moment somewhere else. The stunt course and havana are their own files, so the three run side by side.
 */
reelViewClaims(
  "given highlight reels from a ramming city race, and staged head-ons, wall hits, T-bones and chains among the city's buildings",
  { impact: 5, hit: 6, throw: 2, takeoff: 0, cut: 1 },
  async ({ scene, cityField }) => {
    const cityTrack = new Track(parseTrack(city));
    await cityField("city field", cityTrack, 70);
    for (const shift of [0, 0.03, 0.07, 0.1, 0.13, 0.16]) await scene(`city staged +${shift}`, raceOn("city", 8, 7), cityTrack, crashes(cityTrack.length, shift), 20);
    for (const [gap, seed] of [[7, 5], [16, 6], [24, 7]] as const) {
      for (const shift of [0, 0.05, 0.1]) await scene(`city chain gap ${gap} m +${shift}`, raceOn("city", seed, 7), cityTrack, chain(shift, gap), 16);
    }
  },
);
