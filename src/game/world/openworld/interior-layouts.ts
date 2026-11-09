import { flightHead, type Draft } from "./interior-draft.ts";
import { FURNISHING, OPENING, PARTITION, TURN, type Opening, type Rect, type Stairs } from "./interior-kinds.ts";

/*
 * Positions are plan metres: `deep` from the street wall inward, `across` from the centre line. A piece's `facing` is the way its front points; a seat faces that way.
 */
const { front: toStreet, right: toRight, back: toBack, left: toLeft } = TURN;

/** The rowhome's dining table is this long (m). */
const DINING_TABLE_LENGTH = 1.6;

/** An interior doorway: 2.1 m high, `width` wide. */
const doorway = (centre: number, width = 0.9): Opening => ({ centre, width, sill: 0, top: 2.1, kind: OPENING.door });

/** The parlour's seating group stands this far in (m), off the hall and the bay's alcove, and its plant stands this much further. */
const PARLOUR_SEATING = 2.8;
const PARLOUR_PLANT_STEP = 1.5;

/**
 * Where a rowhome's flights start (m deep), both up the left wall and climbing toward the back: the lower one behind the parlour, the upper one just behind the upper
 * floors' back wall, in line with the lower one and never over it, so every tread has its headroom.
 */
const STAIR_FOOT = 5;
/** A flight's lane runs this far (m) from the wall it climbs along to its middle: half a flight's width. */
const LANE_CENTRE = 0.45;
/** How far past the upper flight's foot (m) its side wall starts on the first floor, leaving its foot open to the back room. */
const UPPER_FOOT_OPEN = 0.75;
/** A rail's offset from the edge it guards, half its thickness (m). */
const RAIL_HALF = 0.03;
/** The rowhome's middle partitions: between the parlour and the dining room, between dining room and kitchen, and the upper floors' room dividers. */
const PARLOUR_WALL = 4.9;
const KITCHEN_WALL = 9.4;
const UPPER_FRONT_WALL = 4.7;
const UPPER_BACK_WALL = 9.6;
const UPPER_STAIR_FOOT = UPPER_BACK_WALL + PARTITION;
/** A walker coming off the top of a lower flight has this much floor (m) before the back room's wall: a step and a turn. A storey's climb takes a tread more than the ground storey's, so the flights above it are laid back from this head, not from `STAIR_FOOT`. */
const HEAD_LANDING = 0.55;
const LOWER_HEAD_ABOVE_GROUND = UPPER_BACK_WALL - PARTITION / 2 - HEAD_LANDING;

/**
 * Rails round a stairwell's open edges on the floor the flight arrives at: along its side toward the rooms and across the end where the headroom is lowest (the flight's foot end), where
 * a person could walk into the hole.
 */
function railStairwell(d: Draft, level: number, flight: Stairs, well: Rect): void {
  const sideAcross = flight.across < 0 ? well.across1 + RAIL_HALF : well.across0 - RAIL_HALF;
  const footDeep = flight.dir === 1 ? well.deep0 - RAIL_HALF : well.deep1 + RAIL_HALF;
  d.put("rail", level, (well.deep0 + well.deep1) / 2, sideAcross, toRight, { width: well.deep1 - well.deep0 });
  d.put("rail", level, footDeep, (well.across0 + well.across1) / 2, toStreet, { width: well.across1 - well.across0 });
}

function layoutRowhomeGround(d: Draft, left: number, right: number, hallEdge: number): void {
  d.crossWall(0, PARLOUR_WALL, hallEdge, right, [doorway(0.9, 1)]);
  d.spineWall(0, hallEdge + PARTITION / 2, PARLOUR_WALL, KITCHEN_WALL);
  d.put("tvUnit", 0, PARLOUR_SEATING, right - FURNISHING.tvUnit.depth / 2, toLeft);
  d.put("screen", 0, PARLOUR_SEATING, right - FURNISHING.screen.depth / 2, toLeft, { lift: 0.5 });
  d.put("table", 0, PARLOUR_SEATING, 0, toRight, { width: 1, depth: 0.5, height: 0.42 });
  d.put("sofa", 0, PARLOUR_SEATING, left + FURNISHING.sofa.depth / 2, toRight);
  d.put("plant", 0, PARLOUR_SEATING + PARLOUR_PLANT_STEP, right - 0.3, toStreet);
  d.lamp(0, PARLOUR_SEATING, 0);
  d.put("table", 0, 7, 1, toStreet, { width: DINING_TABLE_LENGTH });
  for (const across of [0.6, 1.4]) {
    d.put("chair", 0, 6.05, across, toBack);
    d.put("chair", 0, 7.95, across, toStreet);
  }
  d.put("dresser", 0, 7, right - 0.25, toLeft, { width: 1.4 });
  d.lamp(0, 7, 1);
  d.crossWall(0, KITCHEN_WALL, left, right, [doorway(-0.5, 1.1)]);
  const againstRight = (kind: keyof typeof FURNISHING): number => right - FURNISHING[kind].depth / 2;
  d.put("fridge", 0, 10.1, againstRight("fridge"), toLeft);
  d.put("cabinet", 0, 10.8, againstRight("cabinet"), toLeft);
  d.put("sink", 0, 11.7, againstRight("sink"), toLeft);
  d.put("stove", 0, 12.675, againstRight("stove"), toLeft);
  d.put("cabinet", 0, 13.35, againstRight("cabinet"), toLeft);
  d.put("cabinet", 0, 13.95, againstRight("cabinet"), toLeft);
  d.put("table", 0, 13.8, left + 0.55, toStreet);
  d.put("chair", 0, 13.8, -1.1, toLeft);
  d.lamp(0, 12, 0);
}

/** A floor above the ground floor of a rowhome: two bedrooms and a bath (on the first floor) or a study, the stair lane in the corridor along the left wall, `arrival` the flight that reaches it. */
function layoutRowhomeUpper(d: Draft, level: number, left: number, right: number, arrival: { flight: Stairs; well: Rect }): void {
  const spine = left + 1.65;
  d.crossWall(level, UPPER_FRONT_WALL, left, right, [doorway(-1.7)]);
  d.spineWall(level, spine, UPPER_FRONT_WALL, UPPER_BACK_WALL, [doorway(6, 0.8)]);
  d.crossWall(level, UPPER_BACK_WALL, left, right, [doorway(-1.5)]);
  railStairwell(d, level, arrival.flight, arrival.well);
  d.put("bed", level, 2, 1.2, toStreet);
  d.put("dresser", level, 2.5, left + 0.25, toRight);
  d.lamp(level, 2.4, 0);
  d.put("bed", level, 12.5, 0.9, toStreet);
  d.put("dresser", level, d.back - FURNISHING.dresser.depth / 2, 1.8, toStreet);
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

/**
 * Parlour, dining room and kitchen on the ground floor, the stair up the left wall walled off from the dining room, then bedrooms and a bath (or a study) on each floor above, however many
 * storeys the house has. The flights alternate between the lower foot and the upper foot, each in line with the last and never over it, so every tread has its headroom; an odd floor's upper flight
 * is walled off from the back room but for its foot.
 */
export function layoutRowhome(d: Draft): void {
  const left = -d.half;
  const right = d.half;
  const hallEdge = left + 0.9;
  const arrivals: { flight: Stairs; well: Rect }[] = [];
  for (let level = 0; level + 1 < d.floors.length; level++) {
    const across = left + LANE_CENTRE;
    const flight = level % 2 === 1 ? d.stairsUp(level, UPPER_STAIR_FOOT, across) : level === 0 ? d.stairsUp(level, STAIR_FOOT, across) : d.stairsEndingAt(level, LOWER_HEAD_ABOVE_GROUND, across);
    const well = d.stairwell(flight);
    arrivals.push({ flight, well });
    d.floor(level + 1, [well]);
  }
  layoutRowhomeGround(d, left, right, hallEdge);
  for (let level = 1; level < d.floors.length; level++) {
    layoutRowhomeUpper(d, level, left, right, arrivals[level - 1]!);
    if (level % 2 === 1 && level + 1 < d.floors.length) d.spineWall(level, hallEdge + PARTITION / 2, UPPER_STAIR_FOOT + UPPER_FOOT_OPEN, d.back);
  }
}

/** A shop's service stair is this wide with its partition (m): the strip along a side wall the flat's stair climbs in. */
const STRIP = 0.9 + PARTITION;
/** A flat's stair lanes: the flight up from an odd floor stands along the right wall from this deep (m), the one up from an even floor along the left wall from this far in front of the back wall. */
const FLAT_RIGHT_FOOT = 4.4;
const FLAT_LEFT_FOOT_OFF_BACK = 0.5;
/** The flat's kitchen counters start this deep along the left wall, its living room's furniture this deep (m). */
const FLAT_KITCHEN = 5.3;
const FLAT_LIVING = 2.2;
/** The flat's bed stands this deep (m), and its dresser against the back wall this far from the right wall (m). */
const FLAT_BED = 11.4;
const FLAT_DRESSER_OFF_RIGHT = 0.9;

/** The service stair's strip along a side wall of the shop, behind its partition: which side (-1 left, 1 right), its door near the foot at the back wall, and the room it leaves. */
type ServiceStair = { flight: Stairs; well: Rect; side: -1 | 1; innerEdge: number };

/**
 * The flats' service stair, along the `side` wall from the back wall toward the street, walled in with a doorway near its foot and closed across its head; `innerEdge` is the across of the strip's
 * room-side face, which the shop's own fixtures keep clear of.
 */
function serviceStair(d: Draft, side: -1 | 1): ServiceStair {
  const wall = side * d.half;
  const flight = d.stairsUp(0, d.back, wall - side * LANE_CENTRE, -1);
  const well = d.stairwell(flight);
  const head = flightHead(flight);
  const partition = wall - side * (0.9 + PARTITION / 2);
  d.spineWall(0, partition, head - PARTITION, d.back, [doorway(d.back - 0.45)]);
  d.crossWall(0, head - PARTITION / 2, Math.min(wall, partition), Math.max(wall, partition), []);
  return { flight, well, side, innerEdge: wall - side * STRIP };
}

/** A flat over a shop: a living room at the front, a kitchen along the left wall, a bed and a dresser at the back, clear of every stair lane and well. */
function layoutFlat(d: Draft, level: number, arrival: { flight: Stairs; well: Rect }): void {
  const left = -d.half;
  const right = d.half;
  railStairwell(d, level, arrival.flight, arrival.well);
  d.put("tvUnit", level, FLAT_LIVING, right - FURNISHING.tvUnit.depth / 2, toLeft);
  d.put("screen", level, FLAT_LIVING, right - FURNISHING.screen.depth / 2, toLeft, { lift: 0.5 });
  d.put("table", level, FLAT_LIVING, 0, toRight, { width: 1, depth: 0.5, height: 0.42 });
  d.put("sofa", level, FLAT_LIVING, left + FURNISHING.sofa.depth / 2, toRight);
  d.put("plant", level, FLAT_LIVING + PARLOUR_PLANT_STEP, left + 0.3, toStreet);
  d.lamp(level, FLAT_LIVING, 0);
  let counter = FLAT_KITCHEN;
  for (const kind of ["fridge", "cabinet", "sink", "stove"] as const) {
    d.put(kind, level, counter + FURNISHING[kind].width / 2, left + FURNISHING[kind].depth / 2, toRight);
    counter += FURNISHING[kind].width;
  }
  d.put("bed", level, FLAT_BED, 0.6, toStreet);
  d.put("dresser", level, d.back - FURNISHING.dresser.depth / 2, right - FLAT_DRESSER_OFF_RIGHT, toStreet);
  d.lamp(level, FLAT_BED, 0);
}

/**
 * The flats over a shop, one on every floor above its own: each floor's slab (holed for the flight that reaches it), its rooms, and the flights between flats, alternating the right wall (up from
 * an odd floor) and the left (up from an even one), so no flight stands over a hole.
 */
function layoutFlats(d: Draft, stair: ServiceStair): void {
  d.floor(1, [stair.well]);
  const arrivals: { flight: Stairs; well: Rect }[] = [{ flight: stair.flight, well: stair.well }];
  for (let level = 1; level + 1 < d.floors.length; level++) {
    const flight = level % 2 === 1 ? d.stairsUp(level, FLAT_RIGHT_FOOT, d.half - LANE_CENTRE, 1) : d.stairsUp(level, d.back - FLAT_LEFT_FOOT_OFF_BACK, -d.half + LANE_CENTRE, -1);
    const well = d.stairwell(flight);
    arrivals.push({ flight, well });
    d.floor(level + 1, [well]);
  }
  for (let level = 1; level < d.floors.length; level++) layoutFlat(d, level, arrivals[level - 1]!);
}

/** Shelves and cabinets stand this far (m) off a service stair's partition. */
const SHELF_GAP = 0.05;

/** The coffee shop's order counter, its back counter and shelf: centred this far across (m) and this long, inside the left party wall with the staff gate on the right. */
const COFFEE_BAR_ACROSS = -0.75;
const COFFEE_BAR_LENGTH = 3.4;
/** The back counter and shelf keep to the middle of the shop, right of the service stair's strip (m across, long). */
const COFFEE_BACK_ACROSS = 0;
const COFFEE_BACK_LENGTH = 2.6;

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
  const left = -d.half;
  const right = d.half;
  d.put("sofa", 0, 5.1, left + FURNISHING.sofa.depth / 2, toRight, { width: 1.5 });
  d.put("armchair", 0, 4.9, 2, toLeft);
  d.put("plant", 0, 5.9, right - FURNISHING.plant.width / 2, toStreet);
  d.put("counter", 0, 6.6, COFFEE_BAR_ACROSS, toStreet, { width: COFFEE_BAR_LENGTH, serves: true });
  d.lamp(0, 6.6, COFFEE_BAR_ACROSS);
  d.put("counter", 0, 8.55, COFFEE_BACK_ACROSS, toStreet, { width: COFFEE_BACK_LENGTH, depth: 0.6, height: 0.95 });
  d.put("backShelf", 0, 9.05, COFFEE_BACK_ACROSS, toStreet, { width: COFFEE_BACK_LENGTH });
  const stair = serviceStair(d, -1);
  d.crossWall(0, 9.3, stair.innerEdge, right, [doorway(1.7)]);
  d.put("gondola", 0, 10.2, stair.innerEdge + SHELF_GAP + FURNISHING.gondola.depth / 2, toRight);
  d.put("gondola", 0, 11.9, stair.innerEdge + SHELF_GAP + FURNISHING.gondola.depth / 2, toRight);
  d.put("fridge", 0, d.back - FURNISHING.fridge.depth / 2, -0.5, toStreet);
  d.spineWall(0, 0.8, 11.6, d.back);
  d.crossWall(0, 11.6, 0.8, right, [doorway(1.6, 0.8)]);
  d.put("toilet", 0, d.back - FURNISHING.toilet.depth / 2, 1.7, toStreet);
  d.put("basin", 0, 12.3, right - FURNISHING.basin.depth / 2, toLeft);
  layoutFlats(d, stair);
}

/** The bar's booths stand this far across (m), left of the service stair's strip along the right wall. */
const BAR_BOOTHS_ACROSS = 2.9;

/** The bar down the left wall with its back shelves and eight stools, tables, two booths, a pool table, a jukebox and a restroom. */
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
  const stair = serviceStair(d, 1);
  for (const booth of [9.9, 12.1]) {
    d.put("table", 0, booth, BAR_BOOTHS_ACROSS, toStreet);
    d.put("bench", 0, booth - 0.8, BAR_BOOTHS_ACROSS, toBack);
    d.put("bench", 0, booth + 0.8, BAR_BOOTHS_ACROSS, toStreet);
  }
  d.put("poolTable", 0, 9, -0.5, toStreet);
  d.lamp(0, 9, -0.5);
  d.put("jukebox", 0, d.back - FURNISHING.jukebox.depth / 2, 3.5, toStreet);
  d.crossWall(0, 11.6, left, -2.4, [doorway(-3.4)]);
  d.spineWall(0, -2.4, 11.6, d.back);
  d.put("toilet", 0, d.back - FURNISHING.toilet.depth / 2, -4.6, toStreet);
  d.put("basin", 0, 12.4, left + 0.25, toRight);
  layoutFlats(d, stair);
}

/** The meeting room's far chairs keep this off the back wall, and each row of chairs stands this far from the table's middle (m). */
const MEETING_GAP = 0.05;
const MEETING_SEAT_TO_TABLE = 0.85;

/** The office's desks by row: the back row keeps right of the service stair's strip along the left wall. */
const OFFICE_FRONT_DESKS = [-4.2, -1.4, 1.4, 4.2] as const;
const OFFICE_BACK_DESKS = [-3.2, -0.8, 1.6, 4] as const;

/** Lobby with a reception desk and waiting seats, an open plan of eight desks, a glazed-in meeting room and a pantry. */
export function layoutOffice(d: Draft): void {
  d.put("counter", 0, 3.4, 0, toStreet, { width: 3.6, serves: true });
  d.put("deskChair", 0, 4.4, 0, toStreet);
  d.put("screen", 0, 3.4, 0, toStreet, { lift: 1.1 });
  d.put("sofa", 0, 2, -d.half + FURNISHING.sofa.depth / 2, toRight);
  d.put("table", 0, 2, -3.9, toRight, { width: 1, depth: 0.5, height: 0.42 });
  d.put("armchair", 0, 2, d.half - FURNISHING.armchair.depth / 2, toLeft);
  d.put("plant", 0, 0.8, d.half - FURNISHING.plant.width / 2, toStreet);
  d.lamp(0, 2.5, 0);
  const stair = serviceStair(d, -1);
  for (const [row, deep] of [7.4, 10].entries()) {
    for (const across of row === 0 ? OFFICE_FRONT_DESKS : OFFICE_BACK_DESKS) {
      d.put("desk", 0, deep, across, toBack);
      d.put("deskChair", 0, deep - 0.75, across, toBack);
    }
    d.lamp(0, deep, row === 0 ? -2.8 : 2.8);
  }
  d.crossWall(0, 12.1, stair.innerEdge, -1.2, [doorway(-1.8)]);
  d.spineWall(0, -1.2, 12.1, d.back);
  const farChairs = d.back - FURNISHING.chair.depth / 2 - MEETING_GAP;
  d.put("table", 0, farChairs - MEETING_SEAT_TO_TABLE, -2.7, toStreet, { width: 2.6, depth: 1 });
  for (const across of [-3.5, -2.7, -1.9]) {
    d.put("chair", 0, farChairs - 2 * MEETING_SEAT_TO_TABLE, across, toBack);
    d.put("chair", 0, farChairs, across, toStreet);
  }
  for (const across of [2, 2.6, 3.2]) d.put("cabinet", 0, d.back - FURNISHING.cabinet.depth / 2, across, toStreet);
  d.put("fridge", 0, d.back - FURNISHING.fridge.depth / 2, 4.2, toStreet);
  d.put("table", 0, 12.6, 3.4, toStreet);
  d.put("chair", 0, 12.6, 2.45, toRight);
  d.put("chair", 0, 12.6, 4.35, toLeft);
  d.put("chair", 0, 11.8, 3.4, toBack);
  d.put("chair", 0, 13.4, 3.4, toStreet);
  layoutFlats(d, stair);
}

/** The corner store: checkout by the door, three aisles of gondolas, a wall of shelves, coolers on the back wall and a deli counter. */
export function layoutStore(d: Draft): void {
  d.put("counter", 0, 2.8, -4.3, toRight, { width: 3.2, depth: 0.6, serves: true });
  for (const across of [-2, 0.5, 3]) {
    for (const deep of [3.5, 5.2, 6.9, 8.6]) d.put("gondola", 0, deep, across, toRight);
  }
  for (const deep of [3.5, 6, 8.5]) d.put("backShelf", 0, deep, d.half - 0.175, toLeft, { width: 2.5 });
  for (const across of [-3.5, -2.7, -1.9, -1.1]) d.put("fridge", 0, d.back - FURNISHING.fridge.depth / 2, across, toStreet);
  d.put("counter", 0, 12.4, 3.2, toStreet, { width: 3.6 });
  d.put("backShelf", 0, d.back - FURNISHING.backShelf.depth / 2, 3.2, toStreet, { width: 3.6 });
  for (const deep of [3, 7, 11]) d.lamp(0, deep, 0.5);
  layoutFlats(d, serviceStair(d, -1));
}
