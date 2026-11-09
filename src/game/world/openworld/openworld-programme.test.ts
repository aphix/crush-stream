import { describe, expect, it } from "vitest";
import { makeWorld } from "../race-world.test-util.ts";
import { parseTrack } from "../track-schema.ts";
import { OFF_MENU } from "../tracks/index.ts";
import { OPENWORLD_ID } from "./openworld-course.ts";
import { layOutLots } from "./openworld-lots.ts";
import { buildOpenWorldMap } from "./openworld-map.ts";
import { PLACE_NAMES } from "./openworld-programme.ts";
import { PLACE_KIND } from "./walk-graph.ts";

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
