import { detCos, detSin, hypot2 } from "../../kernel/physics-core.js";
import type { PrefabId } from "../catalog.ts";
import { PREFAB } from "../constants.ts";
import { mulberry32 } from "../placements.ts";
import { TREE_SCALE } from "../scenery.ts";
import { PARK, PARK_BLOCK } from "./openworld-constants.ts";
import { BOXWOOD_BALL, greeneryAssetAt, parkTreeStyle, type GreeneryProp } from "./openworld-greenery.ts";
import type { Lots, PathPlan } from "./openworld-layout.ts";
import { parkProps } from "./openworld-park.ts";
import { PLAZA_RADIUS } from "./openworld-plaza.ts";

/**
 * The park's big trees, after Rittenhouse Square's: planes and lindens in round dirt beds on the lawns, each ringed by boxwood balls, set well back from the paths, the benches and their fences so their canopies
 * (high over a walker's head) shade the paths. They are the street tree prop (the same solid), so a car meets a trunk; the beds' boxwood is drawn only.
 */

/** A tree prop as the course takes it: the street tree's station and scale, no yaw, and a style naming its kind. */
type ParkTree = { prefab: PrefabId; x: number; z: number; scale: number; style: string };

/** Seed of the park's tree layout, so every peer plants the same lawns. */
const PARK_SEED = 0x9a4b;
/** Lawn lattice step (m) and how far a tree may sit off its lattice point either way (m). */
const LATTICE_STEP = 11;
const JITTER = 3;
/** The round bed's radius (m), and the least between two park trees (m, trunk to trunk). */
const BED_RADIUS = 1.6;
const TREE_SPACING = 9;
/** A park tree stands this far (m) from a path's middle at the least, past the benches (1.6 m out) and the hoop fences (2.8 m out), plus its bed. */
const FENCE_LINE = 2.8;
const FENCE_GAP = 0.4;
/** Nothing stands within these (m) of the park's edge, the plaza's ring and the court (the other dressing's own clearances, `openworld-park.ts`). */
const LAWN_EDGE = 2.5;
const PLAZA_CLEAR = 1;
const COURT_CLEAR = 1.5;
/** How far (m) round its middle each park prop reaches, past which a tree's bed may not come; others are a bench's. */
const PROP_REACH: Readonly<Partial<Record<PrefabId, number>>> = { [PREFAB.pavilion]: 2.7, [PREFAB.litterBin]: 0.3, [PREFAB.lamp]: 0.3 };
const BENCH_HALF_LENGTH = 0.8;
const PROP_GAP = 0.3;
/** Boxwood balls ringed round a bed: their width, their radius from the tree (m) and how many places the ring has (a seeded few are left open). */
const BOX_WIDTH = 0.8;
const RING_RADIUS = 2;
const RING_PLACES = 7;
const RING_OPEN_OF_TEN = 2;
/** The ball's reach (m): half its width. */
const BOX_REACH = BOX_WIDTH / 2;

/** The park: its block's middle, its paths and the props its dressing stands (`parkProps`). */
type Plan = { lots: Lots; centreX: number; centreZ: number; paths: readonly PathPlan[]; props: readonly { prefab: PrefabId; x: number; z: number }[] };

function distanceToSegment(px: number, pz: number, ax: number, az: number, bx: number, bz: number): number {
  const along = (px - ax) * (bx - ax) + (pz - az) * (bz - az);
  const length = (bx - ax) ** 2 + (bz - az) ** 2;
  const share = length === 0 ? 0 : Math.min(1, Math.max(0, along / length));
  return hypot2(px - (ax + share * (bx - ax)), pz - (az + share * (bz - az)));
}

/** Whether something reaching \`reach\` m round (x, z) would stand on a path's strip (and its fence line), the plaza, the court, a bench or a lamp, or past the park's edge. */
function blocked(plan: Plan, x: number, z: number, reach: number): boolean {
  const { lots, centreX, centreZ } = plan;
  if (Math.abs(x - centreX) > lots.geometry.blockLength / 2 - LAWN_EDGE - reach || Math.abs(z - centreZ) > lots.geometry.blockDepth / 2 - LAWN_EDGE - reach) return true;
  if (hypot2(x - centreX, z - centreZ) < PLAZA_RADIUS + PLAZA_CLEAR + reach) return true;
  const courtX = centreX + PARK.courtOffsetX;
  const courtZ = centreZ + PARK.courtOffsetZ;
  if (Math.abs(x - courtX) < PARK.courtLength / 2 + COURT_CLEAR + reach && Math.abs(z - courtZ) < PARK.courtWidth / 2 + COURT_CLEAR + reach) return true;
  for (const path of plan.paths) {
    for (let at = 1; at < path.points.length; at++) {
      const [ax, az] = path.points[at - 1]!;
      const [bx, bz] = path.points[at]!;
      if (distanceToSegment(x, z, ax, az, bx, bz) < FENCE_LINE + FENCE_GAP + reach) return true;
    }
  }
  return plan.props.some((prop) => prop.prefab !== PREFAB.hoopFence && prop.prefab !== PREFAB.plaza && hypot2(x - prop.x, z - prop.z) < (PROP_REACH[prop.prefab] ?? BENCH_HALF_LENGTH) + reach + PROP_GAP);
}

function parkPlan(lots: Lots): Plan | null {
  const index = lots.blocks.findIndex((block) => block.column === PARK_BLOCK.column && block.row === PARK_BLOCK.row);
  if (index < 0) return null;
  const block = lots.blocks[index]!;
  return { lots, centreX: block.centreX, centreZ: block.centreZ, paths: lots.paths.filter((path) => path.block === index), props: parkProps(lots) };
}

/** The park's trees and the boxwood round their beds, laid out on a jittered lattice over the lawns: a candidate is kept when its bed is clear of everything and of the trees kept before it. */
export function parkTreeProps(lots: Lots): { trees: ParkTree[]; boxwood: GreeneryProp[] } {
  const plan = parkPlan(lots);
  if (plan === null) return { trees: [], boxwood: [] };
  const random = mulberry32(PARK_SEED);
  const trees: ParkTree[] = [];
  const boxwood: GreeneryProp[] = [];
  const halfLength = lots.geometry.blockLength / 2;
  const halfDepth = lots.geometry.blockDepth / 2;
  for (let x = plan.centreX - halfLength; x <= plan.centreX + halfLength; x += LATTICE_STEP) {
    for (let z = plan.centreZ - halfDepth; z <= plan.centreZ + halfDepth; z += LATTICE_STEP) {
      const at = { x: x + (random() * 2 - 1) * JITTER, z: z + (random() * 2 - 1) * JITTER };
      if (blocked(plan, at.x, at.z, BED_RADIUS) || trees.some((tree) => hypot2(tree.x - at.x, tree.z - at.z) < TREE_SPACING)) continue;
      trees.push({ prefab: PREFAB.tree, ...at, scale: TREE_SCALE, style: parkTreeStyle(at.x, at.z, trees.length) });
      boxwood.push(...boxwoodRing(plan, at, random));
    }
  }
  return { trees, boxwood };
}

/** Boxwood balls round a bed: the ring's places, a seeded few left open (a way in to the trunk), and any that would stand on a path or a bench left out. */
function boxwoodRing(plan: Plan, tree: { x: number; z: number }, random: () => number): GreeneryProp[] {
  const ring: GreeneryProp[] = [];
  const start = random() * 2 * Math.PI;
  for (let place = 0; place < RING_PLACES; place++) {
    const angle = start + (place * 2 * Math.PI) / RING_PLACES;
    const open = random() * 10 < RING_OPEN_OF_TEN;
    const x = tree.x + RING_RADIUS * detCos(angle);
    const z = tree.z + RING_RADIUS * detSin(angle);
    if (!open && !blocked(plan, x, z, BOX_REACH)) ring.push(greeneryAssetAt(BOXWOOD_BALL, x, z, angle, BOX_WIDTH));
  }
  return ring;
}
