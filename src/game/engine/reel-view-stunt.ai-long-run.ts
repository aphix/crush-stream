import { parseTrack } from "../world/track-schema.ts";
import { Track } from "../world/track.ts";
import stunt from "../world/tracks/stunt.json" with { type: "json" };
import { raceOn } from "./reel-view.test-util.ts";
import { CREST, crashes, reelViewClaims } from "./reel-view-claims.test-util.ts";

/**
 * Full-sanity run (`npm run test:ai-long-run`), not per commit: the reel view's claims (`reel-view-claims.test-util.ts`) on the stunt
 * course: six shifts of the head-ons, wall hits and T-bones along its tight walls, and two jumps over its crest onto a car on the landing.
 * The city and havana are their own files, so the three run side by side.
 */
reelViewClaims(
  "given staged head-ons, wall hits and T-bones on the stunt course's tight walls, and jumps over its crest onto a car on the landing",
  { impact: 3, hit: 0, throw: 1, takeoff: 2, cut: 0 },
  async ({ scene }) => {
    const stuntTrack = new Track(parseTrack(stunt));
    for (const shift of [0, 0.03, 0.07, 0.1, 0.13, 0.16]) await scene(`stunt staged +${shift}`, raceOn("stunt", 3, 7), stuntTrack, crashes(stuntTrack.length, shift), 20);
    for (const land of [28, 32]) await scene(`stunt jump +${land} m`, raceOn("stunt", 3, 7), stuntTrack, [{ kind: "jump", at: CREST, speed: 30, land }], 14);
  },
);
