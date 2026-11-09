import { describe, expect, it } from "vitest";
import { buildingHeight, DEFAULT_STOREYS, MAX_STOREYS, MIN_STOREYS, storeysOfHeight } from "./interior-kinds.ts";
import { layOutLots } from "./openworld-lots.ts";
import { storeysOfFace, walkOfFace } from "./openworld-storeys.ts";
import { PLACE_KIND } from "./walk-graph.ts";

const lots = layOutLots();
const playable = lots.places.slice(0, lots.backdropStart);
const buildings = playable.filter((place) => place.storeys > 0 && place.interior !== undefined);
/** Rows and columns of the blocks, and lots on a face: the faces the programme lays out. */
const ROWS = 3;
const COLUMNS = 3;
const FACE_LOTS = 20;
/** Two coordinates within this (m) are the same point. */
const SAME = 1e-3;
const faces = Array.from({ length: ROWS * COLUMNS * 2 }, (_, at) => ({ row: Math.floor(at / (COLUMNS * 2)), column: Math.floor(at / 2) % COLUMNS, south: at % 2 === 1 }));

describe("given the storeys of the lots of every face of every block", () => {
  // mutation: sed -i 's/const CORNER_BONUS = 1;/const CORNER_BONUS = 0;/' src/game/world/openworld/openworld-storeys.ts
  it("when a face is walked, then each end lot is a storey taller than the walk alone gives it, and the lots between are the walk's", () => {
    for (const { row, column, south } of faces) {
      const walk = walkOfFace(row, column, south, FACE_LOTS);
      const storeys = storeysOfFace(row, column, south, FACE_LOTS);
      const label = `row ${row} column ${column} ${south ? "south" : "north"}`;
      expect(storeys.length, `${label} lots`).toBe(FACE_LOTS);
      for (let lot = 0; lot < FACE_LOTS; lot++) {
        const end = lot === 0 || lot === FACE_LOTS - 1;
        expect(storeys[lot], `${label} lot ${lot}`).toBe(end ? Math.min(MAX_STOREYS, walk[lot]! + 1) : walk[lot]);
      }
    }
  });

  // mutation: sed -i 's/const LOW_RUN_CHANCE = 0.08;/const LOW_RUN_CHANCE = 0;/' src/game/world/openworld/openworld-storeys.ts
  it("when every face is read, then the counts stay within the range, three is the commonest, every count turns up, and a run of two-storey houses stands somewhere", () => {
    const counts = new Map<number, number>();
    let lowRuns = 0;
    for (const { row, column, south } of faces) {
      const walk = walkOfFace(row, column, south, FACE_LOTS);
      for (const [lot, storeys] of walk.entries()) {
        expect(storeys >= MIN_STOREYS && storeys <= MAX_STOREYS, `row ${row} column ${column} lot ${lot}: ${storeys}`).toBe(true);
        counts.set(storeys, (counts.get(storeys) ?? 0) + 1);
        if (lot > 0 && storeys === MIN_STOREYS && walk[lot - 1] === MIN_STOREYS) lowRuns++;
      }
    }
    for (let storeys = MIN_STOREYS; storeys <= MAX_STOREYS; storeys++) expect(counts.get(storeys) ?? 0, `lots of ${storeys} storeys`).toBeGreaterThan(0);
    const commonest = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]![0];
    expect(commonest, "the commonest count").toBe(DEFAULT_STOREYS);
    expect(lowRuns, "neighbouring two-storey lots").toBeGreaterThan(0);
  });

  // mutation: sed -i 's/  const random = mulberry32(SEED_MIX.salt + row \* SEED_MIX.row + column \* SEED_MIX.column + (south ? SEED_MIX.south : 0));/  const random = Math.random;/' src/game/world/openworld/openworld-storeys.ts
  it("when a face is walked twice, then it is the same; when it is walked longer, then its lots so far are the same", () => {
    for (const { row, column, south } of faces) {
      expect(walkOfFace(row, column, south, FACE_LOTS).join(), "the same walk").toBe(walkOfFace(row, column, south, FACE_LOTS).join());
      expect(walkOfFace(row, column, south, FACE_LOTS - 3).join(), "a shorter walk").toBe(walkOfFace(row, column, south, FACE_LOTS).slice(0, FACE_LOTS - 3).join());
    }
  });
});

describe("given the places of the map", () => {
  // mutation: sed -i 's/const storeys = venueStoreys(venue, spanned);/const storeys = venue.storeys;/' src/game/world/openworld/openworld-lots.ts
  it("when each building is read, then its height is its storeys' and its place says the same count, the supermarket keeps its two, and no shop is lower than its programme says", () => {
    for (const building of lots.buildings.filter((candidate) => candidate.annex !== true)) {
      const place = playable.find((candidate) => Math.abs(candidate.x - building.x) < SAME && Math.abs(candidate.z - building.z) < SAME && candidate.storeys > 0)!;
      expect(place, `a place for the building at ${building.x.toFixed(1)}, ${building.z.toFixed(1)}`).toBeDefined();
      const shop = place.kind !== PLACE_KIND.home;
      expect(storeysOfHeight(building.height, shop), `${place.name} storeys by height`).toBe(place.storeys);
      expect(building.height, `${place.name} height`).toBeCloseTo(buildingHeight(place.storeys, shop), 9);
      expect(place.storeys >= MIN_STOREYS && place.storeys <= MAX_STOREYS, `${place.name} storeys ${place.storeys}`).toBe(true);
      if (place.style === "supermarket") expect(place.storeys, "the supermarket").toBe(2);
    }
    expect(Math.max(...buildings.map((place) => place.storeys)), "tallest").toBeGreaterThan(DEFAULT_STOREYS);
    expect(Math.min(...buildings.map((place) => place.storeys)), "lowest").toBe(MIN_STOREYS);
  });

  // mutation: sed -i 's/const CORNER_BONUS = 1;/const CORNER_BONUS = 0;/' src/game/world/openworld/openworld-storeys.ts
  it("when the heights of a face's corner places are read, then each end of a block's face stands taller than its walk alone gave a house, so a block reads as a corner and a run", () => {
    const corners = buildings.filter((place) => place.openSides !== undefined);
    expect(corners.length, "corner buildings").toBeGreaterThan(0);
    for (const place of corners) expect(place.storeys, `${place.name} at a block's end`).toBeGreaterThan(MIN_STOREYS);
  });
});

describe("given a building's height and its storeys", () => {
  // mutation: sed -i 's/ROOF_ALLOWANCE) \/ STOREY) + 1;/ROOF_ALLOWANCE) \/ STOREY);/' src/game/world/openworld/interior-kinds.ts
  it("when a height is turned into storeys and back, then every count in the range returns itself, for a house and for a shop", () => {
    for (const shop of [false, true]) {
      for (let storeys = MIN_STOREYS; storeys <= MAX_STOREYS; storeys++) expect(storeysOfHeight(buildingHeight(storeys, shop), shop), `${shop ? "shop" : "house"} of ${storeys}`).toBe(storeys);
    }
  });
});
