import { describe, expect, it } from "vitest";
import { Track } from "./track.ts";
import { TRACKS } from "./tracks/index.ts";
import {
  WALK_MAX,
  gateCurvature,
  gateSpacing,
  mouthClearance,
  narrowTurns,
  outsideExposure,
  seamDegrees,
  shortcutGateGap,
  shortcutSpans,
  undeclaredWallGaps,
} from "./course-validity.test-util.ts";

/** Gates sit 100-1500 m apart, on a straight (radius over 60 m within 12 m of the gate), 25 m clear of a shortcut's mouth and exit. */
const GATE_GAP_MIN = 100;
const GATE_GAP_MAX = 1500;
const GATE_RADIUS_MIN = 60;
const GATE_REACH = 12;
const MOUTH_CLEAR_MIN = 25;
const SEAM_DEG_MAX = 5;
const SHORTCUT_GATE_GAP_MAX = 60;
const OPEN_RUN_MAX = 40;

/** Courses that miss a bound today, pinned at what they measure (the value to stay at or better than): a worse course fails, and a pinned course that meets the default bound fails too (`stillBreaks`). */
const SHORT_GATE_GAP: Record<string, number> = { oval: 57, rally: 67, city: 44, stunt: 90, "figure-8": 15 };
const LONG_GATE_GAP: Record<string, number> = { "four-count": 1650, "dam-spine": 1726 };
const GATE_IN_CORNER_RADIUS: Record<string, number> = { oval: 38, rally: 16, city: 8, stunt: 27, "four-count": 43, "figure-8": 23 };
const MOUTH_CLEARANCE: Record<string, number> = { rally: 9, city: 15, stunt: 24, "dam-spine": 9, "breaker-yard": 11 };
const SPARSE_SHORTCUT_GATES: Record<string, number> = { "four-count": 225, "dam-spine": 219, "razor-shelf": 131, "breaker-yard": 118 };
/** Tightest turn radius (m) a course may still have under max(1.5 x road width, 20 m). */
const SLOW_CORNER_RADIUS: Record<string, number> = { rally: 9, city: 8, "four-count": 18, "national-mall": 13, "figure-8": 23 };
/** Longest free run (m) off an open outside corner past `OPEN_RUN_MAX`: measured + 5. four-count's longest is the walk's cap, so it is pinned by its capped walks and open corners as well. */
const KNOWN_OPEN: Record<string, { run: number; unbounded: number; corners: number }> = {
  "dam-spine": { run: 110, unbounded: 0, corners: 5 },
  "four-count": { run: WALK_MAX, unbounded: 4, corners: 314 },
};
/** Wall-line gaps no shortcut explains: how many and the longest (m), each open on both sides at the same s. */
const WALL_GAPS: Record<string, { count: number; longest: number }> = {
  city: { count: 4, longest: 25 },
  "national-mall": { count: 4, longest: 209 },
  "figure-8": { count: 4, longest: 29 },
};

const radiusOf = (curv: number): number => (curv === 0 ? Infinity : 1 / curv);

/** A pinned course must still break the default bound it is pinned against: once it meets it, its entry is stale. */
function stillBreaks(id: string, pins: Record<string, unknown>, map: string, breaks: boolean): void {
  if (id in pins) expect(breaks, `${id} meets the default bound now: drop it from ${map}`).toBe(true);
}

for (const json of TRACKS) {
  const t = new Track(json);
  describe(`given the ${t.id} course`, () => {
    // Mutation: sed -i '31s/"node": 3/"node": 1/' src/game/world/tracks/oval.json
    it(`when its gates are measured round the loop, then each is ${GATE_GAP_MIN}-${GATE_GAP_MAX} m from the next, on a straight, ${MOUTH_CLEAR_MIN} m clear of every shortcut end, and the loop's seam bends under ${SEAM_DEG_MAX} degrees`, () => {
      const gap = gateSpacing(t);
      expect(gap.min, "closest gates (m)").toBeGreaterThanOrEqual(SHORT_GATE_GAP[t.id] ?? GATE_GAP_MIN);
      expect(gap.max, "farthest gates (m)").toBeLessThanOrEqual(LONG_GATE_GAP[t.id] ?? GATE_GAP_MAX);
      const curv = gateCurvature(t, GATE_REACH);
      expect(radiusOf(curv.max), `gate ${curv.gate}'s tightest turn within ${GATE_REACH} m (m radius)`).toBeGreaterThanOrEqual(GATE_IN_CORNER_RADIUS[t.id] ?? GATE_RADIUS_MIN);
      const mouth = mouthClearance(t);
      expect(mouth.min, mouth.what).toBeGreaterThanOrEqual(MOUTH_CLEARANCE[t.id] ?? MOUTH_CLEAR_MIN);
      expect(seamDegrees(t), "seam heading change").toBeLessThan(SEAM_DEG_MAX);
      stillBreaks(t.id, SHORT_GATE_GAP, "SHORT_GATE_GAP", gap.min < GATE_GAP_MIN);
      stillBreaks(t.id, LONG_GATE_GAP, "LONG_GATE_GAP", gap.max > GATE_GAP_MAX);
      stillBreaks(t.id, GATE_IN_CORNER_RADIUS, "GATE_IN_CORNER_RADIUS", radiusOf(curv.max) < GATE_RADIUS_MIN);
      stillBreaks(t.id, MOUTH_CLEARANCE, "MOUTH_CLEARANCE", mouth.min < MOUTH_CLEAR_MIN);
    });

    // Mutation: sed -i '49,51d' src/game/world/tracks/oval.json
    it(`when its shortcuts are measured, then their gates are at most ${SHORTCUT_GATE_GAP_MAX} m apart and an unordered cut is shorter than the loop it skips`, () => {
      const gap = shortcutGateGap(t);
      expect(gap.max, `widest gap on ${gap.id} (m)`).toBeLessThanOrEqual(SPARSE_SHORTCUT_GATES[t.id] ?? SHORTCUT_GATE_GAP_MAX);
      for (const cut of shortcutSpans(t)) expect(cut.length, `${cut.id} against the ${cut.span.toFixed(0)} m it skips`).toBeLessThan(cut.span);
      stillBreaks(t.id, SPARSE_SHORTCUT_GATES, "SPARSE_SHORTCUT_GATES", gap.max > SHORTCUT_GATE_GAP_MAX);
    });

    // Mutation: sed -i '6s/"width": 18/"width": 30/' src/game/world/tracks/oval.json
    it("when every turn of the loop is measured against the road's width, then its radius is at least 1.5 x the width and 20 m", () => {
      const turns = narrowTurns(t);
      const pin = SLOW_CORNER_RADIUS[t.id];
      if (pin === undefined) expect(turns.count, `${turns.count} samples, tightest ${turns.radius.toFixed(1)} m at s ${turns.s.toFixed(0)}`).toBe(0);
      else expect(turns.radius, `tightest turn (m) at s ${turns.s.toFixed(0)}`).toBeGreaterThanOrEqual(pin);
      stillBreaks(t.id, SLOW_CORNER_RADIUS, "SLOW_CORNER_RADIUS", turns.count > 0);
    });

    // Mutation: sed -i '6s/"wall": \[true, true\]/"wall": [false, false]/' src/game/world/tracks/oval.json
    it(`when each open outside corner of the loop is walked outward, then it meets a solid or another road within ${OPEN_RUN_MAX} m`, () => {
      const run = outsideExposure(t);
      const lim = KNOWN_OPEN[t.id] ?? { run: OPEN_RUN_MAX, unbounded: 0, corners: Infinity };
      expect(run.worst, `${run.corners} open corners, the worst at s ${run.s.toFixed(0)} (${run.x.toFixed(0)}, ${run.z.toFixed(0)})`).toBeLessThanOrEqual(lim.run);
      expect(run.unbounded, `walks that meet nothing within ${WALK_MAX} m`).toBeLessThanOrEqual(lim.unbounded);
      expect(run.corners, "open outside corner samples").toBeLessThanOrEqual(lim.corners);
      stillBreaks(t.id, KNOWN_OPEN, "KNOWN_OPEN", run.worst > OPEN_RUN_MAX);
    });

    // Mutation: sed -i -e '9s/ }/, "wall": [false, true] }/' -e '10s/ }/, "wall": [true, true] }/' src/game/world/tracks/oval.json
    it("when its wall lines are read, then every opening is a shortcut's mouth or exit, bar the crossings a course declares", () => {
      const gaps = undeclaredWallGaps(t);
      const allowed = WALL_GAPS[t.id] ?? { count: 0, longest: 0 };
      expect(gaps.length, JSON.stringify(gaps)).toBeLessThanOrEqual(allowed.count);
      for (const g of gaps) expect(g.length, `${g.side} gap at s ${g.s.toFixed(0)}`).toBeLessThanOrEqual(allowed.longest);
      stillBreaks(t.id, WALL_GAPS, "WALL_GAPS", gaps.length > 0);
    });
  });
}
