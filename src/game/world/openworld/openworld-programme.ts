import { PLACE_KIND, SECTOR, type InteriorKind, type PlaceKind } from "./walk-graph.ts";

/**
 * DRAFT block programme (parked until the owner signs off): which lot is which place, from the neighbourhood bible.
 * Streets: 10th, 9th, 8th, 7th St west to east (numbers rise westward, as in Philadelphia); Morris, Tasker, Moore, Mifflin St north to south.
 * Blocks A1..C3: A north row .. C south row, 1 west column .. 3 east column; the park is B2. A spot names its block by row and (0-based) column: A2 is row A, column 1.
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
  policeStation: "Moore St Police Station",
} as const;

export const PARK_NAME = "Moore Park";
export const BLOCK_ROW_LETTERS = "ABC";

export type Face = "north" | "south";

/** Game hours a business is open, [from, to); `to` below `from` wraps past midnight. */
type Hours = readonly [from: number, to: number];

/** A venue over `lots` lots of one face: one building, one place; `interior` names the interior it is built with, none for an exterior-only shop. */
export type Venue = { name: string; style: string; kind: PlaceKind; sector: string; lots: number; shopGround: boolean; storeys: number; hours?: Hours; interior?: InteriorKind };

/** Facade styles the venues share. */
const CORNER_STORE = "cornerstore";
const SHOPS = "shops";

const SHOP = { shopGround: true, lots: 2, storeys: 3 } as const;
const NARROW_SHOP = { shopGround: true, lots: 1, storeys: 3 } as const;

const BODEGA: Venue = { ...SHOP, name: PLACE_NAMES.bodega, style: CORNER_STORE, kind: PLACE_KIND.shop, sector: SECTOR.retail, hours: [6, 23], interior: "store" };
const MARTINEZ: Venue = { ...SHOP, name: "Martinez Grocery & Deli", style: CORNER_STORE, kind: PLACE_KIND.shop, sector: SECTOR.retail, hours: [6, 23], interior: "store" };
const RUIZ: Venue = { ...SHOP, name: "Ruiz Mini Market", style: CORNER_STORE, kind: PLACE_KIND.shop, sector: SECTOR.retail, hours: [7, 22], interior: "store" };
const SUPERMARKET: Venue = { name: "Moore Fresh Market", style: "supermarket", kind: PLACE_KIND.shop, sector: SECTOR.grocery, lots: 4, shopGround: true, storeys: 2, hours: [7, 22] };
const LAUNDROMAT: Venue = { ...SHOP, name: "Spin Cycle Laundry", style: SHOPS, kind: PLACE_KIND.shop, sector: SECTOR.services, hours: [7, 21] };
const BARBER: Venue = { ...SHOP, name: "Cut Above Barbers", style: SHOPS, kind: PLACE_KIND.work, sector: SECTOR.services, hours: [9, 18] };
const PIZZA: Venue = { ...SHOP, name: "Slice Brothers Pizza", style: SHOPS, kind: PLACE_KIND.food, sector: SECTOR.food, hours: [11, 2] };
const GARAGE: Venue = { ...SHOP, name: PLACE_NAMES.garage, style: "warehouse", kind: PLACE_KIND.work, sector: SECTOR.auto, hours: [7, 17] };
const BAR: Venue = { ...SHOP, name: PLACE_NAMES.bar, style: "bar", kind: PLACE_KIND.hangout, sector: SECTOR.nightlife, hours: [16, 2], interior: "bar" };
const TAP_ROOM: Venue = { ...SHOP, name: "Kelly's Tap Room", style: "bar", kind: PLACE_KIND.hangout, sector: SECTOR.nightlife, hours: [15, 2], interior: "bar" };
const COFFEE_GRIND: Venue = { ...NARROW_SHOP, name: "Daily Grind Coffee", style: "coffee", kind: PLACE_KIND.food, sector: SECTOR.cafe, hours: [6, 15], interior: "coffee" };
const COFFEE_BEAN: Venue = { ...NARROW_SHOP, name: "Bean There Cafe", style: "coffee", kind: PLACE_KIND.food, sector: SECTOR.cafe, hours: [7, 17], interior: "coffee" };
const INSURANCE: Venue = { ...SHOP, name: "Pennworth Insurance & Realty", style: "office", kind: PLACE_KIND.work, sector: SECTOR.office, hours: [8, 18], interior: "office" };
const LAW_OFFICE: Venue = { ...SHOP, name: "Lowell & Pratt Law Offices", style: "office", kind: PLACE_KIND.work, sector: SECTOR.office, hours: [8, 18], interior: "office" };
/** The police station: two lots of a Moore St face, an office's kit, open all hours; private (no one works or visits there but the arrested), and where the law takes them. */
const POLICE_STATION: Venue = { ...SHOP, name: PLACE_NAMES.policeStation, style: "office", kind: PLACE_KIND.work, sector: SECTOR.police, interior: "office" };

/**
 * Two landmarks from the owner's Philadelphia photographs (`refs/philly/02`): a rough-stone church three lots wide, and a modern four-storey infill two lots wide, white and grey with tall vertical
 * bays over a brick base. Neither has an interior; the church is a hangout (people gather by it), the infill a home.
 */
const CHURCH: Venue = { name: "St. Brendan's Church", style: "church", kind: PLACE_KIND.hangout, sector: SECTOR.worship, lots: 3, shopGround: false, storeys: 3, hours: [7, 20] };
const INFILL: Venue = { name: "Moore Street Lofts", style: "infill", kind: PLACE_KIND.home, sector: SECTOR.residential, lots: 2, shopGround: false, storeys: 4 };

/** The block rows, north to south. */
const ROW = { A: 0, B: 1, C: 2 } as const;

/** Where a venue stands: its block (row, 0-based column), face, and the first lot (from the west) it covers. A corner lot is the first or last of a face. */
export type Spot = { row: number; column: number; face: Face; at: number };

export const VENUE_SPOTS: readonly (Spot & { venue: Venue })[] = [
  { row: ROW.A, column: 1, face: "north", at: 0, venue: BODEGA },
  { row: ROW.C, column: 0, face: "south", at: 0, venue: MARTINEZ },
  { row: ROW.A, column: 2, face: "north", at: 18, venue: RUIZ },
  { row: ROW.C, column: 2, face: "north", at: 12, venue: SUPERMARKET },
  { row: ROW.B, column: 2, face: "north", at: 0, venue: LAUNDROMAT },
  { row: ROW.A, column: 1, face: "south", at: 18, venue: BARBER },
  { row: ROW.B, column: 0, face: "south", at: 8, venue: PIZZA },
  { row: ROW.C, column: 1, face: "north", at: 8, venue: GARAGE },
  { row: ROW.C, column: 2, face: "south", at: 18, venue: BAR },
  { row: ROW.B, column: 0, face: "north", at: 14, venue: TAP_ROOM },
  { row: ROW.A, column: 0, face: "south", at: 9, venue: COFFEE_GRIND },
  { row: ROW.C, column: 0, face: "north", at: 12, venue: COFFEE_BEAN },
  { row: ROW.A, column: 2, face: "south", at: 12, venue: INSURANCE },
  { row: ROW.B, column: 2, face: "north", at: 12, venue: LAW_OFFICE },
  { row: ROW.A, column: 0, face: "north", at: 6, venue: CHURCH },
  { row: ROW.C, column: 1, face: "south", at: 12, venue: INFILL },
  { row: ROW.B, column: 2, face: "south", at: 0, venue: POLICE_STATION },
];

/**
 * A lane cuts through every block's south face at this lot (the overhead photograph's narrow lanes between the rows of houses): the lot is left empty and paved, a way from the alley to the street between
 * two houses whose side walls it shows. The park's block has none, nor the block whose south face holds the community garden.
 */
export const LANE = { face: "south", at: 10 } as const satisfies { face: Face; at: number };
export const LANELESS_BLOCKS: readonly { row: number; column: number }[] = [{ row: ROW.B, column: 2 }];

/** Homes the cast lives in, by name instead of address. */
export const NAMED_HOMES: readonly (Spot & { name: string })[] = [
  { row: ROW.A, column: 0, face: "north", at: 19, name: PLACE_NAMES.deeHome },
  { row: ROW.A, column: 1, face: "north", at: 19, name: PLACE_NAMES.salHome },
  { row: ROW.A, column: 2, face: "north", at: 10, name: PLACE_NAMES.okaforHome },
  { row: ROW.A, column: 2, face: "south", at: 4, name: PLACE_NAMES.brooksHome },
  { row: ROW.B, column: 0, face: "north", at: 3, name: PLACE_NAMES.mackHome },
  { row: ROW.B, column: 0, face: "south", at: 12, name: PLACE_NAMES.kowalskiHome },
  { row: ROW.C, column: 1, face: "south", at: 5, name: PLACE_NAMES.ramosHome },
];

/** A place on a named home's roof (reached through its front door) or in its rear yard (through the gate on the alley). */
type SidePlace = Spot & { name: string; kind: PlaceKind; sector: string; where: "roof" | "yard"; lots: number };

export const SIDE_PLACES: readonly SidePlace[] = [
  { row: ROW.A, column: 1, face: "north", at: 19, name: PLACE_NAMES.salCoop, kind: PLACE_KIND.hangout, sector: SECTOR.recreation, where: "roof", lots: 1 },
  { row: ROW.A, column: 2, face: "north", at: 10, name: PLACE_NAMES.okaforDeck, kind: PLACE_KIND.hangout, sector: SECTOR.recreation, where: "roof", lots: 1 },
  { row: ROW.B, column: 0, face: "south", at: 12, name: PLACE_NAMES.kowalskiYard, kind: PLACE_KIND.hide, sector: SECTOR.hideout, where: "yard", lots: 1 },
  { row: ROW.B, column: 2, face: "south", at: 9, name: PLACE_NAMES.garden, kind: PLACE_KIND.hangout, sector: SECTOR.recreation, where: "yard", lots: 3 },
];

/** Which block carries the bus stop and on which lot's frontage: Moore St at 10th, on C1's north face. */
export const BUS_STOP = { row: ROW.C, column: 0, at: 1, name: PLACE_NAMES.busStop } as const;

/** Every house is its own building prop, one lot wide: its own brick tint and, in time, its own bay. Brick is the street's majority, painted brick the minority. */
/** The brick rowhome's facade style, and the painted one. */
export const BRICK_STYLE = "rowbrick";
const PAINTED_STYLE = "rowpainted";
export const HOME_STYLES: readonly string[] = [BRICK_STYLE, PAINTED_STYLE];
/** Out of ten houses, this many are brick (the rest painted), picked by a fixed mix of block and lot so a house keeps its style. */
export const BRICK_SHARE_OF_TEN = 7;
export const HOUSE_STOREYS = 3;

/** The backdrop: every lot a home; a corner market on the north face of every other block. */
export const BACKDROP_MARKET = { name: "Outer Market", style: SHOPS, sector: SECTOR.retail, lots: 2 } as const;
