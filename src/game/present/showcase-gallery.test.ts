import { describe, expect, it } from "vitest";
import { PREFAB_IDS, PREFABS } from "../world/catalog.ts";
import { PREFAB } from "../world/constants.ts";
import { STAGE_DIAMETER } from "./engine-world.ts";
import { SHOWCASE_EYE, SHOWCASE_GALLERY } from "./showcase-art.ts";

/** The prefabs that repeat in the game: the gallery shows each once. */
const NON_UNIQUE: readonly string[] = [
  PREFAB.cone, PREFAB.tyreStack, PREFAB.hayBale, PREFAB.crate, PREFAB.barrierBlock, PREFAB.rock, PREFAB.dumpster, PREFAB.chevron,
  PREFAB.lamp, PREFAB.gantry, PREFAB.flagpole, PREFAB.billboard, PREFAB.fence, PREFAB.wall, PREFAB.tree, PREFAB.palm,
  PREFAB.grandstand, PREFAB.fountain, PREFAB.building, PREFAB.stucco,
];
/** One-of-a-kind landmarks, and the two pools too big for the disc. */
const EXCLUDED: readonly string[] = [
  PREFAB.obelisk, PREFAB.capitol, PREFAB.whiteHouse, PREFAB.lincoln, PREFAB.capitolPool, PREFAB.marble, PREFAB.monument,
  PREFAB.grantMemorial, PREFAB.peaceMonument, PREFAB.garfieldMonument, PREFAB.pool, PREFAB.basin,
];
/** The free cam stands near the eye and looks +z: a prop closer than this behind it would fill the view. */
const MIN_CLEARANCE = 5;
/** Metres kept in from the disc's rim. */
const RIM_MARGIN = 2;

type Box = { id: string; x0: number; x1: number; z0: number; z1: number };

/** Placement `p`'s plan box: its size turned by its yaw. */
function footprint(p: (typeof SHOWCASE_GALLERY)[number]): Box {
  const [w, , d] = PREFABS[p.prefab].size;
  const cos = Math.abs(Math.cos(p.yaw));
  const sin = Math.abs(Math.sin(p.yaw));
  const hx = (p.sx * (w * cos + d * sin)) / 2;
  const hz = (p.sz * (w * sin + d * cos)) / 2;
  return { id: p.prefab, x0: p.x - hx, x1: p.x + hx, z0: p.z - hz, z1: p.z + hz };
}

describe("given the showcase prop gallery", () => {
  const boxes = SHOWCASE_GALLERY.map(footprint);

  it("when its prefabs are listed, then each non-unique prefab stands once and no unique landmark is there", () => {
    expect(SHOWCASE_GALLERY.length).toBe(NON_UNIQUE.length);
    for (const id of NON_UNIQUE) expect(SHOWCASE_GALLERY.filter((p) => p.prefab === id).length, id).toBe(1);
    for (const id of EXCLUDED) expect(SHOWCASE_GALLERY.filter((p) => p.prefab === id).length, id).toBe(0);
  });

  it("when a prefab is added to the game, then it is sorted into the gallery or the excluded set", () => {
    for (const id of PREFAB_IDS) expect(NON_UNIQUE.includes(id), id).not.toBe(EXCLUDED.includes(id));
  });

  it("when its footprints are placed, then all stand behind the eye's clearance and inside the disc", () => {
    const reach = STAGE_DIAMETER / 2 - RIM_MARGIN;
    for (const b of boxes) {
      expect(b.z0, `${b.id} reaches z ${b.z0}`).toBeGreaterThan(SHOWCASE_EYE.z + MIN_CLEARANCE);
      for (const x of [b.x0, b.x1]) for (const z of [b.z0, b.z1]) expect(Math.hypot(x, z), `${b.id} corner (${x}, ${z})`).toBeLessThanOrEqual(reach);
    }
  });

  it("when its footprints are compared, then none overlap", () => {
    for (const [i, a] of boxes.entries()) {
      for (const b of boxes.slice(i + 1)) {
        expect(a.x1 <= b.x0 || b.x1 <= a.x0 || a.z1 <= b.z0 || b.z1 <= a.z0, `${a.id} overlaps ${b.id}`).toBeTruthy();
      }
    }
  });
});
