import { createHash } from "node:crypto";
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { createCrowdPoses, type CrowdPoses } from "../../ai/civilians/crowd-poses.ts";
import { FRAME_HZ } from "../../kernel/constants.ts";
import { layOutLots } from "../../world/openworld/openworld-lots.ts";
import { buildOpenWorldMap } from "../../world/openworld/openworld-map.ts";
import { vestibuleSolids, type InteriorSolid } from "../../world/openworld/interior-plan.ts";
import { FACADE_OPEN_AT, FACADE_OPEN_MAX } from "../facades.ts";
import { HIDE_GRACE, SIGHT_ID_CAPACITY, SightField, type SightPlayer } from "../openworld-sight.ts";
import { DOOR_SWING_SECONDS, INTERIOR_FAR, INTERIOR_LINGER, INTERIOR_NEAR, SHELL_FAR, SHELL_NEAR } from "./interior-constants.ts";
import { InteriorSet } from "./interior-art.ts";
import type { DoorOpeners } from "./interior-doors.ts";

const map = buildOpenWorldMap(layOutLots());
const coffee = map.places.find((place) => place.interior === "coffee" && place.doorNode >= 0)!;
/** The map with the one coffee shop: nothing else comes into range as the eye walks about. */
const lone = { ...map, places: [coffee] };
const FRAME = 1 / FRAME_HZ;
/** Frames enough for the budgeted builds to cover the whole map, for a door to swing, and for the hide grace to pass. */
const SETTLE_FRAMES = 200;
const SWING_FRAMES = Math.ceil(DOOR_SWING_SECONDS * FRAME_HZ) + 2;
const GRACE_FRAMES = Math.round(HIDE_GRACE * FRAME_HZ);
/** Where the eye is out of every interior's range. */
const AWAY = 4 * SHELL_FAR;
const NOTHING_BUILT = JSON.stringify({ shells: 0, details: 0, vertices: 0, drawCalls: 0 });
const built = (set: InteriorSet): string => JSON.stringify(set.stats());
/** A field with no eye: everything is seen, so only distance and the doors stream. */
const blind = () => new SightField([], SIGHT_ID_CAPACITY);

/** The point `out` m out of the coffee shop's door (negative: in through it). */
const fromDoor = (out: number): { x: number; z: number } => ({ x: coffee.doorX + Math.cos(coffee.yaw) * out, z: coffee.doorZ - Math.sin(coffee.yaw) * out });
/** A civilian standing just out of the door opens it; one who has gone is hidden. */
const AT_DOOR = 0.5;
const STREET_EYE = 30;
/** The player's walker on the sidewalk, inside the vestibule's reach but outside the door's. */
const SIDEWALK = 2.5;

/** Openers with one civilian, hidden until `standAtDoor`, and no walker. */
/** Openers whose crowd is one civilian. */
type OneCivilian = DoorOpeners & { poses: CrowdPoses };

function openers(): OneCivilian {
  const poses = createCrowdPoses(1);
  poses.shown[0] = 0;
  return { poses, walker: null };
}

function standAtDoor(who: OneCivilian): void {
  const at = fromDoor(AT_DOOR);
  who.poses.x[0] = at.x;
  who.poses.z[0] = at.z;
  who.poses.shown[0] = 1;
}

/** A player's eye `out` m from the door, looking at it (or straight away from it), the sight field, the players inside it (read each frame) and a clock. */
function scene(set: InteriorSet, out: number, who: DoorOpeners, players: SightPlayer[] = [], lookAway = false) {
  const eye = fromDoor(out);
  const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 1000);
  camera.position.set(eye.x, 1.7, eye.z);
  const target = lookAway ? fromDoor(out + 10) : fromDoor(0);
  camera.lookAt(target.x, 1.7, target.z);
  const sight = new SightField([], SIGHT_ID_CAPACITY);
  let now = 0;
  const frames = (count: number): void => {
    for (let frame = 0; frame < count; frame++) {
      now += FRAME;
      sight.update([camera], now, players);
      set.update(eye.x, eye.z, FRAME, sight, who);
    }
  };
  return { frames };
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

  // mutation: sed -i 's/if (entry.shell !== null \&\& distance < SOLIDS_NEAR) return SOLIDS.full;/if (false) return SOLIDS.full;/' src/game/present/interiors/interior-art.ts
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

describe("given a coffee shop with its door shut and the player's walker on the sidewalk before it", () => {
  // mutation: sed -i 's/if (entry.shell !== null \&\& distance < SOLIDS_NEAR) return SOLIDS.full;/if (distance < SOLIDS_NEAR) return SOLIDS.full;/' src/game/present/interiors/interior-art.ts
  it("when the eye looks at the shut door, then no room is built and the physics holds the vestibule behind the door alone", () => {
    const set = new InteriorSet(lone);
    const heard = listen(set);
    const who = openers();
    const walker = fromDoor(SIDEWALK);
    who.walker = walker;
    scene(set, STREET_EYE, who, [{ group: { position: walker } }]).frames(SETTLE_FRAMES);
    expect(set.openDoors(), "doors open").toBe(0);
    expect(built(set), "rooms built").toBe(NOTHING_BUILT);
    expect(last(heard), "solids held").toBe(vestibuleSolids(coffee).length);
    set.dispose();
  });
});

describe("given a civilian opening a coffee shop's door", () => {
  // mutation: sed -i 's/if (sight.seenThroughFace(leaf.boxX, leaf.boxZ, entry.place.yaw, entry.halfDepth, leaf.width \/ 2, leaf.floorY + leaf.height, FACE.front)) return true;/return true;/' src/game/present/interiors/interior-art.ts
  it("when no player's eye sees the doorway (one in range looking away, or every eye out of range), then the door swings but nothing is built", () => {
    const away = new InteriorSet(lone);
    const who = openers();
    standAtDoor(who);
    scene(away, STREET_EYE, who, [], true).frames(SETTLE_FRAMES);
    expect(away.openDoors(), "the door swung").toBe(1);
    expect(built(away), "built for an eye looking away").toBe(NOTHING_BUILT);
    away.dispose();
    const far = new InteriorSet(lone);
    scene(far, SHELL_FAR + 10, who).frames(SETTLE_FRAMES);
    expect(built(far), "built for an eye out of range").toBe(NOTHING_BUILT);
    far.dispose();
  });

  // mutation: sed -i 's/return sight.unseenFor(id) >= sight.hideGrace ? VIEW.hidden : VIEW.kept;/return VIEW.kept;/' src/game/present/interiors/interior-art.ts
  it("when a player's eye in range sees the open doorway, then the shop is built; once the civilian has gone and the door is shut, it is released after the hide grace, its seats and counter untouched", () => {
    const set = new InteriorSet(lone);
    const who = openers();
    const seats = digest(coffee.seats!);
    const counter = digest(coffee.counter!);
    const { frames } = scene(set, STREET_EYE, who);
    standAtDoor(who);
    frames(SWING_FRAMES + 2);
    expect(set.stats().details, "furnished through the open door").toBe(1);
    who.poses.shown[0] = 0;
    frames(SWING_FRAMES + GRACE_FRAMES - 20);
    expect(set.stats().details, "kept inside the grace").toBe(1);
    frames(40);
    expect(built(set), "released once shut for the grace").toBe(NOTHING_BUILT);
    expect(digest(coffee.seats!), "the seats a sitter is placed at").toBe(seats);
    expect(digest(coffee.counter!), "the counter spots").toBe(counter);
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
  /** Whether the coffee shop's place is among the buildings the facade shader shows its windows through. */
  const listed = (): boolean => {
    const slots = FACADE_OPEN_AT.value;
    for (let slot = 0; slot < FACADE_OPEN_MAX; slot++) if (Math.abs(slots[2 * slot]! - coffee.x) < 1e-3 && Math.abs(slots[2 * slot + 1]! - coffee.z) < 1e-3) return true;
    return false;
  };

  // mutation: sed -i 's/      if (entry.shell === null || entry.detail === null) continue;/      if (entry.shell === null) continue;/' src/game/present/interiors/interior-art.ts
  it("when its envelope alone is built (an eye far off sees its open door), then its windows stay painted; when its rooms are built whole, then they are listed to be seen through; once the rooms above are dropped they stay painted again", () => {
    const set = new InteriorSet(lone);
    const who = openers();
    standAtDoor(who);
    scene(set, SHELL_NEAR - 10, who).frames(SWING_FRAMES + 2);
    expect(set.stats().shells, "the envelope is built from afar").toBe(1);
    expect(listed(), "listed with its envelope alone").toBe(false);
    const near = new InteriorSet(lone);
    settle(near, coffee.doorX, coffee.doorZ, who);
    expect(near.stats().details, "the rooms are built at the door").toBe(1);
    expect(listed(), "listed with its rooms built").toBe(true);
    near.update(coffee.doorX + INTERIOR_FAR + 5, coffee.doorZ, INTERIOR_LINGER + FRAME, blind(), who);
    expect(near.stats().shells, "the envelope stays within its own far radius").toBe(1);
    expect(listed(), "listed once its rooms are dropped").toBe(false);
    near.dispose();
    set.dispose();
  });

  // mutation: sed -i 's/    setOpenFacades(this.builtAt, 0);//' src/game/present/interiors/interior-art.ts
  it("when the set is disposed, then no building is left listed: a facade of the next course shows its windows painted", () => {
    const set = new InteriorSet(lone);
    const who = openers();
    standAtDoor(who);
    settle(set, coffee.doorX, coffee.doorZ, who);
    expect(listed(), "listed while built").toBe(true);
    set.dispose();
    expect(listed(), "listed after the course is left").toBe(false);
  });
});
