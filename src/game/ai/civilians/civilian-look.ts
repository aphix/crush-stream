import { detCos, detSin } from "../../kernel/physics-core.js";
import type { OpenWorldMap } from "../../world/openworld/walk-graph.ts";
import { CHEST_HEIGHT, LOOK_RADIUS, LOOK_REACH, STOREY_HEIGHT } from "./civilian-crowd-constants.ts";
import { buildingLines, civilianLine, historyLines } from "./civilian-mood.ts";
import type { CityState } from "./civilian-state.ts";
import type { CrowdPoses } from "./crowd-poses.ts";

/** The eye and the way it looks (a unit vector), written by whoever owns the camera. */
export class LookRay {
  eyeX = 0;
  eyeY = 0;
  eyeZ = 0;
  dirX = 0;
  dirY = 0;
  dirZ = 1;
}

/** What the look-at panel shows: a title and its lines. */
export type LookText = { title: string; lines: string[] };

/** What the ray meets: its index (resident or place; -1 for nothing) and how far along the ray (m). */
type Meeting = { index: number; along: number };

/** The shown civilian whose chest the ray passes closest to, within `LOOK_RADIUS` of it and `LOOK_REACH` ahead. */
function residentMet(poses: CrowdPoses, ray: LookRay): Meeting {
  const met: Meeting = { index: -1, along: Infinity };
  let bestMiss = LOOK_RADIUS * LOOK_RADIUS;
  for (let resident = 0; resident < poses.count; resident++) {
    if (poses.shown[resident] === 0) continue;
    const toX = poses.x[resident]! - ray.eyeX;
    const toY = CHEST_HEIGHT - ray.eyeY;
    const toZ = poses.z[resident]! - ray.eyeZ;
    const along = toX * ray.dirX + toY * ray.dirY + toZ * ray.dirZ;
    if (along <= 0 || along > LOOK_REACH) continue;
    const miss = toX * toX + toY * toY + toZ * toZ - along * along;
    if (miss >= bestMiss) continue;
    bestMiss = miss;
    met.index = resident;
    met.along = along;
  }
  return met;
}

/** The building (inside the walls) whose box the ray enters first within `LOOK_REACH`: the slab test in the building's own frame (local x its depth, local z its width), ground to roof. */
function placeMet(map: OpenWorldMap, ray: LookRay): Meeting {
  const met: Meeting = { index: -1, along: Infinity };
  for (let place = 0; place < map.places.length; place++) {
    const entry = map.places[place]!;
    if (entry.doorNode < 0) continue;
    const cos = detCos(entry.yaw);
    const sin = detSin(entry.yaw);
    const fromX = ray.eyeX - entry.x;
    const fromZ = ray.eyeZ - entry.z;
    const origin = [fromX * cos - fromZ * sin, ray.eyeY, fromX * sin + fromZ * cos];
    const direction = [ray.dirX * cos - ray.dirZ * sin, ray.dirY, ray.dirX * sin + ray.dirZ * cos];
    const low = [-entry.depth / 2, 0, -entry.width / 2];
    const high = [entry.depth / 2, entry.storeys * STOREY_HEIGHT, entry.width / 2];
    let enter = 0;
    let leave = Infinity;
    for (let axis = 0; axis < 3 && enter < leave; axis++) {
      if (direction[axis] === 0) {
        if (origin[axis]! < low[axis]! || origin[axis]! > high[axis]!) leave = -Infinity;
        continue;
      }
      const near = (low[axis]! - origin[axis]!) / direction[axis]!;
      const far = (high[axis]! - origin[axis]!) / direction[axis]!;
      enter = Math.max(enter, Math.min(near, far));
      leave = Math.min(leave, Math.max(near, far));
    }
    if (enter <= 0 || enter >= leave || enter >= met.along || enter > LOOK_REACH) continue;
    met.index = place;
    met.along = enter;
  }
  return met;
}

/** The panel's text for what the eye rests on: the civilian in front of it (their line and their life log), else the building the ray meets (its kind, who lives or works there, its comings and goings), else nothing; whichever is nearer along the ray. */
export function lookAtOf(state: CityState, poses: CrowdPoses, tick: number, ray: LookRay): LookText | null {
  const resident = residentMet(poses, ray);
  const place = placeMet(state.map, ray);
  if (resident.index >= 0 && resident.along <= place.along) return { title: civilianLine(state, resident.index, tick), lines: historyLines(state, resident.index) };
  return place.index >= 0 ? buildingLines(state, place.index, tick) : null;
}
