import { detCos, detSin } from "../../kernel/physics-core.js";
import { placeCourse, type Placed } from "../placements.ts";
import { SCENERY_ASSETS } from "../scenery-assets/index.ts";
import { assetScale } from "../scenery-assets/pick.ts";
import { parseTrack, type TrackJson } from "../track-schema.ts";
import { Track, blankProjection, projectPath } from "../track.ts";
import { LAYOUT } from "./openworld-constants.ts";
import { openWorldCourse } from "./openworld-course.ts";
import type { Lots } from "./openworld-layout.ts";
import { fixtureLots } from "./openworld-lots.test-util.ts";
import { buildOpenWorldMap } from "./openworld-map.ts";
import { sidesOf, type BlockSide } from "./openworld-sides.ts";
import { PLACE_KIND, type PlaceKind, type WalkGraph } from "./walk-graph.ts";

/** Businesses the fixture street is given: each kind in turn, spread evenly over the homes. */
const BUSINESS_COUNT = 24;
const BUSINESS_KINDS: readonly PlaceKind[] = [PLACE_KIND.shop, PLACE_KIND.food, PLACE_KIND.hangout, PLACE_KIND.work];
/** The first business stands this many homes in, so none lands on a block's first lot. */
const BUSINESS_PHASE = 5;
/** Slack (m) on a strip's edges: float rounding, not room. */
const EDGE_TOLERANCE = 1e-6;

/** The fixture street with some homes turned into businesses of every kind that has a frontage kit. */
export function businessLots(): Lots {
  const base = fixtureLots(LAYOUT.wallReach);
  const homes = base.places.flatMap((place, index) => (index < base.backdropStart && place.kind === PLACE_KIND.home ? [index] : []));
  const stride = Math.floor(homes.length / BUSINESS_COUNT);
  const kindAt = new Map<number, PlaceKind>();
  for (let business = 0; business < BUSINESS_COUNT; business++) kindAt.set(homes[business * stride + BUSINESS_PHASE]!, BUSINESS_KINDS[business % BUSINESS_KINDS.length]!);
  return { ...base, places: base.places.map((place, index) => (kindAt.has(index) ? { ...place, kind: kindAt.get(index)!, name: `Business ${index}` } : place)) };
}

export const assetIndex = (id: string): number => SCENERY_ASSETS.findIndex((row) => row.id === id);

/** Everything the course places and draws, the generated scenery included: the instrument that sees what a player would. */
export function placedEverything(track: Track): Placed[] {
  const course = placeCourse(track);
  return [...course.placed, ...course.drawn];
}

/** A prop's four footprint corners, from its asset's own size (turned `yaw`, front local +x). */
export function cornersOf(prop: { x: number; z: number; yaw: number; asset: string }): [number, number][] {
  const [depth, , width] = assetScale(SCENERY_ASSETS[assetIndex(prop.asset)]!, 1);
  const corners: [number, number][] = [];
  for (const localX of [-depth / 2, depth / 2]) {
    for (const localZ of [-width / 2, width / 2]) corners.push([prop.x + localX * detCos(prop.yaw) + localZ * detSin(prop.yaw), prop.z - localX * detSin(prop.yaw) + localZ * detCos(prop.yaw)]);
  }
  return corners;
}

/** Where (x, z) lies on a face: its coordinate along the side and how far out from the property line. */
export function onFace(side: BlockSide, x: number, z: number): { along: number; out: number } {
  return side.alongX ? { along: x, out: side.outward * (z - side.fixed) } : { along: z, out: side.outward * (x - side.fixed) };
}

/** Whether (x, z) is in a face's furniture strip; `pastEnds` m beyond either end of the face count (a corner's sidewalk). */
export function inStrip(side: BlockSide, lots: Lots, x: number, z: number, pastEnds: number): boolean {
  const geometry = lots.geometry;
  const { along, out } = onFace(side, x, z);
  const inAlong = along >= side.start - pastEnds - EDGE_TOLERANCE && along <= side.start + side.length + pastEnds + EDGE_TOLERANCE;
  return inAlong && out >= geometry.sidewalk - geometry.sidewalkFurniture - EDGE_TOLERANCE && out <= geometry.sidewalk + EDGE_TOLERANCE;
}

/** Every face of every playable block. */
export function allFaces(lots: Lots): BlockSide[] {
  return lots.blocks.flatMap((block) => sidesOf(block, lots.geometry));
}

/** How far (m) (x, z) lies inside a road: positive on one, negative off every road. */
export function roadDepth(track: Track, x: number, z: number): number {
  const projection = blankProjection();
  let depth = -Infinity;
  for (const path of track.paths()) {
    projectPath(path, x, z, -1, projection);
    depth = Math.max(depth, path.half[projection.k]! - Math.sqrt(projection.dist2));
  }
  return depth;
}

/** The street the fabric tests read: the lots, the parsed course, the course as a track, the walk graph and everything the course places. */
export type FabricCourse = { lots: Lots; course: TrackJson; track: Track; graph: WalkGraph; everything: Placed[] };

export function fabricCourse(): FabricCourse {
  const lots = businessLots();
  const input = openWorldCourse(lots);
  const track = new Track(input);
  return { lots, course: parseTrack(input), track, graph: buildOpenWorldMap(lots).graph, everything: placedEverything(track) };
}
