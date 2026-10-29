import { afterEach, describe, expect, it } from "vitest";
import { setGround } from "../world/ground.ts";
import { parseTrack } from "../world/track-schema.ts";
import { TRACKS } from "../world/tracks/index.ts";
import { assertHeld, loopRun, NAMED_LOOPS, track } from "./ejection-slope.test-util.ts";

/**
 * The slope tests' full-sanity sweep (`npm run test:ai-long-run`, not the per-commit suite): a damaged sedan driven round the whole
 * main loop of every course the owner's report did not name (the named ones, `NAMED_LOOPS`, run in ejection-slope.test.ts), 2.9 to 4.5 km
 * of road each, hoping a slope or bank the staged crest runs do not reach kills the engine or throws the driver.
 */
describe("given a car that was hit once earlier and drives on, which the ground must not kill or throw its driver", () => {
  afterEach(() => setGround(null));

  for (const course of TRACKS.map((j) => parseTrack(j).id).filter((id) => id !== "city" && !(NAMED_LOOPS as readonly string[]).includes(id))) {
    for (const pace of [25, 32]) {
      it(`when a damaged sedan drives the whole ${course} loop at ${pace} m/s (banks, crests, climbs), then the engine block stays put and nobody is thrown`, (t) => {
        const trk = track(course);
        const r = loopRun(trk, pace);
        t.annotate(`${course} ${pace} m/s: block travel ${(r.settled * 1000).toFixed(1)} -> ${(r.end * 1000).toFixed(1)} mm, ended at s ${r.endS.toFixed(0)} of ${trk.length.toFixed(0)}`);
        assertHeld(r, `its end, s ${trk.length.toFixed(0)}`);
        expect(r.thrown).toHaveLength(0);
      });
    }
  }
});
