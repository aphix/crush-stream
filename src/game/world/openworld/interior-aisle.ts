import { hypot2 } from "../../kernel/physics-core.js";
import { footprintOf, stairBoxes, wallBoxes } from "./interior-draft.ts";
import { ceilingOver, TURN, type Box, type InteriorPlan, type Rect } from "./interior-kinds.ts";
import { CLERK_SPOTS, STAND_COLUMNS, STAND_ROW_DEPTH, STAND_SPACING, STAND_SPOTS } from "./walk-graph.ts";

/** The aisle's grid: points this far apart (m), each this far clear of a wall or a piece of furniture (a body's half and a little). */
const AISLE_STEP = 0.5;
const AISLE_CLEAR = 0.35;
/** A standing-room point is this far clear of furniture, a metre from the next, and this far from the door (so nobody stands in it). */
const ROOM_CLEAR = 0.55;
const ROOM_FROM_DOOR = 1.5;
/** A standing-room point keeps this far (m) back from the serving counter's front, on the customers' side. */
const ROOM_FROM_COUNTER = 0.6;
/** Where a customer stands to buy, from the counter's front (m). */
export const CUSTOMER_REACH = 0.5;
/** What blocks a body: anything between these heights over the floor (m). */
const BODY_LOW = 0.1;
const BODY_HIGH = 1.7;
/** The aisle starts this deep (m), past the street wall, in the door's vestibule. */
const DOOR_INNER = 1;

/** A room's aisle in plan metres: a tree over the walkable grid from just inside the street door (`deep`, `across`, `parent` per node, the root first, its parent -1), and the nodes a customer may stand at. */
type PlanAisle = { deep: number[]; across: number[]; parent: number[]; room: number[] };

/** The ground floor's boxes that block a body at body height: its walls, and those with its stair treads and furniture. */
function blockers(plan: InteriorPlan): { walls: Box[]; all: Box[] } {
  const floor = plan.floors[0]!;
  const atBody = (box: Box): boolean => box.y1 > floor + BODY_LOW && box.y0 < floor + BODY_HIGH;
  const walls = plan.walls.filter((wall) => wall.level === 0).flatMap((wall) => wallBoxes(wall, floor, ceilingOver(plan.floors, plan.topCeiling, 0))).filter(atBody);
  const all = [...walls];
  for (const flight of plan.stairs) if (flight.level === 0) all.push(...stairBoxes(flight, floor).filter(atBody));
  for (const piece of plan.furnishings) if (piece.level === 0) all.push(...[{ ...footprintOf(piece), y0: floor + piece.lift, y1: floor + piece.lift + piece.height }].filter(atBody));
  return { walls, all };
}

const clearOf = (boxes: readonly Rect[], deep: number, across: number, clear: number): boolean =>
  boxes.every((box) => deep <= box.deep0 - clear || deep >= box.deep1 + clear || across <= box.across0 - clear || across >= box.across1 + clear);

/** Whether the segment from (d0, a0) to (d1, a1) crosses `box` (slab test). */
function crosses(box: Rect, d0: number, a0: number, d1: number, a1: number): boolean {
  let near = 0;
  let far = 1;
  for (const [from, along, low, high] of [[d0, d1 - d0, box.deep0, box.deep1], [a0, a1 - a0, box.across0, box.across1]] as const) {
    if (Math.abs(along) < 1e-9) {
      if (from < low || from > high) return false;
      continue;
    }
    const t0 = (low - from) / along;
    const t1 = (high - from) / along;
    near = Math.max(near, Math.min(t0, t1));
    far = Math.min(far, Math.max(t0, t1));
  }
  return near <= far;
}

/** The walkable grid's points as a breadth-first tree from the one nearest just inside the door at `doorAcross`, eight ways (a diagonal step needs both its sides free). */
function grow(plan: InteriorPlan, boxes: readonly Box[], doorAcross: number): PlanAisle & { column: number[]; row: number[] } {
  const rows = Math.floor(plan.depth / AISLE_STEP);
  const columns = Math.floor(plan.width / AISLE_STEP);
  const deepOf = (row: number): number => (row + 0.5) * AISLE_STEP;
  const acrossOf = (column: number): number => (column + 0.5) * AISLE_STEP - plan.width / 2;
  const free = (row: number, column: number): boolean => row >= 0 && column >= 0 && row < rows && column < columns && clearOf(boxes, deepOf(row), acrossOf(column), AISLE_CLEAR);
  const nodeAt = new Int32Array(rows * columns).fill(-1);
  const out = { deep: [] as number[], across: [] as number[], parent: [] as number[], room: [] as number[], column: [] as number[], row: [] as number[] };
  let root = -1;
  let rootGap = Infinity;
  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      const gap = hypot2(deepOf(row) - DOOR_INNER, acrossOf(column) - doorAcross);
      if (gap < rootGap && free(row, column)) [root, rootGap] = [row * columns + column, gap];
    }
  }
  if (root < 0) return out;
  const add = (cell: number, parent: number): void => {
    nodeAt[cell] = out.deep.length;
    out.row.push(Math.floor(cell / columns));
    out.column.push(cell % columns);
    out.deep.push(deepOf(Math.floor(cell / columns)));
    out.across.push(acrossOf(cell % columns));
    out.parent.push(parent);
  };
  add(root, -1);
  for (let node = 0; node < out.deep.length; node++) {
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        const row = out.row[node]! + dr;
        const column = out.column[node]! + dc;
        if ((dr === 0 && dc === 0) || !free(row, column) || nodeAt[row * columns + column]! >= 0) continue;
        if (dr !== 0 && dc !== 0 && (!free(row, out.column[node]!) || !free(out.row[node]!, column))) continue;
        add(row * columns + column, node);
      }
    }
  }
  return out;
}

/** Spots by a counter keep this far (m) off every wall and piece of furniture: a body's half-width (two bodies keep 0.6 m apart). */
const SPOT_CLEAR = 0.3;
/** Rows tried back from the counter, and steps tried along it either side (half a spot's spacing each), before a room is out of floor for its spots. */
const SPOT_ROWS = 6;
const SPOT_STEPS = 12;
/** A blocked spot slides toward the counter in steps this long (m), up to where a body's half-width still clears the counter's front: a clerk's galley behind a counter (Bodega Supreme's 0.64 m to its party wall, Kelly's 0.74 m to its back shelf; measured) is narrower than its nominal spot leaves room for. */
const SPOT_SLIDE_STEP = 0.02;
const SPOT_SLIDE = CUSTOMER_REACH - SPOT_CLEAR;

/** The nth step of a row of bodies along a line, centred: 0, then 1 to the right, 1 to the left, 2 to the right...; in whole steps. */
function lateralStep(column: number): number {
  return column === 0 ? 0 : (column & 1) === 1 ? (column + 1) / 2 : -column / 2;
}

/** Where a counter's spots are searched from: a spot at its front (or back), the way away from the counter, and how far the counter runs from it each way along (`along` grows toward (-outZ, outX)); 2D, plan or world. */
export type CounterSide = { x: number; z: number; outX: number; outZ: number; alongMin: number; alongMax: number };

/**
 * Up to `count` spots on one side of a counter into `into` (x, z pairs), each a spot's spacing from every spot in `into` already, `clear` (off every solid) and `inSight` of the side's spot: rows of half-spacing steps along it
 * from `firstRow` back, nearest first, each slid toward the counter (`SPOT_SLIDE`) where its own place is blocked; `alongside` keeps them within the counter's length (a buying lane or a clerk faces the counter).
 */
function searchSide(side: CounterSide, firstRow: number, count: number, alongside: boolean, into: number[], clear: (x: number, z: number) => boolean, inSight: (x: number, z: number) => boolean): void {
  const target = into.length + 2 * count;
  for (let row = firstRow; row < firstRow + SPOT_ROWS && into.length < target; row++) {
    for (let step = 0; step <= 2 * SPOT_STEPS && into.length < target; step++) {
      const along = (lateralStep(step) * STAND_SPACING) / 2;
      if (alongside && (along < side.alongMin || along > side.alongMax)) continue;
      let x = 0;
      let z = 0;
      let found = false;
      for (let slide = 0; slide * SPOT_SLIDE_STEP <= SPOT_SLIDE + 1e-9 && !found; slide++) {
        const back = row * STAND_ROW_DEPTH - slide * SPOT_SLIDE_STEP;
        x = side.x + side.outX * back - side.outZ * along;
        z = side.z + side.outZ * back + side.outX * along;
        found = clear(x, z) && inSight(x, z);
      }
      if (!found) continue;
      let apart = true;
      for (let at = 0; at < into.length && apart; at += 2) apart = hypot2(into[at]! - x, into[at + 1]! - z) >= STAND_SPACING - 1e-6;
      if (apart) into.push(x, z);
    }
  }
  if (into.length < target) throw new Error(`a counter's room has floor for ${into.length / 2} of its ${target / 2} spots`);
}

/**
 * The spots by a serving counter as x, z pairs: `STAND_COLUMNS` buying lanes (along its front within its length, then further back), `STAND_SPOTS` customers' standing spots behind them and `CLERK_SPOTS` clerks' spots along its back,
 * every one clear and in sight of its side's spot and a spot's spacing from the rest. `clear` and `inSight` are always true in a room with nothing in it.
 */
export function counterStandSpots(customer: CounterSide, clerk: CounterSide, clear: (x: number, z: number) => boolean = () => true, inSight: (fromX: number, fromZ: number, x: number, z: number) => boolean = () => true): Float32Array {
  const customers: number[] = [];
  const fromCustomer = (x: number, z: number): boolean => inSight(customer.x, customer.z, x, z);
  searchSide(customer, 0, STAND_COLUMNS, true, customers, clear, fromCustomer);
  searchSide(customer, 1, STAND_SPOTS, false, customers, clear, fromCustomer);
  const clerks: number[] = [];
  searchSide(clerk, 0, CLERK_SPOTS, true, clerks, clear, (x, z) => inSight(clerk.x, clerk.z, x, z));
  return Float32Array.from([...customers, ...clerks]);
}

/** `counterStandSpots` in a plan's room, in plan metres (x deep, z across): clear of every wall and piece of furniture at body height by `SPOT_CLEAR`, no wall between a spot and its side's spot. */
export function planStandSpots(plan: InteriorPlan, customer: CounterSide, clerk: CounterSide): Float32Array {
  const { walls, all: boxes } = blockers(plan);
  return counterStandSpots(
    customer,
    clerk,
    (deep, across) => clearOf(boxes, deep, across, SPOT_CLEAR),
    (fromDeep, fromAcross, deep, across) => !walls.some((box) => crosses(box, deep, across, fromDeep, fromAcross)),
  );
}

/** The plan's aisle, or null where it has no serving counter (nobody is drawn inside it) or no floor at its door; its standing room keeps a spot's spacing from the counter's spots (`stands`, plan x, z pairs). */
export function planAisle(plan: InteriorPlan, doorAcross: number, stands: Float32Array): PlanAisle | null {
  const counter = plan.furnishings.find((piece) => piece.serves);
  if (counter === undefined || plan.kind === "rowhome") return null;
  const { walls, all: boxes } = blockers(plan);
  const tree = grow(plan, boxes, doorAcross);
  if (tree.deep.length === 0) return null;
  const [stepDeep, stepAcross] = counter.facing === TURN.front ? [-1, 0] : counter.facing === TURN.back ? [1, 0] : counter.facing === TURN.right ? [0, 1] : [0, -1];
  const front = counter.depth / 2 + ROOM_FROM_COUNTER;
  const spotDeep = counter.deep + stepDeep * front + (stepAcross !== 0 ? counter.serveAt : 0);
  const spotAcross = counter.across + stepAcross * front + (stepDeep !== 0 ? counter.serveAt : 0);
  for (let node = 0; node < tree.deep.length; node++) {
    const deep = tree.deep[node]!;
    const across = tree.across[node]!;
    if (tree.row[node]! % 2 !== 0 || tree.column[node]! % 2 !== 0 || hypot2(deep - tree.deep[0]!, across - tree.across[0]!) < ROOM_FROM_DOOR) continue;
    if ((deep - counter.deep) * stepDeep + (across - counter.across) * stepAcross < front || !clearOf(boxes, deep, across, ROOM_CLEAR)) continue;
    let nearSpot = false;
    for (let at = 0; at < stands.length && !nearSpot; at += 2) nearSpot = hypot2(stands[at]! - deep, stands[at + 1]! - across) < STAND_SPACING;
    if (nearSpot) continue;
    if (walls.some((box) => crosses(box, deep, across, spotDeep, spotAcross))) continue;
    tree.room.push(node);
  }
  return { deep: tree.deep, across: tree.across, parent: tree.parent, room: tree.room };
}
