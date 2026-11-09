import { ceilingOver, Draft, footprintOf, stairBoxes, wallBoxes } from "./interior-draft.ts";
import { layoutBar, layoutCoffee, layoutOffice, layoutRowhome, layoutStore } from "./interior-layouts.ts";
import { BAY_WIDTH, FURNISHING, SHOPFRONT, STOOP_SEAT, TURN, type Box, type Furnishing, type InteriorPlan, type Turn } from "./interior-kinds.ts";
import { COUNTER_STRIDE, SEAT_STRIDE, type InteriorKind, type Place } from "./walk-graph.ts";

const LAYOUTS = { rowhome: layoutRowhome, coffee: layoutCoffee, bar: layoutBar, office: layoutOffice, store: layoutStore } as const satisfies Record<InteriorKind, (draft: Draft) => void>;

/** The plan of an interior for a building `width` wide and `depth` deep (m): pure, the same for every peer. */
export function planInterior(kind: InteriorKind, width: number, depth: number): InteriorPlan {
  const draft = new Draft(kind, width, depth);
  draft.floor(0);
  draft.roof();
  for (let level = 0; level < draft.floors.length; level++) draft.envelope(level);
  LAYOUTS[kind](draft);
  return draft.plan();
}

/** A solid in world metres: its plan rectangle's bounds and its heights. */
export type InteriorSolid = { x0: number; z0: number; x1: number; z1: number; y0: number; y1: number };

/** Where a customer stands to buy, from the counter's front; and where the clerk stands behind it (m). */
const CUSTOMER_REACH = 0.5;
const CLERK_REACH = 0.5;
const HALF_TURN = Math.PI / 2;
const QUARTER_COS = [1, 0, -1, 0] as const;
const QUARTER_SIN = [0, 1, 0, -1] as const;
/** Building yaws are quarter turns; a place off one cannot have its plan mapped by exact integer rotation. */
const QUARTER_TOLERANCE = 1e-6;

/** The place's map from plan coordinates to the world: a quarter-turn rotation, so every result is exact. */
class Frame {
  private readonly place: Pick<Place, "x" | "z" | "yaw" | "depth">;
  private readonly cos: number;
  private readonly sin: number;

  constructor(place: Pick<Place, "x" | "z" | "yaw" | "depth">) {
    this.place = place;
    const turns = place.yaw / HALF_TURN;
    if (Math.abs(turns - Math.round(turns)) > QUARTER_TOLERANCE) throw new Error(`an interior needs a building turned a quarter turn, not yaw ${place.yaw}`);
    const quarter = ((Math.round(turns) % 4) + 4) % 4;
    this.cos = QUARTER_COS[quarter]!;
    this.sin = QUARTER_SIN[quarter]!;
  }

  x(deep: number, across: number): number {
    const front = this.place.depth / 2 - deep;
    return this.place.x + front * this.cos + across * this.sin;
  }

  z(deep: number, across: number): number {
    const front = this.place.depth / 2 - deep;
    return this.place.z - front * this.sin + across * this.cos;
  }

  /** The yaw of a walking civilian facing `turn`: atan2(dirX, dirZ) of its world direction. */
  yaw(turn: Turn): number {
    const front = turn === TURN.front ? 1 : turn === TURN.back ? -1 : 0;
    const across = turn === TURN.right ? 1 : turn === TURN.left ? -1 : 0;
    const dirX = front * this.cos + across * this.sin;
    const dirZ = -front * this.sin + across * this.cos;
    return dirZ !== 0 ? (dirZ > 0 ? 0 : Math.PI) : dirX > 0 ? HALF_TURN : -HALF_TURN;
  }

  solid(box: Box): InteriorSolid {
    const xs = [this.x(box.deep0, box.across0), this.x(box.deep1, box.across1)];
    const zs = [this.z(box.deep0, box.across0), this.z(box.deep1, box.across1)];
    return { x0: Math.min(...xs), x1: Math.max(...xs), z0: Math.min(...zs), z1: Math.max(...zs), y0: box.y0, y1: box.y1 };
  }
}

function planOf(place: Pick<Place, "interior" | "width" | "depth">): InteriorPlan {
  if (place.interior === undefined) throw new Error("this place has no interior");
  return planInterior(place.interior, place.width, place.depth);
}

/** Every solid of the place's interior in world metres: wall runs beside each opening, slabs with their stairwells, stair treads and the furniture that blocks. */
export function interiorSolids(place: Place): InteriorSolid[] {
  const plan = planOf(place);
  const frame = new Frame(place);
  const boxes: Box[] = [];
  for (const wall of plan.walls) boxes.push(...wallBoxes(wall, plan.floors[wall.level]!, ceilingOver(plan.floors, plan.topCeiling, wall.level)));
  for (const slab of plan.slabs) boxes.push({ ...slab.rect, y0: slab.y0, y1: slab.y1 });
  for (const flight of plan.stairs) boxes.push(...stairBoxes(flight, plan.floors[flight.level]!));
  for (const piece of plan.furnishings) {
    if (!FURNISHING[piece.kind].solid) continue;
    const y0 = plan.floors[piece.level]! + piece.lift;
    boxes.push({ ...footprintOf(piece), y0, y1: y0 + piece.height });
  }
  return boxes.map((box) => frame.solid(box));
}

/** How many seats a furnishing offers and where along its width the `index`th sits (m from its middle). */
function seatOffset(piece: Furnishing, index: number): number {
  const seats = FURNISHING[piece.kind].seats;
  return (index - (seats - 1) / 2) * (piece.width / seats);
}

/** The seats of the place's interior then, for a rowhome, its stoop's two are first: x, z, yaw, height each; and how many lead on the stoop. */
export function interiorSeats(place: Place): { seats: Float32Array; stoopSeats: number } {
  const plan = planOf(place);
  const frame = new Frame(place);
  const rows: number[][] = [];
  const stoopSeats = place.interior === "rowhome" ? 2 : 0;
  for (let at = 0; at < stoopSeats; at++) {
    const across = (at === 0 ? -1 : 1) * STOOP_SEAT.spread;
    rows.push([frame.x(-STOOP_SEAT.out, across), frame.z(-STOOP_SEAT.out, across), frame.yaw(TURN.front), STOOP_SEAT.height]);
  }
  for (const piece of plan.furnishings) {
    const spec = FURNISHING[piece.kind];
    for (let index = 0; index < spec.seats; index++) {
      const offset = seatOffset(piece, index);
      const alongDeep = piece.facing === TURN.front || piece.facing === TURN.back;
      const deep = piece.deep + (alongDeep ? 0 : offset);
      const across = piece.across + (alongDeep ? offset : 0);
      rows.push([frame.x(deep, across), frame.z(deep, across), frame.yaw(piece.facing), plan.floors[piece.level]! + spec.seatHeight]);
    }
  }
  const seats = new Float32Array(rows.length * SEAT_STRIDE);
  for (const [at, row] of rows.entries()) seats.set(row, at * SEAT_STRIDE);
  return { seats, stoopSeats };
}

/** Plan direction a turn points, as (deep, across). */
function turnStep(turn: Turn): readonly [number, number] {
  return turn === TURN.front ? [-1, 0] : turn === TURN.back ? [1, 0] : turn === TURN.right ? [0, 1] : [0, -1];
}

/** The customer's spot and the clerk's behind the counter the plan marks `serves` (`COUNTER_STRIDE` floats each), or null where there is none. */
export function interiorCounter(place: Place): Float32Array | null {
  const plan = planOf(place);
  const counter = plan.furnishings.find((piece) => piece.serves);
  if (counter === undefined) return null;
  const frame = new Frame(place);
  const [stepDeep, stepAcross] = turnStep(counter.facing);
  const alongDeep = counter.facing === TURN.front || counter.facing === TURN.back;
  const centreDeep = counter.deep + (alongDeep ? 0 : counter.serveAt);
  const centreAcross = counter.across + (alongDeep ? counter.serveAt : 0);
  const customer = counter.depth / 2 + CUSTOMER_REACH;
  const clerk = counter.depth / 2 + CLERK_REACH;
  const top = plan.floors[counter.level]! + counter.height;
  const customerDeep = centreDeep + stepDeep * customer;
  const customerAcross = centreAcross + stepAcross * customer;
  const clerkDeep = centreDeep - stepDeep * clerk;
  const clerkAcross = centreAcross - stepAcross * clerk;
  const out = new Float32Array(2 * COUNTER_STRIDE);
  out.set([frame.x(customerDeep, customerAcross), frame.z(customerDeep, customerAcross), frame.yaw(((counter.facing + 2) % 4) as Turn), top]);
  out.set([frame.x(clerkDeep, clerkAcross), frame.z(clerkDeep, clerkAcross), frame.yaw(counter.facing), top], COUNTER_STRIDE);
  return out;
}

/** The place's own door: the doorway with the smallest `across` over every frontage bay, as the point on the street face where it stands. */
export function interiorDoor(kind: InteriorKind, width: number, depth: number, x: number, z: number, yaw: number): { x: number; z: number } {
  const bays = Math.round(width / BAY_WIDTH);
  const frame = new Frame({ x, z, yaw, depth });
  let across = Infinity;
  for (let bay = 0; bay < bays; bay++) {
    for (const opening of SHOPFRONT[kind]) if (opening.door) across = Math.min(across, opening.centre + (bay - (bays - 1) / 2) * BAY_WIDTH);
  }
  return { x: frame.x(0, across), z: frame.z(0, across) };
}
