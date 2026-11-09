import { describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import { CAR_STYLE_IDS, CAR_STYLES } from "./car-variants.ts";
import { drawnLamp, lampBatchGeometries } from "./part-variants.ts";

/** The head lamp slot's styles that draw their own: only these cost a build. */
const OWN_HEAD_STYLES = CAR_STYLE_IDS.filter((id) => CAR_STYLES[id].lamps.shapes?.head !== undefined);

describe("given a process that has built no lamp variant yet", () => {
  // mutation: sed -i 's|^    table.set(name, entry);|    for (let v = 0; v < entry.builds.length; v++) variantGeometry(entry, v);\n    table.set(name, entry);|' src/game/vehicle/part-variants.ts  (every variant is built at the first ask: the one ask casts as many rays as the whole table)
  it("when one style's head lamp is asked for, then only that style's variant is built, and the batch's call builds the others", () => {
    expect(OWN_HEAD_STYLES.length, "styles that draw their own head lamp").toBeGreaterThanOrEqual(3);
    const casts = vi.spyOn(THREE.Raycaster.prototype, "intersectObjects");

    drawnLamp(CAR_STYLES[OWN_HEAD_STYLES[0]!], "head", 1);
    const castsForOne = casts.mock.calls.length;
    lampBatchGeometries("head");
    const castsForAll = casts.mock.calls.length;

    expect(castsForOne, "rays the one variant's build cast").toBeGreaterThan(0);
    expect(castsForOne, `rays after one ask, of ${castsForAll} for every style's head lamps`).toBeLessThan(castsForAll / 2);
  });
});
