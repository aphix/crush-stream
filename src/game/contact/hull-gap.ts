import type { DeformableCar } from "../vehicle/car.ts";
import { DOOR } from "../vehicle/car-door-mesh.ts";
import { hypot2 } from "../deform/physics-util.ts";
import { OUTLINE_REACH } from "./cage-outline.ts";

/**
 * Plan hulls for the lone-car test of `stepWorld` (`loneCars`): two intact road cars that cannot meet over a step run it as one slice. A hull is the cage's plan box widened by
 * what stands out past it (outline, mirrors, a tilted body's lean), read once per car per step (`readHull`); two hulls are clear when a separating axis leaves a gap that
 * closing speed, turn and slack do not eat (`hullsClear`).
 *
 * Fields of one car's hull in a `Float64Array`, `HULL_STRIDE` per car: centre, right and forward unit vectors, half sides along them, plan velocity, rim speed by turning.
 */
export const H_CX = 0;
export const H_CZ = 1;
const H_RX = 2;
const H_RZ = 3;
const H_FX = 4;
const H_FZ = 5;
export const H_HX = 6;
export const H_HZ = 7;
const H_VX = 8;
const H_VZ = 9;
const H_TURN = 10;
export const HULL_STRIDE = 11;

/** The largest `|y|` of the car's forward and right vectors (2.9 degrees) at which it is still read as its plan box. */
export const LEVEL = 0.05;
/** The mirror's tip from the car's axis (m); a latched door reaches no further. */
const MIRROR_TIP = DOOR.hingeX + DOOR.mirrorX + DOOR.mirrorReach;
/** The most a car's velocity changes over a step (m/s²): a position error of half that times the step squared per car. Measured across classes in `world-step-hull.test.ts`: the worst is 56 (a muscle car braking to a stop). */
export const ACCEL_BOUND = 60;
/** What the speeds do not say a step may move a hull by (m): the ride's pitch and the contact passes' capped pushes. */
const HULL_SLACK = 0.02;

/** `car`'s hull into `out` from index `o`; false (`out` unwritten) where the plan box does not describe the car: a wreck, airborne, falling, on a roof, leaning, a door ajar or a part off, asleep. */
export function readHull(car: DeformableCar, out: Float64Array, o: number): boolean {
  if (car.deform.massActive || car.crashed || car.vaporized || car.falling || car.airborne || car.asleep || car.restsOn !== null) return false;
  if (!car.hingesLatched || car.hasLoosePart()) return false;
  if (Math.abs(car.forward.y) > LEVEL || Math.abs(car.right.y) > LEVEL) return false;
  const plan = car.cage.fields.planBox;
  const midX = (plan[0]! + plan[1]!) / 2;
  const midZ = (plan[2]! + plan[3]!) / 2;
  const p = car.group.position;
  const f = car.fwdFlat;
  const r = car.rightFlat;
  // How far the plan of a car-tall body reaches past the level box when it leans by `LEVEL`.
  const tilt = 2 * car.frame.half.y * LEVEL;
  const hx = Math.max((plan[1]! - plan[0]!) / 2, MIRROR_TIP) + OUTLINE_REACH + tilt;
  const hz = (plan[3]! - plan[2]!) / 2 + OUTLINE_REACH + tilt;
  const w = car.angular;
  out[o + H_CX] = p.x + r.x * midX + f.x * midZ;
  out[o + H_CZ] = p.z + r.z * midX + f.z * midZ;
  out[o + H_RX] = r.x;
  out[o + H_RZ] = r.z;
  out[o + H_FX] = f.x;
  out[o + H_FZ] = f.z;
  out[o + H_HX] = hx;
  out[o + H_HZ] = hz;
  out[o + H_VX] = car.velocity.x;
  out[o + H_VZ] = car.velocity.z;
  out[o + H_TURN] = Math.sqrt(w.x * w.x + w.y * w.y + w.z * w.z) * (hypot2(hx, hz) + hypot2(midX, midZ));
  return true;
}

/** The gap (m) the hulls at `a` and `c` leave along the unit (`ux`, `uz`), less the step's closing along it; `dx`, `dz` the centre vector, `wx`, `wz` the relative velocity. */
function axisClearance(hulls: Float64Array, a: number, c: number, ux: number, uz: number, dx: number, dz: number, wx: number, wz: number, dt: number): number {
  const d = dx * ux + dz * uz;
  const reachA = hulls[a + H_HX]! * Math.abs(ux * hulls[a + H_RX]! + uz * hulls[a + H_RZ]!) + hulls[a + H_HZ]! * Math.abs(ux * hulls[a + H_FX]! + uz * hulls[a + H_FZ]!);
  const reachC = hulls[c + H_HX]! * Math.abs(ux * hulls[c + H_RX]! + uz * hulls[c + H_RZ]!) + hulls[c + H_HZ]! * Math.abs(ux * hulls[c + H_FX]! + uz * hulls[c + H_FZ]!);
  const along = wx * ux + wz * uz;
  const closing = d >= 0 ? -along : along;
  return Math.abs(d) - reachA - reachC - Math.max(0, closing) * dt;
}

/** Whether the hulls of cars `ia` and `ib` cannot meet over `dt` s: on one of the four edge directions the gap, less the closing, the turn and the slack, is still open. */
export function hullsClear(hulls: Float64Array, ia: number, ib: number, dt: number): boolean {
  const a = ia * HULL_STRIDE;
  const c = ib * HULL_STRIDE;
  const dx = hulls[c + H_CX]! - hulls[a + H_CX]!;
  const dz = hulls[c + H_CZ]! - hulls[a + H_CZ]!;
  const wx = hulls[c + H_VX]! - hulls[a + H_VX]!;
  const wz = hulls[c + H_VZ]! - hulls[a + H_VZ]!;
  const spent = (hulls[a + H_TURN]! + hulls[c + H_TURN]!) * dt + ACCEL_BOUND * dt * dt + HULL_SLACK;
  if (axisClearance(hulls, a, c, hulls[a + H_RX]!, hulls[a + H_RZ]!, dx, dz, wx, wz, dt) > spent) return true;
  if (axisClearance(hulls, a, c, hulls[a + H_FX]!, hulls[a + H_FZ]!, dx, dz, wx, wz, dt) > spent) return true;
  if (axisClearance(hulls, a, c, hulls[c + H_RX]!, hulls[c + H_RZ]!, dx, dz, wx, wz, dt) > spent) return true;
  return axisClearance(hulls, a, c, hulls[c + H_FX]!, hulls[c + H_FZ]!, dx, dz, wx, wz, dt) > spent;
}
