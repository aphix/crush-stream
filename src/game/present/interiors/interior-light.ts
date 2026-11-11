import { hypot2 } from "../../kernel/physics-core.js";
import { wallBoxes } from "../../world/openworld/interior-draft.ts";
import { ceilingOver, lookKind, PARTY_WALL, SHELL_WALL, type InteriorPlan } from "../../world/openworld/interior-kinds.ts";
import { ROOM_LIGHT } from "./interior-constants.ts";

/** A room's light sources and bounds in the plan's local frame (x toward the street, y up, z across). */
export type RoomLight = {
  ambient: number;
  /** x, y, z, r, g, b (colour times power), level, per lamp or screen. */
  fixtures: Float32Array;
  fixtureCount: number;
  /** Centre x, y, z, inward normal x, z, area (m²), level, per window pane. */
  panes: Float32Array;
  paneCount: number;
  /** minX, minY, minZ, maxX, maxY, maxZ, level, per wall that is not the ground floor's envelope. */
  boxes: Float32Array;
  boxCount: number;
  /** Floor y and ceiling y, per level. */
  levels: Float32Array;
  levelCount: number;
  /** The inner faces of the street and back walls, and of the party walls, are this far (m) from the plan's middle. */
  halfDepth: number;
  halfWidth: number;
};

const FIXTURE = 7;
const PANE = 7;
const BOX = 7;
const SCREEN_COLOUR = [0.55, 0.8, 1.0] as const;
const SCREEN_POWER = 1.5;
const DESK_SCREEN_POWER = 0.8;
const DESK_SCREEN_HEIGHT = 0.9;
/** A corner this far (m) or less under a floor's top belongs to that floor's level. */
const LEVEL_SLACK = 0.1;

/** 0.4 hard against a wall, floor or ceiling, 1 from 0.9 m away: the darkening of corners and edges. */
function edge(distance: number): number {
  const t = Math.max(0, Math.min(1, distance / 0.9));
  return 0.4 + 0.6 * t * t * (3 - 2 * t);
}

/** Whether a wall of `level` stands between the corner at p and the point p + l. */
function blocked(light: RoomLight, level: number, px: number, py: number, pz: number, lx: number, ly: number, lz: number): boolean {
  for (let box = 0; box < light.boxCount; box++) {
    const o = box * BOX;
    if (light.boxes[o + 6] !== level) continue;
    let near = 0.02;
    let far = 0.98;
    for (let axis = 0; axis < 3; axis++) {
      const from = axis === 0 ? px : axis === 1 ? py : pz;
      const along = axis === 0 ? lx : axis === 1 ? ly : lz;
      const low = light.boxes[o + axis]!;
      const high = light.boxes[o + 3 + axis]!;
      if (Math.abs(along) < 1e-6) {
        if (from < low || from > high) near = 2;
        continue;
      }
      const a = (low - from) / along;
      const b = (high - from) / along;
      near = Math.max(near, Math.min(a, b));
      far = Math.min(far, Math.max(a, b));
    }
    if (near <= far) return true;
  }
  return false;
}

/** The light at one corner: lamp r, g, b (0 to 1) and daylight (0 to 1) into `out[at..at+3]`. `furniture`: a corner of a furnishing, shaded toward the floor. */
export function bakeCorner(light: RoomLight, px: number, py: number, pz: number, nx: number, ny: number, nz: number, furniture: boolean, out: Float32Array, at: number): void {
  let level = 0;
  for (let l = 1; l < light.levelCount; l++) if (py >= light.levels[l * 2]! - LEVEL_SLACK) level = l;
  const floorY = light.levels[level * 2]!;
  const ceilingY = light.levels[level * 2 + 1]!;
  let r = light.ambient;
  let g = light.ambient;
  let b = light.ambient;
  for (let f = 0; f < light.fixtureCount; f++) {
    const o = f * FIXTURE;
    if (light.fixtures[o + 6] !== level) continue;
    const lx = light.fixtures[o]! - px;
    const ly = light.fixtures[o + 1]! - py;
    const lz = light.fixtures[o + 2]! - pz;
    const d2 = lx * lx + ly * ly + lz * lz;
    const d = Math.sqrt(d2);
    if (d < 1e-4) continue;
    const facing = Math.max(0, (nx * lx + ny * ly + nz * lz) / d);
    if (facing === 0 || blocked(light, level, px, py, pz, lx, ly, lz)) continue;
    const gain = (facing * (0.35 + 0.65 * Math.max(0, ly / d))) / (d2 + 0.36);
    r += light.fixtures[o + 3]! * gain;
    g += light.fixtures[o + 4]! * gain;
    b += light.fixtures[o + 5]! * gain;
  }
  // A surface is not darkened by its own plane: each pair of bounds counts by how far the corner's normal is from that axis.
  const upDown = 1 - (1 - edge(py - floorY) * edge(ceilingY - py)) * (1 - Math.abs(ny));
  const frontBack = 1 - (1 - edge(light.halfDepth - px) * edge(px + light.halfDepth)) * (1 - Math.abs(nx));
  const sides = 1 - (1 - edge(light.halfWidth - pz) * edge(pz + light.halfWidth)) * (1 - Math.abs(nz));
  let open = upDown * frontBack * sides;
  if (furniture) open *= 0.6 + 0.4 * Math.min(1, Math.max(0, (py - floorY) / 0.3));
  let day = 0.06;
  for (let p = 0; p < light.paneCount; p++) {
    const o = p * PANE;
    if (light.panes[o + 6] !== level) continue;
    const wx = light.panes[o]! - px;
    const wy = light.panes[o + 1]! - py;
    const wz = light.panes[o + 2]! - pz;
    const r2 = wx * wx + wy * wy + wz * wz;
    const w = Math.sqrt(r2);
    if (w < 1e-4) continue;
    const toPane = Math.max(0, (nx * wx + ny * wy + nz * wz) / w);
    const through = Math.max(0, -(wx * light.panes[o + 3]! + wz * light.panes[o + 4]!) / w);
    day += (light.panes[o + 5]! * toPane * through) / (Math.PI * r2 + 1);
  }
  out[at] = (1 - Math.exp(-r)) * open;
  out[at + 1] = (1 - Math.exp(-g)) * open;
  out[at + 2] = (1 - Math.exp(-b)) * open;
  out[at + 3] = Math.min(1, day) * open;
}

/** The light sources and bounds of `plan`: every `lamp` and `screen` furnishing, a screen for each `desk`, every window pane, every wall above the ground floor's envelope. Built once per plan. */
export function lightingOf(plan: InteriorPlan): RoomLight {
  const fixtures: number[] = [];
  const panes: number[] = [];
  const boxes: number[] = [];
  const source = (x: number, y: number, z: number, colour: readonly [number, number, number], power: number, level: number): void => {
    fixtures.push(x, y, z, colour[0] * power, colour[1] * power, colour[2] * power, level);
  };
  for (const f of plan.furnishings) {
    const room = ROOM_LIGHT[lookKind(plan.kind, f.level)];
    const x = plan.depth / 2 - f.deep;
    const floor = plan.floors[f.level]!;
    if (f.kind === "lamp") source(x, floor + f.lift, f.across, room.color, room.power, f.level);
    else if (f.kind === "screen") source(x, floor + f.lift + f.height / 2, f.across, SCREEN_COLOUR, SCREEN_POWER, f.level);
    else if (f.kind === "desk") source(x, floor + DESK_SCREEN_HEIGHT, f.across, SCREEN_COLOUR, DESK_SCREEN_POWER, f.level);
  }
  for (const p of plan.panes) {
    const x0 = plan.depth / 2 - p.deep0;
    const x1 = plan.depth / 2 - p.deep1;
    const dx = x1 - x0;
    const dz = p.across1 - p.across0;
    const length = hypot2(dx, dz);
    if (length === 0) continue;
    const cx = (x0 + x1) / 2;
    const cz = (p.across0 + p.across1) / 2;
    let nx = -dz / length;
    let nz = dx / length;
    // The normal that points to the plan's middle is the inward one.
    if (nx * -cx + nz * -cz < 0) {
      nx = -nx;
      nz = -nz;
    }
    panes.push(cx, (p.y0 + p.y1) / 2, cz, nx, nz, length * (p.y1 - p.y0), p.level);
  }
  for (const wall of plan.walls) {
    if (wall.shell) continue;
    for (const b of wallBoxes(wall, plan.floors[wall.level]!, ceilingOver(plan.floors, plan.topCeiling, wall.level))) {
      boxes.push(plan.depth / 2 - b.deep1, b.y0, b.across0, plan.depth / 2 - b.deep0, b.y1, b.across1, wall.level);
    }
  }
  const levels = plan.floors.flatMap((floor, level) => [floor, ceilingOver(plan.floors, plan.topCeiling, level)]);
  return {
    ambient: ROOM_LIGHT[plan.kind].ambient,
    fixtures: Float32Array.from(fixtures),
    fixtureCount: fixtures.length / FIXTURE,
    panes: Float32Array.from(panes),
    paneCount: panes.length / PANE,
    boxes: Float32Array.from(boxes),
    boxCount: boxes.length / BOX,
    levels: Float32Array.from(levels),
    levelCount: plan.floors.length,
    halfDepth: plan.depth / 2 - SHELL_WALL,
    halfWidth: plan.width / 2 - PARTY_WALL,
  };
}
