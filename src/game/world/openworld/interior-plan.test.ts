import { describe, expect, it } from "vitest";
import { flightHead, footprintOf, stairBoxes, wallBoxes } from "./interior-draft.ts";
import { BAY_WIDTH, ceilingOver, FURNISHING, HEADROOM, MAX_RISER, MAX_STOREYS, MIN_STOREYS, PARTITION, ROWHOME_FLOOR_Y, SHOPFRONT, type Box, type InteriorPlan } from "./interior-kinds.ts";
import { DOOR_FACE, interiorDoor, interiorDoors, interiorSolids, interiorSpots, planInterior } from "./interior-plan.ts";
import { drawnHalf, STOOP } from "./openworld-facade-solids.ts";
import { layOutLots } from "./openworld-lots.ts";
import { COUNTER_STRIDE, SEAT_STRIDE, type InteriorKind, type Place } from "./walk-graph.ts";
import { detCos, detSin, hypot2 } from "../../kernel/physics-core.js";

const lots = layOutLots();
const furnished = lots.places.filter((place) => place.interior !== undefined);
const firstOf = (kind: InteriorKind): Place => furnished.find((place) => place.interior === kind)!;
const KINDS: readonly InteriorKind[] = ["rowhome", "coffee", "bar", "office", "store"];

const STOREY_COUNTS = Array.from({ length: MAX_STOREYS - MIN_STOREYS + 1 }, (_, at) => MIN_STOREYS + at);

/** Every kind of interior at every storey count: the first place of the kind, planned as if it stood that many storeys. */
const variants = KINDS.flatMap((kind) =>
  STOREY_COUNTS.map((storeys) => {
    const place: Place = { ...firstOf(kind), storeys };
    return { label: `${kind} x${storeys}`, kind, storeys, place, plan: planInterior(place) };
  }),
);

/** Seats a place should publish, counted by hand from what each layout puts in it: a rowhome's two on its stoop, four dining chairs, one in its kitchen and a desk chair on each floor from the second up (so `storeys + 7`); a shop's own, and the sofa of two in each flat over it. */
const SHOP_SEATS: Record<Exclude<InteriorKind, "rowhome">, number> = { coffee: 11, bar: 24, office: 22, store: 0 };
const SOFA_SEATS = 2;
const expectedSeats = (kind: InteriorKind, storeys: number): number => (kind === "rowhome" ? storeys + 7 : SHOP_SEATS[kind] + SOFA_SEATS * (storeys - 1));

function overlap(a: { deep0: number; deep1: number; across0: number; across1: number }, b: { deep0: number; deep1: number; across0: number; across1: number }): number {
  return Math.max(0, Math.min(a.deep1, b.deep1) - Math.max(a.deep0, b.deep0)) * Math.max(0, Math.min(a.across1, b.across1) - Math.max(a.across0, b.across0));
}

describe("given every kind of interior built for a place of the map", () => {
  // mutation: sed -i 's/d.put("stool", 0, 4.3 + stool \* 0.85, -3, toLeft)/void stool/' src/game/world/openworld/interior-layouts.ts (bar: 24 -> 16)
  it("when its seats are published for every storey count, then there is one per seat of every piece of furniture, in x z yaw height rows", () => {
    for (const { label, kind, storeys, place, plan } of variants) {
      const { seats, stoopSeats } = interiorSpots(place, plan);
      expect(seats.length / SEAT_STRIDE, `${label} seats`).toBe(expectedSeats(kind, storeys));
      expect(stoopSeats, `${label} stoop seats`).toBe(kind === "rowhome" ? 2 : 0);
      for (let at = 0; at < seats.length; at++) expect(Number.isFinite(seats[at]!), `${label} float ${at}`).toBe(true);
    }
  });

  it("when the seats of a plan are counted from its own furniture, then they equal what the place publishes", () => {
    for (const { label, place, plan } of variants) {
      const furniture = plan.furnishings.reduce((sum, piece) => sum + FURNISHING[piece.kind].seats, 0);
      const spots = interiorSpots(place, plan);
      expect(spots.seats.length / SEAT_STRIDE - spots.stoopSeats, `${label} indoor seats`).toBe(furniture);
    }
  });

  // mutation: sed -i 's/serves: true, serveAt: -3.3/serveAt: -3.3/' src/game/world/openworld/interior-layouts.ts (bar loses its counter)
  it("when its counter spots are published, then a business has a customer's and a clerk's, facing each other across the counter top, and a home none", () => {
    for (const kind of KINDS) {
      const counter = interiorSpots(firstOf(kind)).counter;
      if (kind === "rowhome") {
        expect(counter, "rowhome counter").toBeNull();
        continue;
      }
      expect(counter!.length, `${kind} counter floats`).toBe(2 * COUNTER_STRIDE);
      expect(counter![3], `${kind} counter top`).toBeGreaterThan(0.9);
      expect(counter![3]).toBe(counter![COUNTER_STRIDE + 3]);
      const turned = Math.abs(counter![2]! - counter![COUNTER_STRIDE + 2]!);
      expect(Math.abs(turned - Math.PI) < 1e-6 || Math.abs(turned - 2 * Math.PI) < 1e-6, `${kind} spots face each other`).toBe(true);
    }
  });
});

describe("given a place's door on the street face", () => {
  // mutation: sed -i 's/centre: ROWHOME_DOOR_OFFSET, width: 1, sill: 0/centre: 0, width: 1, sill: 0/' src/game/world/openworld/interior-kinds.ts (the plan's doorway moves off the place's door)
  it("when the interior's walls are probed at the door, then the doorway is open at body height and wall stands just outside its width", () => {
    for (const place of furnished) {
      const solids = interiorSolids(place);
      const floor = place.interior === "rowhome" ? ROWHOME_FLOOR_Y : 0.05;
      const inward = { x: -Math.round(detCos(place.yaw)), z: Math.round(detSin(place.yaw)) };
      const at = (alongX: number, alongZ: number) => ({ x: place.doorX + inward.x * 0.17 + alongX, z: place.doorZ + inward.z * 0.17 + alongZ });
      const hit = (point: { x: number; z: number }) => solids.some((solid) => point.x > solid.x0 && point.x < solid.x1 && point.z > solid.z0 && point.z < solid.z1 && floor + 1 > solid.y0 && floor + 1 < solid.y1);
      expect(hit(at(0, 0)), `${place.name} door is open`).toBe(false);
      const width = SHOPFRONT[place.interior!][0]!.width;
      const alongFace = { x: Math.round(Math.abs(detSin(place.yaw))), z: Math.round(Math.abs(detCos(place.yaw))) };
      const beside = [1, -1].some((side) => hit(at(alongFace.x * side * (width / 2 + 0.05), alongFace.z * side * (width / 2 + 0.05))));
      expect(beside, `${place.name} has wall beside its door`).toBe(true);
    }
  });

  it("when the door is derived from the frontage again, then it is the place's own door point", () => {
    for (const place of furnished) {
      const door = interiorDoor(place.interior!, place.width, place.depth, place.x, place.z, place.yaw);
      expect(hypot2(door.x - place.doorX, door.z - place.doorZ), `${place.name} door offset`).toBeLessThan(1e-6);
    }
  });
});

describe("given every place's doors", () => {
  // mutation: sed -i 's/openX: frame.x(deep + face, hinge) - frame.x(deep, hinge),/openX: frame.x(deep - face, hinge) - frame.x(deep, hinge),/' src/game/world/openworld/interior-plan.ts
  it("when its door leaves are read, then each street doorway has a leaf shut along the face that swings into the room with a vestibule behind it, and a rowhome has a back door too", () => {
    const wrong: string[] = [];
    for (const place of furnished) {
      const doors = interiorDoors(place);
      const bays = Math.round(place.width / BAY_WIDTH);
      const street = doors.filter((door) => door.face === DOOR_FACE.street);
      const back = doors.filter((door) => door.face === DOOR_FACE.back);
      if (street.length !== bays * SHOPFRONT[place.interior!].length) wrong.push(`${place.name}: ${street.length} street doors`);
      if (back.length !== (place.interior === "rowhome" ? 1 : 0)) wrong.push(`${place.name}: ${back.length} back doors`);
      const outX = detCos(place.yaw);
      const outZ = -detSin(place.yaw);
      for (const door of doors) {
        const inward = -door.face * (door.openX * outX + door.openZ * outZ);
        const across = door.closedX * outX + door.closedZ * outZ;
        if (inward < 0.99 || Math.abs(across) > 1e-9 || door.width < 0.85) wrong.push(`${place.name}: leaf swings ${inward.toFixed(2)} inward, lies ${across.toFixed(2)} off the face, ${door.width.toFixed(2)} wide`);
        const room = door.vestibule;
        const behind = room === null ? null : -((room.x0 + room.x1) / 2 - door.x) * outX - ((room.z0 + room.z1) / 2 - door.z) * outZ;
        if ((door.face === DOOR_FACE.street) !== (behind !== null && behind > 0)) wrong.push(`${place.name}: vestibule ${behind}`);
      }
    }
    expect(wrong.slice(0, 3).join("; "), "doors").toBe("");
  });
});

describe("given every rowhome's stoop", () => {
  // mutation: sed -i 's/const across = doorAcross + (at === 0 ? -1 : 1) \* STOOP_SEAT_SPREAD;/const across = (at === 0 ? -1 : 1) * STOOP_SEAT_SPREAD;/' src/game/world/openworld/interior-plan.ts
  it("when its two stoop seats are read, then both sit on the stoop's steps either side of the door, on its third step, facing the street", () => {
    const off: string[] = [];
    for (const home of furnished.filter((place) => place.interior === "rowhome" && place.doorNode >= 0)) {
      for (let seat = 0; seat < home.stoopSeats!; seat++) {
        const dx = home.seats![seat * SEAT_STRIDE]! - home.doorX;
        const dz = home.seats![seat * SEAT_STRIDE + 1]! - home.doorZ;
        const out = dx * detCos(home.yaw) - dz * detSin(home.yaw);
        const along = dx * detSin(home.yaw) + dz * detCos(home.yaw);
        const height = home.seats![seat * SEAT_STRIDE + 3]!;
        if (Math.abs(along) > STOOP.width / 2 || out <= 0 || out >= STOOP.run || Math.abs(height - 3 * STOOP.rise) > 1e-6) off.push(`${home.name} seat ${seat}: ${along.toFixed(2)} along, ${out.toFixed(2)} out, ${height.toFixed(2)} up`);
      }
    }
    expect(off.slice(0, 3).join("; "), "stoop seats off the stoop").toBe("");
  });
});

/** A storey's nominal height (m), as the facade draws it above its ground band. */
const NOMINAL_STOREY = 3;

/** A plan's level `level` ceiling (m). */
const ceilingOf = (plan: InteriorPlan, level: number): number => ceilingOver(plan.floors, plan.topCeiling, level);

describe("given an interior of any storey count", () => {
  // mutation: sed -i 's/const floors = Array.from({ length: storeys }, (_, level)/const floors = Array.from({ length: storeys + 1 }, (_, level)/' src/game/world/openworld/interior-kinds.ts
  it("when it is planned, then it has a floor for every storey and a flight between each pair, none up from the top", () => {
    for (const { label, storeys, plan } of variants) {
      expect(plan.floors.length, `${label} floors`).toBe(storeys);
      expect(plan.stairs.map((flight) => flight.level).join(), `${label} flights, by the floor each climbs from`).toBe(Array.from({ length: storeys - 1 }, (_, level) => level).join());
      expect(plan.topCeiling, `${label} top ceiling over its top floor (m)`).toBeGreaterThan(plan.floors[storeys - 1]! + 2.4);
      for (let level = 1; level < storeys; level++) expect(plan.slabs.some((slab) => slab.y1 === plan.floors[level]), `${label} slab under floor ${level}`).toBe(true);
    }
  });

  // mutation: sed -i 's/    d.put("bed", level, FLAT_BED, 0.6, toStreet);//' src/game/world/openworld/interior-layouts.ts
  it("when a shop's floors above its own are read, then each is a flat with a bed and a kitchen, a rowhome's each have bedrooms, and the ground floors have none", () => {
    for (const { label, kind, storeys, plan } of variants) {
      for (let level = 0; level < storeys; level++) {
        const kinds = plan.furnishings.filter((piece) => piece.level === level).map((piece) => piece.kind);
        if (level === 0) expect(kinds.includes("bed"), `${label} ground floor has a bed`).toBe(false);
        else expect(kinds.includes("bed"), `${label} floor ${level} has a bed`).toBe(true);
        if (level > 0 && kind !== "rowhome") expect(kinds.includes("stove"), `${label} flat ${level} has a stove`).toBe(true);
      }
    }
  });

  // mutation: sed -i 's/export const STOREY = 3;/export const STOREY = 4;/' src/game/world/openworld/interior-kinds.ts
  it("when its floors are read, then each storey above the second is about as tall as a storey is, and every floor's room is at least a room high", () => {
    for (const { label, kind, storeys, plan } of variants) {
      for (let level = 2; level < storeys; level++) expect(Math.abs(plan.floors[level]! - plan.floors[level - 1]! - NOMINAL_STOREY), `${label} floor ${level} over the one below, off the nominal storey (m)`).toBeLessThan(0.1);
      for (let level = 0; level < storeys; level++) expect(ceilingOf(plan, level) - plan.floors[level]!, `${label} floor ${level} clear height`).toBeGreaterThan(2.5);
      expect(plan.floors[0], `${label} ground floor`).toBe(kind === "rowhome" ? ROWHOME_FLOOR_Y : 0.05);
    }
  });
});

describe("given the stairs of every interior at every storey count", () => {
  /** The floor a walker needs at a flight's head before the wall ahead (m): a step and a turn. */
  const MIN_LANDING = 0.5;

  // mutation: sed -i 's/const HEAD_LANDING = 0.55;/const HEAD_LANDING = 0.1;/' src/game/world/openworld/interior-layouts.ts (a flight above the ground floor's tops out against the back room's wall)
  it("when a walker reaches the head of each flight, then the floor there runs on at least a step and a turn before the wall ahead", () => {
    const short: string[] = [];
    for (const { label, plan } of variants) {
      for (const flight of plan.stairs) {
        const level = flight.level + 1;
        const floor = plan.floors[level]!;
        const head = flightHead(flight);
        const laneLeft = flight.across - flight.width / 2;
        const laneRight = flight.across + flight.width / 2;
        const ahead = plan.walls
          .filter((wall) => wall.level === level)
          .flatMap((wall) => wallBoxes(wall, floor, ceilingOf(plan, level)))
          .filter((box) => box.y1 - box.y0 > 1 && box.across0 < laneRight - 0.01 && box.across1 > laneLeft + 0.01 && (flight.dir === 1 ? box.deep0 >= head - 1e-6 : box.deep1 <= head + 1e-6));
        const landing = flight.dir === 1 ? Math.min(...ahead.map((box) => box.deep0)) - head : head - Math.max(...ahead.map((box) => box.deep1));
        if (landing < MIN_LANDING) short.push(`${label} flight up from ${flight.level}: ${landing.toFixed(2)} m`);
      }
    }
    expect(short.slice(0, 3).join("; "), "landings short of a step and a turn").toBe("");
  });

  // mutation: sed -i 's/const MAX_RISER = 0.19/const MAX_RISER = 0.3/' src/game/world/openworld/interior-kinds.ts (a 0.3 m riser)
  it("when each flight is climbed, then no step is higher than a walker climbs and its top tread is level with the floor above", () => {
    for (const { label, plan } of variants) {
      for (const flight of plan.stairs) {
        expect(flight.rise, `${label} riser of the flight from level ${flight.level}`).toBeLessThanOrEqual(MAX_RISER);
        const treads = stairBoxes(flight, plan.floors[flight.level]!);
        expect(treads[treads.length - 1]!.y1, `${label} top tread of the flight from level ${flight.level}`).toBeCloseTo(plan.floors[flight.level + 1]!, 9);
      }
    }
  });

  // mutation: sed -i 's/const flight = level % 2 === 1 ? d.stairsUp(level, UPPER_STAIR_FOOT, across)/const flight = level % 2 === 1 ? d.stairsUp(level, STAIR_FOOT, across)/' src/game/world/openworld/interior-layouts.ts (the flights stacked again)
  it("when a walker stands on any tread of any flight, then nothing solid is lower over it than a standing walker and a margin", () => {
    const short: string[] = [];
    for (const { label, plan } of variants) {
      const solidsOver: Box[] = [
        ...plan.slabs.map((slab): Box => ({ ...slab.rect, y0: slab.y0, y1: slab.y1 })),
        ...plan.stairs.flatMap((flight) => stairBoxes(flight, plan.floors[flight.level]!)),
        ...plan.furnishings.filter((piece) => FURNISHING[piece.kind].solid).map((piece): Box => ({ ...footprintOf(piece), y0: plan.floors[piece.level]! + piece.lift, y1: plan.floors[piece.level]! + piece.lift + piece.height })),
      ];
      for (const flight of plan.stairs) {
        for (const tread of stairBoxes(flight, plan.floors[flight.level]!)) {
          const footing = { deep0: tread.deep0 + 0.01, deep1: tread.deep1 - 0.01, across0: tread.across0 + 0.01, across1: tread.across1 - 0.01 };
          const above = solidsOver.filter((box) => box.y0 > tread.y1 + 1e-9 && overlap(footing, box) > 0);
          const clear = Math.min(...above.map((box) => box.y0 - tread.y1));
          if (clear < HEADROOM) short.push(`${label} level ${flight.level} tread at ${tread.deep0.toFixed(2)}: ${clear.toFixed(2)} m`);
        }
      }
    }
    expect(short.slice(0, 3).join("; "), "treads short of headroom").toBe("");
  });

  // mutation: sed -i '/d.spineWall(0, hallEdge + PARTITION \/ 2, PARLOUR_WALL, KITCHEN_WALL);/d' src/game/world/openworld/interior-layouts.ts
  it("when a rowhome's ground flight is looked at from the dining room, then a full-height wall closes its side along every tread, and a walker meets it as a solid", () => {
    const home = firstOf("rowhome");
    const plan = planInterior(home);
    const lower = plan.stairs.find((flight) => flight.level === 0)!;
    const side = lower.across + lower.width / 2;
    const floor = plan.floors[0]!;
    const ceiling = ceilingOf(plan, 0);
    const walls = plan.walls.filter((wall) => wall.level === 0).flatMap((wall) => wallBoxes(wall, floor, ceiling));
    const solids = interiorSolids(home);
    const open: string[] = [];
    for (const tread of stairBoxes(lower, floor)) {
      const middle = (tread.deep0 + tread.deep1) / 2;
      const closed = walls.some((box) => box.across0 >= side - 1e-6 && box.across0 <= side + PARTITION && box.deep0 <= middle && box.deep1 >= middle && box.y0 <= floor + 1e-6 && box.y1 >= ceiling - 1e-6);
      if (!closed) open.push(`plan open beside the tread at ${tread.deep0.toFixed(2)}`);
      const front = drawnHalf(home.depth) - middle;
      const across = side + PARTITION / 2;
      const x = home.x + front * detCos(home.yaw) + across * detSin(home.yaw);
      const z = home.z - front * detSin(home.yaw) + across * detCos(home.yaw);
      const y = floor + 1.5;
      if (!solids.some((solid) => x > solid.x0 && x < solid.x1 && z > solid.z0 && z < solid.z1 && y > solid.y0 && y < solid.y1)) open.push(`no solid beside the tread at ${tread.deep0.toFixed(2)}`);
    }
    expect(open.slice(0, 3).join("; "), "the stair's side toward the dining room").toBe("");
  });

  // mutation: sed -i '/  d.spineWall(0, partition, head - PARTITION, d.back, \[doorway(d.back - 0.45)\]);/d' src/game/world/openworld/interior-layouts.ts (a shop's service stair open to the shop)
  it("when a shop's service stair is looked at from the shop, then its side is walled the whole length of the flight but for a doorway at its foot, and its head is closed across", () => {
    for (const { label, kind, plan } of variants.filter((variant) => variant.kind !== "rowhome" && variant.storeys === MIN_STOREYS)) {
      const flight = plan.stairs.find((candidate) => candidate.level === 0)!;
      const head = flightHead(flight);
      const walls = plan.walls.filter((wall) => wall.level === 0 && !wall.shell);
      const partition = walls.find((wall) => wall.axis === "deep" && Math.abs(wall.fixed - (flight.across - Math.sign(flight.across) * (0.45 + PARTITION / 2))) < 1e-9);
      expect(partition, `${label} (${kind}) partition`).toBeDefined();
      expect(partition!.openings.length, `${label} doorways`).toBe(1);
      expect(partition!.from, `${label} partition starts at the head`).toBeLessThanOrEqual(head);
      expect(walls.some((wall) => wall.axis === "across" && Math.abs(wall.fixed - (head - PARTITION / 2)) < 1e-9), `${label} head closed across`).toBe(true);
    }
  });

  it("when the floor above a flight is read, then it has a hole over the flight and the hole ends where the top tread meets the floor", () => {
    for (const { label, plan } of variants) {
      for (const flight of plan.stairs) {
        const upper = plan.slabs.filter((slab) => slab.y1 === plan.floors[flight.level + 1]);
        const head = flightHead(flight);
        const near = flight.dir === 1 ? [head - 0.5, head - 0.1] : [head + 0.1, head + 0.5];
        const over = { deep0: near[0]!, deep1: near[1]!, across0: flight.across - 0.2, across1: flight.across + 0.2 };
        expect(upper.length, `${label} slab pieces over the flight from level ${flight.level}`).toBeGreaterThan(1);
        expect(upper.reduce((sum, slab) => sum + overlap(slab.rect, over), 0), `${label} slab under the stair head`).toBe(0);
      }
    }
  });
});

describe("given any interior's furniture and walls at any storey count", () => {
  const solidBoxes = (plan: InteriorPlan, level: number): Box[] => {
    const floor = plan.floors[level]!;
    const boxes = plan.walls.filter((wall) => wall.level === level).flatMap((wall) => wallBoxes(wall, floor, ceilingOf(plan, level)));
    return boxes.filter((box) => box.y1 - box.y0 > 1);
  };

  // mutation: sed -i 's/d.put("sofa", level, FLAT_LIVING, left + FURNISHING.sofa.depth \/ 2, toRight);/d.put("sofa", level, FLAT_LIVING, left + FURNISHING.sofa.depth \/ 2, toLeft);/' src/game/world/openworld/interior-layouts.ts (a sofa turned into the wall)
  it("when each solid piece is laid on its plan, then it clears every wall and every other solid piece of its level by at least a centimetre inside the room", () => {
    for (const { label, plan } of variants) {
      const clash: string[] = [];
      for (const [at, piece] of plan.furnishings.entries()) {
        if (!FURNISHING[piece.kind].solid || piece.lift > 0) continue;
        const rect = footprintOf(piece);
        const shrunk = { deep0: rect.deep0 + 0.01, deep1: rect.deep1 - 0.01, across0: rect.across0 + 0.01, across1: rect.across1 - 0.01 };
        for (const wall of solidBoxes(plan, piece.level)) if (overlap(shrunk, wall) > 0) clash.push(`${label} ${piece.kind}#${at} in a wall`);
        for (const other of plan.furnishings.slice(at + 1)) if (other.level === piece.level && FURNISHING[other.kind].solid && other.lift === 0 && overlap(shrunk, footprintOf(other)) > 0) clash.push(`${label} ${piece.kind}#${at} in ${other.kind}`);
        for (const flight of plan.stairs) {
          if (flight.level !== piece.level) continue;
          for (const tread of stairBoxes(flight, plan.floors[flight.level]!)) if (overlap(shrunk, tread) > 0) clash.push(`${label} ${piece.kind}#${at} on a tread`);
        }
      }
      expect(clash.slice(0, 4).join("; "), `${label} clashes`).toBe("");
    }
  });

  // mutation: sed -i 's/d.floor(level + 1, \[well\]);/d.floor(level + 1);/' src/game/world/openworld/interior-layouts.ts (no hole in the floor above a rowhome's flight)
  it("when a room's solid piece stands over the hole a flight's well leaves in a floor, then it does not: the well of every flight is clear of furniture", () => {
    for (const { label, plan } of variants) {
      const stray: string[] = [];
      for (const flight of plan.stairs) {
        const hole = plan.slabs.filter((slab) => slab.y1 === plan.floors[flight.level + 1]);
        const head = flightHead(flight);
        const probe = { deep0: Math.min(head, head - flight.dir * 0.4), deep1: Math.max(head, head - flight.dir * 0.4), across0: flight.across - 0.3, across1: flight.across + 0.3 };
        for (const piece of plan.furnishings) {
          if (piece.level !== flight.level + 1 || !FURNISHING[piece.kind].solid || piece.kind === "rail" || piece.lift > 0) continue;
          if (overlap(footprintOf(piece), probe) > 0) stray.push(`${label} ${piece.kind} over the head of the flight up from ${flight.level}`);
        }
        expect(hole.length, `${label} slab pieces over the flight from level ${flight.level}`).toBeGreaterThan(1);
      }
      expect(stray.slice(0, 3).join("; "), `${label} furniture at a flight's head`).toBe("");
    }
  });
});

describe("given the plan of an office", () => {
  // mutation: sed -i 's/^const OFFICE_LAMP_GRID = 3;/const OFFICE_LAMP_GRID = 1;/' src/game/world/openworld/interior-layouts.ts
  it("when it is laid out, then its ground floor has eleven ceiling lamps: nine over the open floor and one in each back room", () => {
    for (const storeys of STOREY_COUNTS) expect(planInterior({ ...firstOf("office"), storeys }).furnishings.filter((piece) => piece.kind === "lamp" && piece.level === 0).length, `office of ${storeys} storeys`).toBe(11);
  });
});
