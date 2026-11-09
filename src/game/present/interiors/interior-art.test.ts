import { describe, expect, it } from "vitest";
import { layOutLots } from "../../world/openworld/openworld-lots.ts";
import { buildOpenWorldMap } from "../../world/openworld/openworld-map.ts";
import type { InteriorSolid } from "../../world/openworld/interior-plan.ts";
import { INTERIOR_FAR, INTERIOR_LINGER, INTERIOR_NEAR, SHELL_FAR, SHELL_NEAR } from "./interior-constants.ts";
import { InteriorSet } from "./interior-art.ts";

const map = buildOpenWorldMap(layOutLots());
const coffee = map.places.find((place) => place.interior === "coffee" && place.doorNode >= 0)!;
/** The map with the one coffee shop: nothing else comes into range as the eye walks about. */
const lone = { ...map, places: [coffee] };
const FRAME = 1 / 60;
/** Frames enough for the budgeted builds to cover the whole map. */
const SETTLE_FRAMES = 200;
/** Where the eye is out of every interior's range. */
const AWAY = 4 * SHELL_FAR;

function settle(set: InteriorSet, x: number, z: number): void {
  for (let frame = 0; frame < SETTLE_FRAMES; frame++) set.update(x, z, FRAME);
}

describe("given the interiors of the open world's map", () => {
  // mutation: sed -i 's/const INTERIOR_NEAR = 35/const INTERIOR_NEAR = 0/' src/game/present/interiors/interior-constants.ts
  it("when the eye comes to a coffee shop's door, then its furniture is built and the whole set is drawn in three draws at most", () => {
    const set = new InteriorSet(map);
    expect(set.stats(), "before any eye").toEqual({ shells: 0, details: 0, vertices: 0, drawCalls: 0 });
    settle(set, coffee.doorX, coffee.doorZ);
    const near = set.stats();
    expect(near.details, "furnished interiors near the door").toBeGreaterThanOrEqual(1);
    expect(near.shells, "envelopes near the door").toBeGreaterThan(near.details);
    expect(near.drawCalls, "draw calls").toBeLessThanOrEqual(3);
    expect(near.vertices, "vertices").toBeGreaterThan(0);
    set.dispose();
  });

  // mutation: sed -i 's/const INTERIOR_LINGER = 3/const INTERIOR_LINGER = 1e9/' src/game/present/interiors/interior-constants.ts
  it("when the eye goes past the far radius for the linger, then the furniture is dropped, then the envelopes, and the meshes are back to nothing; a return before the linger keeps them", () => {
    const set = new InteriorSet(lone);
    settle(set, coffee.doorX, coffee.doorZ);
    expect(set.stats().details, "furnished at the door").toBe(1);
    set.update(coffee.doorX + INTERIOR_FAR + 5, coffee.doorZ, INTERIOR_LINGER / 2);
    set.update(coffee.doorX, coffee.doorZ, FRAME);
    expect(set.stats().details, "after a short walk out and back").toBe(1);
    set.update(coffee.doorX + INTERIOR_FAR + 5, coffee.doorZ, INTERIOR_LINGER + FRAME);
    const midway = set.stats();
    expect(midway.details, "furnished past the far radius").toBe(0);
    expect(midway.shells, "envelope while still inside its radius").toBe(1);
    set.update(coffee.doorX + AWAY, coffee.doorZ, FRAME);
    set.update(coffee.doorX + AWAY, coffee.doorZ, INTERIOR_LINGER + FRAME);
    expect(set.stats(), "far from everything").toEqual({ shells: 0, details: 0, vertices: 0, drawCalls: 0 });
    set.dispose();
  });

  it("when the radii are read, then furniture is nearer than it is dropped, and envelopes reach further than furniture", () => {
    expect(INTERIOR_NEAR).toBeLessThan(INTERIOR_FAR);
    expect(SHELL_NEAR).toBeLessThan(SHELL_FAR);
    expect(INTERIOR_FAR).toBeLessThan(SHELL_NEAR);
  });

  // mutation: sed -i 's/const reached = distance < SOLIDS_NEAR;/const reached = false;/' src/game/present/interiors/interior-art.ts
  it("when the eye comes within the solids' reach of an interior and leaves it, then the physics is handed its solids, then an empty list", () => {
    const set = new InteriorSet(lone);
    const heard: InteriorSolid[][] = [];
    set.onSolids((solids) => heard.push([...solids]));
    settle(set, coffee.doorX, coffee.doorZ);
    expect(heard.length, "lists handed over while at the door").toBeGreaterThanOrEqual(1);
    expect(heard[heard.length - 1]!.length, "solids of the coffee shop at its door").toBeGreaterThan(30);
    set.update(coffee.doorX + AWAY, coffee.doorZ, FRAME);
    expect(heard[heard.length - 1]!.length, "solids once the eye has left").toBe(0);
    set.dispose();
  });
});
