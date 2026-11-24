import { describe, expect, it } from "vitest";
import { hypot2 } from "../../kernel/physics-core.js";
import { interiorSolids, planInterior } from "./interior-plan.ts";
import { layOutLots } from "./openworld-lots.ts";
import { buildOpenWorldMap } from "./openworld-map.ts";
import { AISLE_STRIDE, CLERK_SPOTS, SEAT_STRIDE, STAND_COLUMNS, STAND_SPOTS, type Place } from "./walk-graph.ts";

const map = buildOpenWorldMap(layOutLots());
/** A standing body's half-width (two bodies keep 0.6 m apart). */
const BODY_HALF = 0.3;
/** A sitter takes a stool's half (0.2 m) and a standing body's half-width more. */
const SITTER_CLEAR = 0.5;
/** What blocks a body: anything between these heights over the ground floor (m). */
const BODY_LOW = 0.1;
const BODY_HIGH = 1.7;
const EPSILON = 1e-4;

/** Every way a spot of `place` is too close to a solid or a seat, or (a buying lane or a clerk's) off the serving counter's length. */
function faults(place: Place): string[] {
  const floor = planInterior(place).floors[0]!;
  const solids = interiorSolids(place).filter((solid) => solid.y1 > floor + BODY_LOW && solid.y0 < floor + BODY_HIGH);
  const counter = place.counter!;
  const serving = solids.find((solid) => Math.abs(solid.y1 - counter[3]!) < EPSILON && hypot2(Math.max(solid.x0 - counter[0]!, 0, counter[0]! - solid.x1), Math.max(solid.z0 - counter[1]!, 0, counter[1]! - solid.z1)) < 1);
  const lengthAlongX = serving !== undefined && serving.x1 - serving.x0 > serving.z1 - serving.z0;
  const seats = place.seats ?? new Float32Array(0);
  const found: string[] = serving === undefined ? [`${place.name}: no serving counter beside its customer spot`] : [];
  const spots = place.standSpots!;
  for (let at = 0; at < spots.length; at += 2) {
    const [x, z] = [spots[at]!, spots[at + 1]!];
    const spot = at / 2;
    const kind = spot < STAND_COLUMNS ? "lane" : spot < STAND_COLUMNS + STAND_SPOTS ? "stand" : "clerk";
    for (const solid of solids) {
      const gap = hypot2(Math.max(solid.x0 - x, 0, x - solid.x1), Math.max(solid.z0 - z, 0, z - solid.z1));
      if (gap < BODY_HALF - EPSILON) found.push(`${place.name} ${kind} ${spot} is ${gap.toFixed(2)} m from a solid`);
    }
    for (let seat = 0; seat < seats.length; seat += SEAT_STRIDE) {
      if (seats[seat + 3]! > counter[3]!) continue;
      const gap = hypot2(seats[seat]! - x, seats[seat + 1]! - z);
      if (gap < SITTER_CLEAR - EPSILON) found.push(`${place.name} ${kind} ${spot} is ${gap.toFixed(2)} m from a seat`);
    }
    if (kind !== "stand" && serving !== undefined) {
      const along = lengthAlongX ? x : z;
      if (along < (lengthAlongX ? serving.x0 : serving.z0) - EPSILON || along > (lengthAlongX ? serving.x1 : serving.z1) + EPSILON) found.push(`${place.name} ${kind} ${spot} is past the counter's end`);
    }
  }
  return found;
}

describe("given every shop, coffee shop, bar and office of the neighbourhood with a serving counter", () => {
  const served = map.places.filter((place) => place.counter !== undefined);

  // mutation: sed -i 's/    (deep, across) => clearOf(boxes, deep, across, SPOT_CLEAR),/    () => true,/' src/game/world/openworld/interior-aisle.ts (spots ignore the furniture and walls)
  // mutation: sed -i 's/      if (alongside \&\& (along < side.alongMin || along > side.alongMax)) continue;//' src/game/world/openworld/interior-aisle.ts (lanes and clerks run past the counter)
  // mutation: sed -i 's/^const SPOT_SLIDE = CUSTOMER_REACH - SPOT_CLEAR;/const SPOT_SLIDE = 0;/' src/game/world/openworld/interior-aisle.ts (the clerks' galleys at Bodega Supreme and Kelly's have no floor: the map does not build)
  it("when its buying lanes, standing spots and clerks' spots are read, then each is a body's half-width clear of every wall and piece of furniture, off every seat, and the lanes and clerks face the counter", () => {
    expect([...new Set(served.map((place) => place.interior))].sort().join(" "), "control: the kinds with a counter").toBe("bar coffee office store");
    for (const place of served) expect(place.standSpots!.length, `spots of ${place.name}`).toBe(2 * (STAND_COLUMNS + STAND_SPOTS + CLERK_SPOTS));
    expect(served.flatMap(faults)).toEqual([]);
  });
});

/** Whether the straight leg from (ax, az) to (bx, bz) crosses the box (slab test). */
function legCrosses(solid: { x0: number; x1: number; z0: number; z1: number }, ax: number, az: number, bx: number, bz: number): boolean {
  let near = 0;
  let far = 1;
  for (const [from, along, low, high] of [[ax, bx - ax, solid.x0, solid.x1], [az, bz - az, solid.z0, solid.z1]] as const) {
    if (Math.abs(along) < 1e-9) {
      if (from < low || from > high) return false;
      continue;
    }
    near = Math.max(near, Math.min((low - from) / along, (high - from) / along));
    far = Math.min(far, Math.max((low - from) / along, (high - from) / along));
  }
  return near <= far;
}

describe("given the aisle of every shop, coffee shop, bar and office of the neighbourhood with a serving counter", () => {
  it("when each lane, standing spot and clerk's spot is walked to from the door, then no leg of the walk crosses a wall or a piece of furniture, the clerks' behind the counter included", () => {
    const found: string[] = [];
    for (const place of map.places.filter((entry) => entry.counter !== undefined)) {
      const floor = planInterior(place).floors[0]!;
      const solids = interiorSolids(place).filter((solid) => solid.y1 > floor + BODY_LOW && solid.y0 < floor + BODY_HIGH);
      const aisle = place.aisle!;
      const spots = place.standSpots!;
      for (let at = 0; at < spots.length; at += 2) {
        let node = 0;
        for (let other = 1; other * AISLE_STRIDE < aisle.length; other++) {
          if (hypot2(aisle[other * AISLE_STRIDE]! - spots[at]!, aisle[other * AISLE_STRIDE + 1]! - spots[at + 1]!) < hypot2(aisle[node * AISLE_STRIDE]! - spots[at]!, aisle[node * AISLE_STRIDE + 1]! - spots[at + 1]!)) node = other;
        }
        // The walk is the tree from the door down to her nearest node, then a straight last leg to the spot.
        const legs: number[][] = [[aisle[node * AISLE_STRIDE]!, aisle[node * AISLE_STRIDE + 1]!, spots[at]!, spots[at + 1]!]];
        for (let up = node; aisle[up * AISLE_STRIDE + 2]! >= 0; up = aisle[up * AISLE_STRIDE + 2]!) {
          const parent = aisle[up * AISLE_STRIDE + 2]!;
          legs.push([aisle[up * AISLE_STRIDE]!, aisle[up * AISLE_STRIDE + 1]!, aisle[parent * AISLE_STRIDE]!, aisle[parent * AISLE_STRIDE + 1]!]);
        }
        const spot = at / 2;
        const kind = spot < STAND_COLUMNS ? "lane" : spot < STAND_COLUMNS + STAND_SPOTS ? "stand" : "clerk";
        if (legs.some((leg) => solids.some((solid) => legCrosses(solid, leg[0]!, leg[1]!, leg[2]!, leg[3]!)))) found.push(`${place.name} ${kind} ${spot}: a leg of the walk from the door crosses a solid`);
      }
    }
    expect(found).toEqual([]);
  });
});
