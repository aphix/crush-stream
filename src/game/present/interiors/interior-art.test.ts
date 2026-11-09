import { createHash } from "node:crypto";
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { createCrowdPoses, type CrowdPoses } from "../../ai/civilians/crowd-poses.ts";
import { FRAME_HZ } from "../../kernel/constants.ts";
import { layOutLots } from "../../world/openworld/openworld-lots.ts";
import { buildOpenWorldMap } from "../../world/openworld/openworld-map.ts";
import { vestibuleSolids, type InteriorSolid } from "../../world/openworld/interior-plan.ts";
import { FACADE_OPEN_AT, FACADE_OPEN_MAX, FACADE_OPEN_SLOT_FLOATS } from "../facades.ts";
import { HIDE_GRACE, SIGHT_ID_CAPACITY, SightField, type SightPlayer } from "../openworld-sight.ts";
import type { Place } from "../../world/openworld/walk-graph.ts";
import { CLOSED_GLOW, DOOR_SWING_SECONDS, INTERIOR_DIM, INTERIOR_FAR, INTERIOR_LINGER, INTERIOR_NEAR, OPEN_FADE_SECONDS, SHELL_FAR, SHELL_NEAR, SHOPFRONT_ROOMS } from "./interior-constants.ts";
import { InteriorSet } from "./interior-art.ts";
import type { DoorOpeners } from "./interior-doors.ts";

const map = buildOpenWorldMap(layOutLots());
const coffee = map.places.find((place) => place.interior === "coffee" && place.doorNode >= 0)!;
/** The map with the one coffee shop: nothing else comes into range as the eye walks about. */
const lone = { ...map, places: [coffee] };
/** A home, and the map with it alone: its rooms follow its doors, not its front. */
const house = map.places.find((place) => place.interior === "rowhome" && place.doorNode >= 0)!;
const loneHouse = { ...map, places: [house] };
const FRAME = 1 / FRAME_HZ;
/** Frames enough for the budgeted builds to cover the whole map, for a door to swing, and for the hide grace to pass. */
const SETTLE_FRAMES = 200;
const SWING_FRAMES = Math.ceil(DOOR_SWING_SECONDS * FRAME_HZ) + 2;
const GRACE_FRAMES = Math.round(HIDE_GRACE * FRAME_HZ);
/** Frames for a building's windows to open, or to shut before its rooms are dropped. */
const FADE_FRAMES = Math.ceil(OPEN_FADE_SECONDS * FRAME_HZ) + 2;
/** Where the eye is out of every interior's range. */
const AWAY = 4 * SHELL_FAR;
const NOTHING_BUILT = JSON.stringify({ shells: 0, details: 0, vertices: 0, drawCalls: 0 });
const built = (set: InteriorSet): string => JSON.stringify(set.stats());
/** A field with no eye: everything is seen, so only distance and the doors stream. */
const blind = () => new SightField([], SIGHT_ID_CAPACITY);

/** The point `out` m out of a place's door (the coffee shop's, or another's; negative: in through it). */
const fromDoor = (out: number, place: Place = coffee): { x: number; z: number } => ({ x: place.doorX + Math.cos(place.yaw) * out, z: place.doorZ - Math.sin(place.yaw) * out });
/** A civilian standing just out of the door opens it; one who has gone is hidden. */
const AT_DOOR = 0.5;
const STREET_EYE = 30;
/** The player's walker on the sidewalk, inside the vestibule's reach but outside the door's. */
const SIDEWALK = 2.5;

/** Openers whose crowd is `civilians` people, hidden until `standAtDoor`, and no walker. */
type Civilians = DoorOpeners & { poses: CrowdPoses };
/** The one place of the lone map is shut. */
const SHUT = new Uint8Array([1]);
const OPEN = new Uint8Array([0]);

function openers(civilians = 1): Civilians {
  const poses = createCrowdPoses(civilians);
  poses.shown.fill(0);
  return { poses, walker: null, closed: null };
}

/** Civilian `who` stands just out of a place's door. */
function standAtDoor(crowd: Civilians, place: Place = coffee, who = 0): void {
  const at = fromDoor(AT_DOOR, place);
  crowd.poses.x[who] = at.x;
  crowd.poses.z[who] = at.z;
  crowd.poses.shown[who] = 1;
}

/** A player's eye `out` m from a place's door, looking at it (or straight away from it, `look(true)`), the sight field, the players inside it (read each frame) and a clock. */
function scene(set: InteriorSet, out: number, who: DoorOpeners, players: SightPlayer[] = [], lookAway = false, place: Place = coffee) {
  const eye = fromDoor(out, place);
  const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 1000);
  camera.position.set(eye.x, 1.7, eye.z);
  const look = (away: boolean): void => {
    const target = away ? fromDoor(out + 10, place) : fromDoor(0, place);
    camera.lookAt(target.x, 1.7, target.z);
  };
  look(lookAway);
  const sight = new SightField([], SIGHT_ID_CAPACITY);
  let now = 0;
  const frames = (count: number): void => {
    for (let frame = 0; frame < count; frame++) {
      now += FRAME;
      sight.update([camera], now, players);
      set.update(eye.x, eye.z, FRAME, sight, who);
    }
  };
  return { frames, look };
}

/** How far open the facade's list holds a place's building (0 painted to 1 seen through), or undefined when it is not among those the facade shader shows its windows through. */
function openAmount(place: Place): number | undefined {
  const slots = FACADE_OPEN_AT.value;
  for (let slot = 0; slot < FACADE_OPEN_MAX; slot++) {
    const at = FACADE_OPEN_SLOT_FLOATS * slot;
    if (Math.abs(slots[at]! - place.x) < 1e-3 && Math.abs(slots[at + 1]! - place.z) < 1e-3) return slots[at + 2]!;
  }
  return undefined;
}

const listed = (place: Place): boolean => openAmount(place) !== undefined;

/** Which of `copies` are listed, nearest first, as a string of 1 (listed) and 0. */
const listedNearestFirst = (placed: readonly Place[]): string => placed.slice().reverse().map((place) => (listed(place) ? "1" : "0")).join("");

/** How much further in from its door each copy of a place stands than the last (m): a few steps keep them all within the furnished range of an eye out in front. */
const COPY_STEP = 0.2;
/** `count` copies of a place, each further from an eye out in front of its door than the one before, the farthest first: the order the set reads them in. */
function copies(place: Place, count: number): Place[] {
  const shifted = (copy: number): Place => {
    const x = -Math.cos(place.yaw) * COPY_STEP * copy;
    const z = Math.sin(place.yaw) * COPY_STEP * copy;
    return { ...place, x: place.x + x, z: place.z + z, doorX: place.doorX + x, doorZ: place.doorZ + z };
  };
  return Array.from({ length: count }, (_, copy) => shifted(copy)).reverse();
}

function settle(set: InteriorSet, x: number, z: number, who: DoorOpeners, count = SETTLE_FRAMES): void {
  const sight = blind();
  for (let frame = 0; frame < count; frame++) set.update(x, z, FRAME, sight, who);
}

function listen(set: InteriorSet): InteriorSolid[][] {
  const heard: InteriorSolid[][] = [];
  set.onSolids((solids) => heard.push([...solids]));
  return heard;
}

const last = (heard: InteriorSolid[][]): number => heard[heard.length - 1]?.length ?? 0;
const digest = (floats: Float32Array): string => createHash("sha1").update(Buffer.from(floats.buffer, floats.byteOffset, floats.byteLength)).digest("hex");

describe("given the interiors of the open world's map, a coffee shop's door held open", () => {
  // mutation: sed -i 's/const INTERIOR_NEAR = 35/const INTERIOR_NEAR = 0/' src/game/present/interiors/interior-constants.ts
  it("when the eye comes to the door, then the shop is furnished and the whole set is drawn in four draws at most (envelope, furniture, lamps, glass)", () => {
    const set = new InteriorSet(map);
    const who = openers();
    expect(built(set), "before any eye").toBe(NOTHING_BUILT);
    standAtDoor(who);
    settle(set, coffee.doorX, coffee.doorZ, who);
    const near = set.stats();
    expect(near.details, "furnished interiors near the door").toBeGreaterThanOrEqual(1);
    expect(near.shells, "envelopes near the door").toBeGreaterThanOrEqual(near.details);
    expect(near.drawCalls, "draw calls").toBeLessThanOrEqual(4);
    set.dispose();
  });

  // mutation: sed -i 's/const INTERIOR_LINGER = 3/const INTERIOR_LINGER = 1e9/' src/game/present/interiors/interior-constants.ts
  it("when the eye goes past the far radius for the linger, then the furniture is dropped, then the envelope; a return before the linger keeps them", () => {
    const set = new InteriorSet(lone);
    const who = openers();
    standAtDoor(who);
    const sight = blind();
    settle(set, coffee.doorX, coffee.doorZ, who);
    expect(set.stats().details, "furnished at the door").toBe(1);
    set.update(coffee.doorX + INTERIOR_FAR + 5, coffee.doorZ, INTERIOR_LINGER / 2, sight, who);
    set.update(coffee.doorX, coffee.doorZ, FRAME, sight, who);
    expect(set.stats().details, "after a short walk out and back").toBe(1);
    set.update(coffee.doorX + INTERIOR_FAR + 5, coffee.doorZ, INTERIOR_LINGER + FRAME, sight, who);
    set.update(coffee.doorX + INTERIOR_FAR + 5, coffee.doorZ, FRAME, sight, who);
    expect(set.stats().details, "furnished past the far radius").toBe(0);
    expect(set.stats().shells, "envelope while still inside its radius").toBe(1);
    set.update(coffee.doorX + AWAY, coffee.doorZ, FRAME, sight, who);
    set.update(coffee.doorX + AWAY, coffee.doorZ, INTERIOR_LINGER + FRAME, sight, who);
    expect(built(set), "far from everything").toBe(NOTHING_BUILT);
    set.dispose();
  });

  it("when the radii are read, then furniture is nearer than it is dropped, and envelopes reach further than furniture", () => {
    expect(INTERIOR_NEAR).toBeLessThan(INTERIOR_FAR);
    expect(SHELL_NEAR).toBeLessThan(SHELL_FAR);
    expect(INTERIOR_FAR).toBeLessThan(SHELL_NEAR);
  });

  // mutation: sed -i 's/if (entry.shellBuilt \&\& distance < SOLIDS_NEAR) return SOLIDS.full;/if (false) return SOLIDS.full;/' src/game/present/interiors/interior-art.ts
  it("when the eye is at the built shop and then leaves it, then the physics is handed its solids, then an empty list", () => {
    const set = new InteriorSet(lone);
    const heard = listen(set);
    const who = openers();
    standAtDoor(who);
    settle(set, coffee.doorX, coffee.doorZ, who);
    expect(last(heard), "solids of the coffee shop at its door").toBeGreaterThan(30);
    set.update(coffee.doorX + AWAY, coffee.doorZ, FRAME, blind(), who);
    expect(last(heard), "solids once the eye has left").toBe(0);
    set.dispose();
  });
});

describe("given a house with its door shut and the player's walker on the sidewalk before it", () => {
  // mutation: sed -i 's/if (entry.shellBuilt \&\& distance < SOLIDS_NEAR) return SOLIDS.full;/if (distance < SOLIDS_NEAR) return SOLIDS.full;/' src/game/present/interiors/interior-art.ts
  it("when the eye looks at the shut door, then no room is built and the physics holds the vestibule behind the door alone", () => {
    const set = new InteriorSet(loneHouse);
    const heard = listen(set);
    const who = openers();
    const walker = fromDoor(SIDEWALK, house);
    who.walker = walker;
    scene(set, SIDEWALK, who, [{ group: { position: walker } }], false, house).frames(SETTLE_FRAMES);
    expect(set.openDoors(), "doors open").toBe(0);
    expect(built(set), "rooms built").toBe(NOTHING_BUILT);
    expect(last(heard), "solids held").toBe(vestibuleSolids(house).length);
    set.dispose();
  });
});

describe("given a civilian opening a house's door", () => {
  // mutation: sed -i 's/if (sight.seenThroughFace(leaf.boxX, leaf.boxZ, entry.place.yaw, entry.halfDepth, leaf.width \/ 2, leaf.floorY + leaf.height, FACE.front)) return true;/return true;/' src/game/present/interiors/interior-art.ts
  it("when no player's eye sees the doorway (one in range looking away, or every eye out of range), then the door swings but nothing is built", () => {
    const away = new InteriorSet(loneHouse);
    const who = openers();
    standAtDoor(who, house);
    scene(away, STREET_EYE, who, [], true, house).frames(SETTLE_FRAMES);
    expect(away.openDoors(), "the door swung").toBe(1);
    expect(built(away), "built for an eye looking away").toBe(NOTHING_BUILT);
    away.dispose();
    const far = new InteriorSet(loneHouse);
    scene(far, SHELL_FAR + 10, who, [], false, house).frames(SETTLE_FRAMES);
    expect(built(far), "built for an eye out of range").toBe(NOTHING_BUILT);
    far.dispose();
  });

  // mutation: sed -i 's/return sight.unseenFor(id) >= sight.hideGrace ? VIEW.hidden : VIEW.kept;/return VIEW.kept;/' src/game/present/interiors/interior-art.ts
  it("when a player's eye in range sees the open doorway, then the house is built; once the civilian has gone and the door is shut, it is released after the hide grace, its seats untouched", () => {
    const set = new InteriorSet(loneHouse);
    const who = openers();
    const seats = digest(house.seats!);
    const { frames } = scene(set, STREET_EYE, who, [], false, house);
    standAtDoor(who, house);
    frames(SWING_FRAMES + 2);
    expect(set.stats().details, "furnished through the open door").toBe(1);
    who.poses.shown[0] = 0;
    frames(SWING_FRAMES + GRACE_FRAMES - 20);
    expect(set.stats().details, "kept inside the grace").toBe(1);
    frames(40 + FADE_FRAMES);
    expect(built(set), "released once shut for the grace").toBe(NOTHING_BUILT);
    expect(digest(house.seats!), "the seats a sitter is placed at").toBe(seats);
    set.dispose();
  });
});

describe("given a coffee shop with its door shut", () => {
  // mutation: sed -i 's/ || entry.shopfront || / || /' src/game/present/interiors/interior-art.ts
  it("when a player's eye in range sees its street front, then the room is furnished and listed for its windows with no door open; once the eye looks away it is released after the hide grace, its seats and counter untouched", () => {
    const set = new InteriorSet(lone);
    const who = openers();
    const seats = digest(coffee.seats!);
    const counter = digest(coffee.counter!);
    const view = scene(set, STREET_EYE, who);
    view.frames(SETTLE_FRAMES);
    expect(set.openDoors(), "doors open").toBe(0);
    expect(set.stats().details, "furnished from the street").toBe(1);
    expect(listed(coffee), "its windows are seen through").toBe(true);
    view.look(true);
    view.frames(GRACE_FRAMES - 20);
    expect(set.stats().details, "kept inside the grace").toBe(1);
    view.frames(40 + FADE_FRAMES);
    expect(built(set), "released once out of view for the grace").toBe(NOTHING_BUILT);
    expect(listed(coffee), "listed once released").toBe(false);
    expect(digest(coffee.seats!), "the seats a sitter is placed at").toBe(seats);
    expect(digest(coffee.counter!), "the counter spots").toBe(counter);
    set.dispose();
  });

  // mutation: sed -i 's/ || entry.distance >= (entry.detailBuilt ? INTERIOR_FAR : INTERIOR_NEAR)//' src/game/present/interiors/interior-art.ts
  it("when the eye looking at its front is past the furnished range, then nothing is built", () => {
    const set = new InteriorSet(lone);
    scene(set, INTERIOR_NEAR + 5, openers()).frames(SETTLE_FRAMES);
    expect(built(set), "built for an eye past the near radius").toBe(NOTHING_BUILT);
    set.dispose();
  });

  // mutation: sed -i 's/export const SHOPFRONT_ROOMS = FACADE_OPEN_MAX - HOME_OPEN_SLOTS;/export const SHOPFRONT_ROOMS = FACADE_OPEN_MAX;/' src/game/present/interiors/interior-constants.ts
  it("when more businesses are in view than the facade's list keeps for them, then the nearest few are furnished and listed and the rest stay painted", () => {
    const shops = copies(coffee, FACADE_OPEN_MAX + 4);
    const set = new InteriorSet({ ...map, places: shops });
    scene(set, STREET_EYE, openers()).frames(SETTLE_FRAMES);
    expect(set.stats().details, "furnished, with slots left for the homes").toBeLessThan(FACADE_OPEN_MAX);
    expect(set.stats().details, "furnished").toBe(SHOPFRONT_ROOMS);
    expect(set.stats().shells, "enveloped").toBe(SHOPFRONT_ROOMS);
    expect(listedNearestFirst(shops), "which of them, nearest first, are listed").toBe("1".repeat(SHOPFRONT_ROOMS) + "0".repeat(shops.length - SHOPFRONT_ROOMS));
    set.dispose();
  });
});

describe("given more houses built by their doors than the facade's list holds", () => {
  // mutation: sed -i 's/count = keepNearest(this.listedAt, this.listedDistance, count, at, entry.distance);/if (count < FACADE_OPEN_MAX) { this.listedAt[count] = at; this.listedDistance[count++] = entry.distance; }/' src/game/present/interiors/interior-art.ts
  it("when each has a civilian at its door and an eye in range, then the list holds the nearest of them", () => {
    const houses = copies(house, FACADE_OPEN_MAX + 1);
    const set = new InteriorSet({ ...map, places: houses });
    const who = openers(houses.length);
    const nearest = houses.slice().reverse();
    for (let rank = 0; rank < nearest.length; rank++) standAtDoor(who, nearest[rank]!, rank);
    scene(set, STREET_EYE, who, [], false, house).frames(SETTLE_FRAMES);
    expect(set.stats().details, "every house is furnished").toBe(houses.length);
    expect(listedNearestFirst(houses), "which of them, nearest first, are listed").toBe("1".repeat(FACADE_OPEN_MAX) + "0");
    set.dispose();
  });
});

describe("given the player in or at a coffee shop with no eye on its doorway", () => {
  // mutation: sed -i 's/const seen = sight.playerInside(place.x, place.z, place.yaw, entry.halfDepth, entry.halfWidth) || /const seen = /' src/game/present/interiors/interior-art.ts
  it("when he stands inside with every door shut, then the interior is kept however long", () => {
    const set = new InteriorSet(lone);
    const inside = { x: coffee.x, z: coffee.z };
    const who = openers();
    who.walker = inside;
    scene(set, STREET_EYE, who, [{ group: { position: inside } }], true).frames(2 * GRACE_FRAMES);
    expect(set.openDoors(), "doors open").toBe(0);
    expect(set.stats().details, "furnished with the player inside").toBe(1);
    set.dispose();
  });

  // mutation: sed -i 's/hypot2(walker.x - leaf.x, walker.z - leaf.z) <= VESTIBULE_REACH) return SOLIDS.vestibule;/hypot2(walker.x - leaf.x, walker.z - leaf.z) <= VESTIBULE_REACH) return SOLIDS.none;/' src/game/present/interiors/interior-art.ts
  it("when he stands in the open doorway facing the street, then the vestibule's floor stays under him past the grace", () => {
    const set = new InteriorSet(lone);
    const heard = listen(set);
    const walker = fromDoor(AT_DOOR);
    const who = openers();
    who.walker = walker;
    scene(set, AT_DOOR, who, [{ group: { position: walker } }], true).frames(2 * GRACE_FRAMES);
    expect(set.openDoors(), "his door is open").toBe(1);
    expect(last(heard), "solids under him").toBeGreaterThanOrEqual(vestibuleSolids(coffee).length);
    set.dispose();
  });
});

describe("given the sight field an interior set took its ids from", () => {
  // mutation: sed -i '/this.claimedFrom?.release(this.sightBase, this.entries.length);/d' src/game/present/interiors/interior-art.ts
  it("when the set is disposed, then its ids are free again: the next claim gets the first of them", () => {
    const sight = blind();
    const set = new InteriorSet(lone);
    set.update(coffee.doorX, coffee.doorZ, FRAME, sight, openers());
    set.dispose();
    expect(sight.claim(1), "the first id after the set is gone").toBe(0);
  });
});

describe("given the facade of a shop whose rooms are built", () => {
  // mutation: sed -i 's/      if (!entry.shellBuilt || !entry.detailBuilt) continue;/      if (!entry.shellBuilt) continue;/' src/game/present/interiors/interior-art.ts
  it("when its envelope alone is built (an eye far off sees its open door), then its windows stay painted; when its rooms are built whole, then they are listed to be seen through; once the rooms above are dropped they stay painted again", () => {
    const set = new InteriorSet(lone);
    const who = openers();
    standAtDoor(who);
    scene(set, SHELL_NEAR - 10, who).frames(SWING_FRAMES + 2);
    expect(set.stats().shells, "the envelope is built from afar").toBe(1);
    expect(listed(coffee), "listed with its envelope alone").toBe(false);
    const near = new InteriorSet(lone);
    settle(near, coffee.doorX, coffee.doorZ, who);
    expect(near.stats().details, "the rooms are built at the door").toBe(1);
    expect(listed(coffee), "listed with its rooms built").toBe(true);
    near.update(coffee.doorX + INTERIOR_FAR + 5, coffee.doorZ, INTERIOR_LINGER + FRAME, blind(), who);
    near.update(coffee.doorX + INTERIOR_FAR + 5, coffee.doorZ, FRAME, blind(), who);
    expect(near.stats().shells, "the envelope stays within its own far radius").toBe(1);
    expect(listed(coffee), "listed once its rooms are dropped").toBe(false);
    near.dispose();
    set.dispose();
  });

  // mutation: sed -i 's/    setOpenFacades(this.builtAt, 0);//' src/game/present/interiors/interior-art.ts
  it("when the set is disposed, then no building is left listed: a facade of the next course shows its windows painted", () => {
    const set = new InteriorSet(lone);
    const who = openers();
    standAtDoor(who);
    settle(set, coffee.doorX, coffee.doorZ, who);
    expect(listed(coffee), "listed while built").toBe(true);
    set.dispose();
    expect(listed(coffee), "listed after the course is left").toBe(false);
  });
});

describe("given a coffee shop whose room is built and then released", () => {
  /** What the facade's list says of the shop's windows, and whether its furnished room is built, each frame. */
  function watch(view: ReturnType<typeof scene>, set: InteriorSet, frames: number): { amount: (number | undefined)[]; furnished: boolean[] } {
    const amount: (number | undefined)[] = [];
    const furnished: boolean[] = [];
    for (let frame = 0; frame < frames; frame++) {
      view.frames(1);
      amount.push(openAmount(coffee));
      furnished.push(set.stats().details === 1);
    }
    return { amount, furnished };
  }

  // mutation: sed -i 's/export const OPEN_FADE_SECONDS = 0.5;/export const OPEN_FADE_SECONDS = 1e-6;/' src/game/present/interiors/interior-constants.ts (the windows jump open and shut)
  it("when the room is built, then its windows open a step a frame over the fade, never back, to wide open", () => {
    const set = new InteriorSet(lone);
    const view = scene(set, STREET_EYE, openers());
    const { amount, furnished } = watch(view, set, 3 * FADE_FRAMES);
    const built = furnished.indexOf(true);
    expect(built, "the room is built").toBeGreaterThanOrEqual(0);
    const opening = amount.slice(built).map((value) => value ?? -1);
    expect(opening[0], "just built: nearly shut").toBeLessThan(0.2);
    expect(opening[Math.round(FADE_FRAMES / 2)], "half way through the fade: about half open").toBeGreaterThan(0.3);
    expect(opening[Math.round(FADE_FRAMES / 2)], "half way through the fade: about half open").toBeLessThan(0.7);
    for (let at = 1; at < opening.length; at++) expect(opening[at]!, `frame ${at} after the build`).toBeGreaterThanOrEqual(opening[at - 1]!);
    expect(opening[opening.length - 1], "wide open").toBe(1);
    set.dispose();
  });

  // mutation: sed -i '/    if (this.openness\[at\]! > 0) {/,/    }/d' src/game/present/interiors/interior-art.ts (a room is dropped with its windows open)
  it("when it is released, then its windows shut over the fade with the room still built, and the room is dropped only once they have", () => {
    const set = new InteriorSet(lone);
    const view = scene(set, STREET_EYE, openers());
    view.frames(SETTLE_FRAMES);
    expect(openAmount(coffee), "open before").toBe(1);
    view.look(true);
    const { amount, furnished } = watch(view, set, GRACE_FRAMES + 3 * FADE_FRAMES);
    const dropped = furnished.lastIndexOf(true) + 1;
    expect(dropped, "the room is dropped").toBeLessThan(furnished.length);
    expect(amount[dropped - 1], "the last frame the room stood: its windows shut").toBe(0);
    const closing = amount.slice(0, dropped).filter((value) => value !== undefined && value > 0 && value < 1);
    expect(closing.length, "frames spent shutting, the room built").toBeGreaterThan(FADE_FRAMES / 2);
    expect(listed(coffee), "listed once dropped").toBe(false);
    set.dispose();
  });

  // mutation: sed -i 's/export const INTERIOR_DIM = 0.6;/export const INTERIOR_DIM = 1;/' src/game/present/interiors/interior-constants.ts (a lit room washes out to white)
  it("when its solids are drawn, then they take a share of the light, not all of it", () => {
    const set = new InteriorSet(lone);
    const mesh = set.group.getObjectByName("interior-furniture") as THREE.Mesh;
    expect((mesh.material as THREE.MeshStandardMaterial).color.r, "the furniture's colour factor").toBe(INTERIOR_DIM);
    expect(INTERIOR_DIM, "less than all of the light").toBeLessThan(1);
    set.dispose();
  });
});

describe("given a coffee shop that is shut (wrecked, or outside its hours)", () => {
  /** The brightest colour channel the lamps and screens draw, over the vertices packed. */
  function brightest(set: InteriorSet): number {
    const mesh = set.group.getObjectByName("interior-lights") as THREE.Mesh;
    const color = mesh.geometry.getAttribute("color").array;
    let most = 0;
    for (let at = 0; at < mesh.geometry.drawRange.count * 3; at++) most = Math.max(most, color[at]!);
    return most;
  }

  // mutation: sed -i 's/this.locked\[door\] === 0 \&\& this.someoneAt(leaf, near, openers)/this.someoneAt(leaf, near, openers)/' src/game/present/interiors/interior-doors.ts
  it("when a civilian stands at its street door, then the door stays shut; once it is open again the door swings", () => {
    const set = new InteriorSet(lone);
    const who = openers();
    who.closed = SHUT;
    standAtDoor(who);
    const view = scene(set, STREET_EYE, who);
    view.frames(SWING_FRAMES + 2);
    expect(set.openDoors(), "doors open while it is shut").toBe(0);
    who.closed = OPEN;
    view.frames(SWING_FRAMES + 2);
    expect(set.openDoors(), "doors open once it is open again").toBe(1);
    set.dispose();
  });

  // mutation: sed -i 's/export const CLOSED_GLOW = 0.08;/export const CLOSED_GLOW = 1;/' src/game/present/interiors/interior-constants.ts
  it("when its room is built, then its lamps and screens glow a faint share of their light while it is shut, whether it shut after the room was built or before, and as they were when it opens", () => {
    const lit = new InteriorSet(lone);
    settle(lit, coffee.doorX, coffee.doorZ, openers());
    const bright = brightest(lit);
    expect(bright, "lit").toBeGreaterThan(0.1);
    const who = openers();
    who.closed = SHUT;
    settle(lit, coffee.doorX, coffee.doorZ, who, 3);
    expect(brightest(lit), "shut after it was built").toBeCloseTo(bright * CLOSED_GLOW, 5);
    expect(brightest(lit), "shut after it was built: well under what it was").toBeLessThan(bright / 2);
    who.closed = OPEN;
    settle(lit, coffee.doorX, coffee.doorZ, who, 3);
    expect(brightest(lit), "open again").toBeCloseTo(bright, 5);
    const shut = new InteriorSet(lone);
    const closedFirst = openers();
    closedFirst.closed = SHUT;
    settle(shut, coffee.doorX, coffee.doorZ, closedFirst);
    expect(brightest(shut), "shut before it was built").toBeCloseTo(bright * CLOSED_GLOW, 5);
    expect(brightest(shut), "shut before it was built: well under what it was").toBeLessThan(bright / 2);
    lit.dispose();
    shut.dispose();
  });
});
