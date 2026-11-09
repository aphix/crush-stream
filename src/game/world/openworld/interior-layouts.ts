import type { Draft } from "./interior-draft.ts";
import { TURN, type Opening } from "./interior-kinds.ts";

/*
 * Positions are plan metres: `deep` from the street wall inward, `across` from the centre line. A piece's `facing` is the way its front points; a seat faces that way.
 */
const { front: toStreet, right: toRight, back: toBack, left: toLeft } = TURN;

/** An interior doorway: 2.1 m high, `width` wide. */
const doorway = (centre: number, width = 0.9): Opening => ({ centre, width, sill: 0, top: 2.1 });

/** Where a rowhome's stairs start (m deep), and where each flight's stairwell opening begins so a climber's head clears the slab above. */
const STAIR_FOOT = 5;
const STAIRWELL_FROM = { lower: 5.8, upper: 6 } as const;
/** The rowhome's middle partitions: between the parlour and the dining room, between dining room and kitchen, and the upper floors' room dividers. */
const PARLOUR_WALL = 4.9;
const KITCHEN_WALL = 9.4;
const UPPER_FRONT_WALL = 4.7;
const UPPER_BACK_WALL = 9.7;

function layoutRowhomeGround(d: Draft, left: number, right: number, hallEdge: number): void {
  d.crossWall(0, PARLOUR_WALL, hallEdge, right, [doorway(0.9, 1)]);
  d.put("tvUnit", 0, 0.55, -1.5, toBack);
  d.put("screen", 0, 0.5, -1.5, toBack, { lift: 0.5 });
  d.put("table", 0, 2.2, -1.5, toStreet, { width: 1, depth: 0.5, height: 0.42 });
  d.put("sofa", 0, 3.3, -1.5, toStreet);
  d.put("plant", 0, 3.6, right - 0.3, toStreet);
  d.lamp(0, 2.4, -1.5);
  d.put("table", 0, 7, 1, toStreet, { width: 1.6 });
  for (const across of [0.6, 1.4]) {
    d.put("chair", 0, 6.05, across, toBack);
    d.put("chair", 0, 7.95, across, toStreet);
  }
  d.put("dresser", 0, 7, right - 0.25, toLeft, { width: 1.4 });
  d.lamp(0, 7, 1);
  d.crossWall(0, KITCHEN_WALL, left, right, [doorway(-0.5, 1.1)]);
  const wallSide = right - 0.3;
  d.put("fridge", 0, 10.1, wallSide, toLeft, { depth: 0.6 });
  d.put("cabinet", 0, 10.8, wallSide, toLeft);
  d.put("sink", 0, 11.7, wallSide, toLeft);
  d.put("stove", 0, 12.675, wallSide, toLeft);
  d.put("cabinet", 0, 13.35, wallSide, toLeft);
  d.put("cabinet", 0, 13.95, wallSide, toLeft);
  d.put("table", 0, 13.8, left + 0.55, toStreet);
  d.put("chair", 0, 13.8, -1.1, toLeft);
  d.lamp(0, 12, 0);
}

function layoutRowhomeUpper(d: Draft, level: number, left: number, right: number, hallEdge: number, stairwellEnd: number): void {
  const spine = left + 1.65;
  d.crossWall(level, UPPER_FRONT_WALL, left, right, [doorway(-1.7)]);
  d.spineWall(level, spine, UPPER_FRONT_WALL, UPPER_BACK_WALL, [doorway(6, 0.8)]);
  d.crossWall(level, UPPER_BACK_WALL, left, right, [doorway(-1.5)]);
  const hole = STAIRWELL_FROM[level === 1 ? "lower" : "upper"];
  d.put("rail", level, (hole + stairwellEnd) / 2, hallEdge + 0.03, toRight, { width: stairwellEnd - hole });
  d.put("bed", level, 2, 1.2, toStreet);
  d.put("dresser", level, 2.5, left + 0.25, toRight);
  d.lamp(level, 2.4, 0);
  d.put("bed", level, 12.5, -1.2, toStreet);
  d.put("dresser", level, 14.4, 1.8, toStreet);
  d.lamp(level, 12, 0);
  if (level === 1) {
    d.put("bathtub", level, 7.5, right - 0.4, toLeft);
    d.put("toilet", level, 5.4, 1.4, toBack);
    d.put("basin", level, 9, 0.3, toStreet);
  } else {
    d.put("desk", level, 7, right - 0.45, toLeft);
    d.put("deskChair", level, 7, right - 1.25, toRight);
  }
}

/** Parlour, dining room and kitchen on the ground floor, the stair up the left wall, two bedrooms and a bath (or a study) above. */
export function layoutRowhome(d: Draft): void {
  const left = -d.half;
  const right = d.half;
  const hallEdge = left + 0.9;
  const lower = d.stairsUp(0, STAIR_FOOT, left + 0.45);
  const upper = d.stairsUp(1, STAIR_FOOT, left + 0.45);
  const lowerEnd = STAIR_FOOT + lower.steps * lower.run;
  const upperEnd = STAIR_FOOT + upper.steps * upper.run;
  d.floor(1, [{ deep0: STAIRWELL_FROM.lower, deep1: lowerEnd, across0: left, across1: hallEdge }]);
  d.floor(2, [{ deep0: STAIRWELL_FROM.upper, deep1: upperEnd, across0: left, across1: hallEdge }]);
  layoutRowhomeGround(d, left, right, hallEdge);
  layoutRowhomeUpper(d, 1, left, right, hallEdge, lowerEnd);
  layoutRowhomeUpper(d, 2, left, right, hallEdge, upperEnd);
}

/** The shop floor: one door, two window counters, tables, a sofa nook, the order counter with a staff gate, a back counter and a store room with a restroom. */
export function layoutCoffee(d: Draft): void {
  for (const across of [-1.65, 1.65]) {
    d.put("counter", 0, 0.55, across, toBack, { width: 1.5, depth: 0.4, height: 1.05 });
    for (const seat of [-0.4, 0.4]) d.put("stool", 0, 1.2, across + seat, toStreet);
  }
  for (const across of [-1.6, 1.6]) {
    d.put("table", 0, 3, across, toStreet);
    d.put("chair", 0, 2.2, across, toBack);
    d.put("chair", 0, 3.8, across, toStreet);
    d.lamp(0, 3, across);
  }
  d.put("sofa", 0, 5.1, -2.1, toRight, { width: 1.5 });
  d.put("armchair", 0, 4.9, 2, toLeft);
  d.put("plant", 0, 5.9, 2.3, toStreet);
  d.put("counter", 0, 6.6, -0.85, toStreet, { width: 3.4, serves: true });
  d.lamp(0, 6.6, -0.85);
  d.put("counter", 0, 8.55, -0.85, toStreet, { width: 3.4, depth: 0.6, height: 0.95 });
  d.put("backShelf", 0, 9.05, -0.85, toStreet, { width: 3.4, depth: 0.3 });
  d.crossWall(0, 9.3, -d.half, d.half, [doorway(1.7)]);
  d.put("gondola", 0, 10.2, -2.3, toRight);
  d.put("gondola", 0, 11.9, -2.3, toRight);
  d.put("fridge", 0, 14.3, -1.2, toStreet);
  d.spineWall(0, 0.8, 11.6, d.back);
  d.crossWall(0, 11.6, 0.8, d.half, [doorway(1.6, 0.8)]);
  d.put("toilet", 0, 14.3, 1.7, toStreet);
  d.put("basin", 0, 12.3, 2.3, toLeft);
}

/** The bar down the left wall with its back shelves and eight stools, tables, two booths, a pool table, a jukebox, neon in the windows, and a restroom. */
export function layoutBar(d: Draft): void {
  const left = -d.half;
  for (const deep of [4.5, 7, 9.5]) d.put("backShelf", 0, deep, left + 0.175, toRight, { width: 2.5 });
  d.put("counter", 0, 7, -3.8, toRight, { width: 7.5, serves: true, serveAt: -3.3 });
  for (let stool = 0; stool < 8; stool++) d.put("stool", 0, 4.3 + stool * 0.85, -3, toLeft);
  for (const deep of [4.6, 7.4]) {
    for (const across of [0.3, 2.5]) {
      d.put("table", 0, deep, across, toStreet);
      d.put("chair", 0, deep, across - 0.75, toRight);
      d.put("chair", 0, deep, across + 0.75, toLeft);
    }
    d.lamp(0, deep, 1.4);
  }
  for (const booth of [9.9, 12.1]) {
    d.put("table", 0, booth, 4.45, toStreet);
    d.put("bench", 0, booth - 0.8, 4.45, toBack);
    d.put("bench", 0, booth + 0.8, 4.45, toStreet);
  }
  d.put("poolTable", 0, 9, -0.5, toStreet);
  d.lamp(0, 9, -0.5);
  d.put("jukebox", 0, 14.35, 3.5, toStreet);
  d.put("neon", 0, 0.45, -1, toStreet, { lift: 1.7 });
  d.put("neon", 0, 0.45, 1, toStreet, { lift: 1.7 });
  d.crossWall(0, 11.6, left, -2.4, [doorway(-3.4)]);
  d.spineWall(0, -2.4, 11.6, d.back);
  d.put("toilet", 0, 14.3, -4.6, toStreet);
  d.put("basin", 0, 12.4, left + 0.25, toRight);
}

/** Lobby with a reception desk and waiting seats, an open plan of eight desks, a glazed-in meeting room and a pantry. */
export function layoutOffice(d: Draft): void {
  d.put("counter", 0, 3.4, 0, toStreet, { width: 3.6, serves: true });
  d.put("deskChair", 0, 4.4, 0, toStreet);
  d.put("screen", 0, 3.4, 0, toStreet, { lift: 1.1 });
  d.put("sofa", 0, 2, -4.9, toRight);
  d.put("table", 0, 2, -3.9, toRight, { width: 1, depth: 0.5, height: 0.42 });
  d.put("armchair", 0, 2, 4.8, toLeft);
  d.put("plant", 0, 0.8, 5, toStreet);
  d.lamp(0, 2.5, 0);
  for (const [row, deep] of [7.4, 10].entries()) {
    for (const across of [-4.2, -1.4, 1.4, 4.2]) {
      d.put("desk", 0, deep, across, toBack);
      d.put("deskChair", 0, deep - 0.75, across, toBack);
    }
    d.lamp(0, deep, row === 0 ? -2.8 : 2.8);
  }
  d.crossWall(0, 12.1, -d.half, -1.2, [doorway(-1.8)]);
  d.spineWall(0, -1.2, 12.1, d.back);
  d.put("table", 0, 13.4, -3.3, toStreet, { width: 2.6, depth: 1 });
  for (const across of [-4.1, -3.3, -2.5]) {
    d.put("chair", 0, 12.5, across, toBack);
    d.put("chair", 0, 14.3, across, toStreet);
  }
  for (const across of [2, 2.6, 3.2]) d.put("cabinet", 0, 14.35, across, toStreet);
  d.put("fridge", 0, 14.3, 4.2, toStreet);
  d.put("table", 0, 12.6, 3.4, toStreet);
  d.put("chair", 0, 12.6, 2.45, toRight);
  d.put("chair", 0, 12.6, 4.35, toLeft);
  d.put("chair", 0, 11.8, 3.4, toBack);
  d.put("chair", 0, 13.4, 3.4, toStreet);
}

/** The corner store: checkout by the door, three aisles of gondolas, a wall of shelves, coolers on the back wall and a deli counter. */
export function layoutStore(d: Draft): void {
  d.put("counter", 0, 2.8, -4.3, toRight, { width: 3.2, depth: 0.6, serves: true });
  for (const across of [-2, 0.5, 3]) {
    for (const deep of [3.5, 5.2, 6.9, 8.6]) d.put("gondola", 0, deep, across, toRight);
  }
  for (const deep of [3.5, 6, 8.5]) d.put("backShelf", 0, deep, d.half - 0.175, toLeft, { width: 2.5 });
  for (const across of [-3.5, -2.7, -1.9, -1.1]) d.put("fridge", 0, 14.3, across, toStreet);
  d.put("counter", 0, 12.4, 3.2, toStreet, { width: 3.6 });
  d.put("backShelf", 0, 14.4, 3.2, toStreet, { width: 3.6 });
  d.put("neon", 0, 0.45, -3.9, toStreet, { lift: 1.7 });
  for (const deep of [3, 7, 11]) d.lamp(0, deep, 0.5);
}
