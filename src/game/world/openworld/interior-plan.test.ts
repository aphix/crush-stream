import { describe, expect, it } from "vitest";
import { footprintOf, stairBoxes, wallBoxes } from "./interior-draft.ts";
import { FURNISHING, MAX_RISER, ROWHOME_FLOOR_Y, SHOPFRONT, type Box, type InteriorPlan } from "./interior-kinds.ts";
import { interiorCounter, interiorDoor, interiorSeats, interiorSolids, planInterior } from "./interior-plan.ts";
import { layOutLots } from "./openworld-lots.ts";
import { COUNTER_STRIDE, SEAT_STRIDE, type InteriorKind, type Place } from "./walk-graph.ts";

const lots = layOutLots();
const furnished = lots.places.filter((place) => place.interior !== undefined);
const firstOf = (kind: InteriorKind): Place => furnished.find((place) => place.interior === kind)!;
const KINDS: readonly InteriorKind[] = ["rowhome", "coffee", "bar", "office", "store"];

/** Seats a place should publish, counted by hand from what each layout puts in it (the stoop's two lead a rowhome's). */
const EXPECTED_SEATS: Record<InteriorKind, number> = { rowhome: 10, coffee: 11, bar: 24, office: 22, store: 0 };

function overlap(a: { deep0: number; deep1: number; across0: number; across1: number }, b: { deep0: number; deep1: number; across0: number; across1: number }): number {
  return Math.max(0, Math.min(a.deep1, b.deep1) - Math.max(a.deep0, b.deep0)) * Math.max(0, Math.min(a.across1, b.across1) - Math.max(a.across0, b.across0));
}

describe("given every kind of interior built for a place of the map", () => {
  // mutation: sed -i 's/d.put("stool", 0, 4.3 + stool \* 0.85, -3, toLeft)/void stool/' src/game/world/openworld/interior-layouts.ts (bar: 24 -> 16)
  it("when its seats are published, then there is one per seat of every piece of furniture, in x z yaw height rows", () => {
    for (const kind of KINDS) {
      const { seats, stoopSeats } = interiorSeats(firstOf(kind));
      expect(seats.length / SEAT_STRIDE, `${kind} seats`).toBe(EXPECTED_SEATS[kind]);
      expect(stoopSeats, `${kind} stoop seats`).toBe(kind === "rowhome" ? 2 : 0);
      for (let at = 0; at < seats.length; at++) expect(Number.isFinite(seats[at]!), `${kind} float ${at}`).toBe(true);
    }
  });

  it("when the seats of a plan are counted from its own furniture, then they equal what the place publishes", () => {
    for (const kind of KINDS) {
      const place = firstOf(kind);
      const plan = planInterior(kind, place.width, place.depth);
      const furniture = plan.furnishings.reduce((sum, piece) => sum + FURNISHING[piece.kind].seats, 0);
      expect(interiorSeats(place).seats.length / SEAT_STRIDE - interiorSeats(place).stoopSeats, `${kind} indoor seats`).toBe(furniture);
    }
  });

  // mutation: sed -i 's/serves: true, serveAt: -3.3/serveAt: -3.3/' src/game/world/openworld/interior-layouts.ts (bar loses its counter)
  it("when its counter spots are published, then a business has a customer's and a clerk's, facing each other across the counter top, and a home none", () => {
    for (const kind of KINDS) {
      const counter = interiorCounter(firstOf(kind));
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
      const inward = { x: -Math.round(Math.cos(place.yaw)), z: Math.round(Math.sin(place.yaw)) };
      const at = (alongX: number, alongZ: number) => ({ x: place.doorX + inward.x * 0.17 + alongX, z: place.doorZ + inward.z * 0.17 + alongZ });
      const hit = (point: { x: number; z: number }) => solids.some((solid) => point.x > solid.x0 && point.x < solid.x1 && point.z > solid.z0 && point.z < solid.z1 && floor + 1 > solid.y0 && floor + 1 < solid.y1);
      expect(hit(at(0, 0)), `${place.name} door is open`).toBe(false);
      const width = SHOPFRONT[place.interior!].find((opening) => opening.door)!.width;
      const alongFace = { x: Math.round(Math.abs(Math.sin(place.yaw))), z: Math.round(Math.abs(Math.cos(place.yaw))) };
      const beside = [1, -1].some((side) => hit(at(alongFace.x * side * (width / 2 + 0.05), alongFace.z * side * (width / 2 + 0.05))));
      expect(beside, `${place.name} has wall beside its door`).toBe(true);
    }
  });

  it("when the door is derived from the frontage again, then it is the place's own door point", () => {
    for (const place of furnished) {
      const door = interiorDoor(place.interior!, place.width, place.depth, place.x, place.z, place.yaw);
      expect(Math.hypot(door.x - place.doorX, door.z - place.doorZ), `${place.name} door offset`).toBeLessThan(1e-6);
    }
  });
});

describe("given the rowhome's stairs", () => {
  const plan = planInterior("rowhome", 5.6, 15);
  // mutation: sed -i 's/const MAX_RISER = 0.19/const MAX_RISER = 0.3/' src/game/world/openworld/interior-kinds.ts (a 0.3 m riser)
  it("when each flight is climbed, then no step is higher than a walker climbs and its top tread is level with the floor above", () => {
    expect(plan.stairs.length, "flights").toBe(2);
    for (const flight of plan.stairs) {
      expect(flight.rise, `riser of the flight from level ${flight.level}`).toBeLessThanOrEqual(MAX_RISER);
      const treads = stairBoxes(flight, plan.floors[flight.level]!);
      expect(treads[treads.length - 1]!.y1, `top tread of the flight from level ${flight.level}`).toBeCloseTo(plan.floors[flight.level + 1]!, 9);
    }
  });

  it("when the floor above a flight is read, then it has a hole over the flight and the hole ends where the top tread meets the floor", () => {
    for (const flight of plan.stairs) {
      const upper = plan.slabs.filter((slab) => slab.y1 === plan.floors[flight.level + 1]);
      const over = { deep0: flight.deep0 + flight.run * flight.steps - 0.5, deep1: flight.deep0 + flight.run * flight.steps - 0.1, across0: flight.across - 0.2, across1: flight.across + 0.2 };
      expect(upper.length, `slab pieces over the flight from level ${flight.level}`).toBeGreaterThan(1);
      expect(upper.reduce((sum, slab) => sum + overlap(slab.rect, over), 0), `slab under the stair head`).toBe(0);
    }
  });
});

describe("given any interior's furniture and walls", () => {
  const solidBoxes = (plan: InteriorPlan, level: number): Box[] => {
    const floor = plan.floors[level]!;
    const ceiling = level + 1 < plan.floors.length ? plan.floors[level + 1]! - 0.25 : plan.topCeiling;
    const boxes = plan.walls.filter((wall) => wall.level === level).flatMap((wall) => wallBoxes(wall, floor, ceiling));
    return boxes.filter((box) => box.y1 - box.y0 > 1);
  };

  // mutation: sed -i 's/d.put("sofa", 0, 3.3, -1.5, toStreet)/d.put("sofa", 0, 3.3, -1.5, toLeft)/' src/game/world/openworld/interior-layouts.ts (a sofa turned into the wall)
  it("when each solid piece is laid on its plan, then it clears every wall and every other solid piece of its level by at least a centimetre inside the room", () => {
    for (const kind of KINDS) {
      const place = firstOf(kind);
      const plan = planInterior(kind, place.width, place.depth);
      const clash: string[] = [];
      for (const [at, piece] of plan.furnishings.entries()) {
        if (!FURNISHING[piece.kind].solid || piece.lift > 0) continue;
        const rect = footprintOf(piece);
        const shrunk = { deep0: rect.deep0 + 0.01, deep1: rect.deep1 - 0.01, across0: rect.across0 + 0.01, across1: rect.across1 - 0.01 };
        for (const wall of solidBoxes(plan, piece.level)) if (overlap(shrunk, wall) > 0) clash.push(`${kind} ${piece.kind}#${at} in a wall`);
        for (const other of plan.furnishings.slice(at + 1)) if (other.level === piece.level && FURNISHING[other.kind].solid && other.lift === 0 && overlap(shrunk, footprintOf(other)) > 0) clash.push(`${kind} ${piece.kind}#${at} in ${other.kind}`);
      }
      expect(clash.slice(0, 4).join("; "), `${kind} clashes`).toBe("");
    }
  });
});
