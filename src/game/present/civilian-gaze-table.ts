import { CAR_FAST_SPEED, CAR_NOTICE_MIN_SPEED, KIND_LIFE, PULSE_CAPACITY, STIMULUS, STIMULUS_CAPACITY } from "./civilian-gaze-constants.ts";

/**
 * What the crowd can sense this frame, one row each: the lingering pulses first (crash, knock, shot, someone down), then the player on foot and every
 * car fast enough or with its siren on. `source` is the car's index in the senses' cars, -1 otherwise; `life` the seconds a pulse lingers yet.
 */
export type GazeStimuli = {
  count: number;
  kind: Uint8Array;
  x: Float32Array;
  y: Float32Array;
  z: Float32Array;
  salience: Float32Array;
  source: Int32Array;
  life: Float32Array;
  vx: Float32Array;
  vz: Float32Array;
};

export function createStimuli(): GazeStimuli {
  return {
    count: 0,
    kind: new Uint8Array(STIMULUS_CAPACITY),
    x: new Float32Array(STIMULUS_CAPACITY),
    y: new Float32Array(STIMULUS_CAPACITY),
    z: new Float32Array(STIMULUS_CAPACITY),
    salience: new Float32Array(STIMULUS_CAPACITY),
    source: new Int32Array(STIMULUS_CAPACITY),
    life: new Float32Array(STIMULUS_CAPACITY),
    vx: new Float32Array(STIMULUS_CAPACITY),
    vz: new Float32Array(STIMULUS_CAPACITY),
  };
}

/** What gaze reads of a car (a `DeformableCar` is one). */
export type GazeCar = {
  readonly group: { readonly position: { readonly x: number; readonly y: number; readonly z: number } };
  readonly velocity: { readonly x: number; readonly z: number };
  readonly sirens: boolean;
};

/** What the crowd senses, filled by the engine each frame: the eye (only those near it are turned), the player on foot (his face), the cars, and the buildings' line of sight (null: none blocks). */
export type GazeSenses = {
  eyeX: number;
  eyeZ: number;
  player: boolean;
  playerX: number;
  playerY: number;
  playerZ: number;
  cars: readonly GazeCar[];
  lineOfSight: ((ax: number, az: number, bx: number, bz: number) => boolean) | null;
};

export function blankSenses(): GazeSenses {
  return { eyeX: 0, eyeZ: 0, player: false, playerX: 0, playerY: 0, playerZ: 0, cars: [], lineOfSight: null };
}

/** Row `from` copied over row `to`. */
function moveRow(t: GazeStimuli, from: number, to: number): void {
  t.kind[to] = t.kind[from]!;
  t.x[to] = t.x[from]!;
  t.y[to] = t.y[from]!;
  t.z[to] = t.z[from]!;
  t.salience[to] = t.salience[from]!;
  t.source[to] = t.source[from]!;
  t.life[to] = t.life[from]!;
  t.vx[to] = t.vx[from]!;
  t.vz[to] = t.vz[from]!;
}

/** Row `row` made a still stimulus of `kind` at (x, y, z) from the table's `life` slot onward; its salience and source are the caller's. */
function stillRow(t: GazeStimuli, row: number, kind: number): void {
  t.kind[row] = kind;
  t.source[row] = -1;
  t.life[row] = KIND_LIFE[kind]!;
  t.vx[row] = 0;
  t.vz[row] = 0;
}

/**
 * A pulse of `kind` at (x, y, z) lingers in the first `pulses` rows (when they are full it replaces the one with least life left); returns the new count of pulse rows.
 * It may overwrite a player or car row until the next `refreshStimuli`.
 */
export function addPulse(t: GazeStimuli, pulses: number, kind: number, x: number, y: number, z: number, salience: number): number {
  let at = pulses;
  if (pulses >= PULSE_CAPACITY) {
    at = 0;
    for (let other = 1; other < pulses; other++) if (t.life[other]! < t.life[at]!) at = other;
  }
  stillRow(t, at, kind);
  t.x[at] = x;
  t.y[at] = y;
  t.z[at] = z;
  t.salience[at] = salience;
  const count = Math.max(pulses, at + 1);
  t.count = Math.max(t.count, count);
  return count;
}

/** The table for a frame `dt` s after the last: the pulses aged and the spent dropped, then the player and the cars sensed now. Returns the pulse rows kept. */
export function refreshStimuli(t: GazeStimuli, pulses: number, senses: GazeSenses, dt: number): number {
  let kept = 0;
  for (let row = 0; row < pulses; row++) {
    const life = t.life[row]! - dt;
    if (life <= 0) continue;
    moveRow(t, row, kept);
    t.life[kept] = life;
    kept++;
  }
  let count = kept;
  if (senses.player) {
    stillRow(t, count, STIMULUS.player);
    t.x[count] = senses.playerX;
    t.y[count] = senses.playerY;
    t.z[count] = senses.playerZ;
    t.salience[count] = 1;
    count++;
  }
  const cars = senses.cars;
  for (let car = 0; car < cars.length && count < STIMULUS_CAPACITY; car++) {
    const body = cars[car]!;
    const vx = body.velocity.x;
    const vz = body.velocity.z;
    const speed = Math.sqrt(vx * vx + vz * vz);
    const siren = body.sirens;
    if (!siren && speed < CAR_NOTICE_MIN_SPEED) continue;
    t.kind[count] = siren ? STIMULUS.siren : STIMULUS.car;
    t.x[count] = body.group.position.x;
    t.y[count] = body.group.position.y;
    t.z[count] = body.group.position.z;
    t.salience[count] = Math.min(1, speed / CAR_FAST_SPEED);
    t.source[count] = car;
    t.life[count] = 0;
    t.vx[count] = vx;
    t.vz[count] = vz;
    count++;
  }
  t.count = count;
  return kept;
}
