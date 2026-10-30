import * as THREE from "three";
import { hypot2, hypot3 } from "../kernel/physics-core.js";
import { clamp } from "../kernel/scalar.ts";
import type { DeformableCar } from "../vehicle/car.ts";
import { LOOSE_BODIES } from "../vehicle/part-state.ts";

/** A standing figure's mass (kg): the dummy's (`TOTAL_MASS`), which this layer cannot import; a test pins them equal. */
export const FIGURE_KG = 101.448;
/** A sticking hit that changes a standing man's speed by this much (m/s) knocks him down: the push-recovery research's "fall likely" band. */
const KNOCK_DV = 1;
/** A figure's body for a striker to meet: a post of this radius (m: his arms' reach) and this height (m) over the ground. */
const BODY_RADIUS = 0.3;
const BODY_HEIGHT = 1.8;
/**
 * How his launch takes the car's motion (`fell`): its horizontal velocity, a lift of `LIFT_PER_MPS` per m/s of its speed up to
 * `LIFT_MAX` (m/s), a kick away from the car's centre line of `KICK_PER_MPS` per m/s up to `KICK_MAX` (the car goes on at speed
 * whatever it hit, so he is thrown clear of its path), and a turn of `TUMBLE_PER_MPS` rad/s per m/s up to `TUMBLE_MAX`, legs
 * ahead of his head (guessed, set by eye).
 */
const LIFT_PER_MPS = 0.2;
const LIFT_MAX = 5;
const KICK_PER_MPS = 0.3;
const KICK_MAX = 6;
const TUMBLE_PER_MPS = 0.3;
const TUMBLE_MAX = 8;

/**
 * A standing figure a car ran down, or a loose part of it reached (`loose`): who (`guard`: the squad's index, -1 for the VIP), the car,
 * where his feet stood and which way he faced (a unit vector on the ground), and how he is launched (world velocity and spin). Every
 * number is f32-exact (`Math.fround`), so the copy a clip stored is the launch the live race made.
 */
export type FigureStrike = {
  guard: number;
  car: number;
  x: number;
  y: number;
  z: number;
  faceX: number;
  faceZ: number;
  vx: number;
  vy: number;
  vz: number;
  wx: number;
  wy: number;
  wz: number;
  loose: boolean;
};

/** A fresh record (decoders fill it). */
export function blankStrike(): FigureStrike {
  return { guard: 0, car: 0, x: 0, y: 0, z: 0, faceX: 0, faceZ: 1, vx: 0, vy: 0, vz: 0, wx: 0, wy: 0, wz: 0, loose: false };
}

/**
 * Does a striker of `kg` moving at `v` m/s toward a standing figure (its own velocity at the touch point, along the touch normal) knock
 * him down? The one law for every striker: his speed change if it sticks to him.
 */
export function knocksDown(kg: number, v: number): boolean {
  return (kg * v) / (kg + FIGURE_KG) >= KNOCK_DV;
}

/** `car`'s right and forward unit directions on the ground (x, z), and the ground point (x, z) in its frame: across (along the right) and ahead (along the forward). */
const _frame = { rightX: 0, rightZ: 0, fwdX: 0, fwdZ: 0, across: 0, ahead: 0 };
const _at = new THREE.Vector3();
const _v = new THREE.Vector3();
const _d = new THREE.Vector3();
const _n = new THREE.Vector3();
const _inv = new THREE.Quaternion();

/** `_frame` for the ground point (x, z) against `car`'s pose. */
function inCarFrame(car: DeformableCar, x: number, z: number): void {
  const { x: qx, y: qy, z: qz, w: qw } = car.group.quaternion;
  const dx = x - car.group.position.x;
  const dz = z - car.group.position.z;
  _frame.rightX = 1 - 2 * (qy * qy + qz * qz);
  _frame.rightZ = 2 * (qx * qz - qw * qy);
  _frame.fwdX = 2 * (qx * qz + qw * qy);
  _frame.fwdZ = 1 - 2 * (qx * qx + qy * qy);
  _frame.across = dx * _frame.rightX + dz * _frame.rightZ;
  _frame.ahead = dx * _frame.fwdX + dz * _frame.fwdZ;
}

/**
 * Does `car` run down a figure standing with his feet at (x, groundY, z)? Its cage's plan box (as crushed) grown by his body's radius
 * holds him, its origin no higher over the ground than he stands tall, and it knocks him down (`knocksDown`) at its whole mass, with its
 * velocity at his feet along the normal of the grown face he is least inside; a car already over him (landed on him, or a step past
 * its face) meets him at its whole ground speed.
 */
export function runsDown(car: DeformableCar, x: number, z: number, groundY: number): boolean {
  if (car.falling || car.vaporized || !car.group.visible || car.group.position.y - groundY > BODY_HEIGHT) return false;
  inCarFrame(car, x, z);
  const plan = car.cage.fields.planBox;
  const left = _frame.across - plan[0]! + BODY_RADIUS;
  const right = plan[1]! + BODY_RADIUS - _frame.across;
  const rear = _frame.ahead - plan[2]! + BODY_RADIUS;
  const front = plan[3]! + BODY_RADIUS - _frame.ahead;
  const inside = Math.min(left, right, rear, front);
  if (inside < 0) return false;
  car.pointVelocity(_at.set(x, groundY, z), _v);
  if (inside > 2 * BODY_RADIUS) return knocksDown(car.deform.totalMass, hypot2(_v.x, _v.z));
  const side = inside === left || inside === right;
  const sign = inside === left || inside === rear ? -1 : 1;
  const nx = sign * (side ? _frame.rightX : _frame.fwdX);
  const nz = sign * (side ? _frame.rightZ : _frame.fwdZ);
  return knocksDown(car.deform.totalMass, _v.x * nx + _v.z * nz);
}

/**
 * Does a loose body of `car` (a torn part, a popped wheel) knock down a figure standing with his feet at (x, groundY, z)? Its box (a
 * wheel's disk's) grown by his body's radius holds his axis at its middle's height, and it knocks him down (`knocksDown`) at its mass,
 * with its velocity along the line from the box to him. An asleep one strikes nobody.
 */
export function looseRunsDown(car: DeformableCar, x: number, z: number, groundY: number): boolean {
  for (let b = 0; b < LOOSE_BODIES; b++) {
    const body = car.looseBody(b);
    if (body === null || body.shape.asleep) continue;
    const { half, centre } = body.shape;
    const q = body.object.quaternion;
    _at.copy(centre).applyQuaternion(q).add(body.object.position);
    if (hypot2(_at.x - x, _at.z - z) > hypot3(half.x, half.y, half.z) + BODY_RADIUS) continue;
    _d.set(x, clamp(_at.y, groundY, groundY + BODY_HEIGHT), z).sub(_at).applyQuaternion(_inv.copy(q).invert());
    if (Math.abs(_d.x) > half.x + BODY_RADIUS || Math.abs(_d.y) > half.y + BODY_RADIUS || Math.abs(_d.z) > half.z + BODY_RADIUS) continue;
    _n.set(_d.x - clamp(_d.x, -half.x, half.x), _d.y - clamp(_d.y, -half.y, half.y), _d.z - clamp(_d.z, -half.z, half.z));
    // His axis inside the box: it meets him along its way.
    if (_n.lengthSq() < 1e-12) _n.copy(body.velocity);
    else _n.applyQuaternion(q);
    const length = _n.length();
    if (length > 0 && knocksDown(car.looseKg(b), body.velocity.dot(_n) / length)) return true;
  }
  return false;
}

/**
 * `out` as the launch of a figure a loose part of car `carIndex` reached (`looseRunsDown`): standing still where he stood, the part's own
 * strike (`LooseProxies`) then landing on him in the dummies' world, as on any dummy.
 */
export function stood(carIndex: number, guard: number, x: number, groundY: number, z: number, faceX: number, faceZ: number, out: FigureStrike): FigureStrike {
  out.guard = guard;
  out.car = carIndex;
  out.x = Math.fround(x);
  out.y = Math.fround(groundY);
  out.z = Math.fround(z);
  out.faceX = Math.fround(faceX);
  out.faceZ = Math.fround(faceZ);
  out.vx = out.vy = out.vz = out.wx = out.wy = out.wz = 0;
  out.loose = true;
  return out;
}

/**
 * `out` as the launch of the figure `car` (slot `carIndex`) just ran down (`runsDown`): at the car's velocity with a lift, a kick to
 * the side of its centre line he stood on and a tumble that grow with its speed, his legs swept ahead and his head left behind.
 */
export function fell(car: DeformableCar, carIndex: number, guard: number, x: number, groundY: number, z: number, faceX: number, faceZ: number, out: FigureStrike): FigureStrike {
  const speed = hypot2(car.velocity.x, car.velocity.z);
  // A car spinning on the spot runs a man down by its turn alone.
  const dirX = speed > 0 ? car.velocity.x / speed : 0;
  const dirZ = speed > 0 ? car.velocity.z / speed : 0;
  const turn = Math.min(TUMBLE_MAX, TUMBLE_PER_MPS * speed);
  inCarFrame(car, x, z);
  const kick = (_frame.across < 0 ? -1 : 1) * Math.min(KICK_MAX, KICK_PER_MPS * speed);
  out.guard = guard;
  out.car = carIndex;
  out.x = Math.fround(x);
  out.y = Math.fround(groundY);
  out.z = Math.fround(z);
  out.faceX = Math.fround(faceX);
  out.faceZ = Math.fround(faceZ);
  out.vx = Math.fround(car.velocity.x + _frame.rightX * kick);
  out.vy = Math.fround(Math.min(LIFT_MAX, LIFT_PER_MPS * speed));
  out.vz = Math.fround(car.velocity.z + _frame.rightZ * kick);
  out.wx = Math.fround(-dirZ * turn);
  out.wy = 0;
  out.wz = Math.fround(dirX * turn);
  out.loose = false;
  return out;
}
