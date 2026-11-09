import { detAtan2, detCos, detSin } from "../../kernel/physics-core.js";
import type { PrefabId } from "../catalog.ts";
import { mulberry32 } from "../placements.ts";
import { SCENERY_ASSETS } from "../scenery-assets/index.ts";
import { assetPrefab, assetScale } from "../scenery-assets/pick.ts";
import type { SceneryAsset } from "../scenery-assets/types.ts";
import {
  ASSET,
  CORNER_POCKET,
  CROSSING_AXIS_TOLERANCE,
  CROSSWALK_DEPTH,
  DRAIN_FROM_CORNER,
  DRAIN_PAST_CURB,
  FABRIC_SEED,
  FRONTAGE_KITS,
  FURNITURE_CORNER_CLEAR,
  FURNITURE_GAP,
  HYDRANT_ITEM,
  HYDRANT_SHARE,
  KIT_SLIDE,
  LAMP_CLEARANCE,
  QUARTER_TURN,
  SLIDE_STEP,
  TREE_CROWN_CLEARANCE,
  type KitItem,
} from "./openworld-fabric-constants.ts";
import type { BlockRef, Geometry, Lots } from "./openworld-layout.ts";
import { lampStations, sidePoint, sidesOf, treeStations, type BlockSide } from "./openworld-sides.ts";
import { PLACE_KIND, type WalkGraph } from "./walk-graph.ts";

/** A course prop that names a scenery asset: the course's `props` row as the schema takes it. */
type FabricProp = { prefab: PrefabId; asset: string; x: number; z: number; yaw: number; size?: [number, number, number] };

const CORNER_SIGNS = [-1, 1] as const;
const SLIDE_DIRECTIONS = [1, -1] as const;
const ROWS: ReadonlyMap<string, SceneryAsset> = new Map(SCENERY_ASSETS.map((row) => [row.id, row]));

function rowOf(asset: string): SceneryAsset {
  const row = ROWS.get(asset);
  if (row === undefined) throw new Error(`openworld fabric: no scenery asset "${asset}"`);
  return row;
}

function assetProp(asset: string, x: number, z: number, yaw: number, size?: [number, number, number]): FabricProp {
  const prop: FabricProp = { prefab: assetPrefab(rowOf(asset)), asset, x, z, yaw };
  if (size !== undefined) prop.size = size;
  return prop;
}

/** Marked crossings: bars with the traffic, laid across the carriageway at the middle of every crossing edge of the walk graph, in as many decals as cover it at the asset's own pitch. */
function crossingProps(geometry: Geometry, graph: WalkGraph): FabricProp[] {
  const count = Math.max(1, Math.round(geometry.carriageway / rowOf(ASSET.crosswalk).size[0]));
  const width = geometry.carriageway / count;
  const props: FabricProp[] = [];
  for (let node = 0; node < graph.nodeX.length; node++) {
    for (let edge = graph.edgeStart[node]!; edge < graph.edgeStart[node + 1]!; edge++) {
      const other = graph.edgeTo[edge]!;
      if (graph.edgeCrossing[edge] === 0 || other < node) continue;
      const middleX = (graph.nodeX[node]! + graph.nodeX[other]!) / 2;
      const middleZ = (graph.nodeZ[node]! + graph.nodeZ[other]!) / 2;
      const alongX = Math.abs(graph.nodeZ[node]! - graph.nodeZ[other]!) < CROSSING_AXIS_TOLERANCE;
      for (let step = 0; step < count; step++) {
        const offset = (step - (count - 1) / 2) * width;
        props.push(assetProp(ASSET.crosswalk, alongX ? middleX + offset : middleX, alongX ? middleZ : middleZ + offset, alongX ? 0 : QUARTER_TURN, [width, 1, CROSSWALK_DEPTH]));
      }
    }
  }
  return props;
}

/** One manhole cover in the middle of each street segment (between two intersections), in the middle of a travel lane, alternating lanes from segment to segment. */
function manholeProps(geometry: Geometry, random: () => number): FabricProp[] {
  const lane = geometry.travelLane / 2;
  const props: FabricProp[] = [];
  const cover = (x: number, z: number): void => {
    props.push(assetProp(ASSET.manhole, x, z, random() * 2 * Math.PI));
  };
  for (let row = 0; row < geometry.streetZ.length; row++) {
    for (let column = 0; column + 1 < geometry.streetX.length; column++) {
      cover((geometry.streetX[column]! + geometry.streetX[column + 1]!) / 2, geometry.streetZ[row]! + ((row + column) % 2 === 0 ? lane : -lane));
    }
  }
  for (let column = 0; column < geometry.streetX.length; column++) {
    for (let row = 0; row + 1 < geometry.streetZ.length; row++) {
      cover(geometry.streetX[column]! + ((row + column) % 2 === 0 ? lane : -lane), (geometry.streetZ[row]! + geometry.streetZ[row + 1]!) / 2);
    }
  }
  return props;
}

/** Whether a block corner is one of the perimeter loop's four rounded corners, where the road swings in over the sidewalk. */
function isLoopCorner(block: BlockRef, signX: number, signZ: number, geometry: Geometry): boolean {
  const outwardX = signX < 0 ? block.column === 0 : block.column === geometry.columns - 1;
  const outwardZ = signZ < 0 ? block.row === 0 : block.row === geometry.rows - 1;
  return outwardX && outwardZ;
}

/** At every block corner but the loop's: a street-name sign at two opposite corners of each intersection, turned to the intersection, and a storm drain grate in the gutter by the others. */
function cornerProps(lots: Lots): FabricProp[] {
  const geometry = lots.geometry;
  const props: FabricProp[] = [];
  for (const block of lots.blocks) {
    for (const signX of CORNER_SIGNS) {
      for (const signZ of CORNER_SIGNS) {
        if (isLoopCorner(block, signX, signZ, geometry)) continue;
        const cornerX = block.centreX + (signX * geometry.blockLength) / 2;
        const cornerZ = block.centreZ + (signZ * geometry.blockDepth) / 2;
        if (signX === signZ) props.push(assetProp(ASSET.nameSign, cornerX + signX * CORNER_POCKET, cornerZ + signZ * CORNER_POCKET, detAtan2(-signZ, signX)));
        else props.push(assetProp(ASSET.drain, cornerX - signX * DRAIN_FROM_CORNER, cornerZ + signZ * (geometry.sidewalk + DRAIN_PAST_CURB), 0));
      }
    }
  }
  return props;
}

/** A face's furniture strip: what already stands along it, as pairs of (from, to) along the face (m). */
type Lane = { side: BlockSide; taken: number[] };

function laneOf(side: BlockSide): Lane {
  const lane: Lane = { side, taken: [] };
  for (const along of lampStations(side)) lane.taken.push(along - LAMP_CLEARANCE, along + LAMP_CLEARANCE);
  for (const along of treeStations(side)) lane.taken.push(along - TREE_CROWN_CLEARANCE, along + TREE_CROWN_CLEARANCE);
  return lane;
}

function isFree(lane: Lane, from: number, to: number): boolean {
  if (from < lane.side.start + FURNITURE_CORNER_CLEAR || to > lane.side.start + lane.side.length - FURNITURE_CORNER_CLEAR) return false;
  for (let index = 0; index < lane.taken.length; index += 2) if (from < lane.taken[index + 1]! && to > lane.taken[index]!) return false;
  return true;
}

/** Half the length (m) along the face of a card or box turned `turn` off facing the street. */
function alongHalf(row: SceneryAsset, turn: number): number {
  const [depth, , width] = assetScale(row, 1);
  return (width * Math.abs(detCos(turn)) + depth * Math.abs(detSin(turn))) / 2;
}

/** Stand `item` as near `preferred` along the lane as it fits, sliding either way up to `slide` m; whether it fit. */
function standItem(lane: Lane, item: KitItem, preferred: number, slide: number, geometry: Geometry, props: FabricProp[]): boolean {
  const half = alongHalf(rowOf(item.asset), item.turn);
  for (let step = 0; step * SLIDE_STEP <= slide; step++) {
    for (const direction of SLIDE_DIRECTIONS) {
      if (step === 0 && direction < 0) continue;
      const along = preferred + direction * step * SLIDE_STEP;
      if (!isFree(lane, along - half - FURNITURE_GAP, along + half + FURNITURE_GAP)) continue;
      lane.taken.push(along - half, along + half);
      const at = sidePoint(lane.side, along, geometry.sidewalk - item.stripShare * geometry.sidewalkFurniture);
      props.push(assetProp(item.asset, at.x, at.z, lane.side.outwardYaw + item.turn));
      return true;
    }
  }
  return false;
}

/** Stand a place's frontage kit on its face, the first piece of a bus stop's (its shelter) wherever on the face it fits. */
function standKit(lanes: readonly (readonly Lane[])[], lots: Lots, index: number, props: FabricProp[]): void {
  const place = lots.places[index]!;
  const kit = FRONTAGE_KITS[place.kind];
  const link = lots.links.find((candidate) => candidate.place === index);
  if (kit === undefined || link === undefined || link.side === null || index >= lots.backdropStart) return;
  const isBusStop = place.kind === PLACE_KIND.transit;
  if (!isBusStop && place.storeys === 0) return;
  const lane = lanes[link.block]!.find((candidate) => candidate.side.side === link.side)!;
  const door = lane.side.alongX ? place.doorX : place.doorZ;
  for (const [slot, item] of kit.entries()) {
    const required = isBusStop && slot === 0;
    const fit = standItem(lane, item, door + item.offset, required ? lane.side.length : KIT_SLIDE, lots.geometry, props);
    if (required && !fit) throw new Error(`openworld fabric: no room for the bus shelter at ${place.name}`);
  }
}

/** Bus stops first (their shelter is the widest piece), then the businesses' kits and a hydrant per face, round lamps and street trees. */
function frontageProps(lots: Lots, random: () => number): FabricProp[] {
  const lanes = lots.blocks.map((block) => sidesOf(block, lots.geometry).map(laneOf));
  const props: FabricProp[] = [];
  for (const [index, place] of lots.places.entries()) if (place.kind === PLACE_KIND.transit) standKit(lanes, lots, index, props);
  for (const [index, place] of lots.places.entries()) if (place.kind !== PLACE_KIND.transit) standKit(lanes, lots, index, props);
  for (const faces of lanes) {
    for (const lane of faces) {
      const preferred = lane.side.start + lane.side.length * (HYDRANT_SHARE.min + (HYDRANT_SHARE.max - HYDRANT_SHARE.min) * random());
      if (!standItem(lane, HYDRANT_ITEM, preferred, lane.side.length, lots.geometry, props)) throw new Error(`openworld fabric: no room for a hydrant on the ${lane.side.side} face at ${lane.side.fixed}`);
    }
  }
  return props;
}

/** The city's street fabric as course props that name scenery assets: marked crossings at the walk graph's crossing edges, a manhole cover per street segment, street-name signs and storm drains at block corners, a hydrant per block face and the frontage kits of businesses and the bus stop. */
export function fabricProps(lots: Lots, graph: WalkGraph): FabricProp[] {
  const random = mulberry32(FABRIC_SEED);
  return [...crossingProps(lots.geometry, graph), ...manholeProps(lots.geometry, random), ...cornerProps(lots), ...frontageProps(lots, random)];
}
