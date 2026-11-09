import { describe, expect, it } from "vitest";
import { detCos, detSin } from "../../kernel/physics-core.js";
import { assertSameDigest } from "../../vehicle/test-support.ts";
import { PREFAB } from "../constants.ts";
import { facadeSolidProps } from "./openworld-facade-solids.ts";
import { ASSET, FRONTAGE_KITS, FURNITURE_GAP, KIT_SLIDE, LAMP_CLEARANCE, QUARTER_TURN, TREE_CROWN_CLEARANCE } from "./openworld-fabric-constants.ts";
import { fabricProps } from "./openworld-fabric.ts";
import { allFaces, assetIndex, cornersOf, fabricCourse, inStrip, onFace, roadDepth } from "./openworld-fabric.test-util.ts";
import { sidesOf, type BlockSide } from "./openworld-sides.ts";

const { lots, course, track, graph, everything } = fabricCourse();
const geometry = lots.geometry;
const faces = allFaces(lots);
/** The road's own paint: every other asset the fabric lays is furniture beside it. */
const ROAD_PAINT: readonly string[] = [ASSET.manhole, ASSET.crosswalk, ASSET.drain];
const kit = course.props.filter((prop): prop is typeof prop & { asset: string } => prop.asset !== undefined && !ROAD_PAINT.includes(prop.asset));

/** A decal is on a crossing leg's line within this (m). */
const ON_LINE = 0.01;
/** Slack (m) on a decal's coordinates: the walk graph stores float32. */
const COORDINATE_SLACK = 1e-4;
/** A loop corner's round is within this (m) of its apex: no sign or drain stands that near one. */
const LOOP_CORNER_REACH = 12;

type Leg = { ax: number; az: number; bx: number; bz: number };

/** The crossing edges of the walk graph, each once. */
function crossingLegs(): Leg[] {
  const legs: Leg[] = [];
  for (let node = 0; node < graph.nodeX.length; node++) {
    for (let edge = graph.edgeStart[node]!; edge < graph.edgeStart[node + 1]!; edge++) {
      const other = graph.edgeTo[edge]!;
      if (graph.edgeCrossing[edge] === 1 && other > node) legs.push({ ax: graph.nodeX[node]!, az: graph.nodeZ[node]!, bx: graph.nodeX[other]!, bz: graph.nodeZ[other]! });
    }
  }
  return legs;
}

function distanceToLeg(x: number, z: number, leg: Leg): number {
  const lengthSquared = (leg.bx - leg.ax) ** 2 + (leg.bz - leg.az) ** 2;
  const share = Math.max(0, Math.min(1, ((x - leg.ax) * (leg.bx - leg.ax) + (z - leg.az) * (leg.bz - leg.az)) / lengthSquared));
  return Math.hypot(x - (leg.ax + share * (leg.bx - leg.ax)), z - (leg.az + share * (leg.bz - leg.az)));
}

/** The furniture pieces of `asset` standing in `side`'s strip between `from` and `to` along it. */
function standingOn(asset: string, side: BlockSide, from: number, to: number): typeof kit {
  const held = kit.filter((prop) => prop.asset === asset && inStrip(side, lots, prop.x, prop.z, 0));
  return held.filter((prop) => onFace(side, prop.x, prop.z).along >= from && onFace(side, prop.x, prop.z).along <= to);
}

describe("given the street's marked crossings", () => {
  const decals = everything.filter((prop) => prop.asset === assetIndex(ASSET.crosswalk));
  const legs = crossingLegs();
  const segments = (geometry.rows + 1) * geometry.columns + (geometry.columns + 1) * geometry.rows;

  // mutation: sed -i 's/graph.edgeCrossing\[edge\] === 0 || other < node/other < node/' src/game/world/openworld/openworld-fabric.ts
  it("when every placed crosswalk is read, then each lies on a crossing of the walk graph and the crossings' decals cover the carriageway", () => {
    expect(legs.length, "crossings in the walk graph (two per street segment)").toBe(2 * segments);
    expect(decals.filter((decal) => !legs.some((leg) => distanceToLeg(decal.x, decal.z, leg) < ON_LINE)).length, "crosswalk decals off every crossing").toBe(0);
    for (const leg of legs) {
      const mine = decals.filter((decal) => distanceToLeg(decal.x, decal.z, leg) < ON_LINE);
      expect(
        mine.reduce((sum, decal) => sum + decal.sx, 0),
        `width laid across the crossing at (${leg.ax.toFixed(1)}, ${leg.az.toFixed(1)}) (m)`,
      ).toBeCloseTo(geometry.carriageway, 6);
      expect((mine.reduce((sum, decal) => sum + decal.x, 0) / mine.length) * 2, "the decals centre on the crossing's middle (x)").toBeCloseTo(leg.ax + leg.bx, 3);
      expect((mine.reduce((sum, decal) => sum + decal.z, 0) / mine.length) * 2, "the decals centre on the crossing's middle (z)").toBeCloseTo(leg.az + leg.bz, 3);
    }
  });

  // mutation: sed -i 's/alongX ? 0 : QUARTER_TURN/alongX ? QUARTER_TURN : 0/' src/game/world/openworld/openworld-fabric.ts
  it("when a crossing's decals are read, then their bars run with the street being crossed", () => {
    for (const decal of decals) {
      const leg = legs.find((candidate) => distanceToLeg(decal.x, decal.z, candidate) < ON_LINE)!;
      const alongX = Math.abs(leg.az - leg.bz) < ON_LINE;
      expect(decal.yaw, `yaw of a decal on a leg along ${alongX ? "x" : "z"}`).toBeCloseTo(alongX ? 0 : QUARTER_TURN, 9);
    }
  });
});

describe("given the street's manhole covers", () => {
  const covers = everything.filter((prop) => prop.asset === assetIndex(ASSET.manhole));
  const streets = [
    ...geometry.streetZ.flatMap((fixed) => geometry.streetX.slice(1).map((to, index) => ({ alongX: true, fixed, from: geometry.streetX[index]!, to }))),
    ...geometry.streetX.flatMap((fixed) => geometry.streetZ.slice(1).map((to, index) => ({ alongX: false, fixed, from: geometry.streetZ[index]!, to }))),
  ];

  // mutation: sed -i 's/row + 1 < geometry.streetZ.length/row + 2 < geometry.streetZ.length/' src/game/world/openworld/openworld-fabric.ts
  // mutation: sed -i 's/const lane = geometry.travelLane \/ 2;/const lane = geometry.travelLane;/' src/game/world/openworld/openworld-fabric.ts
  // mutation: sed -i 's/, roadDecals: \[\] }/ }/' src/game/world/openworld/openworld-course.ts
  it("when each street segment is read, then it holds one cover, in the middle of a travel lane, and none lies elsewhere", () => {
    for (const street of streets) {
      const held = covers.filter((cover) => {
        const along = street.alongX ? cover.x : cover.z;
        const across = (street.alongX ? cover.z : cover.x) - street.fixed;
        return along > street.from && along < street.to && Math.abs(across) <= geometry.carriageway / 2;
      });
      const label = `segment ${street.alongX ? "along x" : "along z"} at ${street.fixed.toFixed(1)} from ${street.from.toFixed(1)} to ${street.to.toFixed(1)}`;
      expect(held.length, `covers on ${label}`).toBe(1);
      const across = (street.alongX ? held[0]!.z : held[0]!.x) - street.fixed;
      expect(Math.abs(across), `${label}: the cover's distance from the centre line (m)`).toBeCloseTo(geometry.travelLane / 2, 6);
    }
    expect(covers.length, "covers in all").toBe(streets.length);
  });
});

describe("given the street furniture in the furniture strips", () => {
  // mutation: sed -i 's/const NEAR_CURB = 0.3;/const NEAR_CURB = 0;/' src/game/world/openworld/openworld-fabric-constants.ts
  it("when every piece's four footprint corners are read, then all lie in a furniture strip (a corner's sidewalk counting) and none on the road", () => {
    const outside = kit.filter((prop) => !cornersOf(prop).every(([x, z]) => faces.some((side) => inStrip(side, lots, x, z, geometry.sidewalk))));
    expect(kit.length, "pieces of furniture").toBeGreaterThan(90);
    expect(outside.slice(0, 3).map((prop) => `${prop.asset} at ${prop.x.toFixed(2)}, ${prop.z.toFixed(2)}`).join("; "), "pieces outside a strip").toBe("");
  });

  // mutation: sed -i 's/to > lane.taken\[index\]!) return false;/to > lane.taken[index]!) continue;/' src/game/world/openworld/openworld-fabric.ts
  it("when each face's strip is read, then no piece overlaps a lamp, a street tree or another piece, and each keeps the gap", () => {
    const overlaps: string[] = [];
    for (const side of faces) {
      const spans = kit.flatMap((prop) => {
        const corners = cornersOf(prop);
        if (!corners.every(([x, z]) => inStrip(side, lots, x, z, 0))) return [];
        const alongs = corners.map(([x, z]) => onFace(side, x, z).along);
        return [{ asset: prop.asset, from: Math.min(...alongs), to: Math.max(...alongs) }];
      });
      const fixed = course.props.filter((prop) => (prop.prefab === PREFAB.lamp || prop.prefab === PREFAB.tree) && inStrip(side, lots, prop.x, prop.z, 0));
      for (const [index, span] of spans.entries()) {
        for (const other of spans.slice(index + 1)) if (span.from < other.to + FURNITURE_GAP - 1e-6 && span.to + FURNITURE_GAP - 1e-6 > other.from) overlaps.push(`${span.asset} and ${other.asset}`);
        for (const post of fixed) {
          const along = onFace(side, post.x, post.z).along;
          const reach = post.prefab === PREFAB.lamp ? LAMP_CLEARANCE : TREE_CROWN_CLEARANCE;
          if (span.from < along + reach && span.to > along - reach) overlaps.push(`${span.asset} and a ${post.prefab}`);
        }
      }
    }
    expect(overlaps.slice(0, 3).join("; "), "overlapping pieces").toBe("");
  });
});

describe("given the hydrants, the businesses' frontages and the bus stop", () => {
  // mutation: sed -i 's/for (const faces of lanes) {/for (const faces of lanes.slice(1)) {/' src/game/world/openworld/openworld-fabric.ts
  it("when each block face is read, then exactly one hydrant stands in its strip", () => {
    for (const side of faces) expect(standingOn(ASSET.hydrant, side, side.start, side.start + side.length).length, `hydrants on the ${side.side} face at ${side.fixed.toFixed(1)}`).toBe(1);
  });

  // mutation: sed -i 's/for (const \[slot, item\] of kit.entries()) {/for (const [slot, item] of [].entries()) {/' src/game/world/openworld/openworld-fabric.ts
  it("when each business and the bus stop are read, then some of their kind's furniture stands in the strip within reach of the door, and the shelter stands at the stop", () => {
    let businesses = 0;
    for (const [index, place] of lots.places.entries()) {
      const items = FRONTAGE_KITS[place.kind];
      const link = lots.links.find((candidate) => candidate.place === index);
      if (items === undefined || link === undefined || link.side === null || index >= lots.backdropStart) continue;
      const side = sidesOf(lots.blocks[link.block]!, geometry).find((candidate) => candidate.side === link.side)!;
      const door = onFace(side, place.doorX, place.doorZ).along;
      const reach = Math.max(...items.map((item) => Math.abs(item.offset))) + KIT_SLIDE;
      const held = items.flatMap((item) => standingOn(item.asset, side, door - reach, door + reach));
      expect(held.length, `${place.name}'s furniture`).toBeGreaterThan(0);
      if (place.storeys > 0) businesses++;
      const shelter = standingOn(ASSET.busShelter, side, door - COORDINATE_SLACK, door + COORDINATE_SLACK);
      expect(shelter.length, `bus shelters at ${place.name}`).toBe(items.some((item) => item.asset === ASSET.busShelter) ? 1 : 0);
    }
    expect(businesses, "businesses read").toBeGreaterThan(20);
  });
});

describe("given the facade kit's solid boxes (stoop steps, bay flanks)", () => {
  const boxes = facadeSolidProps(lots);

  // mutation: sed -i 's/const NEAR_CURB = 0.3;/const NEAR_CURB = 2.8;/' src/game/world/openworld/openworld-fabric-constants.ts
  it("when the boxes are read, then no piece of furniture has a footprint corner inside one", () => {
    const inside = kit.filter((prop) =>
      cornersOf(prop).some(([x, z]) =>
        boxes.some((box) => {
          const dx = x - box.x;
          const dz = z - box.z;
          return Math.abs(dx * detCos(box.yaw) - dz * detSin(box.yaw)) <= box.size[0] / 2 && Math.abs(dx * detSin(box.yaw) + dz * detCos(box.yaw)) <= box.size[2] / 2;
        }),
      ),
    );
    expect(boxes.length, "boxes read").toBeGreaterThan(100);
    expect(inside.slice(0, 3).map((prop) => `${prop.asset} at ${prop.x.toFixed(2)}, ${prop.z.toFixed(2)}`).join("; "), "pieces inside a box").toBe("");
  });
});

describe("given the street-name signs and the storm drains at the block corners", () => {
  const signs = kit.filter((prop) => prop.asset === ASSET.nameSign);
  const drains = course.props.filter((prop) => prop.asset === ASSET.drain);
  const apexes = [-1, 1].flatMap((signX) => [-1, 1].map((signZ) => ({ x: signX * geometry.streetX[geometry.streetX.length - 1]!, z: signZ * geometry.streetZ[geometry.streetZ.length - 1]! })));

  // mutation: sed -i 's/if (isLoopCorner(block, signX, signZ, geometry)) continue;//' src/game/world/openworld/openworld-fabric.ts
  it("when the corners are read, then signs and drains stand at many of them and none within reach of the loop's rounded corners", () => {
    expect(signs.length, "signs").toBeGreaterThan(10);
    expect(drains.length, "drains").toBeGreaterThan(10);
    for (const prop of [...signs, ...drains]) {
      for (const apex of apexes) expect(Math.hypot(prop.x - apex.x, prop.z - apex.z), `${prop.asset} at ${prop.x.toFixed(1)}, ${prop.z.toFixed(1)} from a loop corner (m)`).toBeGreaterThan(LOOP_CORNER_REACH);
    }
  });

  // mutation: sed -i 's/geometry.sidewalk + DRAIN_PAST_CURB/geometry.sidewalk - DRAIN_PAST_CURB/' src/game/world/openworld/openworld-fabric.ts
  it("when a drain's four corners are read, then each lies on a road, in the gutter", () => {
    for (const drain of drains) for (const [x, z] of cornersOf({ ...drain, asset: ASSET.drain })) expect(roadDepth(track, x, z), `drain at ${drain.x.toFixed(1)}, ${drain.z.toFixed(1)}: depth into the road (m)`).toBeGreaterThan(0);
  });
});

describe("given the course's road paint and its fabric", () => {
  // mutation: sed -i 's/wall: \[false, false\], raceMarks: false }/wall: [false, false] }/' src/game/world/openworld/openworld-course.ts
  it("when the course is parsed, then it leaves off the race marks and lays no generated road paint", () => {
    expect(course.road.raceMarks, "race marks").toBe(false);
    expect(course.scenery?.roadDecals, "generated road paint").toEqual([]);
  });

  // mutation: sed -i 's/const random = mulberry32(FABRIC_SEED);/const random = Math.random;/' src/game/world/openworld/openworld-fabric.ts
  it("when the fabric is laid twice, then both are the same street", () => {
    assertSameDigest(fabricProps(lots, graph), fabricProps(lots, graph), "fabric props");
  });
});
