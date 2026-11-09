import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { stubBrowser } from "../engine/engine-headless.test-util.ts";
import { PREFAB_IDS, PREFABS } from "../world/catalog.ts";
import { PREFAB } from "../world/constants.ts";
import { ASSET_FAMILIES, SCENERY_ASSETS } from "../world/scenery-assets/index.ts";
import { assetPrefab, assetScale } from "../world/scenery-assets/pick.ts";
import { FACADE, homeStyle, type FacadeStyle } from "./facades.ts";
import { SHOWCASE_EYE, SHOWCASE_GALLERY, SHOWCASE_RADIUS, ShowcaseArt } from "./showcase-art.ts";
import { galleryStyleOf } from "./showcase-gallery-rows.ts";

/** The prefabs that repeat in the game: the gallery shows each once (a building also once in each style that has no prefab of its own). */
const NON_UNIQUE: readonly string[] = [
  PREFAB.cone, PREFAB.tyreStack, PREFAB.hayBale, PREFAB.crate, PREFAB.barrierBlock, PREFAB.rock, PREFAB.dumpster, PREFAB.chevron,
  PREFAB.lamp, PREFAB.gantry, PREFAB.flagpole, PREFAB.billboard, PREFAB.fence, PREFAB.wall, PREFAB.tree, PREFAB.palm,
  PREFAB.grandstand, PREFAB.fountain, PREFAB.building, PREFAB.stucco, PREFAB.bush, PREFAB.flowers, PREFAB.sidewalk,
  PREFAB.parkedSedan, PREFAB.parkedHatchback, PREFAB.parkedWagon, PREFAB.parkedCoupe, PREFAB.parkedPickup,
];
/** One-of-a-kind landmarks, the two pools too big for the disc, the car parts the number keys throw (`THROWN_KINDS`), the figure-8's junkyard (its shells, Carhenge, crane), the plant's cooling tower and smokestack, and the generic asset kinds (one per way of drawing, the placement picks the sprite; the asset rows stand them): not gallery prefabs. */
const EXCLUDED: readonly string[] = [
  PREFAB.obelisk, PREFAB.capitol, PREFAB.whiteHouse, PREFAB.lincoln, PREFAB.capitolPool, PREFAB.marble, PREFAB.monument,
  PREFAB.grantMemorial, PREFAB.peaceMonument, PREFAB.garfieldMonument, PREFAB.pool, PREFAB.basin,
  PREFAB.muscleBumper, PREFAB.monsterWheel, PREFAB.carWheel, PREFAB.wreck, PREFAB.carhenge, PREFAB.junkCrane, PREFAB.coolingTower, PREFAB.smokestack,

  PREFAB.assetCard, PREFAB.assetStandee, PREFAB.assetCross, PREFAB.assetCrossSolid, PREFAB.assetDecal, PREFAB.assetTile, PREFAB.assetBox, PREFAB.assetBoxSolid,
  // The open world's edge: a wall nothing is drawn for; and the enterable lots' building, drawn as a `building` is.
  PREFAB.invisibleWall,
  PREFAB.buildingShell,
  // The open world's street kit: its own street's furniture (`prefabs-street.ts`), shown by the street rows' sprites in the gallery.
  PREFAB.bench, PREFAB.bikeRack, PREFAB.litterBin, PREFAB.parkingMeter, PREFAB.hydrant, PREFAB.cafeSet, PREFAB.busShelter, PREFAB.busStopSign, PREFAB.streetSign,
];
/** The free cam stands near the eye and looks +z: a prop closer than this behind it would fill the view. */
const MIN_CLEARANCE = 5;
/** Metres kept in from the disc's rim. */
const RIM_MARGIN = 2;
const STYLES = Object.keys(FACADE) as FacadeStyle[];
const STYLES_WITHOUT_PREFAB = STYLES.filter((style) => FACADE[style].home === null);

type Placement = (typeof SHOWCASE_GALLERY)[number];
type Box = { id: string; x0: number; x1: number; z0: number; z1: number };

/** Placement `p`'s plan box: its size scaled, then turned by its yaw. */
function footprint(p: Placement): Box {
  const [w, , d] = PREFABS[p.prefab].size;
  const cos = Math.abs(Math.cos(p.yaw));
  const sin = Math.abs(Math.sin(p.yaw));
  const hx = (cos * p.sx * w + sin * p.sz * d) / 2;
  const hz = (sin * p.sx * w + cos * p.sz * d) / 2;
  const id = p.asset === undefined ? p.prefab : SCENERY_ASSETS[p.asset]!.id;
  return { id, x0: p.x - hx, x1: p.x + hx, z0: p.z - hz, z1: p.z + hz };
}

const apart = (a: Box, b: Box): boolean => a.x1 <= b.x0 || b.x1 <= a.x0 || a.z1 <= b.z0 || b.z1 <= a.z0;

/** Names of the pairs of boxes that touch or cross. */
function touchingPairs(boxes: readonly Box[]): string[] {
  const touching: string[] = [];
  for (const [i, a] of boxes.entries()) for (const b of boxes.slice(i + 1)) if (!apart(a, b)) touching.push(`${a.id} / ${b.id}`);
  return touching;
}

/** Placements of the gallery that stand a prefab (not a scenery asset). */
const prefabPlacements = SHOWCASE_GALLERY.filter((p) => p.asset === undefined);

describe("given the showcase prop gallery", () => {
  const boxes = SHOWCASE_GALLERY.map(footprint);

  it("when its prefabs are listed, then each non-unique prefab stands once and no unique landmark is there", () => {
    // mutation: sed -i 's/PREFAB.grandstand, PREFAB.fountain\], 9)/PREFAB.grandstand], 9)/' src/game/present/showcase-art.ts
    expect(prefabPlacements.length).toBe(NON_UNIQUE.length + STYLES_WITHOUT_PREFAB.length);
    for (const id of NON_UNIQUE) expect(prefabPlacements.filter((p) => p.prefab === id).length, id).toBe(id === PREFAB.building ? 1 + STYLES_WITHOUT_PREFAB.length : 1);
    for (const id of EXCLUDED) expect(prefabPlacements.filter((p) => p.prefab === id).length, id).toBe(0);
  });

  it("when a prefab is added to the game, then it is sorted into the gallery or the excluded set", () => {
    for (const id of PREFAB_IDS) expect(NON_UNIQUE.includes(id), id).not.toBe(EXCLUDED.includes(id));
  });

  it("when the showcase floor is built, then it is drawn far past the disc the gallery stands in, so the set has no rim", () => {
    // mutation: sed -i 's/FLOOR_RADIUS = 72 \* SHOWCASE_RADIUS/FLOOR_RADIUS = SHOWCASE_RADIUS/' src/game/present/showcase-art.ts
    stubBrowser();
    const floor = new ShowcaseArt().group.children.find((child): child is THREE.Mesh => child instanceof THREE.Mesh && child.geometry instanceof THREE.CircleGeometry);
    expect(floor, "the floor").toBeDefined();
    expect((floor!.geometry as THREE.CircleGeometry).parameters.radius).toBeGreaterThanOrEqual(50 * SHOWCASE_RADIUS);
  });

  it("when its footprints are placed, then all stand behind the eye's clearance and inside the disc", () => {
    // mutation: sed -i 's/SHOWCASE_RADIUS = 140/SHOWCASE_RADIUS = 100/' src/game/present/showcase-art.ts
    const reach = SHOWCASE_RADIUS - RIM_MARGIN;
    for (const b of boxes) {
      expect(b.z0, `${b.id} reaches z ${b.z0}`).toBeGreaterThan(SHOWCASE_EYE.z + MIN_CLEARANCE);
      for (const x of [b.x0, b.x1]) for (const z of [b.z0, b.z1]) expect(Math.hypot(x, z), `${b.id} corner (${x}, ${z})`).toBeLessThanOrEqual(reach);
    }
  });

  it("when its footprints are compared, then none overlap", () => {
    // mutation: sed -i 's/const BUILDING_GAP = 4/const BUILDING_GAP = -4/' src/game/present/showcase-gallery-rows.ts
    expect(boxes.length, "footprints compared").toBeGreaterThan(NON_UNIQUE.length);
    expect(touchingPairs(boxes).slice(0, 3).join(", "), "touching pairs").toBe("");
  });
});

describe("given the scenery assets in the showcase gallery", () => {
  const assetPlacements = SHOWCASE_GALLERY.filter((p) => p.asset !== undefined);

  it("when the assets are listed, then every asset of every family stands once", () => {
    // mutation: sed -i 's/"trackside", "greenery", "desert"\]/"trackside", "greenery"]/' src/game/present/showcase-gallery-rows.ts
    expect(assetPlacements.length, "assets standing").toBe(SCENERY_ASSETS.length);
    for (const [index, a] of SCENERY_ASSETS.entries()) expect(assetPlacements.filter((p) => p.asset === index).length, a.id).toBe(1);
  });

  it("when an asset stands, then it is its own generic prefab at its own size", () => {
    // mutation: sed -i 's/const \[sx, sy, sz\] = assetScale(a, 1);/const [sx, sy, sz] = assetScale(a, 2);/' src/game/present/showcase-gallery-rows.ts
    for (const p of assetPlacements) {
      const a = SCENERY_ASSETS[p.asset!]!;
      const [sx, sy, sz] = assetScale(a, 1);
      expect([p.prefab, p.sx, p.sy, p.sz].join(), a.id).toBe([assetPrefab(a), sx, sy, sz].join());
    }
  });

  it("when the families are compared, then each stands in rows of its own, none sharing depth with another", () => {
    // mutation: sed -i 's/const ROW_GAP = 2.5/const ROW_GAP = -2.5/' src/game/present/showcase-gallery-rows.ts
    const reach = ASSET_FAMILIES.map((family) => {
      const own = assetPlacements.filter((p) => SCENERY_ASSETS[p.asset!]!.family === family).map(footprint);
      return { family, z0: Math.min(...own.map((b) => b.z0)), z1: Math.max(...own.map((b) => b.z1)) };
    });
    for (const [i, a] of reach.entries()) for (const b of reach.slice(i + 1)) expect(a.z1 <= b.z0 || b.z1 <= a.z0, `${a.family} and ${b.family} share depth`).toBeTruthy();
  });
});

describe("given the buildings in the showcase gallery", () => {
  it("when the buildings are listed, then each facade style stands once", () => {
    // mutation: sed -i 's/const OTHER_STYLES = (Object.keys(FACADE) as FacadeStyle\[\]).filter((style) => FACADE\[style\].home === null)/const OTHER_STYLES = (Object.keys(FACADE) as FacadeStyle[]).filter((style) => FACADE[style].home === null).slice(1)/' src/game/present/showcase-gallery-rows.ts
    const styles = prefabPlacements.filter((p) => p.prefab === PREFAB.building || p.prefab === PREFAB.stucco).map((p) => galleryStyleOf(p) ?? homeStyle(p.prefab));
    expect(styles.length, "buildings standing").toBe(STYLES.length);
    for (const style of STYLES) expect(styles.filter((s) => s === style).length, style).toBe(1);
  });
});
