import { describe, expect, it } from "vitest";
import { footprintOf, stairBoxes, wallBoxes } from "./interior-draft.ts";
import { FURNISHING, HEADROOM, MAX_RISER, PARTITION, ROWHOME_FLOOR_Y, SHOPFRONT, type Box, type InteriorPlan } from "./interior-kinds.ts";
import { interiorDoor, interiorSolids, interiorSpots, planInterior } from "./interior-plan.ts";
import { drawnHalf, STOOP } from "./openworld-facade-solids.ts";
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
      const { seats, stoopSeats } = interiorSpots(firstOf(kind));
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
      expect(interiorSpots(place).seats.length / SEAT_STRIDE - interiorSpots(place).stoopSeats, `${kind} indoor seats`).toBe(furniture);
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

describe("given every rowhome's stoop", () => {
  // mutation: sed -i 's/const across = doorAcross + (at === 0 ? -1 : 1) \* STOOP_SEAT_SPREAD;/const across = (at === 0 ? -1 : 1) * STOOP_SEAT_SPREAD;/' src/game/world/openworld/interior-plan.ts
  it("when its two stoop seats are read, then both sit on the stoop's steps either side of the door, on its third step, facing the street", () => {
    const off: string[] = [];
    for (const home of furnished.filter((place) => place.interior === "rowhome" && place.doorNode >= 0)) {
      for (let seat = 0; seat < home.stoopSeats!; seat++) {
        const dx = home.seats![seat * SEAT_STRIDE]! - home.doorX;
        const dz = home.seats![seat * SEAT_STRIDE + 1]! - home.doorZ;
        const out = dx * Math.cos(home.yaw) - dz * Math.sin(home.yaw);
        const along = dx * Math.sin(home.yaw) + dz * Math.cos(home.yaw);
        const height = home.seats![seat * SEAT_STRIDE + 3]!;
        if (Math.abs(along) > STOOP.width / 2 || out <= 0 || out >= STOOP.run || Math.abs(height - 3 * STOOP.rise) > 1e-6) off.push(`${home.name} seat ${seat}: ${along.toFixed(2)} along, ${out.toFixed(2)} out, ${height.toFixed(2)} up`);
      }
    }
    expect(off.slice(0, 3).join("; "), "stoop seats off the stoop").toBe("");
  });
});

describe("given the rowhome's stairs", () => {
  const plan = planInterior("rowhome", 5.6, 15);
  /** The floor a walker needs at a flight's head before the wall ahead (m): a step and a turn. */
  const MIN_LANDING = 0.5;

  // mutation: sed -i 's/const UPPER_BACK_WALL = 9.6;/const UPPER_BACK_WALL = 9.7;/' src/game/world/openworld/interior-layouts.ts (the upper flight runs to 0.42 m of the back wall)
  it("when a walker reaches the head of each flight, then the floor there runs on at least a step and a turn before the wall ahead", () => {
    for (const flight of plan.stairs) {
      const level = flight.level + 1;
      const floor = plan.floors[level]!;
      const ceiling = level + 1 < plan.floors.length ? plan.floors[level + 1]! - 0.25 : plan.topCeiling;
      const head = flight.deep0 + flight.steps * flight.run;
      const laneLeft = flight.across - flight.width / 2;
      const laneRight = flight.across + flight.width / 2;
      const ahead = plan.walls
        .filter((wall) => wall.level === level)
        .flatMap((wall) => wallBoxes(wall, floor, ceiling))
        .filter((box) => box.y1 - box.y0 > 1 && box.across0 < laneRight - 0.01 && box.across1 > laneLeft + 0.01 && box.deep0 >= head - 1e-6);
      const landing = Math.min(...ahead.map((box) => box.deep0)) - head;
      expect(landing, `floor past the head of the flight from level ${flight.level}`).toBeGreaterThanOrEqual(MIN_LANDING);
    }
  });

  // mutation: sed -i 's/const MAX_RISER = 0.19/const MAX_RISER = 0.3/' src/game/world/openworld/interior-kinds.ts (a 0.3 m riser)
  it("when each flight is climbed, then no step is higher than a walker climbs and its top tread is level with the floor above", () => {
    expect(plan.stairs.length, "flights").toBe(2);
    for (const flight of plan.stairs) {
      expect(flight.rise, `riser of the flight from level ${flight.level}`).toBeLessThanOrEqual(MAX_RISER);
      const treads = stairBoxes(flight, plan.floors[flight.level]!);
      expect(treads[treads.length - 1]!.y1, `top tread of the flight from level ${flight.level}`).toBeCloseTo(plan.floors[flight.level + 1]!, 9);
    }
  });

  // mutation: sed -i 's/const upper = d.stairsUp(1, UPPER_STAIR_FOOT, left + 0.45);/const upper = d.stairsUp(1, STAIR_FOOT, left + 0.45);/' src/game/world/openworld/interior-layouts.ts (the flights stacked again)
  it("when a walker stands on any tread of either flight, then nothing solid is lower over it than a standing walker and a margin", () => {
    const solidsOver: Box[] = [
      ...plan.slabs.map((slab): Box => ({ ...slab.rect, y0: slab.y0, y1: slab.y1 })),
      ...plan.stairs.flatMap((flight) => stairBoxes(flight, plan.floors[flight.level]!)),
      ...plan.furnishings.filter((piece) => FURNISHING[piece.kind].solid).map((piece): Box => ({ ...footprintOf(piece), y0: plan.floors[piece.level]! + piece.lift, y1: plan.floors[piece.level]! + piece.lift + piece.height })),
    ];
    const short: string[] = [];
    for (const flight of plan.stairs) {
      for (const tread of stairBoxes(flight, plan.floors[flight.level]!)) {
        const footing = { deep0: tread.deep0 + 0.01, deep1: tread.deep1 - 0.01, across0: tread.across0 + 0.01, across1: tread.across1 - 0.01 };
        const above = solidsOver.filter((box) => box.y0 > tread.y1 + 1e-9 && overlap(footing, box) > 0);
        const clear = Math.min(...above.map((box) => box.y0 - tread.y1));
        if (clear < HEADROOM) short.push(`level ${flight.level} tread at ${tread.deep0.toFixed(2)}: ${clear.toFixed(2)} m`);
      }
    }
    expect(short.slice(0, 3).join("; "), "treads short of headroom").toBe("");
  });

  // mutation: sed -i '/d.spineWall(0, hallEdge + PARTITION \/ 2, PARLOUR_WALL, KITCHEN_WALL);/d' src/game/world/openworld/interior-layouts.ts
  it("when the ground floor's flight is looked at from the dining room, then a full-height wall closes its side along every tread, and a walker meets it as a solid", () => {
    const lower = plan.stairs.find((flight) => flight.level === 0)!;
    const side = lower.across + lower.width / 2;
    const floor = plan.floors[0]!;
    const ceiling = plan.floors[1]! - 0.25;
    const walls = plan.walls.filter((wall) => wall.level === 0).flatMap((wall) => wallBoxes(wall, floor, ceiling));
    const home = firstOf("rowhome");
    const solids = interiorSolids(home);
    const open: string[] = [];
    for (const tread of stairBoxes(lower, floor)) {
      const middle = (tread.deep0 + tread.deep1) / 2;
      const closed = walls.some((box) => box.across0 >= side - 1e-6 && box.across0 <= side + PARTITION && box.deep0 <= middle && box.deep1 >= middle && box.y0 <= floor + 1e-6 && box.y1 >= ceiling - 1e-6);
      if (!closed) open.push(`plan open beside the tread at ${tread.deep0.toFixed(2)}`);
      const front = drawnHalf(home.depth) - middle;
      const across = side + PARTITION / 2;
      const x = home.x + front * Math.cos(home.yaw) + across * Math.sin(home.yaw);
      const z = home.z - front * Math.sin(home.yaw) + across * Math.cos(home.yaw);
      const y = floor + 1.5;
      if (!solids.some((solid) => x > solid.x0 && x < solid.x1 && z > solid.z0 && z < solid.z1 && y > solid.y0 && y < solid.y1)) open.push(`no solid beside the tread at ${tread.deep0.toFixed(2)}`);
    }
    expect(open.slice(0, 3).join("; "), "the stair's side toward the dining room").toBe("");
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
