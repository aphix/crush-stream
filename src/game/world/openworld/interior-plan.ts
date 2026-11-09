import { ceilingOver, Draft, footprintOf, stairBoxes, wallBoxes } from "./interior-draft.ts";
import { layoutBar, layoutCoffee, layoutOffice, layoutRowhome, layoutStore } from "./interior-layouts.ts";
import { BAY_WIDTH, FURNISHING, PARTITION, SHELL_WALL, SHOPFRONT, STOOP_SEAT_HEIGHT, STOOP_SEAT_OUT, STOOP_SEAT_SPREAD, STREET_SKIN, TURN, type Box, type Furnishing, type InteriorPlan, type Opening, type Turn } from "./interior-kinds.ts";
import { drawnHalf } from "./openworld-facade-solids.ts";
import { COUNTER_STRIDE, SEAT_STRIDE, type InteriorKind, type Place } from "./walk-graph.ts";

const LAYOUTS = { rowhome: layoutRowhome, coffee: layoutCoffee, bar: layoutBar, office: layoutOffice, store: layoutStore } as const satisfies Record<InteriorKind, (draft: Draft) => void>;

/**
 * The plan of an interior for a building prop of footprint `width` x `depth` (m): pure, the same for every peer. It is laid inside the prop's drawn walls (`drawnHalf`), a skin short of them on every
 * side, so no wall of it stands in front of the facade's own picture.
 */
export function planInterior(kind: InteriorKind, width: number, depth: number): InteriorPlan {
  const draft = new Draft(kind, 2 * (drawnHalf(width) - STREET_SKIN), 2 * drawnHalf(depth));
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

/** The place's map from plan coordinates to the world (the plan's front on the building's drawn front wall): a quarter-turn rotation, so every result is exact. */
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
    const front = drawnHalf(this.place.depth) - deep;
    return this.place.x + front * this.cos + across * this.sin;
  }

  z(deep: number, across: number): number {
    const front = drawnHalf(this.place.depth) - deep;
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
export function interiorSolids(place: Place, plan: InteriorPlan = planOf(place)): InteriorSolid[] {
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

/** Where along its width the `index`th seat of a furnishing sits (m from its middle). */
function seatOffset(piece: Furnishing, index: number): number {
  const seats = FURNISHING[piece.kind].seats;
  return (index - (seats - 1) / 2) * (piece.width / seats);
}

/** Plan direction a turn points, as (deep, across). */
function turnStep(turn: Turn): readonly [number, number] {
  return turn === TURN.front ? [-1, 0] : turn === TURN.back ? [1, 0] : turn === TURN.right ? [0, 1] : [0, -1];
}

/** What the place's interior publishes: every seat (a rowhome's two stoop seats lead: x, z, yaw, height each) and the customer's and clerk's spots at the counter the plan marks `serves` (null where there is none). */
type InteriorSpots = { seats: Float32Array; stoopSeats: number; counter: Float32Array | null };

export function interiorSpots(place: Place, plan: InteriorPlan = planOf(place)): InteriorSpots {
  const frame = new Frame(place);
  const rows: number[][] = [];
  const stoopSeats = place.interior === "rowhome" ? 2 : 0;
  const doorAcross = SHOPFRONT[plan.kind].find((opening) => opening.door)!.centre;
  for (let at = 0; at < stoopSeats; at++) {
    const across = doorAcross + (at === 0 ? -1 : 1) * STOOP_SEAT_SPREAD;
    rows.push([frame.x(-STOOP_SEAT_OUT, across), frame.z(-STOOP_SEAT_OUT, across), frame.yaw(TURN.front), STOOP_SEAT_HEIGHT]);
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
  return { seats, stoopSeats, counter: counterSpots(plan, frame) };
}

function counterSpots(plan: InteriorPlan, frame: Frame): Float32Array | null {
  const counter = plan.furnishings.find((piece) => piece.serves);
  if (counter === undefined) return null;
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

/** A column of the ground-floor envelope in world metres (full height: a prism stands from the ground). */
export type EnvelopeColumn = { x0: number; z0: number; x1: number; z1: number };

/**
 * The ground floor's street, party and back walls as columns, the street and back ones running the building's whole width so neighbours' touch: whole but for the street's doorways (a window is
 * closed to a walker, who cannot pass a gap above a sill; the back door is closed to cars and far walkers alike).
 */
export function interiorEnvelope(place: Place): EnvelopeColumn[] {
  const plan = planOf(place);
  const frame = new Frame(place);
  const columns: EnvelopeColumn[] = [];
  for (const wall of plan.walls) {
    if (wall.level !== 0 || !wall.shell) continue;
    const street = wall.axis === "across" && wall.fixed < plan.depth / 2;
    const across = wall.axis === "across" ? { from: -place.width / 2, to: place.width / 2 } : {};
    const doorways = { ...wall, ...across, openings: street ? wall.openings.filter((opening) => opening.sill === 0) : [] };
    for (const box of wallBoxes(doorways, 0, 1)) {
      const { x0, z0, x1, z1 } = frame.solid(box);
      columns.push({ x0, z0, x1, z1 });
    }
  }
  return columns;
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

/** A door leaf's gap to its jambs and head (m), and how far behind the drawn face its closed leaf stands, inside the wall's thickness. */
const LEAF_GAP = 0.025;
const LEAF_INSET = 0.08;
/** The vestibule behind a street door (m): its depth past the wall, the room it leaves either side of the door, and its height over the door's head. */
const VESTIBULE_DEPTH = 1.2;
const VESTIBULE_SIDE = 0.25;
const VESTIBULE_HEADROOM = 0.3;

/** A street door is drawn on its facade (1), a back door only inside (-1). */
export const DOOR_FACE = { street: 1, back: -1 } as const;

/**
 * One door of a place, in world metres: its hinge's foot and the floor it stands on, unit directions along the closed leaf and into the room (the way it swings), the leaf's size, the doorway's
 * middle on the drawn face and the face it is on, the narrowed box a sight query of the doorway is centred on, and, for a street door, the vestibule behind it (null for a back door).
 */
export type DoorLeaf = {
  hingeX: number;
  hingeZ: number;
  floorY: number;
  closedX: number;
  closedZ: number;
  openX: number;
  openZ: number;
  width: number;
  height: number;
  x: number;
  z: number;
  face: (typeof DOOR_FACE)[keyof typeof DOOR_FACE];
  boxX: number;
  boxZ: number;
  vestibule: InteriorSolid | null;
};

/** The vestibule room behind a street doorway, in plan metres. */
function vestibuleRect(opening: Opening): { deep0: number; deep1: number; across0: number; across1: number } {
  const half = opening.width / 2 + VESTIBULE_SIDE;
  return { deep0: STREET_SKIN + SHELL_WALL, deep1: STREET_SKIN + SHELL_WALL + VESTIBULE_DEPTH, across0: opening.centre - half, across1: opening.centre + half };
}

/** The ground floor's doorways: every one in the street wall, then every one in the back wall. */
function doorways(plan: InteriorPlan): { opening: Opening; face: DoorLeaf["face"] }[] {
  const out: { opening: Opening; face: DoorLeaf["face"] }[] = [];
  for (const wall of plan.walls) {
    if (wall.level !== 0 || !wall.shell || wall.axis !== "across") continue;
    const face = wall.fixed < plan.depth / 2 ? DOOR_FACE.street : DOOR_FACE.back;
    for (const opening of wall.openings) if (opening.sill === 0) out.push({ opening, face });
  }
  return out.sort((a, b) => b.face - a.face);
}

/** Every door of the place's ground floor: its street doors (each with its vestibule), then its back door. */
export function interiorDoors(place: Place, plan: InteriorPlan = planOf(place)): DoorLeaf[] {
  const frame = new Frame(place);
  const floorY = plan.floors[0]!;
  return doorways(plan).map(({ opening, face }): DoorLeaf => {
    const deep = face === DOOR_FACE.street ? STREET_SKIN + LEAF_INSET : plan.depth - STREET_SKIN - LEAF_INSET;
    const hinge = opening.centre - opening.width / 2 + LEAF_GAP;
    const room = vestibuleRect(opening);
    return {
      hingeX: frame.x(deep, hinge),
      hingeZ: frame.z(deep, hinge),
      floorY,
      closedX: frame.x(deep, hinge + 1) - frame.x(deep, hinge),
      closedZ: frame.z(deep, hinge + 1) - frame.z(deep, hinge),
      openX: frame.x(deep + face, hinge) - frame.x(deep, hinge),
      openZ: frame.z(deep + face, hinge) - frame.z(deep, hinge),
      width: opening.width - 2 * LEAF_GAP,
      height: opening.top - LEAF_GAP,
      x: frame.x(face === DOOR_FACE.street ? 0 : plan.depth, opening.centre),
      z: frame.z(face === DOOR_FACE.street ? 0 : plan.depth, opening.centre),
      face,
      boxX: frame.x(drawnHalf(place.depth), opening.centre),
      boxZ: frame.z(drawnHalf(place.depth), opening.centre),
      vestibule: face === DOOR_FACE.street ? frame.solid({ ...room, y0: floorY, y1: floorY + opening.top + VESTIBULE_HEADROOM }) : null,
    };
  });
}

/** What a walker at a street door stands and is closed in by while the room behind is not built: the vestibule's floor (from the ground), its two sides and its back. */
export function vestibuleSolids(place: Place, plan: InteriorPlan = planOf(place)): InteriorSolid[] {
  const frame = new Frame(place);
  const floorY = plan.floors[0]!;
  const boxes: Box[] = [];
  for (const { opening, face } of doorways(plan)) {
    if (face !== DOOR_FACE.street) continue;
    const room = vestibuleRect(opening);
    const top = floorY + opening.top + VESTIBULE_HEADROOM;
    const wall = PARTITION / 2;
    boxes.push(
      { ...room, y0: 0, y1: floorY },
      { ...room, across0: room.across0 - wall, across1: room.across0 + wall, y0: floorY, y1: top },
      { ...room, across0: room.across1 - wall, across1: room.across1 + wall, y0: floorY, y1: top },
      { ...room, deep0: room.deep1 - wall, deep1: room.deep1 + wall, y0: floorY, y1: top },
    );
  }
  return boxes.map((box) => frame.solid(box));
}
