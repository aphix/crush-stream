import { describe, expect, it } from "vitest";
import { must } from "../kernel/must.test-util.ts";
import { TRACK_ID } from "../world/constants.ts";
import { junctionsOf } from "../world/junctions.ts";
import { Track } from "../world/track.ts";
import { parseTrack } from "../world/track-schema.ts";
import { TRACKS } from "../world/tracks/index.ts";
import { RaceSession } from "./session.ts";
import { centreline, field, polyline, runTo, shortcutLine, type Pt } from "./session-drive.test-util.ts";

const razor = new Track(TRACKS.find((json) => parseTrack(json).id === TRACK_ID.razorShelf));
const cut = razor.shortcuts[0];
must(cut, "razor-shelf has its inside cut");
const junction = junctionsOf(razor)[0];
must(junction, "the cut has a junction");

/** A clean pace (m/s) and race time (s) that finish one lap either way round. */
const LINE_SPEED = 30;
const RACE_S = 120;

/** Where each car leaves the trail (the nearest of its samples) and the ground it then crosses to the exit gate. */
const offTrail = [
  { it: "when a car crosses the cut's second gate and drives straight over the open ground to its exit gate, then it earns no lap and the race flags a missed checkpoint", leaveAt: { x: 48, z: 270 }, across: [{ x: 145, z: -310 }] },
  {
    it: "when a car drives the cut's first leg, then drops across the dip and its tail's gates in order, then it earns no lap and the race flags a missed checkpoint",
    leaveAt: { x: 130, z: 236 },
    across: [{ x: 140, z: 190 }, { x: 190, z: 120 }, { x: 222, z: 60 }, { x: 225, z: -40 }, { x: 210, z: -170 }, { x: 185, z: -255 }, { x: 145, z: -310 }],
  },
] as const;

/** One lap: the main road to the cut's mouth, `middle`, then the main road from its exit to the line. */
const lapThrough = (middle: readonly Pt[]) => {
  const points = [...centreline(razor, razor.length - 6, razor.length + junction.mouthS), ...middle, ...centreline(razor, razor.length + junction.exitS + 4, 2 * razor.length + 10)];
  const session = new RaceSession(razor, field(1), { laps: 1, noReset: false });
  const events = runTo(session, [polyline(points, LINE_SPEED)], RACE_S);
  const car = session.cars[0];
  must(car, "the car's record");
  return { lapEvents: events.filter((e) => e.type === "lap").length, car };
};

describe("given Razor Shelf's inside cut, whose gates count in order", () => {
  it("when a car drives the cut's own line from mouth to exit, then it earns the lap and is never flagged", () => {
    const { lapEvents, car } = lapThrough(shortcutLine(cut.path, 0, cut.path.length, 2));
    expect(lapEvents, "lap events").toBe(1);
    expect(car.status, "status").toBe("finished");
    expect(car.missed, "missed flag").toBe(false);
  });

  for (const testCase of offTrail) {
    it(testCase.it, () => {
      const p = cut.path;
      let nearest = 0;
      for (let k = 1; k < p.count; k++) {
        if (Math.hypot(p.x[k]! - testCase.leaveAt.x, p.z[k]! - testCase.leaveAt.z) < Math.hypot(p.x[nearest]! - testCase.leaveAt.x, p.z[nearest]! - testCase.leaveAt.z)) nearest = k;
      }
      const trail = shortcutLine(p, 0, (p.length * nearest) / (p.count - 1), 2);
      const { lapEvents, car } = lapThrough([...trail, ...testCase.across]);
      expect(lapEvents, "lap events").toBe(0);
      expect(car.status, "status").toBe("racing");
      expect(car.missed, "missed flag").toBe(true);
    });
  }
});
