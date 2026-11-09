import { describe, expect, it } from "vitest";
import { must } from "../../kernel/must.test-util.ts";
import { planBlocks } from "./openworld-blocks.ts";
import { FACING, LAYOUT, PARK } from "./openworld-constants.ts";
import { openWorldGeometry, type PathPlan, type Rect } from "./openworld-layout.ts";

/** The research ranges and sizes the scale is held to, in metres (literals on purpose: a row that read the table it checks could not fail). */
const LONG_SIDE = 112;
const SHORT_SIDE = 53;
const SIDEWALK = 3.6;
const FACE_TO_FACE = 18.2;
const PLAY_AREA = { length: 408.8, depth: 231.8 };
const CAR_WIDTH = 2;
const CAR_CLEARANCE = 0.55;
const WALKING_SPEED = 1.4;
const DOOR_REACH = 3;
const YARD_RANGE = { least: 3, most: 9 };
const LOTS_ON_A_FACE = 20;
const COURT = { length: 28, width: 15 };
/** Float noise on a coordinate (m). */
const TOLERANCE = 1e-6;

const geometry = openWorldGeometry({ ...LAYOUT });
const plans = planBlocks(geometry);

const near = (actual: number, expected: number): boolean => Math.abs(actual - expected) < 1e-6;
const overlaps = (a: Rect, b: Rect): boolean => a.x0 < b.x1 - TOLERANCE && b.x0 < a.x1 - TOLERANCE && a.z0 < b.z1 - TOLERANCE && b.z0 < a.z1 - TOLERANCE;
const pathRect = (path: PathPlan, half: number): Rect[] =>
  path.points.slice(1).map((point, index) => {
    const from = path.points[index]!;
    return { x0: Math.min(from[0], point[0]) - half, z0: Math.min(from[1], point[1]) - half, x1: Math.max(from[0], point[0]) + half, z1: Math.max(from[1], point[1]) + half };
  });

describe("given the grid's dimensions", () => {
  // mutation: sed -i 's/  lotsPerFace: 20,/  lotsPerFace: 24,/' src/game/world/openworld/openworld-constants.ts
  it("when the blocks are measured, then a block is 112 by 53 m property line to property line and 119.2 by 60.2 m curb to curb", () => {
    expect(geometry.blockLength, "block length (m)").toBeCloseTo(LONG_SIDE, 6);
    expect(geometry.blockDepth, "block depth (m)").toBeCloseTo(SHORT_SIDE, 6);
    expect(geometry.blockLength + 2 * SIDEWALK, "block length curb to curb (m)").toBeCloseTo(119.2, 6);
    expect(geometry.blockDepth + 2 * SIDEWALK, "block depth curb to curb (m)").toBeCloseTo(60.2, 6);
  });

  // mutation: sed -i 's/  wallReach: (CARRIAGEWAY + 2 \* SIDEWALK) \/ 2,/  wallReach: CARRIAGEWAY \/ 2,/' src/game/world/openworld/openworld-constants.ts
  it("when the play area is measured, then it is 408.8 by 231.8 m, building faces 18.2 m apart across every street, the walls on the outer streets' far property line", () => {
    expect(geometry.faceToFace, "building face to building face (m)").toBeCloseTo(FACE_TO_FACE, 6);
    expect(geometry.pitchX - geometry.blockLength, "gap between blocks along x (m)").toBeCloseTo(FACE_TO_FACE, 6);
    expect(geometry.pitchZ - geometry.blockDepth, "gap between blocks along z (m)").toBeCloseTo(FACE_TO_FACE, 6);
    expect(2 * geometry.halfX, "play area along x (m)").toBeCloseTo(PLAY_AREA.length, 6);
    expect(2 * geometry.halfZ, "play area along z (m)").toBeCloseTo(PLAY_AREA.depth, 6);
    expect(geometry.outerPath, "the outer streets' far sidewalk is inside the walls").toBe(true);
  });

  // mutation: sed -i 's/  parkingLane: 2.4,/  parkingLane: 2.0,/' src/game/world/openworld/openworld-constants.ts
  it("when a street and a sidewalk are added up, then two travel and two parking lanes make the carriageway and the three zones make the sidewalk", () => {
    expect(2 * geometry.travelLane + 2 * geometry.parkingLane, "carriageway from its lanes (m)").toBeCloseTo(geometry.carriageway, 6);
    expect(geometry.sidewalkFrontage + geometry.sidewalkClear + geometry.sidewalkFurniture, "sidewalk from its zones (m)").toBeCloseTo(geometry.sidewalk, 6);
  });

  // mutation: sed -i 's/  travelLane: 3.1,/  travelLane: 2.5,/' src/game/world/openworld/openworld-constants.ts
  it("when a 2 m wide car drives a travel lane or the alley, then it clears each side by 0.55 m", () => {
    expect((geometry.travelLane - CAR_WIDTH) / 2, "clearance each side in a lane (m)").toBeGreaterThanOrEqual(CAR_CLEARANCE);
    expect((geometry.alley - CAR_WIDTH) / 2, "clearance each side in the alley (m)").toBeGreaterThanOrEqual(CAR_CLEARANCE);
  });

  // mutation: sed -i 's/  lotFrontage: 5.6,/  lotFrontage: 9,/' src/game/world/openworld/openworld-constants.ts
  it("when a person walks one long block face and crosses a street at walking pace, then the face takes about 80 seconds and the carriageway about 8", () => {
    const faceSeconds = (geometry.blockLength + 2 * geometry.ringOffset) / WALKING_SPEED;
    expect(faceSeconds, "seconds along a block's sidewalk path").toBeGreaterThan(70);
    expect(faceSeconds, "seconds along a block's sidewalk path").toBeLessThan(90);
    expect(geometry.carriageway / WALKING_SPEED, "seconds across a carriageway").toBeGreaterThan(7);
    expect(geometry.carriageway / WALKING_SPEED, "seconds across a carriageway").toBeLessThan(9);
  });
});

describe("given the planned blocks", () => {
  const rowBlocks = plans.playable.filter((block) => !block.park);

  it("when the blocks are counted, then nine are playable, one is the park and a ring of sixteen lies beyond the walls", () => {
    expect(plans.playable.length, "playable blocks").toBe(9);
    expect(plans.playable.filter((block) => block.park).length, "parks").toBe(1);
    expect(plans.backdrop.length, "backdrop blocks").toBe(16);
  });

  // mutation: sed -i 's/    const x1 = x0 + geometry.lotFrontage;/    const x1 = x0 + geometry.lotFrontage - 0.5;/' src/game/world/openworld/openworld-blocks.ts
  it("when a block's long faces are read, then twenty lots tile each from the block's west edge to its east edge with no gap or overlap", () => {
    expect(rowBlocks.length, "blocks with rowhome faces").toBe(8);
    for (const block of rowBlocks) {
      for (const face of ["north", "south"] as const) {
        const lots = block.lots.filter((lot) => lot.face === face);
        expect(lots.length, `${face} lots of block ${block.column},${block.row}`).toBe(LOTS_ON_A_FACE);
        expect(near(lots[0]!.lot.x0, block.centreX - LONG_SIDE / 2), `${face} row starts at the block's west edge`).toBe(true);
        expect(near(lots[LOTS_ON_A_FACE - 1]!.lot.x1, block.centreX + LONG_SIDE / 2), `${face} row ends at the block's east edge`).toBe(true);
        for (let index = 1; index < lots.length; index++) expect(near(lots[index]!.lot.x0, lots[index - 1]!.lot.x1), `${face} lot ${index} starts where the last ends`).toBe(true);
      }
    }
  });

  // mutation: sed -i 's/      lot: rect(x0, lineZ, x1, lotBackZ),/      lot: rect(x0, lineZ, x1, lotBackZ + 1),/' src/game/world/openworld/openworld-blocks.ts
  it("when a lot is read from the street inward, then a 0.6 m setback, a 15 m house and an 8.4 m rear yard fill its 24 m", () => {
    for (const block of rowBlocks) {
      for (const lot of block.lots) {
        const lotDepth = lot.lot.z1 - lot.lot.z0;
        const house = lot.house.z1 - lot.house.z0;
        const yard = lot.yard.z1 - lot.yard.z0;
        const setback = lot.inward === 1 ? lot.house.z0 - lot.lot.z0 : lot.lot.z1 - lot.house.z1;
        expect(lotDepth, "lot depth (m)").toBeCloseTo(24, 6);
        expect(setback, "setback (m)").toBeCloseTo(0.6, 6);
        expect(house, "house depth (m)").toBeCloseTo(15, 6);
        expect(yard, "rear yard (m)").toBeCloseTo(8.4, 6);
        expect(yard, "rear yard against the research range (m)").toBeGreaterThanOrEqual(YARD_RANGE.least);
        expect(yard, "rear yard against the research range (m)").toBeLessThanOrEqual(YARD_RANGE.most);
      }
    }
  });

  // mutation: sed -i 's/  const alley = rect(block.centreX - halfLength, block.centreZ - geometry.alley \/ 2,/  const alley = rect(block.centreX - halfLength + 9, block.centreZ - geometry.alley \/ 2,/' src/game/world/openworld/openworld-blocks.ts
  it("when the two rows of a block are read, then their rear yards meet the 5 m alley on each side and the alley opens on both streets at the block's ends", () => {
    for (const block of rowBlocks) {
      const alley = block.alley;
      must(alley, "a rowhome block has an alley");
      expect(alley.z1 - alley.z0, "alley width (m)").toBeCloseTo(5, 6);
      expect(alley.x0, "alley west mouth at the block's west edge").toBeCloseTo(block.centreX - LONG_SIDE / 2, 6);
      expect(alley.x1, "alley east mouth at the block's east edge").toBeCloseTo(block.centreX + LONG_SIDE / 2, 6);
      for (const lot of block.lots) expect(near(lot.inward === 1 ? lot.yard.z1 : lot.yard.z0, lot.inward === 1 ? alley.z0 : alley.z1), "a yard ends at the alley's edge").toBe(true);
      expect(
        block.lots.some((lot) => overlaps(lot.lot, alley)),
        "a lot reaches into the alley",
      ).toBe(false);
    }
  });

  // mutation: sed -i 's/{ point: points.length - 1, side: "east" },//' src/game/world/openworld/openworld-blocks.ts
  it("when the alley's path is read, then it joins the sidewalk path at both mouths", () => {
    for (const block of rowBlocks) {
      const sides = block.paths.flatMap((path) => path.joins.map((join) => join.side)).sort();
      expect(sides, `alley path joins of block ${block.column},${block.row}`).toHaveLength(2);
      expect(sides.join(), "sides joined").toBe("east,west");
    }
  });

  // mutation: sed -i 's/const gateXs = Array.from({ length: geometry.lotsPerFace }/const gateXs = Array.from({ length: 0 }/' src/game/world/openworld/openworld-blocks.ts
  it("when the alley's path is read, then it has a node at the middle of every lot, where a yard's gate would open on it", () => {
    for (const block of rowBlocks) {
      const alleyPath = block.paths[0]!;
      for (const lot of block.lots.filter((candidate) => candidate.face === "north")) {
        expect(
          alleyPath.points.some(([x, z]) => near(x, lot.x) && near(z, block.centreZ)),
          `alley node at the middle of lot ${lot.index} of block ${block.column},${block.row}`,
        ).toBe(true);
      }
      expect(alleyPath.points.length, "alley path points: mouths, middle and a gate per lot").toBe(LOTS_ON_A_FACE + 3);
    }
  });

  // mutation: sed -i 's/      yaw: north ? FACING.north : FACING.south,/      yaw: north ? FACING.south : FACING.north,/' src/game/world/openworld/openworld-blocks.ts
  it("when a lot's front door is read, then it looks at its street from 0.6 m inside the property line, 2.1 m from the sidewalk path", () => {
    for (const block of rowBlocks) {
      for (const lot of block.lots) {
        const north = lot.face === "north";
        expect(lot.yaw, `yaw of a ${lot.face} lot`).toBe(north ? FACING.north : FACING.south);
        expect(Math.abs(lot.frontZ - lot.lineZ), "door set back from the property line (m)").toBeCloseTo(0.6, 6);
        expect(Math.abs(lot.frontZ - lot.lineZ) + geometry.ringOffset, "door to the sidewalk path (m)").toBeLessThan(DOOR_REACH);
        expect(lot.lineZ, `${lot.face} property line`).toBeCloseTo(block.centreZ + (north ? -1 : 1) * (SHORT_SIDE / 2), 6);
      }
    }
  });

  // mutation: sed -i 's/paths: \[alongStreets, ...northSouth, spur\]/paths: [alongStreets, spur]/' src/game/world/openworld/openworld-blocks.ts
  it("when the park is read, then its lawn runs to all four property lines and paths join every side, three along each long side", () => {
    const park = plans.playable.find((block) => block.park);
    must(park, "a park block");
    const lawn = park.lawn;
    must(lawn, "the park has a lawn");
    expect(park.lots.length, "lots in the park").toBe(0);
    expect(near(lawn.x0, park.centreX - LONG_SIDE / 2) && near(lawn.x1, park.centreX + LONG_SIDE / 2), "lawn spans the block's length").toBe(true);
    expect(near(lawn.z0, park.centreZ - SHORT_SIDE / 2) && near(lawn.z1, park.centreZ + SHORT_SIDE / 2), "lawn spans the block's depth").toBe(true);
    const joined = park.paths.flatMap((path) => path.joins.map((join) => join.side));
    for (const side of ["north", "south"] as const) expect(joined.filter((joinedSide) => joinedSide === side).length, `paths joining the ${side} street`).toBe(3);
    for (const side of ["west", "east"] as const) expect(joined.filter((joinedSide) => joinedSide === side).length, `paths joining the ${side} street`).toBe(1);
  });

  // mutation: sed -i 's/courtLength: 28,/courtLength: 70,/' src/game/world/openworld/openworld-constants.ts
  it("when the court is read, then it is 28 by 15 m, inside the lawn and clear of every path but the spur's end at its door", () => {
    const park = plans.playable.find((block) => block.park);
    must(park, "a park block");
    const { court, lawn } = park;
    must(court, "the park has a court");
    must(lawn, "the park has a lawn");
    expect(court.x1 - court.x0, "court length (m)").toBeCloseTo(COURT.length, 6);
    expect(court.z1 - court.z0, "court width (m)").toBeCloseTo(COURT.width, 6);
    expect(court.x0 >= lawn.x0 && court.x1 <= lawn.x1 && court.z0 >= lawn.z0 && court.z1 <= lawn.z1, "court inside the lawn").toBe(true);
    const door = park.courtDoor;
    must(door, "the court has a door");
    const endsAtDoor = (path: PathPlan): boolean => path.points[path.points.length - 1]![0] === door[0] && path.points[path.points.length - 1]![1] === door[1];
    const crossed = park.paths.flatMap((path) => pathRect(path, endsAtDoor(path) ? 0 : PARK.pathWidth / 2)).filter((rectOfPath) => overlaps(rectOfPath, court));
    expect(crossed.length, "path rectangles crossing the court").toBe(0);
    expect(door[0], "court door along x (m)").toBeCloseTo(court.x0 + COURT.length / 2, 6);
    expect(door[1], "court door on the court's edge facing the east-west path (m)").toBeCloseTo(court.z0, 6);
  });

  // mutation: sed -i 's/const inside = column >= 0 \&\& column < geometry.columns \&\& row >= 0 \&\& row < geometry.rows;/const inside = true;/' src/game/world/openworld/openworld-blocks.ts
  it("when the backdrop blocks are read, then every one lies beyond the walls and every playable block inside them", () => {
    const within = (block: { centreX: number; centreZ: number }): boolean => Math.abs(block.centreX) + LONG_SIDE / 2 <= geometry.halfX && Math.abs(block.centreZ) + SHORT_SIDE / 2 <= geometry.halfZ;
    expect(plans.playable.every(within), "every playable block inside the walls").toBe(true);
    expect(plans.backdrop.some(within), "a backdrop block inside the walls").toBe(false);
    expect(
      plans.backdrop.every((block) => block.paths.length === 0 && !block.playable),
      "backdrop blocks have no walk paths",
    ).toBe(true);
  });
});
