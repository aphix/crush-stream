import {
  BACK_DOOR,
  BAY_WIDTH,
  ceilingOver,
  OPENING,
  type Alcove,
  FURNISHING,
  HEADROOM,
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
  type Pane,
  type Rect,
  type Slab,
  type Stairs,
  type Turn,
  type Wall,
  TURN,
} from "./interior-kinds.ts";
import { FACADE_FACE, type RoomWindow } from "./facade-windows.ts";
import { BAY, BAY_FLOORS, bayOutline } from "./openworld-facade-solids.ts";
import type { InteriorKind } from "./walk-graph.ts";

/** Glass sits this far (m) inside the bay kit's outer walls, so it never shares a plane with them. */
const GLASS_INSET = 0.05;


/** A flight is this wide (m): a person and a handrail. */
const STAIR_WIDTH = 0.9;
/** A hanging lamp's drop from the ceiling (m). */
const LAMP_DROP = 0.35;

/** The footprint of a furnishing in plan coordinates: its width runs across its front, its depth along it. */
export function footprintOf(piece: Furnishing): Rect {
  const alongDeep = piece.facing === TURN.front || piece.facing === TURN.back;
  const halfDeep = (alongDeep ? piece.depth : piece.width) / 2;
  const halfAcross = (alongDeep ? piece.width : piece.depth) / 2;
  return { deep0: piece.deep - halfDeep, deep1: piece.deep + halfDeep, across0: piece.across - halfAcross, across1: piece.across + halfAcross };
}

/** Two edges of a wall's openings closer than this (m) are one. */
const EDGE_TOLERANCE = 1e-9;

/**
 * A wall's solid boxes between `floorY` and `ceilingY`: the wall cut at every opening's edges into runs, each run solid but for the heights of the openings that cover it (a sill under, a lintel over,
 * a bar between two stacked ones). Openings may stand over one another or overlap.
 */
export function wallBoxes(wall: Wall, floorY: number, ceilingY: number): Box[] {
  const half = wall.thick / 2;
  const boxAlong = (from: number, to: number, y0: number, y1: number): Box =>
    wall.axis === "across"
      ? { deep0: wall.fixed - half, deep1: wall.fixed + half, across0: from, across1: to, y0, y1 }
      : { across0: wall.fixed - half, across1: wall.fixed + half, deep0: from, deep1: to, y0, y1 };
  const inside = (value: number): number => Math.min(wall.to, Math.max(wall.from, value));
  const edges = [wall.from, wall.to, ...wall.openings.flatMap((opening) => [inside(opening.centre - opening.width / 2), inside(opening.centre + opening.width / 2)])].sort((a, b) => a - b);
  const out: Box[] = [];
  for (let at = 0; at + 1 < edges.length; at++) {
    const from = edges[at]!;
    const to = edges[at + 1]!;
    if (to - from < EDGE_TOLERANCE) continue;
    const middle = (from + to) / 2;
    const gaps = wall.openings
      .filter((opening) => middle > opening.centre - opening.width / 2 && middle < opening.centre + opening.width / 2)
      .map((opening): [number, number] => [floorY + opening.sill, Math.min(ceilingY, floorY + opening.top)])
      .sort((a, b) => a[0] - b[0]);
    let solidFrom = floorY;
    for (const [low, high] of gaps) {
      if (low > solidFrom) out.push(boxAlong(from, to, solidFrom, low));
      solidFrom = Math.max(solidFrom, high);
    }
    if (solidFrom < ceilingY) out.push(boxAlong(from, to, solidFrom, ceilingY));
  }
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
  readonly panes: Pane[] = [];
  readonly alcoves: Alcove[] = [];
  readonly floors: readonly number[];
  readonly topCeiling: number;
  /** The clear half width between the party walls, and the clear depths from the street wall to the back wall. */
  readonly half: number;
  readonly front = STREET_SKIN + SHELL_WALL;
  readonly back: number;

  /** Every window a room of this interior looks out of (the facade's own, from its picture), on every face, at every level. */
  private readonly windows: readonly RoomWindow[];

  constructor(kind: InteriorKind, width: number, depth: number, windows: readonly RoomWindow[] = []) {
    this.windows = windows;
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

  /** The opening a flight needs in the floor above it: from the first tread a climber's head (`HEADROOM`) would meet the slab over, to where the top tread meets that floor, across the flight. */
  stairwell(flight: Stairs): Rect {
    const floor = this.floors[flight.level]!;
    const underside = this.ceilingOf(flight.level);
    let step = 0;
    while (step < flight.steps && underside - (floor + (step + 1) * flight.rise) >= HEADROOM) step++;
    return { deep0: flight.deep0 + step * flight.run, deep1: flight.deep0 + flight.steps * flight.run, across0: flight.across - flight.width / 2, across1: flight.across + flight.width / 2 };
  }

  /** The windows on `face` at `level` as wall openings, and their panes of glass in the wall's plane, `wallAt` deep or across. */
  private glazed(level: number, face: RoomWindow["face"], wallAt: number): Opening[] {
    const floor = this.floors[level]!;
    const here = this.windows.filter((window) => window.level === level && window.face === face);
    const street = face === FACADE_FACE.street || face === FACADE_FACE.back;
    for (const window of here) {
      const [a, b] = [window.along0, window.along1];
      this.panes.push(street ? { level, deep0: wallAt, across0: a, deep1: wallAt, across1: b, y0: window.y0, y1: window.y1 } : { level, deep0: a, across0: wallAt, deep1: b, across1: wallAt, y0: window.y0, y1: window.y1 });
    }
    return here.map((window): Opening => ({ centre: (window.along0 + window.along1) / 2, width: window.along1 - window.along0, sill: window.y0 - floor, top: window.y1 - floor, kind: OPENING.window }));
  }

  /** A rowhome's bay window on `level`: the street wall is open across its mouth from the floor up to the glass's head, and the alcove (floor, apron, ceiling) and its three panes stand outside the wall. */
  private bayOpening(level: number): Opening[] {
    if (this.kind !== "rowhome") return [];
    const { sill, head } = BAY_FLOORS[level]!;
    const floorY = this.floors[level]!;
    const outline = bayOutline(-GLASS_INSET);
    for (let at = 0; at + 1 < outline.length; at++) {
      this.panes.push({ level, deep0: -outline[at]!.out, across0: outline[at]!.across, deep1: -outline[at + 1]!.out, across1: outline[at + 1]!.across, y0: sill, y1: head });
    }
    this.alcoves.push({ level, floorY, sill, head, corners: bayOutline(-GLASS_INSET).map((corner) => [-corner.out, corner.across] as const) });
    return [{ centre: BAY.across, width: BAY.width, sill: 0, top: head - floorY, kind: OPENING.bay }];
  }

  /** The envelope of `level`: the street wall (its doorways on the ground floor, its windows and the bay's mouth), the party walls (with windows where a side is open) and the back wall; the ground floor's are the far view's shell. */
  envelope(level: number): void {
    const ground = level === 0;
    const bays = Math.round(this.width / BAY_WIDTH);
    const doors = ground ? Array.from({ length: bays }, (_, bay) => SHOPFRONT[this.kind].map((opening): Opening => ({ ...opening, centre: opening.centre + (bay - (bays - 1) / 2) * BAY_WIDTH }))).flat() : [];
    const streetAt = STREET_SKIN + SHELL_WALL / 2;
    const backAt = this.depth - STREET_SKIN - SHELL_WALL / 2;
    this.crossWall(level, streetAt, -this.half, this.half, [...doors, ...this.glazed(level, FACADE_FACE.street, streetAt), ...this.bayOpening(level)], ground, SHELL_WALL);
    this.crossWall(level, backAt, -this.half, this.half, [...(ground && this.kind === "rowhome" ? [BACK_DOOR] : []), ...this.glazed(level, FACADE_FACE.back, backAt)], ground, SHELL_WALL);
    for (const side of [-1, 1]) {
      const sideAt = side * (this.width / 2 - PARTY_WALL / 2);
      const face = side === 1 ? FACADE_FACE.plusAcross : FACADE_FACE.minusAcross;
      this.spineWall(level, sideAt, STREET_SKIN, this.depth - STREET_SKIN, this.glazed(level, face, sideAt), ground, PARTY_WALL);
    }
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
    return { kind: this.kind, width: this.width, depth: this.depth, floors: this.floors, topCeiling: this.topCeiling, walls: this.walls, slabs: this.slabs, furnishings: this.furnishings, stairs: this.stairs, panes: this.panes, alcoves: this.alcoves };
  }
}

function overlaps(a: Rect, b: Rect): boolean {
  return a.deep0 < b.deep1 && b.deep0 < a.deep1 && a.across0 < b.across1 && b.across0 < a.across1;
}
