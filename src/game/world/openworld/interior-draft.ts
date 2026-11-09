import {
  BACK_DOOR,
  BAY_WIDTH,
  FURNISHING,
  LEVELS,
  MAX_RISER,
  PARTITION,
  PARTY_WALL,
  SHELL_WALL,
  SHOPFRONT,
  SLAB_THICK,
  STREET_SKIN,
  TREAD_RUN,
  type Box,
  type Furnishing,
  type FurnishingKind,
  type InteriorPlan,
  type Opening,
  type Rect,
  type Slab,
  type Stairs,
  type Turn,
  type Wall,
  TURN,
} from "./interior-kinds.ts";
import type { InteriorKind } from "./walk-graph.ts";

/** A flight is this wide (m): a person and a handrail. */
const STAIR_WIDTH = 0.9;
/** A hanging lamp's drop from the ceiling (m). */
const LAMP_DROP = 0.35;

/** Underside of the ceiling over `level`: the next floor's slab, or the roof's. */
export function ceilingOver(floors: readonly number[], topCeiling: number, level: number): number {
  return level + 1 < floors.length ? floors[level + 1]! - SLAB_THICK : topCeiling;
}

/** The footprint of a furnishing in plan coordinates: its width runs across its front, its depth along it. */
export function footprintOf(piece: Furnishing): Rect {
  const alongDeep = piece.facing === TURN.front || piece.facing === TURN.back;
  const halfDeep = (alongDeep ? piece.depth : piece.width) / 2;
  const halfAcross = (alongDeep ? piece.width : piece.depth) / 2;
  return { deep0: piece.deep - halfDeep, deep1: piece.deep + halfDeep, across0: piece.across - halfAcross, across1: piece.across + halfAcross };
}

/** A wall's solid boxes between `floorY` and `ceilingY`: full-height runs between its openings, a sill under and a lintel over each. */
export function wallBoxes(wall: Wall, floorY: number, ceilingY: number): Box[] {
  const half = wall.thick / 2;
  const boxAlong = (from: number, to: number, y0: number, y1: number): Box =>
    wall.axis === "across"
      ? { deep0: wall.fixed - half, deep1: wall.fixed + half, across0: from, across1: to, y0, y1 }
      : { across0: wall.fixed - half, across1: wall.fixed + half, deep0: from, deep1: to, y0, y1 };
  const out: Box[] = [];
  let cursor = wall.from;
  for (const opening of [...wall.openings].sort((a, b) => a.centre - b.centre)) {
    const start = opening.centre - opening.width / 2;
    const end = opening.centre + opening.width / 2;
    if (start > cursor) out.push(boxAlong(cursor, start, floorY, ceilingY));
    if (opening.sill > 0) out.push(boxAlong(start, end, floorY, floorY + opening.sill));
    if (floorY + opening.top < ceilingY) out.push(boxAlong(start, end, floorY + opening.top, ceilingY));
    cursor = end;
  }
  if (wall.to > cursor) out.push(boxAlong(cursor, wall.to, floorY, ceilingY));
  return out;
}

/** The stair treads as stacked boxes: tread `step` reaches `rise * (step + 1)` over the floor it climbs from. */
export function stairBoxes(stairs: Stairs, floorY: number): Box[] {
  return Array.from({ length: stairs.steps }, (_, step): Box => ({
    deep0: stairs.deep0 + step * stairs.run,
    deep1: stairs.deep0 + (step + 1) * stairs.run,
    across0: stairs.across - stairs.width / 2,
    across1: stairs.across + stairs.width / 2,
    y0: floorY,
    y1: floorY + (step + 1) * stairs.rise,
  }));
}

/** `rect` with `hole` cut out: up to four rectangles round it. */
function aroundHole(rect: Rect, hole: Rect): Rect[] {
  return [
    { ...rect, deep1: hole.deep0 },
    { ...rect, deep0: hole.deep1 },
    { deep0: hole.deep0, deep1: hole.deep1, across0: rect.across0, across1: hole.across0 },
    { deep0: hole.deep0, deep1: hole.deep1, across0: hole.across1, across1: rect.across1 },
  ].filter((part) => part.deep1 - part.deep0 > 1e-6 && part.across1 - part.across0 > 1e-6);
}

/** What a layout fills in: one interior's walls, slabs, furniture and stairs, in plan coordinates. */
export class Draft {
  readonly kind: InteriorKind;
  readonly width: number;
  readonly depth: number;
  readonly walls: Wall[] = [];
  readonly slabs: Slab[] = [];
  readonly furnishings: Furnishing[] = [];
  readonly stairs: Stairs[] = [];
  readonly floors: readonly number[];
  readonly topCeiling: number;
  /** The clear half width between the party walls, and the clear depths from the street wall to the back wall. */
  readonly half: number;
  readonly front = STREET_SKIN + SHELL_WALL;
  readonly back: number;

  constructor(kind: InteriorKind, width: number, depth: number) {
    this.kind = kind;
    this.width = width;
    this.depth = depth;
    this.floors = LEVELS[kind].floors;
    this.topCeiling = LEVELS[kind].topCeiling;
    this.half = width / 2 - PARTY_WALL;
    this.back = depth - STREET_SKIN - SHELL_WALL;
  }

  ceilingOf(level: number): number {
    return ceilingOver(this.floors, this.topCeiling, level);
  }

  /** A wall parallel to the street at `deep`, from `from` to `to` across. */
  crossWall(level: number, deep: number, from: number, to: number, openings: readonly Opening[] = [], shell = false, thick = PARTITION): void {
    this.walls.push({ level, axis: "across", fixed: deep, from, to, thick, openings, shell });
  }

  /** A wall at `across`, running from `from` to `to` deep. */
  spineWall(level: number, across: number, from: number, to: number, openings: readonly Opening[] = [], shell = false, thick = PARTITION): void {
    this.walls.push({ level, axis: "deep", fixed: across, from, to, thick, openings, shell });
  }

  put(kind: FurnishingKind, level: number, deep: number, across: number, facing: Turn, over: Partial<Pick<Furnishing, "width" | "depth" | "height" | "lift" | "serves" | "serveAt">> = {}): void {
    const spec = FURNISHING[kind];
    this.furnishings.push({ kind, level, deep, across, facing, width: spec.width, depth: spec.depth, height: spec.height, lift: 0, serves: false, serveAt: 0, ...over });
  }

  /** A pendant lamp hanging from the ceiling of `level`. */
  lamp(level: number, deep: number, across: number): void {
    this.put("lamp", level, deep, across, TURN.front, { lift: this.ceilingOf(level) - this.floors[level]! - LAMP_DROP });
  }

  /** A straight flight from `level` to the next, as many treads as the climb needs at no more than `MAX_RISER`. */
  stairsUp(level: number, deep0: number, across: number): Stairs {
    const climb = this.floors[level + 1]! - this.floors[level]!;
    const steps = Math.ceil(climb / MAX_RISER);
    const flight = { level, deep0, across, width: STAIR_WIDTH, steps, rise: climb / steps, run: TREAD_RUN };
    this.stairs.push(flight);
    return flight;
  }

  /** The envelope of `level`: the street wall (cut by the shopfront on the ground floor), the party walls and the back wall; the ground floor's are the far view's shell. */
  envelope(level: number): void {
    const ground = level === 0;
    const bays = Math.round(this.width / BAY_WIDTH);
    const streetOpenings = ground ? Array.from({ length: bays }, (_, bay) => SHOPFRONT[this.kind].map((opening): Opening => ({ ...opening, centre: opening.centre + (bay - (bays - 1) / 2) * BAY_WIDTH }))).flat() : [];
    this.crossWall(level, STREET_SKIN + SHELL_WALL / 2, -this.half, this.half, streetOpenings, ground, SHELL_WALL);
    this.crossWall(level, this.depth - STREET_SKIN - SHELL_WALL / 2, -this.half, this.half, ground && this.kind === "rowhome" ? [BACK_DOOR] : [], ground, SHELL_WALL);
    for (const side of [-1, 1]) this.spineWall(level, side * (this.width / 2 - PARTY_WALL / 2), STREET_SKIN, this.depth - STREET_SKIN, [], ground, PARTY_WALL);
  }

  /** The slab under level `level`'s floor: the foundation from the ground on the ground floor, else a slab, with `holes` cut through it. */
  floor(level: number, holes: readonly Rect[] = []): void {
    const top = this.floors[level]!;
    const y0 = level === 0 ? 0 : top - SLAB_THICK;
    this.slab(y0, top, holes, level === 0);
  }

  /** The ceiling over the topmost level; a shop's belongs to the shell. */
  roof(): void {
    this.slab(this.topCeiling, this.topCeiling + SLAB_THICK, [], this.floors.length === 1);
  }

  private slab(y0: number, y1: number, holes: readonly Rect[], shell: boolean): void {
    let parts: Rect[] = [{ deep0: STREET_SKIN, deep1: this.depth - STREET_SKIN, across0: -this.width / 2, across1: this.width / 2 }];
    for (const hole of holes) parts = parts.flatMap((part) => (overlaps(part, hole) ? aroundHole(part, hole) : [part]));
    for (const rect of parts) this.slabs.push({ y0, y1, rect, shell });
  }

  plan(): InteriorPlan {
    return { kind: this.kind, width: this.width, depth: this.depth, floors: this.floors, topCeiling: this.topCeiling, walls: this.walls, slabs: this.slabs, furnishings: this.furnishings, stairs: this.stairs };
  }
}

function overlaps(a: Rect, b: Rect): boolean {
  return a.deep0 < b.deep1 && b.deep0 < a.deep1 && a.across0 < b.across1 && b.across0 < a.across1;
}
