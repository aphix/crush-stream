import * as THREE from "three";
import { ceilingOver, stairBoxes, wallBoxes } from "../../world/openworld/interior-draft.ts";
import { ROOM_LOOK, SHELL_WALL, STREET_SKIN, type Box, type InteriorPlan } from "../../world/openworld/interior-kinds.ts";
import type { Place } from "../../world/openworld/walk-graph.ts";
import { box, painted, type Piece } from "../prefab-pieces.ts";
import { furnishingParts } from "./interior-kit.ts";

/** A floor's wearing layer on top of its slab (m). */
const FLOOR_LAYER = 0.03;
/** A door leaf: thickness (m), and how much shorter than its opening it is. */
const LEAF_THICK = 0.05;
const LEAF_CLEARANCE = 0.05;
/** The turn each furnishing's front (its +x) takes it to, as a rotation about y in the building's local frame (front is +x there). */
const TURN_ANGLE = [0, -Math.PI / 2, Math.PI, Math.PI / 2] as const;

type Look = (typeof ROOM_LOOK)[InteriorPlan["kind"]];

/** A plan box as a box in the building's local frame (x toward the street, z along its face). */
function localBox(plan: InteriorPlan, solid: Box): THREE.BufferGeometry {
  const x0 = plan.depth / 2 - solid.deep1;
  const x1 = plan.depth / 2 - solid.deep0;
  return box(x1 - x0, solid.y1 - solid.y0, solid.across1 - solid.across0, (x0 + x1) / 2, (solid.y0 + solid.y1) / 2, (solid.across0 + solid.across1) / 2);
}

function wallPieces(plan: InteriorPlan, look: Look, shell: boolean): Piece[] {
  const out: Piece[] = [];
  for (const wall of plan.walls) {
    if (wall.shell !== shell) continue;
    for (const solid of wallBoxes(wall, plan.floors[wall.level]!, ceilingOver(plan.floors, plan.topCeiling, wall.level))) out.push([localBox(plan, solid), look.wall]);
  }
  return out;
}

/** A slab is its body in the ceiling's colour and, except under the roof, a floor layer on top. */
function slabPieces(plan: InteriorPlan, look: Look, shell: boolean): Piece[] {
  const out: Piece[] = [];
  for (const slab of plan.slabs) {
    if (slab.shell !== shell) continue;
    const roof = slab.y0 === plan.topCeiling;
    out.push([localBox(plan, { ...slab.rect, y0: slab.y0, y1: roof ? slab.y1 : slab.y1 - FLOOR_LAYER }), look.ceiling]);
    if (!roof) out.push([localBox(plan, { ...slab.rect, y0: slab.y1 - FLOOR_LAYER, y1: slab.y1 }), look.floor]);
  }
  return out;
}

/** Every doorway in the ground floor's street wall holds a leaf swung open against its hinge jamb. */
function leafPieces(plan: InteriorPlan, look: Look): Piece[] {
  const out: Piece[] = [];
  const street = plan.walls.find((wall) => wall.level === 0 && wall.axis === "across" && wall.fixed < plan.depth / 2);
  if (street === undefined) return out;
  const floor = plan.floors[0]!;
  const hingeDeep = STREET_SKIN + SHELL_WALL;
  for (const opening of street.openings) {
    if (opening.sill !== 0) continue;
    const length = opening.width - LEAF_CLEARANCE;
    const leaf = localBox(plan, { deep0: hingeDeep, deep1: hingeDeep + length, across0: opening.centre - opening.width / 2 + 0.02, across1: opening.centre - opening.width / 2 + 0.02 + LEAF_THICK, y0: floor, y1: floor + opening.top - LEAF_CLEARANCE });
    out.push([leaf, plan.kind === "rowhome" ? look.wood : look.trim]);
  }
  return out;
}

/** Bake the building's turn and place into a merged geometry. */
function inWorld(geometry: THREE.BufferGeometry, place: Place): THREE.BufferGeometry {
  return geometry.rotateY(place.yaw).translate(place.x, 0, place.z);
}

/** The ground floor's envelope: what shows through a door or a shopfront window from the street. */
export function buildShell(plan: InteriorPlan, place: Place): THREE.BufferGeometry {
  const look = ROOM_LOOK[plan.kind];
  return inWorld(painted([...wallPieces(plan, look, true), ...slabPieces(plan, look, true), ...leafPieces(plan, look)]), place);
}

/** Everything else: partitions, upper floors, stairs and the furniture (lit and unlit apart); a geometry is null when it has no pieces. */
export function buildDetail(plan: InteriorPlan, place: Place): { solid: THREE.BufferGeometry | null; glow: THREE.BufferGeometry | null } {
  const look = ROOM_LOOK[plan.kind];
  const solid: Piece[] = [...wallPieces(plan, look, false), ...slabPieces(plan, look, false)];
  const glow: Piece[] = [];
  for (const flight of plan.stairs) for (const tread of stairBoxes(flight, plan.floors[flight.level]!)) solid.push([localBox(plan, tread), look.wood]);
  for (const piece of plan.furnishings) {
    const parts = furnishingParts(piece, plan.kind);
    const lx = plan.depth / 2 - piece.deep;
    const y = plan.floors[piece.level]! + piece.lift;
    for (const made of [...parts.solid, ...parts.glow]) made[0].rotateY(TURN_ANGLE[piece.facing]).translate(lx, y, piece.across);
    solid.push(...parts.solid);
    glow.push(...parts.glow);
  }
  return { solid: solid.length > 0 ? inWorld(painted(solid), place) : null, glow: glow.length > 0 ? inWorld(painted(glow), place) : null };
}
