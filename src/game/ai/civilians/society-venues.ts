import { PLACE_KIND, SEAT_STRIDE, type InteriorKind, type OpenWorldMap, type Place } from "../../world/openworld/walk-graph.ts";
import { PLACE_HOURS } from "./civilian-cast.ts";
import { CLOSED_HOURS_WEIGHT, HOURS_PER_GAME_DAY, PURPOSE } from "./civilian-constants.ts";

/** What a place is to the people who go there: the interaction table and the hours choose by it. */
export const VENUE = { other: 0, home: 1, office: 2, coffee: 3, bar: 4, diner: 5, shop: 6, supermarket: 7, park: 8, transit: 9 } as const;
const VENUE_COUNT = 10;

const VENUE_OF_INTERIOR: Readonly<Record<InteriorKind, number>> = { rowhome: VENUE.home, coffee: VENUE.coffee, bar: VENUE.bar, office: VENUE.office, store: VENUE.shop };
/** Exteriors with no interior name their venue by their facade style. */
const VENUE_OF_STYLE: Readonly<Record<string, number>> = { cornerstore: VENUE.shop, supermarket: VENUE.supermarket };

/** The venue of a place: its interior, else its facade style, else its kind (a hangout without an interior is a park). */
function venueOf(place: Place): number {
  const byInterior = place.interior === undefined ? undefined : VENUE_OF_INTERIOR[place.interior];
  if (byInterior !== undefined) return byInterior;
  const byStyle = VENUE_OF_STYLE[place.style];
  if (byStyle !== undefined) return byStyle;
  switch (place.kind) {
    case PLACE_KIND.home:
      return VENUE.home;
    case PLACE_KIND.work:
      return VENUE.office;
    case PLACE_KIND.food:
      return VENUE.diner;
    case PLACE_KIND.shop:
      return VENUE.shop;
    case PLACE_KIND.hangout:
      return VENUE.park;
    case PLACE_KIND.transit:
      return VENUE.transit;
    default:
      return VENUE.other;
  }
}

/** Customers of these sit down when a seat is free. */
export function isSeatedVenue(venue: number): boolean {
  return venue === VENUE.coffee || venue === VENUE.bar || venue === VENUE.diner;
}

/** Venues where a customer buys at a counter: they are served first, then sit. */
export function isCounterVenue(venue: number): boolean {
  return isSeatedVenue(venue) || venue === VENUE.shop || venue === VENUE.supermarket;
}

/** Walks that end standing at a door in the street rather than inside: they are drawn there, and witnessed. */
const OUTDOOR_PURPOSES: readonly number[] = [PURPOSE.stoopSit, PURPOSE.stoopTalk, PURPOSE.argue, PURPOSE.loiter, PURPOSE.report, PURPOSE.mug, PURPOSE.breakIn, PURPOSE.fight, PURPOSE.lookOn, PURPOSE.callAmbulance];

export function isOutdoorPurpose(purpose: number): boolean {
  return OUTDOOR_PURPOSES.includes(purpose);
}

/** Opening hours [from, to) by venue when the map gives none (a window may wrap midnight; none: open at all hours): coffee in the morning, bars from dusk, shops by day. */
const DEFAULT_HOURS: readonly (readonly [number, number] | null)[] = [null, null, null, [6, 15], [16, 3], [7, 23], [7, 22], [8, 21], null, null];

/** Whether `hour` falls in [from, to) on a clock that wraps midnight. */
export function isHourIn(hour: number, from: number, to: number): boolean {
  return from <= to ? hour >= from && hour < to : hour >= from || hour < to;
}

/** What the map says about a place's kind of venue, hours and seats, once: `hourWeight` holds `HOURS_PER_GAME_DAY` weights per place (1 open, `CLOSED_HOURS_WEIGHT` shut). */
export type VenueIndex = {
  venueOf: Uint8Array;
  /** Places with a door of each venue. */
  byVenue: readonly Int32Array[];
  hourWeight: Float32Array;
  /** Seats of a place are numbered `seatBase[place]` + seat for the owner table; `seatCount` all of them, `stoopCount` the leading ones that are on the stoop. */
  seatBase: Int32Array;
  seatCount: Uint16Array;
  stoopCount: Uint16Array;
  seatTotal: number;
};

export function buildVenueIndex(map: OpenWorldMap): VenueIndex {
  const placeCount = map.places.length;
  const venue = new Uint8Array(placeCount);
  const hourWeight = new Float32Array(placeCount * HOURS_PER_GAME_DAY);
  const seatBase = new Int32Array(placeCount);
  const seatCount = new Uint16Array(placeCount);
  const stoopCount = new Uint16Array(placeCount);
  const byName = new Map<string, readonly [number, number]>(PLACE_HOURS.map((entry) => [entry.place, [entry.from, entry.to]]));
  let seatTotal = 0;
  for (let place = 0; place < placeCount; place++) {
    const entry = map.places[place]!;
    venue[place] = venueOf(entry);
    const window = entry.hours ?? byName.get(entry.name) ?? DEFAULT_HOURS[venue[place]!] ?? null;
    for (let hour = 0; hour < HOURS_PER_GAME_DAY; hour++) hourWeight[place * HOURS_PER_GAME_DAY + hour] = window === null || isHourIn(hour, window[0], window[1]) ? 1 : CLOSED_HOURS_WEIGHT;
    seatBase[place] = seatTotal;
    seatCount[place] = entry.seats === undefined ? 0 : Math.floor(entry.seats.length / SEAT_STRIDE);
    stoopCount[place] = Math.min(seatCount[place]!, entry.stoopSeats ?? 0);
    seatTotal += seatCount[place]!;
  }
  const byVenue = Array.from({ length: VENUE_COUNT }, (_, kind) => Int32Array.from(Array.from({ length: placeCount }, (_, place) => place).filter((place) => venue[place] === kind && map.places[place]!.doorNode >= 0)));
  return { venueOf: venue, byVenue, hourWeight, seatBase, seatCount, stoopCount, seatTotal };
}
