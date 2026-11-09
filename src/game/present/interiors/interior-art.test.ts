import { createHash } from "node:crypto";
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { FRAME_HZ } from "../../kernel/constants.ts";
import { layOutLots } from "../../world/openworld/openworld-lots.ts";
import { buildOpenWorldMap } from "../../world/openworld/openworld-map.ts";
import type { InteriorSolid } from "../../world/openworld/interior-plan.ts";
import { HIDE_GRACE, SIGHT_ID_CAPACITY, SightField, type SightPlayer } from "../openworld-sight.ts";
import { occluder, type Occluder } from "../spectate-cam.ts";
import { INTERIOR_FAR, INTERIOR_KEEP, INTERIOR_LINGER, INTERIOR_NEAR, SHELL_FAR, SHELL_NEAR } from "./interior-constants.ts";
import { InteriorSet } from "./interior-art.ts";

const map = buildOpenWorldMap(layOutLots());
const coffee = map.places.find((place) => place.interior === "coffee" && place.doorNode >= 0)!;
/** The map with the one coffee shop: nothing else comes into range as the eye walks about. */
const lone = { ...map, places: [coffee] };
const FRAME = 1 / FRAME_HZ;
/** Frames enough for the budgeted builds to cover the whole map. */
const SETTLE_FRAMES = 200;
/** Where the eye is out of every interior's range. */
const AWAY = 4 * SHELL_FAR;
/** A field with no eye: everything is seen, so only distance streams. */
const blind = () => new SightField([], SIGHT_ID_CAPACITY);
const NOTHING_BUILT = JSON.stringify({ shells: 0, details: 0, vertices: 0, drawCalls: 0 });

/** The shop's frame: out of its street face, and along it. */
const outX = Math.cos(coffee.yaw);
const outZ = -Math.sin(coffee.yaw);
/** The point `out` m out of the shop's door (negative: in through it, toward its back). */
const fromDoor = (out: number): { x: number; z: number } => ({ x: coffee.doorX + outX * out, z: coffee.doorZ + outZ * out });
/** A wall 12 m tall, thin across the line out of the door and `length` m along the shop's face, standing `out` m out of the door. */
function wallAt(out: number, length: number): Occluder {
  const at = fromDoor(out);
  return occluder(at.x, at.z, coffee.yaw, 0.15, length / 2, false, 0, 12);
}

const EYE_HEIGHT = 1.7;
const EYE_FOV = 60;
const EYE_FAR = 1000;
/** Where the street eye stands (m out of the door: inside the furnished radius), the wall that hides the shop from it, and the alley eye behind the shop's back wall. */
const STREET_EYE = 30;
const STREET_WALL = 25;
const ALLEY_EYE = -(coffee.depth + 3);
const BACK_WALL = -(coffee.depth - 0.17);
const WALL_LENGTH = 3 * coffee.width;
/** Frames the eye looks before a wall goes up, and how far short of and past the hide grace the rows check. */
const MARGIN_FRAMES = 10;
const GRACE_FRAMES = Math.round(HIDE_GRACE * FRAME_HZ);

/** An eye at `out` m from the door looking at it, a sight field over `solids`, and a clock: `frame` advances both by one frame. */
function watch(set: InteriorSet, out: number, players: readonly SightPlayer[] = []) {
  const eye = fromDoor(out);
  const camera = new THREE.PerspectiveCamera(EYE_FOV, 1, 0.1, EYE_FAR);
  camera.position.set(eye.x, EYE_HEIGHT, eye.z);
  camera.lookAt(coffee.doorX, EYE_HEIGHT, coffee.doorZ);
  const sight = new SightField([], SIGHT_ID_CAPACITY);
  let now = 0;
  const frames = (count: number): void => {
    for (let frame = 0; frame < count; frame++) {
      now += FRAME;
      sight.update([camera], now, players);
      set.update(eye.x, eye.z, FRAME, sight);
    }
  };
  return { sight, frames };
}

function settle(set: InteriorSet, x: number, z: number): void {
  const sight = blind();
  for (let frame = 0; frame < SETTLE_FRAMES; frame++) set.update(x, z, FRAME, sight);
}

const digest = (floats: Float32Array): string => createHash("sha1").update(Buffer.from(floats.buffer, floats.byteOffset, floats.byteLength)).digest("hex");

describe("given the interiors of the open world's map", () => {
  // mutation: sed -i 's/const INTERIOR_NEAR = 35/const INTERIOR_NEAR = 0/' src/game/present/interiors/interior-constants.ts
  it("when the eye comes to a coffee shop's door, then its furniture is built and the whole set is drawn in three draws at most", () => {
    const set = new InteriorSet(map);
    expect(JSON.stringify(set.stats()), "before any eye").toBe(NOTHING_BUILT);
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
    const sight = blind();
    settle(set, coffee.doorX, coffee.doorZ);
    expect(set.stats().details, "furnished at the door").toBe(1);
    set.update(coffee.doorX + INTERIOR_FAR + 5, coffee.doorZ, INTERIOR_LINGER / 2, sight);
    set.update(coffee.doorX, coffee.doorZ, FRAME, sight);
    expect(set.stats().details, "after a short walk out and back").toBe(1);
    set.update(coffee.doorX + INTERIOR_FAR + 5, coffee.doorZ, INTERIOR_LINGER + FRAME, sight);
    const midway = set.stats();
    expect(midway.details, "furnished past the far radius").toBe(0);
    expect(midway.shells, "envelope while still inside its radius").toBe(1);
    set.update(coffee.doorX + AWAY, coffee.doorZ, FRAME, sight);
    set.update(coffee.doorX + AWAY, coffee.doorZ, INTERIOR_LINGER + FRAME, sight);
    expect(JSON.stringify(set.stats()), "far from everything").toBe(NOTHING_BUILT);
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
    set.update(coffee.doorX + AWAY, coffee.doorZ, FRAME, blind());
    expect(heard[heard.length - 1]!.length, "solids once the eye has left").toBe(0);
    set.dispose();
  });
});

describe("given an eye on the street that can see a coffee shop, then cannot", () => {
  // mutation: sed -i 's/return sight.unseenFor(id) >= sight.hideGrace ? VIEW.hidden : VIEW.kept;/return VIEW.kept;/' src/game/present/interiors/interior-art.ts
  it("when a wall stands between them, then the interior stays through the hide grace, is released after it, and is built again once the wall is gone", () => {
    const set = new InteriorSet(lone);
    const { sight, frames } = watch(set, STREET_EYE);
    frames(MARGIN_FRAMES);
    expect(set.stats().details, "furnished while seen").toBe(1);
    expect(set.stats().shells, "envelope while seen").toBe(1);
    sight.setSolids([wallAt(STREET_WALL, WALL_LENGTH)]);
    frames(GRACE_FRAMES - MARGIN_FRAMES);
    expect(set.stats().details, "furnished inside the grace").toBe(1);
    frames(2 * MARGIN_FRAMES);
    expect(JSON.stringify(set.stats()), "released once hidden for the grace").toBe(NOTHING_BUILT);
    sight.setSolids([]);
    frames(MARGIN_FRAMES);
    expect(set.stats().details, "furnished once seen again").toBe(1);
    expect(set.stats().shells, "envelope once seen again").toBe(1);
    set.dispose();
  });

  // mutation: sed -i 's/if (seen || sight.near(place.doorX, place.doorZ, INTERIOR_KEEP)) return VIEW.wanted;/if (seen) return VIEW.wanted;/' src/game/present/interiors/interior-art.ts
  it("when a player stands at the door behind the wall, then the interior is kept however long no eye sees it", () => {
    const set = new InteriorSet(lone);
    const player: SightPlayer = { group: { position: { x: coffee.doorX, z: coffee.doorZ } } };
    const { sight, frames } = watch(set, STREET_EYE, [player]);
    frames(MARGIN_FRAMES);
    sight.setSolids([wallAt(STREET_WALL, WALL_LENGTH)]);
    frames(2 * GRACE_FRAMES);
    expect(set.stats().details, "furnished with a player beside it").toBe(1);
    expect(INTERIOR_KEEP, "the keep reaches past the deepest interior").toBeGreaterThan(coffee.depth);
    set.dispose();
  });
});

describe("given an eye in the alley behind a coffee shop where a civilian sits", () => {
  // mutation: sed -i 's/const reached = distance < SOLIDS_NEAR;/const reached = distance < SOLIDS_NEAR \&\& view !== VIEW.hidden;/' src/game/present/interiors/interior-art.ts
  it("when the shop's back wall hides it past the grace, then its drawing is released while the seats and the counter the crowd sits and serves people at, and the solids the physics stands them on, are untouched", () => {
    const set = new InteriorSet(lone);
    const heard: InteriorSolid[][] = [];
    set.onSolids((solids) => heard.push([...solids]));
    const seats = digest(coffee.seats!);
    const counter = digest(coffee.counter!);
    const { sight, frames } = watch(set, ALLEY_EYE);
    frames(MARGIN_FRAMES);
    expect(set.stats().details, "furnished while the back is open to the eye").toBe(1);
    sight.setSolids([wallAt(BACK_WALL, WALL_LENGTH)]);
    frames(2 * GRACE_FRAMES);
    expect(JSON.stringify(set.stats()), "drawing released behind the back wall").toBe(NOTHING_BUILT);
    expect(heard[heard.length - 1]!.length, "solids still with the physics").toBeGreaterThan(30);
    expect(digest(coffee.seats!), "the seats a sitter is placed at").toBe(seats);
    expect(digest(coffee.counter!), "the counter spots").toBe(counter);
    set.dispose();
  });
});
