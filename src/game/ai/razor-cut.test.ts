import { describe, expect, it } from "vitest";
import { must } from "../kernel/must.test-util.ts";
import type { VehicleClassId } from "../vehicle/vehicle-classes.ts";
import { COURSES, race } from "./race-ai.test-util.ts";
import { hairpinsOf } from "./razor-cut.test-util.ts";

const razor = COURSES.find((t) => t.id === "razor-shelf");
must(razor, "razor-shelf is a course");
const cut = razor.shortcuts[0];
must(cut, "razor-shelf has its inside cut");

/** The most (s) the cut may save a flying lap. */
const MOST_SAVED_S = 8;
/** Laps a lone car drives: its seeded coin takes the cut on some and the loop on the rest. */
const LAPS = 6;
/** How far (m) either side of the cut's centreline the ground is read: 8 m past the trail's edge. */
const BESIDE = 12;
/** The ground beside a hairpin lies at least this far (m) under the road ... */
const DROP = 5;
/** ... along at least this share of that hairpin. */
const DROP_SHARE = 0.5;

describe("given Razor Shelf's inside cut", () => {
  it("when its centreline is walked, then it bends through at least four hairpins", () => {
    expect(hairpinsOf(cut.path).length, "hairpins on the cut").toBeGreaterThanOrEqual(4);
  });

  it("when the ground beside each hairpin is read, then it lies 5 m or more under the road along at least half of that hairpin", () => {
    const ground = razor.ground();
    const p = cut.path;
    const hairpins = hairpinsOf(cut.path);
    expect(hairpins.length, "hairpins on the cut").toBeGreaterThan(0);
    for (const [i, [first, last]] of hairpins.entries()) {
      let deep = 0;
      for (let k = first; k <= last; k++) {
        // The sample's left normal is (-tz, tx).
        const left = ground.heightAt(p.x[k]! - p.tz[k]! * BESIDE, p.z[k]! + p.tx[k]! * BESIDE);
        const right = ground.heightAt(p.x[k]! + p.tz[k]! * BESIDE, p.z[k]! - p.tx[k]! * BESIDE);
        if (p.y[k]! - Math.min(left, right) >= DROP) deep++;
      }
      expect(deep / (last - first + 1), `share of hairpin ${i + 1} with ${DROP} m of drop ${BESIDE} m beside the trail`).toBeGreaterThanOrEqual(DROP_SHARE);
    }
  });
});

const classes: readonly { it: string; carClass: VehicleClassId }[] = [
  { it: "when a lone sedan's flying laps are timed by the way it went, then the cut's are quicker than the loop's by more than 1 s and at most 8 s", carClass: "sedan" },
  { it: "when a lone monster truck's flying laps are timed by the way it went, then the cut's are quicker than the loop's by more than 1 s and at most 8 s", carClass: "monster" },
];

describe("given a lone car on the hard AI lapping Razor Shelf six times, its coin taking the cut on some laps and the loop on the rest", () => {
  for (const testCase of classes) {
    it(testCase.it, () => {
      const onCut = new Set<number>();
      const { session } = race(razor, 1, 0, LAPS, (LAPS * razor.length) / 8 + 10, "hard", undefined, (_cars, s) => {
        const live = s.cars[0];
        must(live, "the car's record");
        if (live.route >= 0) onCut.add(live.lap);
      }, [testCase.carClass]);
      const rec = session.cars[0];
      must(rec, "the car's record");
      const flying = rec.lapTimes.map((time, lap) => ({ time, lap })).filter((l) => l.lap > 0);
      const mean = (times: readonly number[]): number => times.reduce((sum, t) => sum + t, 0) / times.length;
      const cutTimes = flying.filter((l) => onCut.has(l.lap)).map((l) => l.time);
      const loopTimes = flying.filter((l) => !onCut.has(l.lap)).map((l) => l.time);
      expect(rec.lapTimes, "laps finished").toHaveLength(LAPS);
      expect(cutTimes.length, "flying laps driven on the cut").toBeGreaterThan(0);
      expect(loopTimes.length, "flying laps driven on the loop").toBeGreaterThan(0);
      const saved = mean(loopTimes) - mean(cutTimes);
      const said = `s saved on the cut (loop ${mean(loopTimes).toFixed(1)} s, cut ${mean(cutTimes).toFixed(1)} s)`;
      expect(saved, said).toBeGreaterThan(1);
      expect(saved, said).toBeLessThanOrEqual(MOST_SAVED_S);
    });
  }
});
