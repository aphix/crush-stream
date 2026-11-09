import { describe, expect, it } from "vitest";
import { detCos, detSin } from "../../kernel/physics-core.js";
import { assertSameDigest } from "../../vehicle/test-support.ts";
import { PREFABS } from "../catalog.ts";
import { PREFAB } from "../constants.ts";
import { placeProps, propColliders } from "../placements.ts";
import { SCENERY_ASSETS } from "../scenery-assets/index.ts";
import { streetSignNames } from "../street-kit.ts";
import { facadeSolidProps, homeFrontages } from "./openworld-facade-solids.ts";
import { ASSET, BOLLARD_SPOTS, CELLAR, FRONTAGE_KITS, FURNITURE_GAP, KIT_SLIDE, LAMP_CLEARANCE, PIECE, QUARTER_TURN, SHELTER_WALL, TREE_CROWN_CLEARANCE, type FurniturePiece } from "./openworld-fabric-constants.ts";
import { fabricProps } from "./openworld-fabric.ts";
import { layOutLots } from "./openworld-lots.ts";
import { STREETS_X, STREETS_Z } from "./openworld-programme.ts";
import { buildOpenWorldMap } from "./openworld-map.ts";
import { allFaces, assetIndex, cornersOf, fabricCourse, inStrip, onFace, roadDepth } from "./openworld-fabric.test-util.ts";
import { sidesOf, type BlockSide } from "./openworld-sides.ts";
import { PLACE_KIND } from "./walk-graph.ts";

const { lots, course, track, graph, everything } = fabricCourse();
const geometry = lots.geometry;
const faces = allFaces(lots);
/** What a furniture prop is: its asset where it names one, else its prefab. */
const keyOf = (prop: { prefab: string; asset?: string }): string => prop.asset ?? prop.prefab;
/** The street furniture: every kit piece and the street signs, on the sidewalks (the park's benches and bins stand inside its block). */
const FURNITURE: readonly string[] = [...Object.values(PIECE).map(keyOf), PREFAB.streetSign];
const insideABlock = (x: number, z: number): boolean => lots.blocks.some((block) => Math.abs(x - block.centreX) < geometry.blockLength / 2 && Math.abs(z - block.centreZ) < geometry.blockDepth / 2);
const kit = course.props.filter((prop) => FURNITURE.includes(keyOf(prop)) && !insideABlock(prop.x, prop.z));

/** The scenery family the furniture used to be sprites of (`street.json`'s ids): none is placed any more. */
const STREET_FAMILY = "street-";
/** A decal is on a crossing leg's line within this (m). */
const ON_LINE = 0.01;
/** Slack (m) on a decal's coordinates: the walk graph stores float32. */
const COORDINATE_SLACK = 1e-4;
/** A loop corner's round is within this (m) of its apex: no sign stands that near one. */
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

/** The furniture of `piece`'s kind standing in `side`'s strip between `from` and `to` along it. */
function standingOn(piece: FurniturePiece, side: BlockSide, from: number, to: number): typeof kit {
  const held = kit.filter((prop) => keyOf(prop) === keyOf(piece) && inStrip(side, lots, prop.x, prop.z, 0));
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
    expect(outside.slice(0, 3).map((prop) => `${keyOf(prop)} at ${prop.x.toFixed(2)}, ${prop.z.toFixed(2)}`).join("; "), "pieces outside a strip").toBe("");
  });

  // mutation: sed -i 's/to > lane.taken\[index\]!) return false;/to > lane.taken[index]!) continue;/' src/game/world/openworld/openworld-fabric.ts
  it("when each face's strip is read, then no piece overlaps a lamp, a street tree or another piece, and each keeps the gap", () => {
    const overlaps: string[] = [];
    for (const side of faces) {
      const spans = kit.flatMap((prop) => {
        const corners = cornersOf(prop);
        if (!corners.every(([x, z]) => inStrip(side, lots, x, z, 0))) return [];
        const alongs = corners.map(([x, z]) => onFace(side, x, z).along);
        return [{ asset: keyOf(prop), from: Math.min(...alongs), to: Math.max(...alongs) }];
      });
      const fixed = course.props.filter((prop) => (prop.prefab === PREFAB.acornLamp || prop.prefab === PREFAB.tree) && inStrip(side, lots, prop.x, prop.z, 0));
      for (const [index, span] of spans.entries()) {
        for (const other of spans.slice(index + 1)) if (span.from < other.to + FURNITURE_GAP - 1e-6 && span.to + FURNITURE_GAP - 1e-6 > other.from) overlaps.push(`${span.asset} and ${other.asset}`);
        for (const post of fixed) {
          const along = onFace(side, post.x, post.z).along;
          const reach = post.prefab === PREFAB.acornLamp ? LAMP_CLEARANCE : TREE_CROWN_CLEARANCE;
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
    for (const side of faces) expect(standingOn(PIECE.hydrant, side, side.start, side.start + side.length).length, `hydrants on the ${side.side} face at ${side.fixed.toFixed(1)}`).toBe(1);
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
      const held = items.flatMap((item) => standingOn(item.piece, side, door - reach, door + reach));
      expect(held.length, `${place.name}'s furniture`).toBeGreaterThan(0);
      if (place.storeys > 0) businesses++;
      const shelter = standingOn(PIECE.busShelter, side, door - COORDINATE_SLACK, door + COORDINATE_SLACK);
      expect(shelter.length, `bus shelters at ${place.name}`).toBe(items.some((item) => item.piece === PIECE.busShelter) ? 1 : 0);
    }
    expect(businesses, "businesses read").toBeGreaterThan(20);
  });
});

describe("given the street signs at the block corners", () => {
  const signs = kit.filter((prop) => prop.prefab === PREFAB.streetSign);
  const apexes = [-1, 1].flatMap((signX) => [-1, 1].map((signZ) => ({ x: signX * geometry.streetX[geometry.streetX.length - 1]!, z: signZ * geometry.streetZ[geometry.streetZ.length - 1]! })));

  // mutation: sed -i 's/if (isLoopCorner(block, signX, signZ, geometry)) continue;//' src/game/world/openworld/openworld-fabric.ts
  it("when the corners are read, then signs stand at many of them and none within reach of the loop's rounded corners", () => {
    expect(signs.length, "signs").toBeGreaterThan(10);
    for (const sign of signs) {
      for (const apex of apexes) expect(Math.hypot(sign.x - apex.x, sign.z - apex.z), `sign at ${sign.x.toFixed(1)}, ${sign.z.toFixed(1)} from a loop corner (m)`).toBeGreaterThan(LOOP_CORNER_REACH);
    }
  });

  // mutation: sed -i 's/props.push({ prefab: PREFAB.streetSign, x: cornerX + signX \* CORNER_POCKET, z: cornerZ + signZ \* CORNER_POCKET, yaw: 0, style: streetSignStyle(alongX, alongZ) });/props.push({ prefab: PREFAB.streetSign, x: cornerX + signX * CORNER_POCKET, z: cornerZ + signZ * CORNER_POCKET, yaw: 0, style: streetSignStyle(alongZ, alongX) });/' src/game/world/openworld/openworld-fabric.ts
  it("when each sign is read, then its blade along x names the street running along x beside it and its blade along z the street along z", () => {
    const nearest = (lines: readonly number[], at: number): number => lines.reduce((best, line, index) => (Math.abs(line - at) < Math.abs(lines[best]! - at) ? index : best), 0);
    for (const sign of signs) {
      const names = streetSignNames(sign.style);
      expect(names, `names on the sign at ${sign.x.toFixed(1)}, ${sign.z.toFixed(1)}`).not.toBeNull();
      expect(names![0], "the blade along x").toBe(STREETS_Z[nearest(geometry.streetZ, sign.z)]);
      expect(names![1], "the blade along z").toBe(STREETS_X[nearest(geometry.streetX, sign.x)]);
    }
  });
});

describe("given the street kit's posts", () => {
  /** The post-like furniture a car must not drive through: where each stands in the course, and how tall its foot's solid must reach (m) to stop a bumper. */
  const POSTS_THAT_STOP = [PREFAB.bollard, PREFAB.hydrant, PREFAB.parkingMeter, PREFAB.streetSign, PREFAB.busStopSign] as const;
  const BUMPER_HEIGHT = 0.5;
  const colliders = propColliders(placeProps(track));

  // mutation: sed -i 's/  return { body: "solid", collider: colliders, foot: reach, size/  return { body: "none", collider: colliders, foot: reach, size/' src/game/world/catalog.ts
  it("when the course is placed, then every bollard, hydrant, parking meter and street and bus stop sign stands a solid a car meets, its foot reaching a bumper's height", () => {
    for (const prefab of POSTS_THAT_STOP) {
      const placed = course.props.filter((prop) => prop.prefab === prefab);
      expect(placed.length, `${prefab} placed`).toBeGreaterThan(0);
      const pieces = colliders.filter((piece) => piece.prefab === prefab);
      expect(pieces.filter((piece) => piece.body !== "solid").length, `${prefab} pieces that are no solid`).toBe(0);
      // The solid at a post's foot is its pieces together (a hydrant is four circles): from the lowest base to the highest top.
      const unmet = placed.filter((prop) => {
        const here = pieces.filter((piece) => Math.hypot(piece.x - prop.x, piece.z - prop.z) < COORDINATE_SLACK);
        return here.length === 0 || Math.max(...here.map((piece) => piece.top)) - Math.min(...here.map((piece) => piece.base)) < BUMPER_HEIGHT;
      });
      expect(unmet.slice(0, 3).map((prop) => `${prop.x.toFixed(1)}, ${prop.z.toFixed(1)}`).join("; "), `${prefab}s with nothing a bumper meets at their foot`).toBe("");
    }
  });
});

describe("given the street kit's knockable furniture and its pavilion", () => {
  /** The furniture a car knocks over once it closes fast enough; the pavilion's posts are solid. */
  const KNOCKED = [PREFAB.litterBin, PREFAB.bench, PREFAB.newsBox, PREFAB.bikeRack] as const;
  /** A placed piece's colliders lie within this (m) of its place: the bench's and the rack's longest reach. */
  const PIECE_REACH = 1;
  const POSTS_ROUND_THE_PAVILION = 8;
  const colliders = propColliders(placeProps(track));

  // mutation: sed -i 's/\[PREFAB.bench\]: knockSpec(STREET_KIT.bench, MAT.BENCH_MAPLE, benchPlan(), 0.8, KNOCKABLE.bench)/[PREFAB.bench]: kitSpec(STREET_KIT.bench, MAT.BENCH_MAPLE)/' src/game/world/catalog.ts
  it("when the course is placed, then every bin, bench, news box and bike rack stands as a knock prop with its knock speed, and each has its colliders in place", () => {
    for (const prefab of KNOCKED) {
      const placed = course.props.filter((prop) => prop.prefab === prefab);
      expect(placed.length, `${prefab} placed`).toBeGreaterThan(0);
      const pieces = colliders.filter((piece) => piece.prefab === prefab);
      expect(pieces.filter((piece) => piece.body !== "knock" || piece.knockSpeed !== PREFABS[prefab].knockSpeed || !(piece.knockSpeed! > 0)).length, `${prefab} pieces that are no knock prop with a speed`).toBe(0);
      const unmet = placed.filter((prop) => !pieces.some((piece) => Math.hypot(piece.x - prop.x, piece.z - prop.z) < PIECE_REACH));
      expect(unmet.slice(0, 3).map((prop) => `${prop.x.toFixed(1)}, ${prop.z.toFixed(1)}`).join("; "), `${prefab}s with no collider in place`).toBe("");
    }
  });

  // mutation: sed -i 's/  \[PREFAB.pavilion\]: postSpec(STREET_KIT.pavilion, MAT.GANTRY_STEEL, pavilionPlan(), PAVILION.fasciaRadius),/  [PREFAB.pavilion]: kitSpec(STREET_KIT.pavilion, MAT.GANTRY_STEEL),/' src/game/world/catalog.ts
  it("when the pavilion is placed, then its floor, its eight posts and its roof are solids a car meets", () => {
    const placed = course.props.filter((prop) => prop.prefab === PREFAB.pavilion);
    expect(placed.length, "pavilions placed").toBe(1);
    const pieces = colliders.filter((piece) => piece.prefab === PREFAB.pavilion);
    expect(pieces.filter((piece) => piece.body !== "solid").length, "pieces that are no solid").toBe(0);
    expect(pieces.filter((piece) => piece.kind === "box").length, "posts").toBe(POSTS_ROUND_THE_PAVILION);
    expect(pieces.filter((piece) => piece.kind === "circle").length, "floor, fascia, roof and finial").toBe(4);
  });
});

describe("given the street furniture's drawing", () => {
  // mutation: sed -i 's/  return { prefab: piece.prefab, x, z, yaw };/  return assetProp("street-fire-hydrant", x, z, yaw);/' src/game/world/openworld/openworld-fabric.ts
  it("when the course's props are read, then no piece of furniture is a sprite of the street scenery family: each is a street kit prefab, the newspaper box included", () => {
    const sprites = course.props.filter((prop) => prop.asset?.startsWith(STREET_FAMILY));
    expect(sprites.map((prop) => keyOf(prop)).join(", "), "street family sprites in the course (the greenery's are another lane's)").toBe("");
    for (const piece of Object.values(PIECE)) expect(kit.filter((prop) => keyOf(prop) === keyOf(piece)).length, `${keyOf(piece)} placed`).toBeGreaterThan(0);
  });

  // mutation: sed -i 's/      if (item.piece === PIECE.busShelter) props.push(shelterWall(at.x, at.z, yaw));//' src/game/world/openworld/openworld-fabric.ts
  it("when each bus shelter is read, then a solid box stands under its back panel, behind its middle", () => {
    const shelters = kit.filter((prop) => prop.prefab === PREFAB.busShelter);
    const walls = course.props.filter((prop) => prop.prefab === PREFAB.invisibleWall && prop.size?.[2] === SHELTER_WALL.length);
    expect(shelters.length, "shelters").toBeGreaterThan(0);
    for (const shelter of shelters) {
      const behind = walls.filter((wall) => Math.abs(Math.hypot(wall.x - shelter.x, wall.z - shelter.z) - SHELTER_WALL.back) < COORDINATE_SLACK && Math.abs(wall.yaw - shelter.yaw) < COORDINATE_SLACK);
      expect(behind.length, `back walls of the shelter at ${shelter.x.toFixed(1)}, ${shelter.z.toFixed(1)}`).toBe(1);
      const out = (shelter.x - behind[0]!.x) * detCos(shelter.yaw) - (shelter.z - behind[0]!.z) * detSin(shelter.yaw);
      expect(out, "the wall stands behind the shelter's open front (m)").toBeCloseTo(SHELTER_WALL.back, 6);
    }
  });
});

describe("given the block corners without a street sign", () => {
  const bollards = course.props.filter((prop) => prop.prefab === PREFAB.bollard);
  const drains = course.props.filter((prop) => prop.asset === ASSET.drain);
  const legs = crossingLegs();
  /** A bollard's radius and a walker's shoulder room (m): the most a bollard may near a crossing's line. */
  const BOLLARD_CLEAR = 0.6;
  /** Corners of the playable blocks that are no loop corner, half of them signed. */
  const unsigned = lots.blocks.length * 2 - 2;

  // mutation: sed -i 's/  \[3.3, 2.2\],/  [3.3, 1.6],/' src/game/world/openworld/openworld-fabric-constants.ts
  it("when the corners are read, then three bollards stand round each one's curb on the sidewalk, clear of the crossings' landings", () => {
    expect(bollards.length, "bollards").toBe(unsigned * BOLLARD_SPOTS.length);
    for (const bollard of bollards) {
      expect(roadDepth(track, bollard.x, bollard.z), `the bollard at ${bollard.x.toFixed(1)}, ${bollard.z.toFixed(1)} off the road (m)`).toBeLessThan(-PREFABS[PREFAB.bollard].size[0] / 2);
      expect(Math.min(...legs.map((leg) => distanceToLeg(bollard.x, bollard.z, leg))), `the bollard at ${bollard.x.toFixed(1)}, ${bollard.z.toFixed(1)} from a crossing's line (m)`).toBeGreaterThan(BOLLARD_CLEAR);
    }
  });

  // mutation: sed -i 's/geometry.sidewalk + DRAIN_PAST_CURB/geometry.sidewalk - DRAIN_PAST_CURB/' src/game/world/openworld/openworld-fabric.ts
  it("when the corners' drains are read, then one lies in the gutter at each, every corner of it on the road", () => {
    expect(drains.length, "drains").toBe(unsigned);
    for (const drain of drains) for (const [x, z] of cornersOf(drain)) expect(roadDepth(track, x, z), `drain at ${drain.x.toFixed(1)}, ${drain.z.toFixed(1)}: depth into the road (m)`).toBeGreaterThan(0);
  });
});

describe("given the paint on the roads", () => {
  const paint = everything.filter((prop) => (prop.prefab === PREFAB.assetDecal || prop.prefab === PREFAB.assetTile) && roadDepth(track, prop.x, prop.z) > 0);

  // mutation: sed -i 's/, roadDecals: \[\] }/, roadDecals: ["arrow"] }/' src/game/world/openworld/openworld-course.ts
  it("when every decal and tile the course places or draws on a road is read, then it is a manhole cover, a marked crossing or a storm drain", () => {
    const ids = new Set(paint.map((prop) => SCENERY_ASSETS[prop.asset!]!.id));
    expect([...ids].sort().join(", "), "assets painted on the roads").toBe([ASSET.crosswalk, ASSET.drain, ASSET.manhole].sort().join(", "));
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

describe("given the shipped layout", () => {
  const shipped = layOutLots();
  const laid = fabricProps(shipped, buildOpenWorldMap(shipped).graph);
  const boxes = facadeSolidProps(shipped);
  /** Whether a piece has a footprint corner inside one of the facade kit's boxes (a stoop's steps, a bay's flanks). */
  const inABox = (piece: (typeof laid)[number]): boolean =>
    cornersOf(piece).some(([x, z]) =>
      boxes.some((box) => {
        const dx = x - box.x;
        const dz = z - box.z;
        return Math.abs(dx * detCos(box.yaw) - dz * detSin(box.yaw)) <= box.size[0] / 2 && Math.abs(dx * detSin(box.yaw) + dz * detCos(box.yaw)) <= box.size[2] / 2;
      }),
    );

  // mutation: sed -i 's/const NEAR_CURB = 0.3;/const NEAR_CURB = 2.8;/' src/game/world/openworld/openworld-fabric-constants.ts
  it("when the facade kit's boxes are read, then no piece of furniture has a footprint corner inside one (the kit stands only at the rowhomes with an interior)", () => {
    const furniture = laid.filter((prop) => FURNITURE.includes(keyOf(prop)));
    expect(boxes.length, "boxes read").toBeGreaterThan(100);
    expect(furniture.length, "pieces of furniture read").toBeGreaterThan(90);
    expect(furniture.filter(inABox).slice(0, 3).map((prop) => `${keyOf(prop)} at ${prop.x.toFixed(2)}, ${prop.z.toFixed(2)}`).join("; "), "pieces inside a box").toBe("");
  });

  // mutation: sed -i 's/random() >= CELLAR.share/random() >= 2 * CELLAR.share/' src/game/world/openworld/openworld-fabric.ts
  // mutation: sed -i 's/export const CELLAR = { share: 0.3, gap: 0.1 } as const;/export const CELLAR = { share: 0.3, gap: 3 } as const;/' src/game/world/openworld/openworld-fabric-constants.ts
  it("when the cellar doors are read, then about the seeded share of the rowhomes has one, each on the sidewalk between the property line and the clear path", () => {
    const doors = laid.filter((prop) => prop.prefab === PREFAB.cellarDoor);
    const rowhomes = shipped.links.filter((link) => link.side !== null && link.place < shipped.backdropStart && homeFrontages([shipped.places[link.place]!]).length > 0).length;
    /** The share of rowhomes with cellar doors may wander this far from the seeded share over a city's few hundred homes. */
    const SHARE_SLACK = 0.1;
    expect(rowhomes, "rowhomes read").toBeGreaterThan(100);
    expect(doors.length / rowhomes, "share of rowhomes with cellar doors").toBeGreaterThan(CELLAR.share - SHARE_SLACK);
    expect(doors.length / rowhomes, "share of rowhomes with cellar doors").toBeLessThan(CELLAR.share + SHARE_SLACK);
    for (const door of doors) {
      // Each corner against the face it is nearest across, among the faces whose length it lies along.
      const out = cornersOf(door).map(([x, z]) => {
        const along = faces.filter((side) => Math.abs(onFace(side, x, z).along - (side.start + side.length / 2)) <= side.length / 2);
        return along.map((side) => onFace(side, x, z).out).reduce((best, value) => (Math.abs(value) < Math.abs(best) ? value : best), Infinity);
      });
      expect(Math.min(...out), `the door at ${door.x.toFixed(1)}, ${door.z.toFixed(1)}: nearest corner past the property line (m)`).toBeGreaterThanOrEqual(0);
      expect(Math.max(...out), `the door at ${door.x.toFixed(1)}, ${door.z.toFixed(1)}: farthest corner past the property line (m)`).toBeLessThan(geometry.sidewalkFrontage + geometry.sidewalkClear);
    }
  });

  // mutation: sed -i 's/export const CELLAR = { share: 0.3, gap: 0.1 } as const;/export const CELLAR = { share: 0.3, gap: -0.5 } as const;/' src/game/world/openworld/openworld-fabric-constants.ts
  it("when the facade kit's boxes are read, then no cellar door has a footprint corner inside one", () => {
    const doors = laid.filter((prop) => prop.prefab === PREFAB.cellarDoor);
    expect(doors.length, "cellar doors read").toBeGreaterThan(20);
    expect(doors.filter(inABox).slice(0, 3).map((door) => `${door.x.toFixed(2)}, ${door.z.toFixed(2)}`).join("; "), "cellar doors in a stoop or bay").toBe("");
  });

  // mutation: sed -i 's/export const FURNITURE_CORNER_CLEAR = 3;/export const FURNITURE_CORNER_CLEAR = 60;/' src/game/world/openworld/openworld-fabric-constants.ts
  it("when the fabric is laid on it, then every block face has its hydrant and the bus stop its shelter", () => {
    const missing: string[] = [];
    for (const block of shipped.blocks) {
      for (const side of sidesOf(block, shipped.geometry)) {
        const hydrants = laid.filter((prop) => prop.prefab === PREFAB.hydrant && inStrip(side, shipped, prop.x, prop.z, 0)).length;
        if (hydrants !== 1) missing.push(`${hydrants} hydrants on the ${side.side} face of block ${block.column},${block.row}`);
      }
    }
    for (const [index, place] of shipped.places.entries()) {
      const link = shipped.links.find((candidate) => candidate.place === index);
      if (place.kind !== PLACE_KIND.transit || index >= shipped.backdropStart || link === undefined || link.side === null) continue;
      const side = sidesOf(shipped.blocks[link.block]!, shipped.geometry).find((candidate) => candidate.side === link.side)!;
      if (!laid.some((prop) => prop.prefab === PREFAB.busShelter && inStrip(side, shipped, prop.x, prop.z, 0))) missing.push(`no shelter at ${place.name} on the ${side.side} face of block ${link.block}`);
    }
    expect(missing.join("; "), "faces and stops left without").toBe("");
  });
});
