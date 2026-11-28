import { FRAME_HZ } from "../kernel/constants.ts";
import { frame, makeCar, worldOf } from "../vehicle/ground-probe.test-util.ts";
import { PREFAB } from "../world/constants.ts";
import { propColliders, solidsOf, type Placed } from "../world/placements.ts";
import { TREE_SCALE } from "../world/scenery.ts";
import { armSolids } from "../world/surfaces.ts";
import { propContact, type PropHits } from "./prop-contact.ts";

const NO_HITS: PropHits = { knock: () => {}, fx: () => {}, wall: () => {} };
/** How far off a tree's axis the dropped car's middle is: its footprint straddles the trunk. */
const OFF_AXIS = 0.4;
const DROP_SECONDS = 2.4;
const SAMPLE_EVERY = 6;

/** A sedan on flat ground with the tree `style` names (a tree of the old crown when undefined) standing at the origin; `tree` false leaves the ground bare. */
export function treeWorld(style: string | undefined, tree = true) {
  const placed: Placed[] = tree ? [{ prefab: PREFAB.tree, x: 0, y: 0, z: 0, yaw: 0, sx: TREE_SCALE, sy: TREE_SCALE, sz: TREE_SCALE, style }] : [];
  const colliders = propColliders(placed);
  const solids = solidsOf([], colliders);
  armSolids(solids);
  const car = makeCar("sedan");
  const knocked = new Uint8Array(placed.length);
  const world = worldOf(car, (c, h) => propContact(c, 0, solids, knocked, NO_HITS, h));
  return { car, world, top: Math.max(0, ...colliders.map((c) => c.top)) };
}

/** The sedan's height every tenth of a second as it falls from `from` m, `OFF_AXIS` m off the tree's axis. */
export function fallFrom(from: number, style: string | undefined, tree = true): number[] {
  const { car, world } = treeWorld(style, tree);
  car.spawnFacing(OFF_AXIS, 0, 0, 0);
  car.group.position.y = from;
  car.airborne = true;
  const state = { acc: 0 };
  const heights: number[] = [];
  for (let f = 0; f < DROP_SECONDS * FRAME_HZ; f++) {
    frame(world, null, state);
    if (f % SAMPLE_EVERY === SAMPLE_EVERY - 1) heights.push(car.group.position.y);
  }
  return heights;
}

/** The most a dropped car's height may differ from the same drop with no tree (m). */
export const FREE_FALL_SLACK = 0.02;
