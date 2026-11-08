import { describe, expect, it } from "vitest";
import { PREFABS } from "./catalog.ts";
import { PREFAB } from "./constants.ts";
import { boxClear, placeProps, type Placed } from "./placements.ts";
import { biomeLookup } from "./scenery.ts";
import { Track } from "./track.ts";
import fourCount from "./tracks/four-count.json" with { type: "json" };

const track = new Track(fourCount);
const placed = placeProps(track);

type Box = readonly [x0: number, z0: number, x1: number, z1: number];
const CITY: Box = [300, 190, 880, 580];
const CANYON: Box = [380, -170, 880, 189];
const BOWL: Box = [-460, 300, -150, 650];
const WOODS: readonly Box[] = [[-455, -170, -180, 295], [-180, -170, 300, 50], [-150, 105, 150, 330]];

const within = (p: Placed, [x0, z0, x1, z1]: Box): boolean => p.x >= x0 && p.x <= x1 && p.z >= z0 && p.z <= z1;
const countIn = (prefab: string, boxes: readonly Box[]): number => placed.filter((p) => p.prefab === prefab && boxes.some((b) => within(p, b))).length;

/** The sidewalk the city biome lays is 3.6 m beyond the wall line: a facade stands further off than that. */
const FACADE_SETBACK = 6.9;
const PLATEAU_FOOT_CLEAR = 9;

describe("given Four-Count's four zones", () => {
  // mutation: sed -i 's/"biome": "city"/"biome": "park"/' src/game/world/tracks/four-count.json
  it("when a point inside each zone is read, then its biome is the zone's: circuit bowl, city blocks, desert canyon, park woods", () => {
    const biome = biomeLookup(track);
    expect(biome(-280, 520), "the bowl's infield").toBe("circuit");
    expect(biome(560, 330), "the city blocks").toBe("city");
    expect(biome(620, 40), "the canyon").toBe("desert");
    expect(biome(-100, -50), "the woods by the dirt road").toBe("park");
    expect(biome(-300, 200), "the woods in the west infield").toBe("park");
  });

  // mutation: sed -i 's/"prefab": "building"/"prefab": "crate"/' src/game/world/tracks/four-count.json
  it("when the props are placed, then the city holds a lot grid of buildings and each facade stands back from every road past its sidewalk", () => {
    const buildings = placed.filter((p) => p.prefab === PREFAB.building && within(p, CITY));
    expect(buildings.length, "buildings in the city box").toBeGreaterThanOrEqual(250);
    for (const b of buildings) {
      const half = (PREFABS.building.size[0] * b.sx) / 2;
      for (const path of track.paths()) {
        expect(boxClear(path, b.x, b.z, b.yaw, half, half), `building at (${b.x.toFixed(1)}, ${b.z.toFixed(1)})`).toBeGreaterThanOrEqual(FACADE_SETBACK);
      }
    }
  });

  // mutation: sed -i 's/"prefab": "tree"/"prefab": "rock"/' src/game/world/tracks/four-count.json
  it("when the props are placed, then the woods are dense with trees, bushes and rocks", () => {
    expect(countIn(PREFAB.tree, WOODS), "trees in the woods").toBeGreaterThanOrEqual(1900);
    expect(countIn(PREFAB.bush, WOODS), "bushes in the woods").toBeGreaterThanOrEqual(700);
    expect(countIn(PREFAB.rock, WOODS), "rocks in the woods").toBeGreaterThanOrEqual(180);
  });

  // mutation: sed -i 's/"prefab": "grandstand"/"prefab": "crate"/' src/game/world/tracks/four-count.json
  it("when the props are placed, then the bowl has a ring of stands round its infield (their facing is the stands row's)", () => {
    expect(countIn(PREFAB.grandstand, [BOWL]), "stands in the bowl").toBeGreaterThanOrEqual(12);
  });

  // mutation: sed -i '/"halfX": /s/"height": [0-9]*/"height": 1/' src/game/world/tracks/four-count.json
  it("when the canyon's ground is read, then each mesa stands at its height, its foot keeps off every road, and boulders stand in the gaps", () => {
    const { plateaus } = track.json.environment;
    expect(plateaus.length, "mesas").toBeGreaterThanOrEqual(10);
    for (const p of plateaus) {
      const top = track.ground().heightAt(p.x, p.z);
      expect(top, `mesa at (${p.x}, ${p.z}): ground at its centre (m)`).toBeGreaterThan(p.height - 1);
      expect(top, `mesa at (${p.x}, ${p.z}): ground at its centre (m)`).toBeLessThan(p.height + 1);
      const foot = Math.max(p.halfX, p.halfZ) + Math.max(...p.run) + p.round;
      for (const path of track.paths()) expect(boxClear(path, p.x, p.z, 0, foot, foot), `mesa at (${p.x}, ${p.z}): foot to the nearest road (m)`).toBeGreaterThanOrEqual(PLATEAU_FOOT_CLEAR);
    }
    expect(placed.filter((p) => p.prefab === PREFAB.rock && p.sx >= 1.8 && within(p, CANYON)).length, "boulders in the canyon").toBeGreaterThanOrEqual(80);
  });
});
