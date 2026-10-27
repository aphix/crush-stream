import { parseTrack } from "../world/track-schema.ts";
import { Track } from "../world/track.ts";
import { HAVANA } from "../world/tracks/havana.ts";
import { crashes, HAVANA_SHIFTS, reelViewClaims, survivalOn } from "./reel-view-claims.test-util.ts";

/**
 * Full-sanity run (`npm run test:ai-long-run`), not per commit: the reel view's claims (`reel-view-claims.test-util.ts`) in havana: the
 * Survival player's own crashes among its blocks at six places, and two launches up the plaza face into the monument. The city and the
 * stunt course are their own files, so the three run side by side.
 */
reelViewClaims(
  "given the Survival player's own crashes among havana's blocks, and launches up havana's plaza face into the monument",
  { impact: 2, hit: 0, throw: 1, takeoff: 2, cut: 0 },
  async ({ scene }) => {
    const havana = new Track(parseTrack(HAVANA));
    for (let i = 0; i < HAVANA_SHIFTS.length; i++) {
      await scene(`havana survival ${i} +${HAVANA_SHIFTS[i]}`, survivalOn(2), havana, [{ ...crashes(havana.length, HAVANA_SHIFTS[i]!)[i % 5]!, cars: [0, 1] }], 16);
    }
    for (const [x, z, speed] of [[4, 26, 32], [-1, 30, 36]] as const) {
      await scene(`havana launch (${x}, ${z})`, survivalOn(2), havana, [{ kind: "ramp", x, z, yaw: Math.PI, speed, cars: [0, 1] }], 16);
    }
  },
);
