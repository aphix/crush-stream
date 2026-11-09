import { describe, expect, it } from "vitest";
import { detCos, detSin } from "../kernel/physics-core.js";
import { PREFAB } from "./constants.ts";
import { NO_FLOOR } from "./ground.ts";
import { type Placed, propColliders } from "./placements.ts";
import { flightHeightAt, flightsOf, isFlight, StairField } from "./stairs.ts";

/** The stair kit's tread depth (m): a flight is cut into as many of them as its length holds. */
const STAIR_TREAD = 0.28;
const LENGTH = 1.12;
const WIDTH = 1.6;
const RISE = 0.72;
const TREADS = Math.round(LENGTH / STAIR_TREAD);
/** A turn that is neither a quarter nor a half: the flight's frame is not the world's. */
const YAW = 0.7;

function flightProp(x: number, z: number, yaw: number, stairs: boolean): Placed {
  return { prefab: PREFAB.invisibleWall, x, y: 0, z, yaw, sx: LENGTH, sy: RISE, sz: WIDTH, ...(stairs ? { stairs: true as const } : {}) };
}

/** The world point `along` m from the flight's middle toward its low end and `across` m sideways, for a flight at (x, z) turned `yaw`. */
function at(x: number, z: number, yaw: number, along: number, across: number): { x: number; z: number } {
  return { x: x + detCos(yaw) * along + detSin(yaw) * across, z: z - detSin(yaw) * along + detCos(yaw) * across };
}

describe("given a flight of stairs placed as a prop, its top falling from the local -x end to the +x end", () => {
  const placed = [flightProp(10, -4, YAW, true)];
  const flight = flightsOf(propColliders(placed), placed)[0]!;

  // mutation: sed -i 's/Math.ceil(climbed \* flight.treads)/Math.floor(climbed * flight.treads)/' src/game/world/stairs.ts
  it("when each tread's middle is read, then its height is its riser times its number, the highest at the -x end", () => {
    for (let tread = 1; tread <= TREADS; tread++) {
      const point = at(10, -4, YAW, LENGTH / 2 - (tread - 0.5) * STAIR_TREAD, 0.3);
      expect(flightHeightAt(flight, point.x, point.z), `tread ${tread} from the low end (m)`).toBeCloseTo((RISE * tread) / TREADS, 9);
    }
  });

  it("when a point is past either end or beside the flight, then there is no floor", () => {
    for (const [along, across] of [[LENGTH / 2 + 0.01, 0], [-LENGTH / 2 - 0.01, 0], [0, WIDTH / 2 + 0.01], [0, -WIDTH / 2 - 0.01]] as const) {
      const point = at(10, -4, YAW, along, across);
      expect(flightHeightAt(flight, point.x, point.z), `at ${along}, ${across}`).toBe(NO_FLOOR);
    }
  });

  it("when the props are sorted, then only the solid box with stairs is a flight, however many others stand about it", () => {
    const mixed = [flightProp(0, 0, 0, false), flightProp(5, 5, 0, true), flightProp(9, 9, 0, false)];
    const colliders = propColliders(mixed);
    expect(colliders.filter((c) => isFlight(c, mixed)).length, "flights").toBe(1);
    expect(flightsOf(colliders, mixed).length, "flights listed").toBe(1);
  });
});

describe("given flights standing across the grid's cell edges", () => {
  // mutation: sed -i 's/for (let cx = cellOf(flight.x - reach); cx <= cellOf(flight.x + reach); cx++)/for (let cx = cellOf(flight.x); cx <= cellOf(flight.x); cx++)/' src/game/world/stairs.ts
  it("when each flight is read through the field at points on either side of an edge, then the field answers what the flight does", () => {
    const placed = [flightProp(7.9, 0, 0, true), flightProp(-0.3, 15.9, 1.1, true), flightProp(40, 40, 3, true)];
    const flights = flightsOf(propColliders(placed), placed);
    const field = new StairField(flights);
    for (const [index, flight] of flights.entries()) {
      for (const along of [-0.4, -0.1, 0.1, 0.4]) {
        const point = at(flight.x, flight.z, flight.yaw, along, 0);
        expect(field.heightAt(point.x, point.z), `flight ${index} at ${along}`).toBe(flightHeightAt(flight, point.x, point.z));
        expect(field.heightAt(point.x, point.z), `flight ${index} at ${along} is a floor`).not.toBe(NO_FLOOR);
      }
    }
    expect(field.heightAt(20, 20), "open ground").toBe(NO_FLOOR);
  });
});
