// base props: 17
import { PREFAB } from "../constants.ts";

/** The crate yard in the loop's east bend: crates and barrier blocks sprinkled 8 m or more off any wall line. @param {import("../../../../scripts/course-dressing.mjs").Dressing} d */
export default (d) => {
  d.fill([480, -110, 540, -60], [PREFAB.crate, PREFAB.barrierBlock], { near: 8, minProp: 1.5, density: 8 });
};
