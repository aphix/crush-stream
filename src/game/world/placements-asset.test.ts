import { describe, expect, it } from "vitest";
import { PREFAB, SCENERY_ARM } from "./constants.ts";
import { placeProps } from "./placements.ts";
import { SCENERY_ASSETS } from "./scenery-assets/index.ts";
import { parseTrack } from "./track-schema.ts";
import { Track } from "./track.ts";
import { square } from "./track.test-util.ts";

const HYDRANT = "street-fire-hydrant";
const CROSSWALK = "ground-crosswalk-stripes";
/** The hydrant card's own size (m), from its row in street.json. */
const HYDRANT_WIDTH = 0.42;
const HYDRANT_HEIGHT = 0.78;
const CROSSWALK_SIZE: [number, number, number] = [3.5, 1, 3];

describe("given a course whose props name scenery assets", () => {
  const course = square({
    props: [
      { prefab: PREFAB.assetCard, asset: HYDRANT, x: 30.25, z: 20.5, yaw: 0.5 },
      { prefab: PREFAB.assetCard, asset: HYDRANT, x: 33, z: 20.5, scale: 2 },
      { prefab: PREFAB.assetDecal, asset: CROSSWALK, x: 40, z: 21, size: CROSSWALK_SIZE },
      { prefab: PREFAB.cone, x: 31, z: 20 },
    ],
  });
  const placed = placeProps(new Track(course), SCENERY_ARM.off);
  const [hydrant, tall, crosswalk, cone] = placed;

  // mutation: sed -i 's/sz: sz \* p.scale, asset });/sz: sz * p.scale });/' src/game/world/placements.ts
  it("when it is placed, then an asset prop stands at its exact point with its asset and the asset's own size", () => {
    expect(placed.length, "authored props").toBe(4);
    expect(hydrant!.prefab, "hydrant prefab").toBe(PREFAB.assetCard);
    expect([hydrant!.x, hydrant!.z, hydrant!.yaw], "hydrant x, z, yaw").toEqual([30.25, 20.5, 0.5]);
    expect(hydrant!.asset, "hydrant asset").toBe(SCENERY_ASSETS.findIndex((row) => row.id === HYDRANT));
    expect(hydrant!.sy, "hydrant height (m)").toBeCloseTo(HYDRANT_HEIGHT, 6);
    expect(hydrant!.sz, "hydrant width (m)").toBeCloseTo(HYDRANT_WIDTH, 6);
  });

  // mutation: sed -i 's/sx: sx \* p.scale, sy: sy \* p.scale, sz: sz \* p.scale/sx, sy, sz/' src/game/world/placements.ts
  it("when it carries a scale or a size, then the scale multiplies the asset's size and the size replaces it", () => {
    expect(tall!.sy, "scaled hydrant height (m)").toBeCloseTo(2 * HYDRANT_HEIGHT, 6);
    expect(tall!.sz, "scaled hydrant width (m)").toBeCloseTo(2 * HYDRANT_WIDTH, 6);
    expect(crosswalk!.sx, "crosswalk width (m)").toBe(CROSSWALK_SIZE[0]);
    expect(crosswalk!.sy, "crosswalk height").toBe(CROSSWALK_SIZE[1]);
    expect(crosswalk!.sz, "crosswalk depth (m)").toBe(CROSSWALK_SIZE[2]);
    expect(crosswalk!.asset, "crosswalk asset").toBe(SCENERY_ASSETS.findIndex((row) => row.id === CROSSWALK));
  });

  // mutation: sed -i 's/if (p.asset !== undefined) {/if (false) {/' src/game/world/placements.ts
  it("when a prop names no asset, then it is placed as before: no asset, its prefab's own size", () => {
    expect(cone!.prefab, "cone prefab").toBe(PREFAB.cone);
    expect([cone!.x, cone!.z, cone!.sx, cone!.sy, cone!.sz], "cone x, z and scales").toEqual([31, 20, 1, 1, 1]);
    expect("asset" in cone!, "a cone has no asset").toBe(false);
  });
});

describe("given a prop that names an asset", () => {
  // mutation: sed -i 's/.refine((p) => p.asset === undefined ||/.refine((p) => true ||/' src/game/world/track-schema.ts
  it("when its prefab is not the asset's generic one or the id is no asset's, then the course is rejected", () => {
    const withProp = (prop: object): unknown => ({ ...square(), props: [prop] });
    expect(() => parseTrack(withProp({ prefab: PREFAB.cone, asset: HYDRANT, x: 0, z: 0 }))).toThrow(/props\.0\.prefab/);
    expect(() => parseTrack(withProp({ prefab: PREFAB.assetCard, asset: "street-no-such-thing", x: 0, z: 0 }))).toThrow(/props\.0\.asset/);
    expect(() => parseTrack(withProp({ prefab: PREFAB.assetCard, asset: HYDRANT, x: 0, z: 0 })), "the right pair parses").not.toThrow();
  });
});
