// base props: 17
import { PREFAB } from "../constants.ts";

/** Crate stacks on the east edge: cargo crates 1.4 to 2.4 m a side. */
const STACK_CRATE = { prefab: PREFAB.crate, scale: [1.4, 2.4] };
/** Mid-z of each crate stack outside the east leg (m). */
const STACK_Z = [-150, -200, -245, -285, -325, -365];

/**
 * The crate yard in the loop's east bend, the plant's smokestack and fourth hall, and the east edge's jersey rank and crate stacks, all 8 m or more off any wall line.
 * @param {import("../../../../scripts/course-dressing.mjs").Dressing} d
 */
export default (d) => {
  d.fill([480, -110, 540, -60], [PREFAB.crate, PREFAB.barrierBlock], { near: 8, minProp: 1.5, density: 8 });
  d.keepOutRoads(8);
  d.prop(PREFAB.smokestack, 96, -46);
  d.prop(PREFAB.building, 380, -385, { size: [64, 16, 28] });
  d.row(PREFAB.barrierBlock, [586, -214], [586, -392], { every: 8, jitter: 1 });
  for (const z of STACK_Z) d.fill([590, z - 12, 636, z + 12], STACK_CRATE, { count: 5, minProp: 0.4 });
};
