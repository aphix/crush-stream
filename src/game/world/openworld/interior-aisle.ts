import { hypot2 } from "../../kernel/physics-core.js";
import { footprintOf, stairBoxes, wallBoxes } from "./interior-draft.ts";
import { ceilingOver, TURN, type Box, type InteriorPlan, type Rect } from "./interior-kinds.ts";
import { STAND_COLUMNS, STAND_ROW_DEPTH, STAND_SPACING, STAND_SPOTS } from "./walk-graph.ts";

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
/** Standing room keeps clear of the block of standing spots by the serving point (`STAND_SPOTS` in rows of `STAND_COLUMNS` behind the lane) by a spot's spacing: this far along the counter either side, and this far out from the counter's front (m). */
const STAND_BLOCK_HALF = ((STAND_COLUMNS - 1) / 2) * STAND_SPACING + STAND_SPACING;
const STAND_BLOCK_OUT = CUSTOMER_REACH + Math.ceil(STAND_SPOTS / STAND_COLUMNS) * STAND_ROW_DEPTH + STAND_SPACING;
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

/** The plan's aisle, or null where it has no serving counter (nobody is drawn inside it) or no floor at its door. */
export function planAisle(plan: InteriorPlan, doorAcross: number): PlanAisle | null {
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
    const along = stepDeep !== 0 ? across - spotAcross : deep - spotDeep;
    if (Math.abs(along) < STAND_BLOCK_HALF && (deep - counter.deep) * stepDeep + (across - counter.across) * stepAcross < counter.depth / 2 + STAND_BLOCK_OUT) continue;
    if (walls.some((box) => crosses(box, deep, across, spotDeep, spotAcross))) continue;
    tree.room.push(node);
  }
  return { deep: tree.deep, across: tree.across, parent: tree.parent, room: tree.room };
}
