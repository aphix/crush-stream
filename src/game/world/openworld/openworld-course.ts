import type { z } from "zod";
import { detCos, detSin, hypot2 } from "../../kernel/physics-core.js";
import { BIOME, PAVING, PREFAB, SURFACE } from "../constants.ts";
import { TREE_SCALE } from "../scenery.ts";
import type { TrackSchema } from "../track-schema.ts";
import {
  COURSE_LOOK,
  LAMP_FROM_CURB,
  LOOP_ARC_STEPS,
  LOOP_CHECKPOINTS,
  LOOP_CORNER_RADIUS,
  LOOP_END_RUN,
  LOOP_STRAIGHT_STEP,
  OPENWORLD_BLURB,
  OPENWORLD_ID,
  OPENWORLD_NAME,
  ROUTE_ID,
  SPAWN_FORMATION_BACK,
  SPAWN_FORMATION_COUNT,
  SPAWN_FORMATION_LATERAL,
  SPAWN_BEHIND_CENTRE,
  SPAWN_FORMATION_STEP,
  SPAWN_LATERAL_SHIFT,
  WALL_HEIGHT,
  WALL_PIECE_LENGTH,
  WALL_THICKNESS,
} from "./openworld-constants.ts";
import { facadeSolidProps } from "./openworld-facade-solids.ts";
import { QUARTER_TURN } from "./openworld-fabric-constants.ts";
import { fabricProps } from "./openworld-fabric.ts";
import { interiorEnvelopeProps } from "./openworld-interior-solids.ts";
import type { Geometry, Lots } from "./openworld-layout.ts";
import { buildOpenWorldMap } from "./openworld-map.ts";
import { parkPaint, parkProps } from "./openworld-park.ts";
import { lampStations, sidePoint, sidesOf, treeStations, type BlockSide } from "./openworld-sides.ts";
import { stoopGreeneryProps, streetTreeStyle } from "./openworld-greenery.ts";

export { OPENWORLD_ID };

type TrackInput = z.input<typeof TrackSchema>;
type Prop = NonNullable<TrackInput["props"]>[number];
type Point = { x: number; z: number };

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

/** Lamps and street trees along a side's furniture strip: lamps at the curb's edge, trees centred. */
function furnitureProps(side: BlockSide, geometry: Geometry): Prop[] {
  const lampProps = lampStations(side).map((along): Prop => ({ prefab: PREFAB.acornLamp, ...sidePoint(side, along, geometry.sidewalk - LAMP_FROM_CURB), yaw: side.outwardYaw }));
  const treeProps = treeStations(side).map((along): Prop => {
    const at = sidePoint(side, along, geometry.sidewalk - geometry.sidewalkFurniture / 2);
    return { prefab: PREFAB.tree, ...at, scale: TREE_SCALE, style: streetTreeStyle(at.x, at.z, side.side) };
  });
  return [...lampProps, ...treeProps];
}

/** Lamps and trees round every block, then the layout's own dressing. */
function streetProps(lots: Lots): Prop[] {
  const props: Prop[] = [];
  for (const block of lots.blocks) {
    for (const side of sidesOf(block, lots.geometry)) props.push(...furnitureProps(side, lots.geometry));
  }
  for (const dressing of lots.dressing) props.push({ prefab: dressing.prefab, x: dressing.x, z: dressing.z, yaw: dressing.yaw ?? 0, scale: dressing.scale ?? 1 });
  return props;
}

function paintOf(lots: Lots): NonNullable<NonNullable<TrackInput["environment"]>["paint"]> {
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

/** The open world as a course (`TrackSchema` input): the perimeter street as the road loop, the interior streets as car-free routes, a building per lot, lamps and trees, the street fabric (crossings, manholes, hydrants, furniture), the park's dressing and an invisible wall round the play area. */
export function openWorldCourse(lots: Lots): TrackInput {
  const geometry = lots.geometry;
  const nodes = loopNodes(geometry);
  return {
    id: OPENWORLD_ID,
    name: OPENWORLD_NAME,
    blurb: OPENWORLD_BLURB,
    laps: 1,
    road: { width: geometry.carriageway, surface: SURFACE.asphalt, runoff: [0, 0], runoffSurface: SURFACE.concrete, wall: [false, false], raceMarks: false },
    nodes,
    checkpoints: Array.from({ length: LOOP_CHECKPOINTS }, (_, index) => ({ node: Math.floor((index * nodes.length) / LOOP_CHECKPOINTS) })),
    props: [...buildingProps(lots), ...streetProps(lots), ...fabricProps(lots, buildOpenWorldMap(lots).graph), ...parkProps(lots), ...wallProps(geometry), ...facadeSolidProps(lots), ...interiorEnvelopeProps(lots), ...stoopGreeneryProps(lots)],
    scenery: { biome: BIOME.city, off: ["frontage", "verge", "islands"], roadDecals: [], paving: PAVING.brick },
    traffic: { count: 0, lanes: [], routes: streetRoutes(geometry) },
    survival: spawnOf(geometry),
    environment: {
      sky: COURSE_LOOK.sky,
      fog: COURSE_LOOK.fog,
      terrain: SURFACE.concrete,
      far: COURSE_LOOK.far,
      paint: [...parkPaint(lots), ...paintOf(lots)],
      light: { sun: COURSE_LOOK.sun, sunIntensity: COURSE_LOOK.sunIntensity, hemi: COURSE_LOOK.hemi, fill: COURSE_LOOK.fill },
    },
  };
}
