import { describe, expect, it } from "vitest";
import { detCos, detSin } from "../../kernel/physics-core.js";
import { DOOR, type Frontage, homeFrontages, STOOP, stoopStepRange } from "./openworld-facade-solids.ts";
import { layOutLots } from "./openworld-lots.ts";
import { buildOpenWorldMap } from "./openworld-map.ts";
import { Stoops } from "./openworld-stoops.ts";
import { PLACE_KIND } from "./walk-graph.ts";

/** A house at (10, 20) whose front looks along (cos yaw, -sin yaw): not a tidy angle, so a swapped axis shows. */
const HOUSE: Frontage = { x: 10, z: 20, yaw: 0.9, depth: 10, style: "federal", storeys: 3, variant: 0 };
const NEIGHBOUR: Frontage = { x: 10 + 5.6 * detSin(0.9), z: 20 + 5.6 * detCos(0.9), yaw: 0.9, depth: 10, style: "federal", storeys: 3, variant: 1 };
const TREAD_MIDDLE = 0.5;
const PERSON = 0;

/** The world point `out` m out from the facade and `across` m from the door's middle (toward the lot's +u) of `house`. */
function pointAt(house: Frontage, out: number, across: number): { x: number; z: number } {
  return { x: house.x + detCos(house.yaw) * out + detSin(house.yaw) * (DOOR.across + across), z: house.z - detSin(house.yaw) * out + detCos(house.yaw) * (DOOR.across + across) };
}

/** The lift of `stoops` at the point `out`, `across` of `house`. */
function liftAt(stoops: Stoops, house: Frontage, out: number, across = 0): number {
  const point = pointAt(house, out, across);
  const feetY = new Float32Array([-1]);
  stoops.liftFeet(new Float32Array([point.x]), new Float32Array([point.z]), feetY, PERSON);
  return feetY[0]!;
}

describe("given a rowhome with its stoop", () => {
  const stoops = new Stoops([HOUSE]);

  // mutation: sed -i 's/riser < STOOP.steps; riser++/riser < STOOP.steps - 1; riser++/' src/game/world/openworld/openworld-stoops.ts
  it("when she stands at the door, then she stands at the sill's height, and on the landing too", () => {
    expect(liftAt(stoops, HOUSE, 0)).toBeCloseTo(STOOP.sill, 4);
    expect(liftAt(stoops, HOUSE, STOOP.landing * TREAD_MIDDLE)).toBeCloseTo(STOOP.sill, 4);
  });

  // mutation: sed -i 's/lift += STOOP.rise \* climbed/lift += STOOP.rise * 0.5 * climbed/' src/game/world/openworld/openworld-stoops.ts
  it.each([1, 2, 3, 4])("when she stands in the middle of step %i's tread, then she stands at that tread's height, between the street's and the sill's", (step) => {
    const range = stoopStepRange(step);
    const height = liftAt(stoops, HOUSE, (range.near + range.far) / 2);
    expect(height).toBeCloseTo(range.top, 4);
    expect(height).toBeGreaterThan(0);
    expect(height).toBeLessThan(STOOP.sill);
  });

  // mutation: sed -i 's/out > STOOP.run + RISER_EASE \/ 2/out > STOOP.run + 1/; s/(STOOP.run - riser/(STOOP.run + 1 - riser/' src/game/world/openworld/openworld-stoops.ts
  it("when she stands a step past the bottom one, then she stands at the street's height", () => {
    expect(liftAt(stoops, HOUSE, STOOP.run + STOOP.tread)).toBe(0);
  });

  // mutation: sed -i 's/const RISER_EASE = 0.14;/const RISER_EASE = 0.0001;/' src/game/world/openworld/openworld-stoops.ts
  it("when she goes down from the door to the street, then her height only falls, no more than a little at a time", () => {
    let before = liftAt(stoops, HOUSE, -0.1);
    for (let out = -0.1; out < STOOP.run + 0.4; out += 0.005) {
      const now = liftAt(stoops, HOUSE, out);
      expect(now, `at ${out.toFixed(3)} m out`).toBeLessThanOrEqual(before + 1e-6);
      expect(before - now, `at ${out.toFixed(3)} m out`).toBeLessThan(0.012);
      before = now;
    }
  });

  // mutation: sed -i 's/Math.abs(across) > STOOP.width \/ 2/Math.abs(across) > 5/' src/game/world/openworld/openworld-stoops.ts
  it("when she stands beside the stoop, then she stands at the street's height, and she is on it up to its width", () => {
    expect(liftAt(stoops, HOUSE, 1, STOOP.width / 2 + 0.05)).toBe(0);
    expect(liftAt(stoops, HOUSE, 1, -(STOOP.width / 2 + 0.05))).toBe(0);
    expect(liftAt(stoops, HOUSE, 0.25, STOOP.width / 2 - 0.05)).toBeCloseTo(STOOP.sill, 4);
  });

  // mutation: sed -i 's/Math.abs(across) > STOOP.width \/ 2/Math.abs(across) > 5/' src/game/world/openworld/openworld-stoops.ts
  it("when she stands at the bay, not at the door, then she stands at the street's height", () => {
    expect(liftAt(stoops, HOUSE, 0.3, -DOOR.across - 0.9)).toBe(0);
  });

  // mutation: sed -i 's/return this.doors\[from\] === 1 || this.doors\[to\] === 1;/return true;/' src/game/world/openworld/openworld-stoops.ts
  it("when a walk has a door's node at either end, then it leads to the door, and a walk between two other nodes does not", () => {
    const doored = new Stoops([HOUSE], [3, 9]);
    expect(doored.leadsToDoor(3, 5), "out of the door").toBe(true);
    expect(doored.leadsToDoor(5, 9), "into the door").toBe(true);
    expect(doored.leadsToDoor(5, 6), "along the sidewalk").toBe(false);
    expect(doored.leadsToDoor(40, 41), "nodes beyond the doors' own").toBe(false);
    expect(stoops.leadsToDoor(3, 5), "no doors given").toBe(false);
  });
});

describe("given a street with two rowhomes side by side and a house with no stoop", () => {
  // mutation: sed -i 's/Math.abs(across) > STOOP.width \/ 2/Math.abs(across) > 5/' src/game/world/openworld/openworld-stoops.ts
  it("when she stands at one's door, then she is lifted to its sill only, and the other's stoop does not reach her", () => {
    const stoops = new Stoops([HOUSE, NEIGHBOUR]);
    expect(liftAt(stoops, HOUSE, 0.25)).toBeCloseTo(STOOP.sill, 4);
    expect(liftAt(stoops, NEIGHBOUR, 0.25)).toBeCloseTo(STOOP.sill, 4);
    const between = pointAt(HOUSE, 0.25, 2.8);
    const feetY = new Float32Array([-1]);
    stoops.liftFeet(new Float32Array([between.x]), new Float32Array([between.z]), feetY, PERSON);
    expect(feetY[0], "the pier between the two stoops").toBe(0);
  });

  // mutation: sed -i 's/    if (houses === undefined) return;/    if (houses === undefined) { feetY[at] = STOOP.sill; return; }/' src/game/world/openworld/openworld-stoops.ts
  it("when there is no stoop, then there are no steps: she stands at the street's height wherever she stands", () => {
    const none = new Stoops([]);
    expect(liftAt(none, HOUSE, 0)).toBe(0);
    expect(liftAt(none, HOUSE, 1)).toBe(0);
  });
});

describe("given the open world's rowhomes as the map lays them out", () => {
  const map = buildOpenWorldMap(layOutLots());
  const playable = map.places.filter((place) => place.doorNode >= 0);
  const stoops = new Stoops(homeFrontages(playable));
  const homes = playable.filter((place) => place.kind === PLACE_KIND.home && place.interior === "rowhome");
  const { nodeX, nodeZ, edgeStart, edgeTo } = map.graph;

  /** The lift (m) at the point `metres` along the first edge out of `node` (0: the node itself), from the spur's own direction. */
  function liftAlongSpur(node: number, metres: number): number {
    const to = edgeTo[edgeStart[node]!]!;
    const dx = nodeX[to]! - nodeX[node]!;
    const dz = nodeZ[to]! - nodeZ[node]!;
    const length = Math.sqrt(dx * dx + dz * dz);
    const feetY = new Float32Array([-1]);
    stoops.liftFeet(new Float32Array([nodeX[node]! + (dx / length) * metres]), new Float32Array([nodeZ[node]! + (dz / length) * metres]), feetY, PERSON);
    return feetY[0]!;
  }

  // mutation: sed -i 's/riser < STOOP.steps; riser++/riser < STOOP.steps - 1; riser++/' src/game/world/openworld/openworld-stoops.ts
  it("when a resident leaves any rowhome's door node, then she stands at the sill's height, and the way to the sidewalk goes down to the street's height within the stoop's run", () => {
    expect(homes.length, "rowhomes inside the walls").toBeGreaterThan(10);
    for (const home of homes) {
      expect(liftAlongSpur(home.doorNode, 0), `${home.name}'s door`).toBeCloseTo(STOOP.sill, 1);
      expect(liftAlongSpur(home.doorNode, 0.3), `${home.name}'s landing`).toBeCloseTo(STOOP.sill, 1);
      expect(liftAlongSpur(home.doorNode, STOOP.run + STOOP.tread), `${home.name}'s street`).toBe(0);
    }
  });

  // mutation: sed -i 's/ && place.interior === "rowhome"//' src/game/world/openworld/openworld-facade-solids.ts
  it("when a resident leaves a home that has no stoop (the lofts), then she is at the street's height at its door and on the way out", () => {
    const lofts = playable.filter((place) => place.kind === PLACE_KIND.home && place.interior !== "rowhome");
    expect(lofts.length, "homes without a stoop inside the walls").toBeGreaterThan(0);
    expect(homeFrontages(lofts), "no stoop is laid for them").toHaveLength(0);
    for (const home of lofts) {
      expect(liftAlongSpur(home.doorNode, 0), `${home.name}'s door`).toBe(0);
      expect(liftAlongSpur(home.doorNode, 0.3), `${home.name}'s landing`).toBe(0);
    }
  });
});
