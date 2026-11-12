import { detCos, detSin, hypot2 } from "../../kernel/physics-core.js";
import type { PrefabId, SurfaceId } from "../catalog.ts";
import { PREFAB, SURFACE } from "../constants.ts";
import { FACING, PARK, PARK_BLOCK } from "./openworld-constants.ts";
import type { BlockRef, Geometry, Lots } from "./openworld-layout.ts";
import { HOOP_FENCE } from "../street-kit.ts";
import { PLAZA_RADIUS } from "./openworld-plaza.ts";

/**
 * The park's dressing, after Rittenhouse Square: its paths paved, a round plaza at the crossing of the middle paths (its stone bench rings and statue, `openworld-plaza.ts`),
 * slat benches beside the paths facing them, a bin by every other bench, lamps along the paths, low hoop fences round the lawns behind the benches and a small pavilion
 * on the south-west lawn. The paths are the walk graph's own (`openworld-blocks.ts`); nothing stands on one.
 */

/** Paths and the plaza are laid in pavers. */
const PAVERS: SurfaceId = SURFACE.cobble;
/** Sides of the plaza's paved circle. */
const PLAZA_SIDES = 32;
/** Half a path's width (m). */
const PATH_HALF = PARK.pathWidth / 2;
/** A bench stands this far (m) from its path's middle: its 0.6 m depth 0.1 m off the path's edge. */
const BENCH_OFF = PATH_HALF + 0.4;
/** Benches stand every 12 m along a path from 6 m in, so one is never across a lamp; lamps every 24 m, on alternate sides, at the path's edge. */
const BENCH_SPACING = 12;
const BENCH_FIRST = 6;
const LAMP_SPACING = 24;
const LAMP_OFF = PATH_HALF + 0.45;
/** How far (m) round its middle a bench, a bin and a lamp reach: a bench's half length, a bin's radius, a lamp's arm. */
const BENCH_REACH = 0.8;
const BIN_REACH = 0.26;
const LAMP_REACH = 0.3;
/** A bin stands beside every other bench, this far (m) along the path from its middle (past its 0.8 m half length). */
const BIN_ALONG = 1.3;
const BIN_OFF = PATH_HALF + 0.4;
/** The lawns' hoop fences stand behind the benches, this far (m) from the path's middle, in runs of a fence section's length. */
const FENCE_OFF = PATH_HALF + 1.6;
const FENCE_RUN = 2 * HOOP_FENCE.halfLength;
/** Nothing stands within this (m) of the park's edge (the street's sidewalk), of the plaza's ring, of the court or of another path's edge. */
const EDGE_CLEAR = 2.5;
const PLAZA_CLEAR = 1;
const COURT_CLEAR = 1.5;
const CROSS_CLEAR = 0.6;
/** The pavilion stands in the middle of the south-west lawn: halfway between the west and middle paths, halfway down from the east-west path. */
const PAVILION_SHARE = { across: 0.5, down: 0.5 } as const;
const QUARTER_TURN = Math.PI / 2;

type ParkProp = { prefab: PrefabId; x: number; z: number; yaw: number; style?: typeof PARK_LAMP };
/** The style a park's lamp is placed with: it stands on the ground, not on a sidewalk slab, so its light pool lies on the ground (`prefabParts`). */
export const PARK_LAMP = "park-lamp";
type ParkPaint = { surface: SurfaceId; poly: [number, number][] };

/** A straight path's middle line: along x (at z `fixed`) or along z (at x `fixed`), from `from` to `to`. */
type Path = { alongX: boolean; fixed: number; from: number; to: number };

/** The park and what its dressing keeps clear of. */
type Park = { block: BlockRef; paths: Path[]; court: { x0: number; z0: number; x1: number; z1: number }; courtX: number; geometry: Geometry };

function parkOf(lots: Lots): Park | null {
  const block = lots.blocks.find((candidate) => candidate.column === PARK_BLOCK.column && candidate.row === PARK_BLOCK.row);
  if (block === undefined) return null;
  const geometry = lots.geometry;
  const halfLength = geometry.blockLength / 2;
  const halfDepth = geometry.blockDepth / 2;
  const courtX = block.centreX + PARK.courtOffsetX;
  const courtZ = block.centreZ + PARK.courtOffsetZ;
  const paths: Path[] = [{ alongX: true, fixed: block.centreZ, from: block.centreX - halfLength, to: block.centreX + halfLength }];
  for (const offset of PARK.crossPaths) paths.push({ alongX: false, fixed: block.centreX + offset, from: block.centreZ - halfDepth, to: block.centreZ + halfDepth });
  // The court's spur runs from the east-west path to the court's north edge.
  paths.push({ alongX: false, fixed: courtX, from: block.centreZ, to: courtZ - PARK.courtWidth / 2 });
  const court = { x0: courtX - PARK.courtLength / 2, z0: courtZ - PARK.courtWidth / 2, x1: courtX + PARK.courtLength / 2, z1: courtZ + PARK.courtWidth / 2 };
  return { block, paths, court, courtX, geometry };
}

/** The ground of a path, as a polygon. */
function pathPoly(path: Path): [number, number][] {
  const [a0, a1, b0, b1] = [path.from, path.to, path.fixed - PATH_HALF, path.fixed + PATH_HALF];
  return path.alongX
    ? [
        [a0, b0],
        [a1, b0],
        [a1, b1],
        [a0, b1],
      ]
    : [
        [b0, a0],
        [b1, a0],
        [b1, a1],
        [b0, a1],
      ];
}

/** The park's paved ground: every path and the plaza's circle. Paint goes on bare ground first come, so these go before the lawn. */
export function parkPaint(lots: Lots): ParkPaint[] {
  const park = parkOf(lots);
  if (park === null) return [];
  const plaza: [number, number][] = Array.from({ length: PLAZA_SIDES }, (_, side) => {
    const angle = (side * 2 * Math.PI) / PLAZA_SIDES;
    return [park.block.centreX + PLAZA_RADIUS * detCos(angle), park.block.centreZ + PLAZA_RADIUS * detSin(angle)];
  });
  return [{ surface: PAVERS, poly: plaza }, ...park.paths.map((path) => ({ surface: PAVERS, poly: pathPoly(path) }))];
}

/** Whether a thing reaching `reach` m round (x, z) would touch a path's ground (but `own`'s, which it stands beside), the plaza's ring, the court or the park's edge. */
function blocked(park: Park, x: number, z: number, reach: number, own: Path | null): boolean {
  const { block, geometry, court } = park;
  if (Math.abs(x - block.centreX) > geometry.blockLength / 2 - EDGE_CLEAR - reach || Math.abs(z - block.centreZ) > geometry.blockDepth / 2 - EDGE_CLEAR - reach) return true;
  if (hypot2(x - block.centreX, z - block.centreZ) < PLAZA_RADIUS + PLAZA_CLEAR + reach) return true;
  if (x > court.x0 - COURT_CLEAR - reach && x < court.x1 + COURT_CLEAR + reach && z > court.z0 - COURT_CLEAR - reach && z < court.z1 + COURT_CLEAR + reach) return true;
  for (const path of park.paths) {
    if (path === own) continue;
    const along = path.alongX ? x : z;
    const across = Math.abs((path.alongX ? z : x) - path.fixed);
    if (along > path.from - reach && along < path.to + reach && across < PATH_HALF + CROSS_CLEAR + reach) return true;
  }
  return false;
}

/** The point `along` a path and `out` m to one side of its middle (negative: the other side). */
function besidePath(path: Path, along: number, out: number): { x: number; z: number } {
  return path.alongX ? { x: along, z: path.fixed + out } : { x: path.fixed + out, z: along };
}

/** The yaw that turns a prefab's front (local +x) toward its path from the side `side` (+1: the greater x or z). */
function facingPath(path: Path, side: number): number {
  if (path.alongX) return side > 0 ? FACING.north : FACING.south;
  return side > 0 ? FACING.west : FACING.east;
}

/** Benches facing each path, a bin by every other, lamps on alternate sides. */
function pathSideProps(park: Park, path: Path, props: ParkProp[]): void {
  let benches = 0;
  for (let along = path.from + BENCH_FIRST; along < path.to; along += BENCH_SPACING) {
    for (const side of [-1, 1]) {
      const bench = besidePath(path, along, side * BENCH_OFF);
      if (blocked(park, bench.x, bench.z, BENCH_REACH, path)) continue;
      props.push({ prefab: PREFAB.bench, ...bench, yaw: facingPath(path, side) });
      benches++;
      const bin = besidePath(path, along + BIN_ALONG, side * BIN_OFF);
      if (benches % 2 === 0 && !blocked(park, bin.x, bin.z, BIN_REACH, path)) props.push({ prefab: PREFAB.litterBin, ...bin, yaw: facingPath(path, side) });
    }
  }
  let lamps = 0;
  for (let along = path.from + LAMP_SPACING; along < path.to; along += LAMP_SPACING) {
    const side = lamps % 2 === 0 ? 1 : -1;
    const lamp = besidePath(path, along, side * LAMP_OFF);
    if (blocked(park, lamp.x, lamp.z, LAMP_REACH, path)) continue;
    props.push({ prefab: PREFAB.acornLamp, ...lamp, yaw: facingPath(path, side), style: PARK_LAMP });
    lamps++;
  }
}

/** The lawns' hoop fences: runs along each path behind its benches, none across another path, the plaza, the court or the park's edge. */
function fenceProps(park: Park, path: Path, props: ParkProp[]): void {
  for (let start = path.from; start + FENCE_RUN <= path.to; start += FENCE_RUN) {
    for (const side of [-1, 1]) {
      const ends = [besidePath(path, start, side * FENCE_OFF), besidePath(path, start + FENCE_RUN, side * FENCE_OFF)];
      const middle = besidePath(path, start + FENCE_RUN / 2, side * FENCE_OFF);
      if ([...ends, middle].some((point) => blocked(park, point.x, point.z, 0, path))) continue;
      props.push({ prefab: PREFAB.hoopFence, ...middle, yaw: path.alongX ? QUARTER_TURN : 0 });
    }
  }
}

/** The park's props: the plaza at the middle, the paths' benches, bins, lamps and fences, and the pavilion. */
export function parkProps(lots: Lots): ParkProp[] {
  const park = parkOf(lots);
  if (park === null) return [];
  const props: ParkProp[] = [{ prefab: PREFAB.plaza, x: park.block.centreX, z: park.block.centreZ, yaw: 0 }];
  // The court's spur is too short for benches; its edges keep everything else clear.
  for (const path of park.paths.slice(0, -1)) {
    pathSideProps(park, path, props);
    fenceProps(park, path, props);
  }
  const westPath = park.paths[1]!.fixed;
  const middlePath = park.paths[2]!.fixed;
  props.push({
    prefab: PREFAB.pavilion,
    x: westPath + (middlePath - westPath) * PAVILION_SHARE.across,
    z: park.block.centreZ + (park.geometry.blockDepth / 2) * PAVILION_SHARE.down,
    yaw: 0,
  });
  return props;
}
