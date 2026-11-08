import { describe, expect, it } from "vitest";
import { PARKED_CARS, PREFABS } from "./catalog.ts";
import { PREFAB } from "./constants.ts";
import { boxClear, lastDressing, placeCourse, type Placed } from "./placements.ts";
import { nearOpening } from "./scenery.test-util.ts";
import { biomeLookup } from "./scenery.ts";
import { Track } from "./track.ts";
import fourCount from "./tracks/four-count.json" with { type: "json" };

const track = new Track(fourCount);
const course = placeCourse(track);
const placed = course.placed;
const authored = placed.slice(0, lastDressing.authored);

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
/** The authored woods are a solid edge: between these many trees and rocks, each within `WOODS_EDGE_REACH` m of an open road edge; the forest behind is drawn by the scenery service. */
const WOODS_EDGE_MIN = 60;
const WOODS_EDGE_MAX = 150;
const WOODS_EDGE_REACH = 15;
const WOODS_DRAWN_TREES_MIN = 60;

describe("given Four-Count's four zones", () => {
  // mutation: sed -i 's/"biome": "city"/"biome": "park"/' src/game/world/tracks/four-count.json
  it("when a point inside each zone is read, then its biome is the zone's: circuit bowl, city blocks, desert canyon, park woods", () => {
    const biome = biomeLookup(track);
    expect(biome(-280, 520), "the bowl's infield").toBe("circuit");
    expect(biome(560, 330), "the city blocks").toBe("city");
    expect(biome(840, 330), "the city's fringe past its middle draw cell (three facade styles)").toBe("circuit");
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

  // mutation: sed -i 's/"verge": 3/"verge": 1/' src/game/world/tracks/four-count.json
  it("when the woods are placed, then the few authored trees and rocks stand on a road's open edge and the zone's forest is the scenery service's drawn trees", () => {
    const edge = authored.filter((p) => (p.prefab === PREFAB.tree || p.prefab === PREFAB.rock) && WOODS.some((b) => within(p, b)));
    expect(edge.length, "authored solid trees and rocks in the woods").toBeGreaterThanOrEqual(WOODS_EDGE_MIN);
    expect(edge.length, "authored solid trees and rocks in the woods").toBeLessThanOrEqual(WOODS_EDGE_MAX);
    for (const p of edge) expect(nearOpening(track, p.x, p.z, WOODS_EDGE_REACH), `authored ${p.prefab} at (${p.x.toFixed(1)}, ${p.z.toFixed(1)}) within ${WOODS_EDGE_REACH} m of an open edge`).toBe(true);
    const drawnTrees = course.drawn.filter((p) => p.prefab === PREFAB.tree && WOODS.some((b) => within(p, b)));
    expect(drawnTrees.length, "trees the scenery service draws in the woods").toBeGreaterThanOrEqual(WOODS_DRAWN_TREES_MIN);
  });

  // mutation: sed -i 's/"prefab": "grandstand"/"prefab": "crate"/' src/game/world/tracks/four-count.json
  it("when the props are placed, then the bowl has a ring of stands round its infield (their facing is the stands row's)", () => {
    expect(countIn(PREFAB.grandstand, [BOWL]), "stands in the bowl").toBeGreaterThanOrEqual(12);
  });

  // mutation: sed -i 's/"off": \["trackside"\]/"off": []/' src/game/world/tracks/four-count.json
  it("when the scenery is drawn, then no parked cars stand behind the bowl's stands (each is a multi-part draw the budget has no room for)", () => {
    const parked = new Set<string>(PARKED_CARS.map((c) => c.prefab));
    expect(course.drawn.filter((p) => parked.has(p.prefab)).length, "parked cars drawn").toBe(0);
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
    expect(placed.filter((p) => p.prefab === PREFAB.rock && p.sx >= 1.8 && within(p, CANYON)).length, "boulders in the canyon").toBeGreaterThanOrEqual(60);
  });
});
