import { describe, expect, it } from "vitest";
import { FACADE } from "../../present/facades.ts";
import { makeWorld } from "../race-world.test-util.ts";
import { parseTrack } from "../track-schema.ts";
import { OFF_MENU } from "../tracks/index.ts";
import { OPENWORLD_ID } from "./openworld-course.ts";
import { must } from "../../kernel/must.test-util.ts";
import { layOutLots } from "./openworld-lots.ts";
import { buildOpenWorldMap } from "./openworld-map.ts";
import { PLACE_NAMES } from "./openworld-programme.ts";
import { PLACE_KIND, SEAT_STRIDE, SECTOR } from "./walk-graph.ts";

/** A rowhome's seats are its two stoop seats, four dining chairs, a kitchen chair and a sofa of two, and a desk chair on each floor from the second up: `storeys + 7`. */
const HOME_SEATS_BEYOND_STOREYS = 7;

const lots = layOutLots();
const map = buildOpenWorldMap(lots);
const playable = map.places.filter((place) => place.doorNode >= 0);
const graph = map.graph;

describe("given the open world loaded by its id", () => {
  // mutation: sed -i 's/\[HAVANA, openWorldCourse(layOutLots())\]/[HAVANA]/' src/game/world/tracks/index.ts
  it("when the race loader is asked for openworld, then it loads that course and not the first on the menu", () => {
    const world = makeWorld();
    world.race.showLobby(OPENWORLD_ID);
    expect(world.race.courseId, "course the loader returned").toBe(OPENWORLD_ID);
    expect(OFF_MENU.some((json) => parseTrack(json).id === OPENWORLD_ID), "listed off the menu").toBe(true);
  });
});

describe("given the drafted programme's map", () => {
  // mutation: sed -i 's/name: PLACE_NAMES.bodega/name: "Bodega"/' src/game/world/openworld/openworld-programme.ts
  it("when the cast's places are looked up by name, then each is on the map exactly once", () => {
    for (const name of Object.values(PLACE_NAMES)) expect(playable.filter((place) => place.name === name).length, `places named ${name}`).toBe(1);
  });

  it("when the places inside the walls are named, then no two share a name", () => {
    const seen = new Set<string>();
    const repeated = playable.map((place) => place.name).filter((name) => seen.size === seen.add(name).size);
    expect(repeated.slice(0, 3).join("; "), "repeated names").toBe("");
  });

  it("when the places inside the walls are listed, then there is somewhere to live, work, eat, shop, hang out, hide and catch a bus", () => {
    const kinds = new Set(playable.map((place) => place.kind));
    for (const kind of Object.values(PLACE_KIND)) expect(kinds.has(kind), `a place of kind ${kind}`).toBe(true);
  });

  it("when a person walks from each portal on the real map, then every node and every door can be reached", () => {
    const reached = (start: number): Uint8Array => {
      const seen = new Uint8Array(graph.nodeX.length);
      const stack = [start];
      seen[start] = 1;
      while (stack.length > 0) {
        const node = stack.pop()!;
        for (let edge = graph.edgeStart[node]!; edge < graph.edgeStart[node + 1]!; edge++) {
          const next = graph.edgeTo[edge]!;
          if (!seen[next]) {
            seen[next] = 1;
            stack.push(next);
          }
        }
      }
      return seen;
    };
    const fromFirst = reached(0);
    expect(fromFirst.reduce((sum, seen) => sum + seen, 0), "nodes reached from node 0").toBe(graph.nodeX.length);
    const unreachable: string[] = [];
    for (const portal of map.portals) {
      const seen = reached(portal);
      for (const place of playable) if (!seen[place.doorNode]) unreachable.push(`${place.name} from ${portal}`);
    }
    expect(unreachable.slice(0, 3).join("; "), "doors not reachable from a portal").toBe("");
  });

  it("when the drawn-only city is read, then every place beyond the walls has no door node and the homes outnumber the playable ones", () => {
    const beyond = map.places.filter((place) => place.doorNode < 0);
    expect(beyond.length, "places beyond the walls").toBeGreaterThan(400);
    expect(beyond.every((place) => Math.abs(place.x) > map.halfX || Math.abs(place.z) > map.halfZ), "all beyond the walls").toBe(true);
    expect(beyond.filter((place) => place.kind === PLACE_KIND.work).length, "workplaces beyond the walls").toBeGreaterThan(0);
  });
});

describe("given the programme's businesses on the map", () => {
  const businesses = playable.filter((place) => place.storeys > 0 && place.kind !== PLACE_KIND.home && place.name !== PLACE_NAMES.policeStation);
  const withInterior = (interior: string) => playable.filter((place) => place.interior === interior);

  // mutation: sed -i 's/{ row: ROW.A, column: 0, face: "south", at: 9, venue: COFFEE_GRIND },//' src/game/world/openworld/openworld-programme.ts
  it("when the places are counted by kind of interior, then there are coffee shops, bars and an office, a store on each of several corners and one supermarket without an interior", () => {
    expect(withInterior("coffee").length, "coffee shops").toBeGreaterThanOrEqual(2);
    expect(withInterior("bar").length, "bars").toBeGreaterThanOrEqual(2);
    expect(withInterior("office").length, "offices").toBeGreaterThanOrEqual(1);
    expect(withInterior("store").length, "corner stores").toBeGreaterThanOrEqual(3);
    const supermarkets = playable.filter((place) => place.style === "supermarket");
    expect(supermarkets.length, "supermarkets").toBe(1);
    expect(supermarkets[0]!.interior, "the supermarket's interior").toBeUndefined();
  });

  // mutation: sed -i 's/{ row: ROW.C, column: 0, face: "south", at: 0, venue: MARTINEZ }/{ row: ROW.C, column: 0, face: "south", at: 6, venue: MARTINEZ }/' src/game/world/openworld/openworld-programme.ts
  it("when each corner store is placed on its block, then it touches the block's west or east end", () => {
    const reach = lots.geometry.blockLength / 2;
    for (const store of withInterior("store")) {
      const block = lots.blocks.find((candidate) => Math.abs(store.x - candidate.centreX) < reach)!;
      const fromEnd = reach - (Math.abs(store.x - block.centreX) + store.width / 2);
      expect(Math.abs(fromEnd), `${store.name} distance from its block's end`).toBeLessThan(1e-6);
    }
  });

  // mutation: sed -i 's/hours: \[6, 15\], interior: "coffee"/interior: "coffee"/' src/game/world/openworld/openworld-programme.ts
  it("when the businesses are read, then each has opening hours of game hours, a sector and a facade style the pipeline has, and a type of business has its own style", () => {
    const styleOf = new Map<string, Set<string>>();
    for (const place of businesses) {
      if (place.hours === undefined) throw new Error(`${place.name} has no hours`);
      for (const hour of place.hours) expect(Number.isInteger(hour) && hour >= 0 && hour < 24, `${place.name} hour ${hour}`).toBe(true);
      expect(Object.values(SECTOR), `${place.name} sector`).toContain(place.sector);
      if (place.interior !== undefined) {
        expect(Object.hasOwn(FACADE, place.style), `${place.name} style ${place.style}`).toBe(true);
        styleOf.set(place.interior, (styleOf.get(place.interior) ?? new Set()).add(place.style));
      }
    }
    expect(Object.fromEntries([...styleOf].map(([interior, styles]) => [interior, [...styles]])), "style by kind of interior").toEqual({ bar: ["bar"], coffee: ["coffee"], office: ["office"], store: ["cornerstore"] });
  });

  // mutation: sed -i 's/interior: "rowhome" }/}/' src/game/world/openworld/openworld-lots.ts
  it("when the homes inside the walls are read, then each is a one-lot building of its own with a rowhome interior and two stoop seats leading its seats, however many storeys it has", () => {
    const homes = playable.filter((place) => place.kind === PLACE_KIND.home && place.interior !== undefined);
    expect(homes.length, "homes inside the walls").toBeGreaterThan(100);
    for (const home of homes) {
      expect(home.interior, `${home.name} interior`).toBe("rowhome");
      expect(home.stoopSeats, `${home.name} stoop seats`).toBe(2);
      expect(home.seats!.length / SEAT_STRIDE, `${home.name} seats`).toBe(home.storeys + HOME_SEATS_BEYOND_STOREYS);
    }
    expect(lots.buildings.filter((building) => building.style === "rowbrick" || building.style === "rowpainted").length, "house buildings").toBeGreaterThanOrEqual(homes.length);
  });
});

describe("given the police station on the map", () => {
  const station = playable.find((place) => place.name === PLACE_NAMES.policeStation);

  // mutation: sed -i 's/sector: SECTOR.police, interior: "office"/sector: SECTOR.police/' src/game/world/openworld/openworld-programme.ts
  it("when the station is read, then it is a two-lot office building with an office interior and a door on the street, open at every hour", () => {
    must(station, "the station is on the map");
    expect(station.interior, "its interior").toBe("office");
    expect(station.style, "its facade").toBe("office");
    expect(station.sector, "its trade").toBe(SECTOR.police);
    expect(station.hours, "opening hours (none: always open)").toBeUndefined();
    expect(station.width, "two lots wide").toBeCloseTo(2 * lots.geometry.lotFrontage, 3);
    expect(station.doorNode, "a door on the walk graph").toBeGreaterThanOrEqual(0);
  });
});
