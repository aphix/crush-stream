import type { z } from "zod";
import { detCos, detSin, hypot2 } from "../../kernel/physics-core.js";
import { PARKED_CARS } from "../catalog.ts";
import { BIOME, PREFAB, SURFACE } from "../constants.ts";
import { mulberry32 } from "../placements.ts";
import { TREE_SCALE } from "../scenery.ts";
import type { TrackSchema } from "../track-schema.ts";
import {
  COURSE_LOOK,
  FACING,
  LAMP_FROM_CURB,
  LAMP_SPACING,
  LOOP_ARC_STEPS,
  LOOP_CHECKPOINTS,
  LOOP_CORNER_RADIUS,
  LOOP_END_RUN,
  LOOP_STRAIGHT_STEP,
  OPENWORLD_BLURB,
  OPENWORLD_ID,
  OPENWORLD_NAME,
  PARKING_CORNER_GAP,
  PARKING_EMPTY_SHARE,
  PARKING_SEED,
  PARKING_SPACE,
  ROUTE_ID,
  SPAWN_FORMATION_BACK,
  SPAWN_FORMATION_COUNT,
  SPAWN_FORMATION_LATERAL,
  SPAWN_BEHIND_CENTRE,
  SPAWN_FORMATION_STEP,
  SPAWN_LATERAL_SHIFT,
  TREE_LAMP_CLEARANCE,
  TREE_SPACING,
  WALL_HEIGHT,
  WALL_PIECE_LENGTH,
  WALL_THICKNESS,
} from "./openworld-constants.ts";
import { interiorEnvelopeProps } from "./openworld-interior-solids.ts";
import type { BlockRef, Geometry, Lots } from "./openworld-layout.ts";

export { OPENWORLD_ID };

type TrackInput = z.input<typeof TrackSchema>;
type Prop = NonNullable<TrackInput["props"]>[number];
type Point = { x: number; z: number };

const QUARTER_TURN = Math.PI / 2;

/** A straight's nodes between its two end points (exclusive): close runs at each end, the rest spread at most `LOOP_STRAIGHT_STEP` apart. */
function straightBetween(from: Point, to: Point): Point[] {
  const length = hypot2(to.x - from.x, to.z - from.z);
  const reach = LOOP_END_RUN[LOOP_END_RUN.length - 1]!;
  const middle = Math.max(0, Math.ceil((length - 2 * reach) / LOOP_STRAIGHT_STEP) - 1);
  const marks: number[] = [...LOOP_END_RUN];
  for (let step = 1; step <= middle; step++) marks.push(reach + (step * (length - 2 * reach)) / (middle + 1));
  for (let index = LOOP_END_RUN.length - 1; index >= 0; index--) marks.push(length - LOOP_END_RUN[index]!);
  return marks.map((mark) => ({ x: from.x + ((to.x - from.x) * mark) / length, z: from.z + ((to.z - from.z) * mark) / length }));
}

/** One corner arc, clockwise from `bearing` (0 is north, -z) through a quarter turn. */
function arcPoints(centre: Point, bearing: number): Point[] {
  return Array.from({ length: LOOP_ARC_STEPS + 1 }, (_, step) => {
    const angle = bearing + (step * QUARTER_TURN) / LOOP_ARC_STEPS;
    return { x: centre.x + LOOP_CORNER_RADIUS * detSin(angle), z: centre.z - LOOP_CORNER_RADIUS * detCos(angle) };
  });
}

/** The perimeter street's centre line, clockwise from the north straight: rounded corners joined by straights. */
function loopNodes(geometry: Geometry): Point[] {
  const edgeX = geometry.streetX[geometry.streetX.length - 1]!;
  const edgeZ = geometry.streetZ[geometry.streetZ.length - 1]!;
  const inX = edgeX - LOOP_CORNER_RADIUS;
  const inZ = edgeZ - LOOP_CORNER_RADIUS;
  const centres: Point[] = [
    { x: inX, z: -inZ },
    { x: inX, z: inZ },
    { x: -inX, z: inZ },
    { x: -inX, z: -inZ },
  ];
  const arcs = centres.map((centre, index) => arcPoints(centre, index * QUARTER_TURN));
  const nodes: Point[] = [];
  for (const [index, arc] of arcs.entries()) {
    if (index > 0) nodes.push(...straightBetween(arcs[index - 1]![LOOP_ARC_STEPS]!, arc[0]!));
    nodes.push(...arc);
  }
  nodes.push(...straightBetween(arcs[arcs.length - 1]![LOOP_ARC_STEPS]!, arcs[0]![0]!));
  return nodes;
}

/** The interior streets as traffic routes with no cars: each runs between the perimeter street's centre lines. */
function streetRoutes(geometry: Geometry): NonNullable<NonNullable<TrackInput["traffic"]>["routes"]> {
  const edgeX = geometry.streetX[geometry.streetX.length - 1]!;
  const edgeZ = geometry.streetZ[geometry.streetZ.length - 1]!;
  const lanes = [
    { offset: -geometry.travelLane / 2, dir: 1 as const },
    { offset: geometry.travelLane / 2, dir: -1 as const },
  ];
  const route = (id: string, from: Point, to: Point) => ({ id, path: [from, to], width: geometry.carriageway, count: 0, lanes });
  const columns = geometry.streetX.slice(1, -1).map((x, index) => route(`${ROUTE_ID.columnStreet}${index + 1}`, { x, z: -edgeZ }, { x, z: edgeZ }));
  const rows = geometry.streetZ.slice(1, -1).map((z, index) => route(`${ROUTE_ID.rowStreet}${index + 1}`, { x: -edgeX, z }, { x: edgeX, z }));
  return [...columns, ...rows];
}

function buildingProps(lots: Lots): Prop[] {
  return lots.buildings.map((building): Prop => ({ prefab: building.enterable === true ? PREFAB.buildingShell : PREFAB.building, x: building.x, z: building.z, yaw: building.yaw, size: [building.depth, building.height, building.width], style: building.style }));
}

/** One piece of the invisible wall, thick along its short side, `length` long along the wall. */
function wallPiece(x: number, z: number, alongX: boolean, length: number): Prop {
  return { prefab: PREFAB.invisibleWall, x, z, yaw: alongX ? QUARTER_TURN : 0, size: [WALL_THICKNESS, WALL_HEIGHT, length] };
}

/** A wall edge cut into equal pieces: `from` to `to` along the wall, at `fixed` across it. */
function wallEdge(from: number, to: number, fixed: number, alongX: boolean): Prop[] {
  const count = Math.ceil((to - from) / WALL_PIECE_LENGTH);
  const length = (to - from) / count;
  return Array.from({ length: count }, (_, index) => {
    const along = from + (index + 0.5) * length;
    return alongX ? wallPiece(along, fixed, true, length) : wallPiece(fixed, along, false, length);
  });
}

/** The play area's four walls, standing outside the area; the east and west ones span the corners. */
function wallProps(geometry: Geometry): Prop[] {
  const outX = geometry.halfX + WALL_THICKNESS / 2;
  const outZ = geometry.halfZ + WALL_THICKNESS / 2;
  return [
    ...wallEdge(-geometry.halfX, geometry.halfX, -outZ, true),
    ...wallEdge(-geometry.halfX, geometry.halfX, outZ, true),
    ...wallEdge(-geometry.halfZ - WALL_THICKNESS, geometry.halfZ + WALL_THICKNESS, -outX, false),
    ...wallEdge(-geometry.halfZ - WALL_THICKNESS, geometry.halfZ + WALL_THICKNESS, outX, false),
  ];
}

/** One face of a block's property line: where its sidewalk and street lie. */
type BlockSide = { alongX: boolean; fixed: number; outward: number; start: number; length: number; outwardYaw: number; trafficYaw: number };

function sidesOf(block: BlockRef, geometry: Geometry): BlockSide[] {
  const westEdge = block.centreX - geometry.blockLength / 2;
  const northEdge = block.centreZ - geometry.blockDepth / 2;
  return [
    { alongX: true, fixed: northEdge, outward: -1, start: westEdge, length: geometry.blockLength, outwardYaw: FACING.north, trafficYaw: FACING.north },
    { alongX: true, fixed: block.centreZ + geometry.blockDepth / 2, outward: 1, start: westEdge, length: geometry.blockLength, outwardYaw: FACING.south, trafficYaw: FACING.south },
    { alongX: false, fixed: westEdge, outward: -1, start: northEdge, length: geometry.blockDepth, outwardYaw: FACING.west, trafficYaw: FACING.west },
    { alongX: false, fixed: block.centreX + geometry.blockLength / 2, outward: 1, start: northEdge, length: geometry.blockDepth, outwardYaw: FACING.east, trafficYaw: FACING.east },
  ];
}

/** The point `along` the side and `distance` out from its property line. */
function sidePoint(side: BlockSide, along: number, distance: number): Point {
  const across = side.fixed + side.outward * distance;
  return side.alongX ? { x: along, z: across } : { x: across, z: along };
}

/** Stations along a side: `count` of them, evenly spread, each in the middle of its share. */
function stations(side: BlockSide, count: number): number[] {
  return Array.from({ length: count }, (_, index) => side.start + ((index + 0.5) * side.length) / count);
}

/** Lamps and street trees along a side's furniture strip: lamps at the curb's edge, trees centred, none within the lamp clearance of a lamp. */
function furnitureProps(side: BlockSide, geometry: Geometry): Prop[] {
  const lamps = stations(side, Math.max(1, Math.round(side.length / LAMP_SPACING)));
  const trees = stations(side, Math.floor(side.length / TREE_SPACING)).filter((along) => lamps.every((lamp) => Math.abs(along - lamp) >= TREE_LAMP_CLEARANCE));
  const lampProps = lamps.map((along): Prop => ({ prefab: PREFAB.lamp, ...sidePoint(side, along, geometry.sidewalk - LAMP_FROM_CURB), yaw: side.outwardYaw }));
  const treeProps = trees.map((along): Prop => ({ prefab: PREFAB.tree, ...sidePoint(side, along, geometry.sidewalk - geometry.sidewalkFurniture / 2), scale: TREE_SCALE }));
  return [...lampProps, ...treeProps];
}

/** Cars parked nose to tail along a side's parking lane, a share of spaces empty, none within the corner gap. */
function parkedCarProps(side: BlockSide, geometry: Geometry, random: () => number): Prop[] {
  const usable = side.length + 2 * geometry.sidewalk - 2 * PARKING_CORNER_GAP;
  const spaces = Math.floor(usable / PARKING_SPACE);
  const first = side.start - geometry.sidewalk + PARKING_CORNER_GAP + (usable - spaces * PARKING_SPACE) / 2;
  const props: Prop[] = [];
  for (let space = 0; space < spaces; space++) {
    const empty = random() < PARKING_EMPTY_SHARE;
    const model = PARKED_CARS[Math.floor(random() * PARKED_CARS.length)]!.prefab;
    if (empty) continue;
    props.push({ prefab: model, ...sidePoint(side, first + (space + 0.5) * PARKING_SPACE, geometry.sidewalk + geometry.parkingLane / 2), yaw: side.trafficYaw });
  }
  return props;
}

/** Lamps, trees and parked cars round every block, then the layout's own dressing. */
function streetProps(lots: Lots): Prop[] {
  const random = mulberry32(PARKING_SEED);
  const props: Prop[] = [];
  for (const block of lots.blocks) {
    for (const side of sidesOf(block, lots.geometry)) props.push(...furnitureProps(side, lots.geometry), ...parkedCarProps(side, lots.geometry, random));
  }
  for (const dressing of lots.dressing) props.push({ prefab: dressing.prefab, x: dressing.x, z: dressing.z, yaw: dressing.yaw ?? 0, scale: dressing.scale ?? 1 });
  return props;
}

function paintOf(lots: Lots): NonNullable<TrackInput["environment"]>["paint"] {
  return lots.areas.map((area) => ({
    surface: area.surface,
    poly: [
      [area.x0, area.z0],
      [area.x1, area.z0],
      [area.x1, area.z1],
      [area.x0, area.z1],
    ],
  }));
}

/** Spawn: across the first interior intersection, heading east; the cops queue behind. */
function spawnOf(geometry: Geometry): NonNullable<TrackInput["survival"]> {
  const z = geometry.streetZ[1]! + SPAWN_LATERAL_SHIFT;
  const startX = geometry.streetX[1]! - SPAWN_BEHIND_CENTRE;
  const formation = Array.from({ length: SPAWN_FORMATION_COUNT }, (_, index) => ({
    x: startX - SPAWN_FORMATION_BACK - index * SPAWN_FORMATION_STEP,
    z: z + (index % 2 === 0 ? -SPAWN_FORMATION_LATERAL : SPAWN_FORMATION_LATERAL),
    yaw: QUARTER_TURN,
  }));
  return { start: { x: startX, z, yaw: QUARTER_TURN }, formation };
}

/** The open world as a course (`TrackSchema` input): the perimeter street as the road loop, the interior streets as car-free routes, a building per lot, street furniture and an invisible wall round the play area. */
export function openWorldCourse(lots: Lots): TrackInput {
  const geometry = lots.geometry;
  const nodes = loopNodes(geometry);
  return {
    id: OPENWORLD_ID,
    name: OPENWORLD_NAME,
    blurb: OPENWORLD_BLURB,
    laps: 1,
    road: { width: geometry.carriageway, surface: SURFACE.asphalt, runoff: [0, 0], runoffSurface: SURFACE.concrete, wall: [false, false] },
    nodes,
    checkpoints: Array.from({ length: LOOP_CHECKPOINTS }, (_, index) => ({ node: Math.floor((index * nodes.length) / LOOP_CHECKPOINTS) })),
    props: [...buildingProps(lots), ...streetProps(lots), ...wallProps(geometry), ...interiorEnvelopeProps(lots)],
    scenery: { biome: BIOME.city, off: ["frontage", "verge", "islands"] },
    traffic: { count: 0, lanes: [], routes: streetRoutes(geometry) },
    survival: spawnOf(geometry),
    environment: {
      sky: COURSE_LOOK.sky,
      fog: COURSE_LOOK.fog,
      terrain: SURFACE.concrete,
      far: COURSE_LOOK.far,
      paint: paintOf(lots),
      light: { sun: COURSE_LOOK.sun, sunIntensity: COURSE_LOOK.sunIntensity, hemi: COURSE_LOOK.hemi, fill: COURSE_LOOK.fill },
    },
  };
}
