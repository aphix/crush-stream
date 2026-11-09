import * as THREE from "three";
import { hypot2 } from "../../kernel/physics-core.js";
import { stairBoxes, wallBoxes } from "../../world/openworld/interior-draft.ts";
import { ceilingOver, lookKind, ROOM_LOOK, type Alcove, type Box, type InteriorPlan, type Pane } from "../../world/openworld/interior-kinds.ts";
import type { Place } from "../../world/openworld/walk-graph.ts";
import { box, painted, type Piece } from "../prefab-pieces.ts";
import { furnishingParts } from "./interior-kit.ts";

/** A slab's top matches a floor's height within this (m). */
const FLOOR_MATCH = 1e-6;
/** A floor's wearing layer on top of its slab (m). */
const FLOOR_LAYER = 0.03;
/** The glass's colour: a pale blue-green, seen against the light. */
const GLASS_COLOR = 0xbfd8e6;
/** A plate on a floor or under a ceiling stands this far (m) clear of the slab beside it, so the two never share a plane. */
const PLATE_LIFT = 0.004;
/** A point of the building's local frame: x toward the street, y up, z along its face. */
type Point = readonly [x: number, y: number, z: number];

/** The turn each furnishing's front (its +x) takes it to, as a rotation about y in the building's local frame (front is +x there). */
const TURN_ANGLE = [0, -Math.PI / 2, Math.PI, Math.PI / 2] as const;

type Look = (typeof ROOM_LOOK)[InteriorPlan["kind"]];

/** A plan box as a box in the building's local frame (x toward the street, z along its face). */
function localBox(plan: InteriorPlan, solid: Box): THREE.BufferGeometry {
  const x0 = plan.depth / 2 - solid.deep1;
  const x1 = plan.depth / 2 - solid.deep0;
  return box(x1 - x0, solid.y1 - solid.y0, solid.across1 - solid.across0, (x0 + x1) / 2, (solid.y0 + solid.y1) / 2, (solid.across0 + solid.across1) / 2);
}

/** A plan point (deep, across) at height `y` as a point of the building's local frame. */
function at(plan: InteriorPlan, deep: number, y: number, across: number): Point {
  return [plan.depth / 2 - deep, y, across];
}

/** A quad through four points in order. */
function quad(a: Point, b: Point, c: Point, d: Point): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute([...a, ...b, ...c, ...d], 3));
  geometry.setIndex([0, 1, 2, 0, 2, 3]);
  geometry.computeVertexNormals();
  return geometry;
}

/** A sheet standing over the plan segment from `from` to `to` between two heights. */
function upright(plan: InteriorPlan, from: readonly [deep: number, across: number], to: readonly [deep: number, across: number], y0: number, y1: number): THREE.BufferGeometry {
  return quad(at(plan, from[0], y0, from[1]), at(plan, to[0], y0, to[1]), at(plan, to[0], y1, to[1]), at(plan, from[0], y1, from[1]));
}

/** A level sheet over an alcove's four outline corners at height `y`. */
function plate(plan: InteriorPlan, corners: Alcove["corners"], y: number): THREE.BufferGeometry {
  const [a, b, c, d] = corners.map(([deep, across]) => at(plan, deep, y, across));
  return quad(a!, b!, c!, d!);
}

/** An alcove's sill board reaches this far (m) into the room over the apron, is this thick, and the skirting under the apron is this high: the apron reads as a wall with a sill, not a slab in front of the glass. */
const SILL_DEPTH = 0.12;
const SILL_THICK = 0.05;
const SKIRTING_HEIGHT = 0.12;

/** A plan point as (deep, across). */
type PlanPoint = readonly [deep: number, across: number];

/** The unit step, in plan, from the segment `from`-`to` into the alcove (toward the middle of its corners). */
function inward(corners: Alcove["corners"], from: PlanPoint, to: PlanPoint): PlanPoint {
  const along: PlanPoint = [to[0] - from[0], to[1] - from[1]];
  const length = hypot2(along[0], along[1]);
  const normal: PlanPoint = [along[1] / length, -along[0] / length];
  const middle = corners.reduce<PlanPoint>((sum, corner) => [sum[0] + corner[0] / corners.length, sum[1] + corner[1] / corners.length], [0, 0]);
  const toMiddle = (middle[0] - from[0]) * normal[0] + (middle[1] - from[1]) * normal[1];
  return toMiddle >= 0 ? normal : [-normal[0], -normal[1]];
}

/**
 * Every alcove of `level`: its floor carried out over the bay, its ceiling at the glass's head, and on its three sides the apron up to the sill: skirting, a wall-coloured body, and a sill board at the glass's
 * bottom edge that reaches into the room.
 */
function alcovePieces(plan: InteriorPlan, look: Look, level: number): Piece[] {
  const out: Piece[] = [];
  for (const alcove of plan.alcoves) {
    if (alcove.level !== level) continue;
    out.push([plate(plan, alcove.corners, alcove.floorY + PLATE_LIFT), look.floor], [plate(plan, alcove.corners, alcove.head - PLATE_LIFT), look.ceiling]);
    for (let side = 0; side + 1 < alcove.corners.length; side++) {
      const from = alcove.corners[side]!;
      const to = alcove.corners[side + 1]!;
      const step = inward(alcove.corners, from, to);
      const boardFrom: PlanPoint = [from[0] + step[0] * SILL_DEPTH, from[1] + step[1] * SILL_DEPTH];
      const boardTo: PlanPoint = [to[0] + step[0] * SILL_DEPTH, to[1] + step[1] * SILL_DEPTH];
      out.push(
        [upright(plan, from, to, alcove.floorY, alcove.floorY + SKIRTING_HEIGHT), look.trim],
        [upright(plan, from, to, alcove.floorY + SKIRTING_HEIGHT, alcove.sill), look.wall],
        [quad(at(plan, from[0], alcove.sill, from[1]), at(plan, to[0], alcove.sill, to[1]), at(plan, boardTo[0], alcove.sill, boardTo[1]), at(plan, boardFrom[0], alcove.sill, boardFrom[1])), look.trim],
        [upright(plan, boardFrom, boardTo, alcove.sill - SILL_THICK, alcove.sill), look.trim],
      );
    }
  }
  return out;
}

/** The glass of `level`'s windows and bays, as one merged geometry; null when it has none. */
function glassOf(plan: InteriorPlan, levels: (level: number) => boolean): THREE.BufferGeometry | null {
  const panes = plan.panes.filter((pane: Pane) => levels(pane.level));
  return panes.length === 0 ? null : painted(panes.map((pane): Piece => [upright(plan, [pane.deep0, pane.across0], [pane.deep1, pane.across1], pane.y0, pane.y1), GLASS_COLOR]));
}

/** The room look of `level` of the plan. */
const lookOf = (plan: InteriorPlan, level: number): Look => ROOM_LOOK[lookKind(plan.kind, level)];

function wallPieces(plan: InteriorPlan, shell: boolean): Piece[] {
  const out: Piece[] = [];
  for (const wall of plan.walls) {
    if (wall.shell !== shell) continue;
    const look = lookOf(plan, wall.level);
    for (const solid of wallBoxes(wall, plan.floors[wall.level]!, ceilingOver(plan.floors, plan.topCeiling, wall.level))) out.push([localBox(plan, solid), look.wall]);
  }
  return out;
}

/** A slab is its body in the ceiling's colour (the room below's) and, except under the roof, a floor layer on top (the room above's). */
function slabPieces(plan: InteriorPlan, shell: boolean): Piece[] {
  const out: Piece[] = [];
  for (const slab of plan.slabs) {
    if (slab.shell !== shell) continue;
    const roof = slab.y0 === plan.topCeiling;
    const level = roof ? plan.floors.length - 1 : plan.floors.findIndex((floor) => Math.abs(floor - slab.y1) < FLOOR_MATCH);
    out.push([localBox(plan, { ...slab.rect, y0: slab.y0, y1: roof ? slab.y1 : slab.y1 - FLOOR_LAYER }), lookOf(plan, Math.max(0, roof ? level : level - 1)).ceiling]);
    if (!roof) out.push([localBox(plan, { ...slab.rect, y0: slab.y1 - FLOOR_LAYER, y1: slab.y1 }), lookOf(plan, level).floor]);
  }
  return out;
}

/** Bake the building's turn and place into a merged geometry. */
function inWorld(geometry: THREE.BufferGeometry, place: Place): THREE.BufferGeometry {
  return geometry.rotateY(place.yaw).translate(place.x, 0, place.z);
}

/** The ground floor's envelope: what shows through a door from the street; with the glass of its windows and its bay. */
export function buildShell(plan: InteriorPlan, place: Place): { solid: THREE.BufferGeometry; glass: THREE.BufferGeometry | null } {
  const glass = glassOf(plan, (level) => level === 0);
  return { solid: inWorld(painted([...wallPieces(plan, true), ...slabPieces(plan, true), ...alcovePieces(plan, lookOf(plan, 0), 0)]), place), glass: glass === null ? null : inWorld(glass, place) };
}

/** Everything else: partitions, upper floors, their bays, stairs and the furniture (lit and unlit apart) and the upper floors' glass; a geometry is null when it has no pieces. */
export function buildDetail(plan: InteriorPlan, place: Place): { solid: THREE.BufferGeometry | null; glow: THREE.BufferGeometry | null; glass: THREE.BufferGeometry | null } {
  const solid: Piece[] = [...wallPieces(plan, false), ...slabPieces(plan, false)];
  for (let level = 1; level < plan.floors.length; level++) solid.push(...alcovePieces(plan, lookOf(plan, level), level));
  const glow: Piece[] = [];
  for (const flight of plan.stairs) for (const tread of stairBoxes(flight, plan.floors[flight.level]!)) solid.push([localBox(plan, tread), lookOf(plan, flight.level).wood]);
  for (const piece of plan.furnishings) {
    const parts = furnishingParts(piece, lookKind(plan.kind, piece.level));
    const lx = plan.depth / 2 - piece.deep;
    const y = plan.floors[piece.level]! + piece.lift;
    for (const made of [...parts.solid, ...parts.glow]) made[0].rotateY(TURN_ANGLE[piece.facing]).translate(lx, y, piece.across);
    solid.push(...parts.solid);
    glow.push(...parts.glow);
  }
  const glass = glassOf(plan, (level) => level > 0);
  return { solid: solid.length > 0 ? inWorld(painted(solid), place) : null, glow: glow.length > 0 ? inWorld(painted(glow), place) : null, glass: glass === null ? null : inWorld(glass, place) };
}
