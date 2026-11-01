import * as THREE from "three";
import { FREEWHEEL, launch, makeCar, makeWorld, tickWorld } from "../contact/crash-scenarios.test-util.ts";
import { FRAME_HZ } from "../kernel/constants.ts";
import type { DeformableCar } from "./car.ts";

/** Seconds after the first contact a wall hit is stepped on: the hood's crash fold has settled by then. */
const SETTLE_S = 1.5;
/** Where the sedan starts (m from the wall's face, at its centre line), facing it. */
const START_X = 6.2;
const DEG = 180 / Math.PI;

/** A point of the hood's centre line: its rest z (car frame, m) and the drawn z and y now (car frame), with its rest y. */
export interface CentreRow {
  restZ: number;
  restY: number;
  z: number;
  y: number;
}

/** The hood's top line along the car (x = 0), one row per ring of its mesh, rear to front, in the car frame as the hood is drawn now (skin and pose). */
export function hoodCentre(car: DeformableCar): CentreRow[] {
  const hood = car["hood"];
  const rest = car["hoodRest"];
  const origin = car["hoodOrigin"];
  hood.updateMatrix();
  const position = hood.geometry.getAttribute("position");
  const top = new Map<string, number>();
  for (let i = 0; i < position.count; i++) {
    if (Math.abs(rest[i * 3]!) > 1e-4) continue;
    const ring = rest[i * 3 + 2]!.toFixed(3);
    const held = top.get(ring);
    if (held === undefined || rest[i * 3 + 1]! > rest[held * 3 + 1]!) top.set(ring, i);
  }
  const at = new THREE.Vector3();
  const rows: CentreRow[] = [];
  for (const i of top.values()) {
    at.fromBufferAttribute(position, i).applyMatrix4(hood.matrix);
    rows.push({ restZ: rest[i * 3 + 2]! + origin.z, restY: rest[i * 3 + 1]! + origin.y, z: at.z, y: at.y });
  }
  return rows.sort((a, b) => a.restZ - b.restZ);
}

/** How far (m) the highest row stands over the straight line between the first and last rows, in the rows' rest or drawn places. */
function crestOverChord(rows: readonly CentreRow[], drawn: boolean): number {
  const first = rows[0]!;
  const last = rows[rows.length - 1]!;
  const z = (r: CentreRow): number => (drawn ? r.z : r.restZ);
  const y = (r: CentreRow): number => (drawn ? r.y : r.restY);
  let crest = -Infinity;
  for (const row of rows) crest = Math.max(crest, y(row) - (y(first) + ((y(last) - y(first)) * (z(row) - z(first))) / (z(last) - z(first))));
  return crest;
}

/** How far (deg) a row's segment to the next stands turned from its rest line: + nose-up, the way a rigid turn about the cowl would turn every segment alike. */
function segmentTurnsDeg(rows: readonly CentreRow[]): number[] {
  const turns: number[] = [];
  for (let k = 1; k < rows.length; k++) {
    const a = rows[k - 1]!;
    const b = rows[k]!;
    turns.push((Math.atan2(b.y - a.y, b.z - a.z) - Math.atan2(b.restY - a.restY, b.restZ - a.restZ)) * DEG);
  }
  return turns;
}

function mean(values: readonly number[]): number {
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

/** What a wall hit did to the hood's shape, read at the last frame it stood on the car. */
export interface HoodFold {
  car: DeformableCar;
  /** The hood's hinge value (0 to 1) at that frame. */
  hingeT: number;
  /** Whether the hood tore off before the hit was over. */
  torn: boolean;
  /** How much higher (m) the hood's crest stands over the line between its two ends than it did at rest. */
  crestGainM: number;
  /** The mean turn (deg) of each third of its segments from their rest lines, rear to front. */
  turnDeg: readonly [rear: number, middle: number, front: number];
  /** The hood's centre line at that frame. */
  rows: readonly CentreRow[];
}

/** A fresh sedan driven square into the rigid wall at `kph`, stepped until `SETTLE_S` after its first contact. */
export function hoodFoldAfterWall(kph: number): HoodFold {
  const car = makeCar();
  launch(car, START_X, 0, -Math.PI / 2, -kph / 3.6, 0);
  const world = makeWorld([car], true, false, FREEWHEEL);
  const hood = car["hoodPart"];
  let rows = hoodCentre(car);
  let hingeT = 0;
  let sinceHit = 0;
  while (sinceHit < SETTLE_S) {
    tickWorld(world);
    if (car.crashed) sinceHit += 1 / FRAME_HZ;
    if (hood.detached) continue;
    rows = hoodCentre(car);
    hingeT = hood.hingeT;
  }
  const turns = segmentTurnsDeg(rows);
  const third = Math.floor(turns.length / 3);
  return {
    car,
    hingeT,
    torn: hood.detached,
    rows,
    crestGainM: crestOverChord(rows, true) - crestOverChord(rows, false),
    turnDeg: [mean(turns.slice(0, third)), mean(turns.slice(third, turns.length - third)), mean(turns.slice(turns.length - third))],
  };
}
