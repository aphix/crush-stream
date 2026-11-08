import { describe, expect, it } from "vitest";
import { must } from "../kernel/must.test-util.ts";
import { PREFAB } from "../world/constants.ts";
import { placeProps, propColliders, type PropCollider } from "../world/placements.ts";
import { blankProjection, projectPath, type TrackPath } from "../world/track.ts";
import { COURSES } from "./race-ai.test-util.ts";
import { hairpinsOf } from "./razor-cut.test-util.ts";

const razor = COURSES.find((t) => t.id === "razor-shelf");
must(razor, "razor-shelf is a course");
const cut = razor.shortcuts[0];
must(cut, "razor-shelf has its inside cut");

/** A hazard stands at least this far (m) off every road's drivable surface: a clean line never touches it. */
const CLEAR_MIN = 1.2;
/** ... and past a hairpin's apex on its outside it stands within this far (m) of the road edge, where a late brake runs wide. */
const NEAR_MAX = 3;
/** Samples past a hairpin's last sample that still count as its exit. */
const EXIT_SAMPLES = 20;

const placed = placeProps(razor);
/** The authored solid hazards: the hand-placed rocks and jersey barriers (placements are numbered by their place in `props`). */
const hazards = propColliders(placed).filter((c) => c.index < razor.json.props.length && (c.prefab === PREFAB.rock || c.prefab === PREFAB.barrierBlock));
const proj = blankProjection();

/** Gap (m) from the nearest point of a collider's outline to the edge of `path`'s road and runoff, at the sample it lies nearest. */
function edgeGap(path: TrackPath, c: PropCollider): { gap: number; k: number } {
  const outline: [number, number][] = [];
  if (c.kind === "circle") outline.push([c.x, c.z]);
  else {
    const cos = Math.cos(c.yaw);
    const sin = Math.sin(c.yaw);
    for (let i = 0; i <= 4; i++) {
      for (const s of [-1, 1]) {
        for (const [u, v] of [[-c.hx + (c.hx / 2) * i, s * c.hz], [s * c.hx, -c.hz + (c.hz / 2) * i]] as const) outline.push([c.x + u * cos + v * sin, c.z - u * sin + v * cos]);
      }
    }
  }
  let best = { gap: Infinity, k: 0 };
  for (const [x, z] of outline) {
    projectPath(path, x, z, -1, proj);
    const gap = Math.sqrt(proj.dist2) - (c.kind === "circle" ? c.r : 0) - path.half[proj.k]! - Math.max(path.runL[proj.k]!, path.runR[proj.k]!);
    if (gap < best.gap) best = { gap, k: proj.k };
  }
  return best;
}

describe("given the hazards hand-placed beside Razor Shelf's inside cut", () => {
  it("when each hazard is measured against every road and runoff of the course, then every one stands at least 1.2 m clear and there are hazards to measure", () => {
    expect(hazards.length, "hazard colliders").toBeGreaterThan(0);
    const near: string[] = [];
    for (const c of hazards) {
      for (const [pi, path] of razor.paths().entries()) {
        const { gap } = edgeGap(path, c);
        if (gap < CLEAR_MIN) near.push(`prop ${c.index} (${c.prefab}) is ${gap.toFixed(2)} m from road ${pi}`);
      }
    }
    expect(near, "hazards under 1.2 m from a road").toHaveLength(0);
  });

  it("when the outside of each hairpin past its apex is searched, then a solid hazard stands there within 3 m of the road edge", () => {
    const hairpins = hairpinsOf(cut.path);
    expect(hairpins.length, "hairpins on the cut").toBeGreaterThan(0);
    for (const [i, [first, last]] of hairpins.entries()) {
      const apex = Math.round((first + last) / 2);
      const turn = Math.sign(cut.path.curv[apex]!);
      const found = new Set<number>();
      for (const c of hazards) {
        const { gap, k } = edgeGap(cut.path, c);
        // The cut's left normal is (-tz, tx); a positive curvature bends toward -normal, so its outside is the +normal side.
        const outside = ((c.x - cut.path.x[k]!) * -cut.path.tz[k]! + (c.z - cut.path.z[k]!) * cut.path.tx[k]!) * turn > 0;
        if (outside && gap <= NEAR_MAX && k > apex && k <= last + EXIT_SAMPLES) found.add(c.index);
      }
      expect(found.size, `solid hazards on the outside of hairpin ${i + 1} past its apex`).toBeGreaterThan(0);
    }
  });
});
