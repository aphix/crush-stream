import { detCos, detSin } from "../../kernel/physics-core.js";
import type { OpenWorldMap } from "../../world/openworld/walk-graph.ts";
import { ANIMAL_CHEST_HEIGHT, CHEST_HEIGHT, LOOK, LOOK_RADIUS, LOOK_REACH, STOREY_HEIGHT } from "./civilian-crowd-constants.ts";
import { SPECIES } from "./civilian-constants.ts";
import { activityLine } from "./civilian-activity.ts";
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
export type Meeting = { index: number; along: number };

/** The shown civilian whose chest (a cat's or dog's body: `ANIMAL_CHEST_HEIGHT`) the ray passes closest to, within `LOOK_RADIUS` of it and `reach` ahead: the look panel's person. */
export function residentMet(poses: CrowdPoses, ray: LookRay, reach: number = LOOK_REACH): Meeting {
  const met: Meeting = { index: -1, along: Infinity };
  let bestMiss = LOOK_RADIUS * LOOK_RADIUS;
  for (let resident = 0; resident < poses.count; resident++) {
    if (poses.shown[resident] === 0) continue;
    const toX = poses.x[resident]! - ray.eyeX;
    const toY = poses.feetY[resident]! + (poses.look[resident]! >>> LOOK.speciesShift === SPECIES.person ? CHEST_HEIGHT : ANIMAL_CHEST_HEIGHT) - ray.eyeY;
    const toZ = poses.z[resident]! - ray.eyeZ;
    const along = toX * ray.dirX + toY * ray.dirY + toZ * ray.dirZ;
    if (along <= 0 || along > reach) continue;
    const miss = toX * toX + toY * toY + toZ * toZ - along * along;
    if (miss >= bestMiss) continue;
    bestMiss = miss;
    met.index = resident;
    met.along = along;
  }
  return met;
}

/** The ray's eye and direction in a building's own frame, and the building's low and high corners: `placeMet`'s scratch, so a call allocates nothing. */
const _origin = new Float64Array(3);
const _direction = new Float64Array(3);
const _low = new Float64Array(3);
const _high = new Float64Array(3);
/** The look panel's building meeting (`lookAtOf`). */
const _placeMeeting: Meeting = { index: -1, along: Infinity };
/** Per place of a map: the cosine and sine of its yaw, worked out once a map: a trig call's result is boxed, and a look turns into several buildings. */
const YAW_TRIG = new WeakMap<object, Float64Array>();

function buildYawTrig(places: OpenWorldMap["places"]): Float64Array {
  const table = new Float64Array(places.length * 2);
  for (let place = 0; place < places.length; place++) {
    table[place * 2] = detCos(places[place]!.yaw);
    table[place * 2 + 1] = detSin(places[place]!.yaw);
  }
  YAW_TRIG.set(places, table);
  return table;
}

/** The building (inside the walls) whose box the ray enters first within `reach`, into `out` (index -1, along Infinity: none): the slab test in the building's own frame (local x its depth, local z its width), ground to roof. Allocates nothing. */
export function placeMet(map: OpenWorldMap, ray: LookRay, reach: number, out: Meeting): Meeting {
  out.index = -1;
  out.along = Infinity;
  const origin = _origin;
  const direction = _direction;
  const low = _low;
  const high = _high;
  const flat = ray.dirX * ray.dirX + ray.dirZ * ray.dirZ;
  const trig = YAW_TRIG.get(map.places) ?? buildYawTrig(map.places);
  for (let place = 0; place < map.places.length; place++) {
    const entry = map.places[place]!;
    if (entry.doorNode < 0) continue;
    const fromX = ray.eyeX - entry.x;
    const fromZ = ray.eyeZ - entry.z;
    // The ray's level path, within `reach`, never comes within half the building's depth and width of its middle: it cannot enter, so it skips the slab test.
    const nearest = flat > 0 ? Math.max(0, Math.min(reach, -(fromX * ray.dirX + fromZ * ray.dirZ) / flat)) : 0;
    const gapX = fromX + nearest * ray.dirX;
    const gapZ = fromZ + nearest * ray.dirZ;
    const half = (entry.depth + entry.width) / 2;
    if (gapX * gapX + gapZ * gapZ > half * half) continue;
    const cos = trig[place * 2]!;
    const sin = trig[place * 2 + 1]!;
    origin[0] = fromX * cos - fromZ * sin;
    origin[1] = ray.eyeY;
    origin[2] = fromX * sin + fromZ * cos;
    direction[0] = ray.dirX * cos - ray.dirZ * sin;
    direction[1] = ray.dirY;
    direction[2] = ray.dirX * sin + ray.dirZ * cos;
    low[0] = -entry.depth / 2;
    low[1] = 0;
    low[2] = -entry.width / 2;
    high[0] = entry.depth / 2;
    high[1] = entry.storeys * STOREY_HEIGHT;
    high[2] = entry.width / 2;
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
    if (enter <= 0 || enter >= leave || enter >= out.along || enter > reach) continue;
    out.index = place;
    out.along = enter;
  }
  return out;
}

/** The shown figure among the first `count` of `poses`, not marked in `skip`, whose chest (a cat's or dog's body: `ANIMAL_CHEST_HEIGHT`) the ray passes within `radius` m, the nearest, nearer than `reach` m: its index and the distance along the ray into `out` (index -1, `reach`: none). A bullet's test, as `residentMet` is the look's (`peopleOnly`: a cat or dog is passed, as the hook does). Allocates nothing. */
export function chestMet(poses: Pick<CrowdPoses, "x" | "z" | "feetY" | "shown" | "look">, count: number, skip: Uint8Array | null, ray: LookRay, radius: number, reach: number, out: Meeting, peopleOnly = false): Meeting {
  out.index = -1;
  out.along = reach;
  for (let figure = 0; figure < count; figure++) {
    if (poses.shown[figure] === 0 || (skip !== null && skip[figure] === 1)) continue;
    if (peopleOnly && poses.look[figure]! >>> LOOK.speciesShift !== SPECIES.person) continue;
    const px = poses.x[figure]! - ray.eyeX;
    const py = poses.feetY[figure]! + (poses.look[figure]! >>> LOOK.speciesShift === SPECIES.person ? CHEST_HEIGHT : ANIMAL_CHEST_HEIGHT) - ray.eyeY;
    const pz = poses.z[figure]! - ray.eyeZ;
    const along = px * ray.dirX + py * ray.dirY + pz * ray.dirZ;
    if (along <= 0 || along >= out.along || px * px + py * py + pz * pz - along * along > radius * radius) continue;
    out.index = figure;
    out.along = along;
  }
  return out;
}

/**
 * The panel's text for what the eye rests on within `reach` m (a car the caller met first cuts it short): the civilian in front of it (their line, what they are doing when the line does not say it, and their life log),
 * else the building the ray meets (its kind, who lives or works there, its comings and goings), else nothing; whichever is nearer along the ray. `shown.index` is the civilian it is about, -1 for none.
 */
export function lookAtOf(state: CityState, poses: CrowdPoses, tick: number, ray: LookRay, reach = LOOK_REACH, shown: Meeting | null = null): LookText | null {
  const resident = residentMet(poses, ray, reach);
  const place = placeMet(state.map, ray, reach, _placeMeeting);
  const about = resident.index >= 0 && resident.along <= place.along;
  if (shown !== null) shown.index = about ? resident.index : -1;
  if (about) {
    const doing = activityLine(poses.activity[resident.index]!);
    const history = historyLines(state, resident.index);
    return { title: civilianLine(state, resident.index, tick), lines: doing === null ? history : [doing, ...history] };
  }
  return place.index >= 0 ? buildingLines(state, place.index, tick) : null;
}
