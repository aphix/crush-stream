import { PLACE_KIND, type PlaceKind } from "./walk-graph.ts";

/**
 * DRAFT block programme (parked until the owner signs off): which lot is which place, from the neighbourhood bible.
 * Streets: 10th, 9th, 8th, 7th St west to east (numbers rise westward, as in Philadelphia); Morris, Tasker, Moore, Mifflin St north to south.
 * Blocks A1..C3: A north row .. C south row, 1 west column .. 3 east column; the park is B2.
 */
export const STREETS_X: readonly string[] = ["10th St", "9th St", "8th St", "7th St"];
export const STREETS_Z: readonly string[] = ["Morris St", "Tasker St", "Moore St", "Mifflin St"];
/** The streets one ring out (the backdrop's): north, south, west, east. */
export const BEYOND = { north: "Reed St", south: "McKean St", west: "11th St", east: "6th St" } as const;
/** The hundred a block's house numbers start from: the block between 10th and 9th is the 900 block, between 9th and 8th the 800 block. */
export const HUNDRED_WEST = 900;
export const HUNDRED_STEP = 100;

/** Exactly the names the neighbourhood brain's cast looks places up by (`PLACE_NAMES` in the brain's cast table): a mismatch leaves a story without its place. */
export const PLACE_NAMES = {
  salHome: "Sal's rowhome",
  salCoop: "Sal's pigeon coop",
  kowalskiHome: "Kowalski rowhome",
  kowalskiYard: "Kowalski's yard",
  brooksHome: "Brooks rowhome",
  deeHome: "Dee's radio house",
  okaforHome: "Okafor rowhome",
  okaforDeck: "Okafor rooftop deck",
  mackHome: "Mack rowhome",
  vanAlley: "B1 alley",
  ramosHome: "Ramos rowhome",
  garage: "Moore Auto Body Garage",
  bodega: "Bodega Supreme",
  parkCourt: "Moore Park Court",
  tabbyAlley: "A2 alley",
  garden: "B3 Community Garden",
  bar: "Mifflin Bar",
  busStop: "Moore Bus Stop",
} as const;

export const PARK_NAME = "Moore Park";
export const BLOCK_ROW_LETTERS = "ABC";

export type Face = "north" | "south";

/** A venue over `lots` lots of one face: one building, one place. */
export type Venue = { name: string; style: string; kind: PlaceKind; sector: string; lots: number; shopGround: boolean };

const SHOP = { shopGround: true, lots: 2 } as const;
export const BODEGA: Venue = { ...SHOP, name: PLACE_NAMES.bodega, style: "bodega", kind: PLACE_KIND.shop, sector: "retail" };
export const LAUNDROMAT: Venue = { ...SHOP, name: "Spin Cycle Laundry", style: "laundromat", kind: PLACE_KIND.shop, sector: "services" };
export const BARBER: Venue = { ...SHOP, name: "Cut Above Barbers", style: "shops", kind: PLACE_KIND.work, sector: "services" };
export const PIZZA: Venue = { ...SHOP, name: "Slice Brothers Pizza", style: "shops", kind: PLACE_KIND.food, sector: "food" };
export const GARAGE: Venue = { ...SHOP, name: PLACE_NAMES.garage, style: "warehouse", kind: PLACE_KIND.work, sector: "auto" };
export const BAR: Venue = { ...SHOP, name: PLACE_NAMES.bar, style: "divebar", kind: PLACE_KIND.hangout, sector: "nightlife" };

/** Where a venue stands: block id, face, and the first lot (from the west) it covers. */
export type Spot = { block: string; face: Face; at: number };

export const VENUE_SPOTS: readonly (Spot & { venue: Venue })[] = [
  { block: "A2", face: "north", at: 0, venue: BODEGA },
  { block: "B3", face: "north", at: 0, venue: LAUNDROMAT },
  { block: "A2", face: "south", at: 18, venue: BARBER },
  { block: "B1", face: "south", at: 8, venue: PIZZA },
  { block: "C2", face: "north", at: 8, venue: GARAGE },
  { block: "C3", face: "south", at: 18, venue: BAR },
];

/** Homes the cast lives in, by name instead of address. */
export const NAMED_HOMES: readonly (Spot & { name: string })[] = [
  { block: "A1", face: "north", at: 19, name: PLACE_NAMES.deeHome },
  { block: "A2", face: "north", at: 19, name: PLACE_NAMES.salHome },
  { block: "A3", face: "north", at: 10, name: PLACE_NAMES.okaforHome },
  { block: "A3", face: "south", at: 4, name: PLACE_NAMES.brooksHome },
  { block: "B1", face: "north", at: 3, name: PLACE_NAMES.mackHome },
  { block: "B1", face: "south", at: 12, name: PLACE_NAMES.kowalskiHome },
  { block: "C2", face: "south", at: 5, name: PLACE_NAMES.ramosHome },
];

/** A place on a named home's roof (reached through its front door) or in its rear yard (through the gate on the alley). */
export type SidePlace = Spot & { name: string; kind: PlaceKind; sector: string; where: "roof" | "yard"; lots: number };

export const SIDE_PLACES: readonly SidePlace[] = [
  { block: "A2", face: "north", at: 19, name: PLACE_NAMES.salCoop, kind: PLACE_KIND.hangout, sector: "recreation", where: "roof", lots: 1 },
  { block: "A3", face: "north", at: 10, name: PLACE_NAMES.okaforDeck, kind: PLACE_KIND.hangout, sector: "recreation", where: "roof", lots: 1 },
  { block: "B1", face: "south", at: 12, name: PLACE_NAMES.kowalskiYard, kind: PLACE_KIND.hide, sector: "hideout", where: "yard", lots: 1 },
  { block: "B3", face: "south", at: 9, name: PLACE_NAMES.garden, kind: PLACE_KIND.hangout, sector: "recreation", where: "yard", lots: 3 },
];

/** Which block carries the bus stop and on which lot's frontage: Moore St at 10th, on C1's north face. */
export const BUS_STOP = { block: "C1", at: 1, name: PLACE_NAMES.busStop } as const;

/** Homes in pairs share a building prop (two lots, two facade bays); the styles alternate pair by pair. */
export const HOMES_PER_BUILDING = 2;
export const HOME_STYLES: readonly string[] = ["rowbrick", "rowpainted"];
export const HOUSE_STOREYS = 3;
export const SHOP_STOREYS = 3;
export const RESIDENTIAL = "residential";

/** The backdrop: every lot a home; a corner market on the north face of every other block. */
export const BACKDROP_MARKET = { name: "Outer Market", style: "shops", sector: "retail", lots: 2 } as const;
