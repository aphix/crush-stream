import type { CrowdPoses } from "../ai/civilians/crowd-poses.ts";
import {
  ATTRACT_M,
  CAR_BRUSH_M,
  CAR_BRUSH_SPEED,
  CAR_BRUSH_URGENCY,
  CAR_CALM_SPEED,
  CAR_COMING_S,
  CAR_COMING_SPEED,
  CAR_COMING_URGENCY,
  CAR_FAST_SPEED,
  CAR_MISS_M,
  DOWN_URGENCY,
  EYE_HEIGHT_M,
  FACE_HEIGHT_M,
  FOV_COS,
  NOTICE_FLOOR,
  GLANCE_DISTANCE_M,
  GLANCE_SHARE,
  GLANCE_URGENCY,
  GLANCE_YAW,
  GROUND_PITCH,
  GROUND_SHARE,
  HASH16,
  hash16,
  KIND_LIFE,
  KIND_RANGE,
  PASSER_AHEAD_COS,
  PASSER_M,
  PASSER_SHARE,
  PASSER_URGENCY,
  PERSONAL_M,
  PLAYER_NOTICE_SHARE,
  PLAYER_URGENCY,
  SCRATCH,
  SIREN_URGENCY,
  SKY_PITCH,
  SKY_SHARE,
  STIMULUS,
  TOUCH_M,
} from "./civilian-gaze-constants.ts";
import type { GazeStimuli } from "./civilian-gaze-table.ts";

/** Cells of the passers-by grid (a power of two) and their size (m): a passer-by is looked for in the 3 x 3 cells about her. */
const GRID_CELLS = 1024;
const CELL_M = 4;
/** Salts so a person's draws for different questions in one poll differ. */
const SALT = { player: 1, passer: 2, glance: 3, glanceYaw: 4, glancePitch: 5 } as const;

/** The cell key of grid cell (cellX, cellZ): a spatial hash, so a city of any size fits `GRID_CELLS`. */
function cellKey(cellX: number, cellZ: number): number {
  return (Math.imul(cellX, 73856093) ^ Math.imul(cellZ, 19349663)) & (GRID_CELLS - 1);
}

/** The shown civilians bucketed by where they stand, rebuilt each frame: who is near whom without a scan of the crowd. */
export class CrowdGrid {
  private readonly head = new Int32Array(GRID_CELLS);
  private readonly next: Int32Array;

  constructor(capacity: number) {
    this.next = new Int32Array(capacity);
  }

  build(poses: CrowdPoses, count: number): void {
    this.head.fill(-1);
    for (let civilian = 0; civilian < count; civilian++) {
      if (poses.shown[civilian] === 0) continue;
      const key = cellKey(Math.floor(poses.x[civilian]! / CELL_M), Math.floor(poses.z[civilian]! / CELL_M));
      this.next[civilian] = this.head[key]!;
      this.head[key] = civilian;
    }
  }

  /** The nearest shown civilian but `civilian` and her partner within `PASSER_M` ahead of her (the scratch's own spot and heading), -1 for none. */
  passerAhead(poses: CrowdPoses, civilian: number, s: Float64Array): number {
    const cellX = Math.floor(s[SCRATCH.ownX]! / CELL_M);
    const cellZ = Math.floor(s[SCRATCH.ownZ]! / CELL_M);
    const partner = poses.partner[civilian]!;
    let best = -1;
    let bestSquared = PASSER_M * PASSER_M;
    for (let offset = 0; offset < 9; offset++) {
      for (let other = this.head[cellKey(cellX + (offset % 3) - 1, cellZ + Math.floor(offset / 3) - 1)]!; other >= 0; other = this.next[other]!) {
        if (other === civilian || other === partner) continue;
        const dx = poses.x[other]! - s[SCRATCH.ownX]!;
        const dz = poses.z[other]! - s[SCRATCH.ownZ]!;
        const squared = dx * dx + dz * dz;
        if (squared >= bestSquared || dx * s[SCRATCH.aheadX]! + dz * s[SCRATCH.aheadZ]! < PASSER_AHEAD_COS * Math.sqrt(squared)) continue;
        best = other;
        bestSquared = squared;
      }
    }
    return best;
  }
}

/** What choosing a look reads and writes: the table, the grid, the attractors (x, y, z triples), the frame, and the candidate (kind, source; its point, urgency and distance in `scratch`). */
export type LookChooser = {
  readonly scratch: Float64Array;
  readonly stimuli: GazeStimuli;
  readonly grid: CrowdGrid;
  attractors: Float32Array;
  frame: number;
  candidateKind: number;
  candidateSource: number;
};

/** The scratch holds civilian `civilian`'s spot, eye height and heading, and no candidate yet. */
function loadSelf(chooser: LookChooser, civilian: number, poses: CrowdPoses): void {
  const s = chooser.scratch;
  s[SCRATCH.ownX] = poses.x[civilian]!;
  s[SCRATCH.ownZ] = poses.z[civilian]!;
  s[SCRATCH.eyeY] = poses.feetY[civilian]! + EYE_HEIGHT_M;
  s[SCRATCH.aheadX] = Math.sin(poses.yaw[civilian]!);
  s[SCRATCH.aheadZ] = Math.cos(poses.yaw[civilian]!);
  s[SCRATCH.urgency] = 0;
  chooser.candidateKind = STIMULUS.none;
  chooser.candidateSource = -1;
}

/** `trial` for a car row: fast and near, coming at her, or brushing by; the row's offset, distance and nearness are in the scratch. */
function carTrial(t: GazeStimuli, row: number, s: Float64Array): void {
  const vx = t.vx[row]!;
  const vz = t.vz[row]!;
  const speed = Math.sqrt(vx * vx + vz * vz) + 1e-9;
  const distance = s[SCRATCH.distance]!;
  const closing = -(s[SCRATCH.dx]! * vx + s[SCRATCH.dz]! * vz) / distance;
  const miss = Math.abs(s[SCRATCH.dx]! * vz - s[SCRATCH.dz]! * vx) / speed;
  const fast = Math.min(1, Math.max(0, (speed - CAR_CALM_SPEED) / (CAR_FAST_SPEED - CAR_CALM_SPEED))) * s[SCRATCH.near]!;
  const coming = closing > CAR_COMING_SPEED && distance < closing * CAR_COMING_S && miss < CAR_MISS_M ? CAR_COMING_URGENCY : 0;
  const brush = distance < CAR_BRUSH_M && speed > CAR_BRUSH_SPEED ? CAR_BRUSH_URGENCY : 0;
  s[SCRATCH.trial] = Math.max(s[SCRATCH.trial]!, fast, coming, brush);
}

/** `trial`: how strongly row `row` draws civilian `civilian` as the scratch has her (0: not at all, out of range or out of sight). */
function rowTrial(chooser: LookChooser, civilian: number, row: number): void {
  const s = chooser.scratch;
  const t = chooser.stimuli;
  const kind = t.kind[row]!;
  s[SCRATCH.trial] = 0;
  const dx = t.x[row]! - s[SCRATCH.ownX]!;
  const dz = t.z[row]! - s[SCRATCH.ownZ]!;
  const range = KIND_RANGE[kind]!;
  const squared = dx * dx + dz * dz;
  if (squared > range * range || squared === 0) return;
  const distance = Math.sqrt(squared);
  s[SCRATCH.dx] = dx;
  s[SCRATCH.dz] = dz;
  s[SCRATCH.distance] = distance;
  s[SCRATCH.near] = 1 - distance / range;
  const seen = distance < TOUCH_M || dx * s[SCRATCH.aheadX]! + dz * s[SCRATCH.aheadZ]! >= FOV_COS * distance;
  if (kind === STIMULUS.siren) s[SCRATCH.trial] = SIREN_URGENCY * s[SCRATCH.near]!;
  if ((kind === STIMULUS.car && seen) || kind === STIMULUS.siren) carTrial(t, row, s);
  else if (kind === STIMULUS.down && seen) s[SCRATCH.trial] = DOWN_URGENCY * s[SCRATCH.near]!;
  else if (kind === STIMULUS.crash || kind === STIMULUS.knock || kind === STIMULUS.gunshot) s[SCRATCH.trial] = (t.salience[row]! * s[SCRATCH.near]! * t.life[row]!) / KIND_LIFE[kind]!;
  else if (kind === STIMULUS.player && seen && (distance < PERSONAL_M || hash16(civilian, (chooser.frame >>> 3) ^ SALT.player) < PLAYER_NOTICE_SHARE * HASH16)) s[SCRATCH.trial] = PLAYER_URGENCY * s[SCRATCH.near]!;
}

/** The candidate becomes a look at row `row` of the table, at urgency `trial`. */
function takeRow(chooser: LookChooser, row: number): void {
  const s = chooser.scratch;
  const t = chooser.stimuli;
  chooser.candidateKind = t.kind[row]!;
  chooser.candidateSource = t.source[row]!;
  s[SCRATCH.urgency] = s[SCRATCH.trial]!;
  s[SCRATCH.x] = t.x[row]!;
  s[SCRATCH.y] = t.y[row]!;
  s[SCRATCH.z] = t.z[row]!;
}

/** The candidate becomes a glance at the passer-by nearest ahead, on `PASSER_SHARE` of polls. */
function considerPasser(chooser: LookChooser, civilian: number, poses: CrowdPoses): void {
  const s = chooser.scratch;
  if (s[SCRATCH.urgency]! >= PASSER_URGENCY || hash16(civilian, (chooser.frame >>> 3) ^ SALT.passer) >= PASSER_SHARE * HASH16) return;
  const other = chooser.grid.passerAhead(poses, civilian, s);
  if (other < 0) return;
  chooser.candidateKind = STIMULUS.person;
  chooser.candidateSource = other;
  s[SCRATCH.urgency] = PASSER_URGENCY;
  s[SCRATCH.x] = poses.x[other]!;
  s[SCRATCH.y] = poses.feetY[other]! + FACE_HEIGHT_M;
  s[SCRATCH.z] = poses.z[other]!;
}

/** The nearest attractor within `ATTRACT_M` in front of her, -1 for none. */
function attractorInView(chooser: LookChooser): number {
  const s = chooser.scratch;
  const points = chooser.attractors;
  let best = -1;
  let bestSquared = ATTRACT_M * ATTRACT_M;
  for (let at = 0; at + 2 < points.length; at += 3) {
    const dx = points[at]! - s[SCRATCH.ownX]!;
    const dz = points[at + 2]! - s[SCRATCH.ownZ]!;
    const squared = dx * dx + dz * dz;
    if (squared >= bestSquared || dx * s[SCRATCH.aheadX]! + dz * s[SCRATCH.aheadZ]! < FOV_COS * Math.sqrt(squared)) continue;
    best = at;
    bestSquared = squared;
  }
  return best;
}

/** The candidate becomes an idle glance, on `GLANCE_SHARE` x `freedom` of polls: the nearest shop window or sign in front, else a point on the sky, the street or the ground off to a side. */
function considerGlance(chooser: LookChooser, civilian: number, freedom: number): void {
  const s = chooser.scratch;
  const draw = (chooser.frame >>> 3) ^ SALT.glance;
  if (chooser.candidateKind !== STIMULUS.none || hash16(civilian, draw) >= GLANCE_SHARE * freedom * HASH16) return;
  chooser.candidateKind = STIMULUS.glance;
  chooser.candidateSource = -1;
  s[SCRATCH.urgency] = GLANCE_URGENCY;
  const attractor = attractorInView(chooser);
  if (attractor >= 0) {
    s[SCRATCH.x] = chooser.attractors[attractor]!;
    s[SCRATCH.y] = chooser.attractors[attractor + 1]!;
    s[SCRATCH.z] = chooser.attractors[attractor + 2]!;
    return;
  }
  const off = (2 * hash16(civilian, draw ^ SALT.glanceYaw)) / HASH16 - 1;
  const lean = hash16(civilian, draw ^ SALT.glancePitch) / HASH16;
  const pitch = lean < SKY_SHARE ? SKY_PITCH : lean < SKY_SHARE + GROUND_SHARE ? GROUND_PITCH : 0;
  const yaw = Math.atan2(s[SCRATCH.aheadX]!, s[SCRATCH.aheadZ]!) + off * GLANCE_YAW;
  s[SCRATCH.x] = s[SCRATCH.ownX]! + GLANCE_DISTANCE_M * Math.sin(yaw);
  s[SCRATCH.y] = s[SCRATCH.eyeY]! - GLANCE_DISTANCE_M * Math.tan(pitch);
  s[SCRATCH.z] = s[SCRATCH.ownZ]! + GLANCE_DISTANCE_M * Math.cos(yaw);
}

/**
 * The best thing for civilian `civilian` to look at now (`candidateKind` none: nothing): the most urgent stimulus she senses, else maybe a passer-by ahead, else with
 * `freedom` (0 while a look or its cooldown runs) maybe an idle glance. Allocates nothing.
 */
export function chooseLook(chooser: LookChooser, civilian: number, poses: CrowdPoses, freedom: number): void {
  loadSelf(chooser, civilian, poses);
  const s = chooser.scratch;
  for (let row = 0; row < chooser.stimuli.count; row++) {
    rowTrial(chooser, civilian, row);
    if (s[SCRATCH.trial]! >= NOTICE_FLOOR && s[SCRATCH.trial]! > s[SCRATCH.urgency]!) takeRow(chooser, row);
  }
  considerPasser(chooser, civilian, poses);
  if (freedom > 0) considerGlance(chooser, civilian, freedom);
}
