import { describe, expect, it } from "vitest";
import { SURFACE } from "../constants.ts";
import { OPEN_SIDE } from "./facade-windows.ts";
import { buildingHeight } from "./interior-kinds.ts";
import { planBlocks } from "./openworld-blocks.ts";
import { layOutLots } from "./openworld-lots.ts";
import { buildOpenWorldMap } from "./openworld-map.ts";
import { LANE, LANELESS_BLOCKS, SIDE_PLACES } from "./openworld-programme.ts";
import { PLACE_KIND, SECTOR } from "./walk-graph.ts";

const lots = layOutLots();
const map = buildOpenWorldMap(lots);
const plans = planBlocks(lots.geometry).playable;
const playable = lots.places.slice(0, lots.backdropStart);
const homes = playable.filter((place) => place.kind === PLACE_KIND.home && place.interior === "rowhome");
const annexes = lots.buildings.filter((building) => building.annex === true);
/** Two coordinates within this (m) are the same point. */
const SAME = 1e-3;
/** An ell's share of the houses may fall anywhere in this range (the seeded share is 45 in a hundred). */
const ELL_SHARE_RANGE = [0.3, 0.6] as const;
/** A yard behind an ell keeps at least this much (m) before the alley's edge. */
const YARD_LEFT = 1;

/** The lane paths: two points straight from the alley to the property line, the end joined to the sidewalk. */
const lanePaths = lots.paths.filter((path) => path.points.length === 2 && path.joins.length === 1 && path.joins[0]!.side === LANE.face && path.points[0]![0] === path.points[1]![0]);
const laneBlocks = plans.filter((plan) => !LANELESS_BLOCKS.some((block) => block.row === plan.row && block.column === plan.column));

describe("given the lanes through the blocks", () => {
  // mutation: sed -i 's/LANELESS_BLOCKS: readonly { row: number; column: number }\[\] = \[{ row: ROW.B, column: 2 }\];/LANELESS_BLOCKS: readonly { row: number; column: number }[] = [];/' src/game/world/openworld/openworld-programme.ts
  it("when the blocks are read, then every block but the park's and the garden's has one lane, from its alley to its south sidewalk, over a lot left bare of houses", () => {
    expect(laneBlocks.length, "blocks with a lane").toBe(plans.length - 1);
    expect(lanePaths.length, "lane paths").toBe(laneBlocks.length);
    for (const plan of laneBlocks) {
      const lot = plan.lots.find((candidate) => candidate.face === LANE.face && candidate.index === LANE.at)!;
      const path = lanePaths.find((candidate) => Math.abs(candidate.points[0]![0] - lot.x) < SAME && candidate.points[0]![1] === plan.centreZ);
      expect(path, `lane of block ${plan.column},${plan.row}`).toBeDefined();
      expect(path!.points[1]![1], "the lane ends on the property line").toBe(lot.lineZ);
      const built = lots.buildings.filter((building) => Math.abs(building.x - lot.x) < lot.width / 2 - SAME && Math.abs(building.z - (lot.house.z0 + lot.house.z1) / 2) < SAME);
      expect(built.length, `buildings on the lane's lot in block ${plan.column},${plan.row}`).toBe(0);
      const paved = lots.areas.some((area) => area.surface === SURFACE.asphalt && area.x0 <= lot.lot.x0 + SAME && area.x1 >= lot.lot.x1 - SAME && area.z0 <= Math.min(lot.lot.z0, lot.lot.z1) + SAME && area.z1 >= Math.max(lot.lot.z0, lot.lot.z1) - SAME);
      expect(paved, `the lane of block ${plan.column},${plan.row} is paved`).toBe(true);
    }
  });

  // mutation: sed -i 's/joins: \[{ point: 1, side: lot.face }\] });/joins: [] });/' src/game/world/openworld/openworld-lots.ts
  it("when a person walks the lane, then its street end is a node with the sidewalk's path beside it, and its alley end the alley's", () => {
    const nodeNear = (x: number, z: number): number => {
      for (let node = 0; node < map.graph.nodeX.length; node++) if (Math.abs(map.graph.nodeX[node]! - x) < SAME && Math.abs(map.graph.nodeZ[node]! - z) < SAME) return node;
      return -1;
    };
    const degree = (node: number): number => map.graph.edgeStart[node + 1]! - map.graph.edgeStart[node]!;
    for (const path of lanePaths) {
      const [alley, street] = [nodeNear(path.points[0]![0], path.points[0]![1]), nodeNear(path.points[1]![0], path.points[1]![1])];
      expect(alley, "the lane's alley end is a node").toBeGreaterThanOrEqual(0);
      expect(street, "the lane's street end is a node").toBeGreaterThanOrEqual(0);
      expect(degree(street), "the lane's street end joins the lane and the sidewalk").toBeGreaterThanOrEqual(2);
    }
  });

  // mutation: sed -i 's/lots\[0\]!.index - 1 === lane/false/' src/game/world/openworld/openworld-lots.ts
  it("when the two places beside a lane are read, then each shows its side wall to it: the one on its west its east side, the one on its east its west", () => {
    for (const plan of laneBlocks) {
      const lot = plan.lots.find((candidate) => candidate.face === LANE.face && candidate.index === LANE.at)!;
      const west = playable.find((place) => place.interior !== undefined && Math.abs(place.x + place.width / 2 - lot.lot.x0) < SAME && Math.abs(place.z - (lot.house.z0 + lot.house.z1) / 2) < SAME);
      const east = playable.find((place) => place.interior !== undefined && Math.abs(place.x - place.width / 2 - lot.lot.x1) < SAME && Math.abs(place.z - (lot.house.z0 + lot.house.z1) / 2) < SAME);
      expect(west, `west of the lane in block ${plan.column},${plan.row}`).toBeDefined();
      expect(east, `east of the lane in block ${plan.column},${plan.row}`).toBeDefined();
      expect((west!.openSides ?? 0) & OPEN_SIDE.minusAcross, `${west!.name} shows its lane side`).not.toBe(0);
      expect((east!.openSides ?? 0) & OPEN_SIDE.plusAcross, `${east!.name} shows its lane side`).not.toBe(0);
    }
  });
});

describe("given the rear ells", () => {
  /** The home an ell stands behind: the one whose lot it is in, and whose back wall it butts. */
  const houseOf = (ell: (typeof annexes)[number]) => homes.find((home) => Math.abs(ell.x - home.x) <= home.width / 2 && Math.abs(Math.abs(ell.z - home.z) - (home.depth / 2 + ell.depth / 2)) < 1);

  // mutation: sed -i 's/shareOfHundred: 45/shareOfHundred: 0/' src/game/world/openworld/openworld-lots.ts
  it("when the buildings are counted, then about two in five houses have an ell, and every ell belongs to a house", () => {
    const share = annexes.length / homes.length;
    expect(share, "ells per house").toBeGreaterThan(ELL_SHARE_RANGE[0]);
    expect(share, "ells per house").toBeLessThan(ELL_SHARE_RANGE[1]);
    for (const ell of annexes) expect(houseOf(ell), `a house in front of the ell at ${ell.x.toFixed(1)}, ${ell.z.toFixed(1)}`).toBeDefined();
  });

  // mutation: sed -i 's/height: buildingHeight(Math.max(MIN_STOREYS, storeys - 1), false),/height: buildingHeight(storeys, false),/' src/game/world/openworld/openworld-lots.ts
  it("when each ell is measured against its house, then it is lower than a house of three or more, within its lot's width, in its house's style, and leaves the yard its width before the alley", () => {
    for (const ell of annexes) {
      const house = houseOf(ell)!;
      const houseHeight = buildingHeight(house.storeys, false);
      if (house.storeys > 2) expect(ell.height, `ell behind ${house.name}`).toBeLessThan(houseHeight);
      else expect(ell.height, `ell behind ${house.name}`).toBeLessThanOrEqual(houseHeight);
      expect(Math.abs(ell.x - house.x) + ell.width / 2, `ell behind ${house.name} in its lot`).toBeLessThanOrEqual(house.width / 2 + 1e-6);
      expect(ell.style, `ell behind ${house.name}`).toBe(house.style);
      const block = lots.blocks.reduce((best, candidate) => (Math.abs(candidate.centreZ - ell.z) < Math.abs(best.centreZ - ell.z) ? candidate : best));
      expect(Math.abs(ell.z - block.centreZ) - ell.depth / 2 - lots.geometry.alley / 2, `yard left behind the ell of ${house.name} (m)`).toBeGreaterThanOrEqual(YARD_LEFT);
    }
  });

  // mutation: sed -i 's/return !yard \&\& mix < ELL.shareOfHundred;/return mix < ELL.shareOfHundred;/' src/game/world/openworld/openworld-lots.ts
  it("when the lots behind which a yard place stands are read, then no ell is built there", () => {
    for (const side of SIDE_PLACES.filter((place) => place.where === "yard")) {
      const plan = plans.find((candidate) => candidate.row === side.row && candidate.column === side.column)!;
      const covered = plan.lots.filter((lot) => lot.face === side.face && lot.index >= side.at && lot.index < side.at + side.lots);
      for (const lot of covered) {
        const strayed = annexes.filter((ell) => Math.abs(ell.x - lot.x) < lot.width / 2 && Math.abs(ell.z - (lot.house.z0 + lot.house.z1) / 2) < lots.geometry.houseDepth);
        expect(strayed.length, `ells behind the yard place ${side.name} (lot ${lot.index})`).toBe(0);
      }
    }
  });
});

describe("given the landmarks", () => {
  const church = playable.find((place) => place.name === "St. Brendan's Church");
  const infill = playable.find((place) => place.name === "Moore Street Lofts");

  // mutation: sed -i 's/  { row: ROW.A, column: 0, face: "north", at: 6, venue: CHURCH },//' src/game/world/openworld/openworld-programme.ts
  it("when the programme is read, then a stone church three lots wide stands among the houses, a place to gather with hours and no interior", () => {
    expect(church, "the church").toBeDefined();
    expect(church!.style, "style").toBe("church");
    expect(church!.kind, "kind").toBe(PLACE_KIND.hangout);
    expect(church!.sector, "sector").toBe(SECTOR.worship);
    expect(church!.interior, "interior").toBeUndefined();
    expect(church!.hours, "hours").toBeDefined();
    expect(Math.round(church!.width / lots.geometry.lotFrontage), "lots wide").toBe(3);
    expect(lots.buildings.some((building) => building.style === "church" && building.enterable !== true), "a solid building of the church's style").toBe(true);
  });

  // mutation: sed -i 's/  { row: ROW.C, column: 1, face: "south", at: 12, venue: INFILL },//' src/game/world/openworld/openworld-programme.ts
  it("when the programme is read, then a modern four-storey infill two lots wide stands among the houses as a home with no interior", () => {
    expect(infill, "the infill").toBeDefined();
    expect(infill!.style, "style").toBe("infill");
    expect(infill!.kind, "kind").toBe(PLACE_KIND.home);
    expect(infill!.storeys, "storeys").toBe(4);
    expect(infill!.interior, "interior").toBeUndefined();
    expect(Math.round(infill!.width / lots.geometry.lotFrontage), "lots wide").toBe(2);
    expect(lots.buildings.find((building) => building.style === "infill")!.height, "height").toBeCloseTo(buildingHeight(4, false), 9);
  });
});
