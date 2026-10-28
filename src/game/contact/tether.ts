import * as THREE from "three";
import type { DeformableCar } from "../vehicle/car.ts";
import { rigidCentre } from "../vehicle/car-air.ts";
import { invInertia } from "../vehicle/car-air-body.ts";
import { carClass, CLASSES } from "../vehicle/vehicle-classes.ts";
import { MAX_TETHERS, WINCH_MIN_LENGTH, WINCH_SPEED } from "../kernel/constants.ts";

/** The farthest (m) a hook reaches: Just Cause 4's grapple range. */
export const TETHER_RANGE = 80;
/** The most pull (N) a retract gives: it takes a sedan (1.4 t) to `WINCH_SPEED` in 0.7 s and a monster truck (2.9 t) in 1.5, so the heavy one arrives later and a cable between the two moves the sedan twice as far. */
const RETRACT_FORCE = 55_000;
/** What a new cable holds (N) before it snaps: above the retract (55 kN) and a sedan swinging 15 m below its anchor (40 kN), below a sedan yanked at 12 m/s (150 kN). */
const BREAK_FORCE = 140_000;
/** The window (s) a cable's tension is averaged over before it is compared to its strength, so the break does not depend on the slice length. */
const BREAK_SMOOTH_S = 0.1;
/** Share of a cable's stretch the solver pulls back in one slice: under Baumgarte's 0.1 to 0.3, since a cable that is already taut only ever stretches by a step's rounding. */
const STRETCH_BIAS = 0.1;
/** The most (m/s) the stretch correction pulls the ends together, so a large error never throws a body. */
const MAX_PULL_IN = 1;
/** Passes over the cables per slice: two cables sharing a car settle on each other. */
const PASSES = 4;
/** Anchors nearer than this (m) have no direction to pull along. */
const MIN_SPAN = 1e-6;

/** A cable end is a point of a car (its car-frame coordinates), of the world, or of a thing in the dummies' world (a dummy, a prop, a box: `RAPIER`, its coordinates the world point the dummies' world last put it at). */
export const WORLD = -1;
export const RAPIER = -2;

/** What a `RAPIER` end is, in `TetherSet.thing`: a kind and its index, one number. */
export const THING = { doll: 1, prop: 2, box: 3 } as const;
const THING_RADIX = 1 << 16;

/** One cable's numbers in `TetherSet.rows`: alive, the two ends' car index, the two ends' coordinates, its length (m), its averaged tension (N), its strength (N) and the two ends' things. */
export const ROW = 14;
const R_ALIVE = 0;
const R_CAR = 1;
const R_POS = 3;
const R_LENGTH = 9;
const R_TENSION = 10;
export const R_STRENGTH = 11;
const R_THING = 12;

/** A thing's `THING` kind and index as the one number `TetherSet.setEnd` keeps, and back. */
export function thingCode(kind: number, index: number): number {
  return kind * THING_RADIX + index;
}

export function thingKind(code: number): number {
  return Math.floor(code / THING_RADIX);
}

export function thingIndex(code: number): number {
  return code % THING_RADIX;
}

/** The cables of a world: at most `MAX_TETHERS`, each held in a row of numbers so a step with none costs one read of `count`. */
export class TetherSet {
  readonly rows = new Float64Array(MAX_TETHERS * ROW);
  /** Cables alive. */
  count = 0;
  /** The retract is held: every cable reels in. */
  reeling = false;
  /** The slot a full set gives up next (the oldest). */
  private oldest = 0;

  isAlive(slot: number): boolean {
    return this.rows[slot * ROW + R_ALIVE] === 1;
  }

  /** A fresh cable in a free slot (the oldest one's, if the set is full), its ends unset: set both (`setEnd`), then `fit` it. */
  open(): number {
    let slot = -1;
    for (let i = 0; i < MAX_TETHERS; i++) {
      if (!this.isAlive(i)) {
        slot = i;
        break;
      }
    }
    if (slot < 0) {
      slot = this.oldest;
      this.release(slot);
    }
    this.oldest = (slot + 1) % MAX_TETHERS;
    const o = slot * ROW;
    this.rows.fill(0, o, o + ROW);
    this.rows[o + R_ALIVE] = 1;
    this.rows[o + R_STRENGTH] = BREAK_FORCE;
    this.count++;
    return slot;
  }

  /** End `end` (0 or 1) of cable `slot`: car `car` (or `WORLD`, or `RAPIER` with its `thing`) at (x, y, z), a car-frame point for a car. */
  setEnd(slot: number, end: number, car: number, x: number, y: number, z: number, thing = 0): void {
    const o = slot * ROW;
    this.rows[o + R_CAR + end] = car;
    this.rows[o + R_POS + 3 * end] = x;
    this.rows[o + R_POS + 3 * end + 1] = y;
    this.rows[o + R_POS + 3 * end + 2] = z;
    this.rows[o + R_THING + end] = thing;
  }

  /** The cable is as long as its ends stand apart now (slack from here on when they come closer). False, and no change, where a car is gone. */
  fit(slot: number, cars: readonly DeformableCar[]): boolean {
    if (!this.anchor(slot, 0, cars, _from) || !this.anchor(slot, 1, cars, _to)) return false;
    this.rows[slot * ROW + R_LENGTH] = _to.distanceTo(_from);
    return true;
  }

  /** The world place of cable `slot`'s end `end` into `out`; false where its car is not in `cars`. */
  anchor(slot: number, end: number, cars: readonly DeformableCar[], out: THREE.Vector3): boolean {
    const o = slot * ROW;
    const car = this.rows[o + R_CAR + end]!;
    out.set(this.rows[o + R_POS + 3 * end]!, this.rows[o + R_POS + 3 * end + 1]!, this.rows[o + R_POS + 3 * end + 2]!);
    if (car === WORLD || car === RAPIER) return true;
    const body = cars[car];
    if (body === undefined) return false;
    out.applyQuaternion(body.group.quaternion).add(body.group.position);
    return true;
  }

  /** The car index (or `WORLD`) cable `slot`'s end `end` is on. */
  endCar(slot: number, end: number): number {
    return this.rows[slot * ROW + R_CAR + end]!;
  }

  /** The thing (`thingCode` of its `THING` kind and index) on cable `slot`'s `RAPIER` end `end`. */
  thing(slot: number, end: number): number {
    return this.rows[slot * ROW + R_THING + end]!;
  }

  /** End `end` of cable `slot` as it was set (a car end's car-frame point, else a world point) into `out`. */
  point(slot: number, end: number, out: THREE.Vector3): THREE.Vector3 {
    const o = slot * ROW + R_POS + 3 * end;
    return out.set(this.rows[o]!, this.rows[o + 1]!, this.rows[o + 2]!);
  }

  /** Cable `slot` has an end in the dummies' world: that world holds it, the sim's solver leaves it alone. */
  isRapier(slot: number): boolean {
    return this.endCar(slot, 0) === RAPIER || this.endCar(slot, 1) === RAPIER;
  }

  /** Some cable the sim solves is out (not only ones the dummies' world holds). */
  get sim(): boolean {
    if (this.count === 0) return false;
    for (let i = 0; i < MAX_TETHERS; i++) if (this.isAlive(i) && !this.isRapier(i)) return true;
    return false;
  }

  /** Where the dummies' world has `RAPIER` end `end` of cable `slot` now, and how long its rope is. */
  setPlace(slot: number, end: number, x: number, y: number, z: number, length: number): void {
    const o = slot * ROW;
    this.rows[o + R_POS + 3 * end] = x;
    this.rows[o + R_POS + 3 * end + 1] = y;
    this.rows[o + R_POS + 3 * end + 2] = z;
    this.rows[o + R_LENGTH] = length;
  }

  length(slot: number): number {
    return this.rows[slot * ROW + R_LENGTH]!;
  }

  /** The cable's tension (N), averaged over `BREAK_SMOOTH_S`. */
  tension(slot: number): number {
    return this.rows[slot * ROW + R_TENSION]!;
  }

  release(slot: number): void {
    if (!this.isAlive(slot)) return;
    this.rows[slot * ROW + R_ALIVE] = 0;
    this.count--;
  }

  clear(): void {
    for (let i = 0; i < MAX_TETHERS; i++) this.release(i);
    this.reeling = false;
  }
}

const _from = new THREE.Vector3();
const _to = new THREE.Vector3();
const _centre = new THREE.Vector3();
const _spin = new THREE.Vector3();
const _inverse = new THREE.Quaternion();

/** One end of a cable in one slice: where it is, its arm from its body's centre of mass, and what its body gives to a pull along the cable. */
class End {
  car: DeformableCar | null = null;
  readonly point = new THREE.Vector3();
  readonly arm = new THREE.Vector3();
  readonly velocity = new THREE.Vector3();
  readonly lever = new THREE.Vector3();
  mass = 0;
  /** Takes a spin from a pull off its centre: an intact car's rigid body, not a wreck's masses. */
  rotates = false;
}

const _ends = Array.from({ length: 2 * MAX_TETHERS }, () => new End());
const _axes = Array.from({ length: MAX_TETHERS }, () => new THREE.Vector3());
/** Per cable this slice: whether it is solved, the inverse mass of its pull, the closing speed it asks for (m/s, negative: pull in), the impulse it may still give and the impulse it has given. */
const W_LIVE = 0;
const W_INVERSE_MASS = 1;
const W_TARGET = 2;
const W_ROOM = 3;
const W_GIVEN = 4;
const W_STRIDE = 5;
const _work = new Float64Array(MAX_TETHERS * W_STRIDE);

/** A car's tether-end fields for the point `anchor` of it (world), or the world's when `car` is null. */
function placeEnd(end: End, car: DeformableCar | null, anchor: THREE.Vector3): void {
  end.car = car;
  end.point.copy(anchor);
  if (car === null) {
    end.arm.set(0, 0, 0);
    end.mass = 0;
    end.rotates = false;
    return;
  }
  _centre.copy(rigidCentre(car)).applyQuaternion(car.group.quaternion).add(car.group.position);
  end.arm.copy(anchor).sub(_centre);
  end.mass = CLASSES[carClass(car)].mass;
  end.rotates = car.rigid;
}

/** Whether a tether may hold `car`: a put-away, vaporized or fallen car is out of the game. */
function holdable(car: DeformableCar): boolean {
  return !car.stored && !car.vaporized && !car.falling;
}

/** The inverse mass a pull along `axis` at `end` sees: 1/m with the spin its lever gives an intact car; 0 for the world. */
function inverseMassAt(end: End, axis: THREE.Vector3): number {
  const car = end.car;
  if (car === null) return 0;
  end.lever.crossVectors(end.arm, axis);
  if (!end.rotates) return 1 / end.mass;
  _inverse.copy(car.group.quaternion).invert();
  _spin.copy(end.lever);
  invInertia(_spin, car.group.quaternion, _inverse, car.frame.invI);
  return (1 + _spin.dot(end.lever)) / end.mass;
}

function pointVelocity(end: End): void {
  const car = end.car;
  if (car === null) {
    end.velocity.set(0, 0, 0);
    return;
  }
  end.velocity.crossVectors(car.angular, end.arm).add(car.velocity);
}

/** Impulse `j` (N s, signed) along `axis` at `end`: the body's velocity (and its masses', for a wreck) and, for an intact car, its spin. */
function push(end: End, axis: THREE.Vector3, j: number): void {
  const car = end.car;
  if (car === null) return;
  const dv = j / end.mass;
  if (car.asleep) car.wake();
  car.velocity.addScaledVector(axis, dv);
  if (end.rotates) {
    _inverse.copy(car.group.quaternion).invert();
    _spin.crossVectors(end.arm, axis);
    invInertia(_spin, car.group.quaternion, _inverse, car.frame.invI);
    car.angular.addScaledVector(_spin, dv);
    return;
  }
  const masses = car.deform.masses;
  for (let i = 0; i < masses.length; i++) masses[i]!.vel.addScaledVector(axis, dv);
}

/** Cable `slot`'s ends and axis (end 0 toward end 1) as the slice of `h` s finds them, and what it asks of them; false when it cannot be solved (a car gone, the ends on one spot). */
function prepare(set: TetherSet, slot: number, cars: readonly DeformableCar[], h: number): boolean {
  const o = slot * ROW;
  const carA = set.rows[o + R_CAR]!;
  const carB = set.rows[o + R_CAR + 1]!;
  if (carA === carB) return false;
  const bodyA = carA === WORLD ? null : cars[carA];
  const bodyB = carB === WORLD ? null : cars[carB];
  if (bodyA === undefined || bodyB === undefined) return false;
  if ((bodyA !== null && !holdable(bodyA)) || (bodyB !== null && !holdable(bodyB))) return false;
  set.anchor(slot, 0, cars, _from);
  set.anchor(slot, 1, cars, _to);
  const a = _ends[2 * slot]!;
  const b = _ends[2 * slot + 1]!;
  placeEnd(a, bodyA, _from);
  placeEnd(b, bodyB, _to);
  const axis = _axes[slot]!.copy(_to).sub(_from);
  const span = axis.length();
  if (span < MIN_SPAN) return false;
  axis.divideScalar(span);
  const inverse = inverseMassAt(a, axis) + inverseMassAt(b, axis);
  if (inverse <= 0) return false;
  // The winch takes up slack at once: it reels from where the ends stand, and never lets the cable out.
  if (set.reeling) set.rows[o + R_LENGTH] = Math.min(set.rows[o + R_LENGTH]!, Math.max(Math.min(WINCH_MIN_LENGTH, set.rows[o + R_LENGTH]!), span - WINCH_SPEED * h));
  const stretch = span - set.rows[o + R_LENGTH]!;
  const w = slot * W_STRIDE;
  _work[w + W_LIVE] = 1;
  _work[w + W_INVERSE_MASS] = inverse;
  _work[w + W_ROOM] = set.reeling ? RETRACT_FORCE * h : Infinity;
  _work[w + W_TARGET] = stretch <= 0 || set.reeling ? -stretch / h : -Math.min((STRETCH_BIAS * stretch) / h, MAX_PULL_IN);
  return true;
}

/**
 * One slice of every cable, after the contact passes: each cable pulls its two ends together only while they are farther apart than its length
 * (a one-sided distance constraint, solved as impulses at the anchors with the bodies' mass and inertia), asks for a retract's speed while the
 * retract is held at a capped force, and snaps once its averaged tension passes its strength. A slack cable gives nothing.
 */
export function solveTethers(set: TetherSet, cars: readonly DeformableCar[], h: number): void {
  _work.fill(0);
  for (let slot = 0; slot < MAX_TETHERS; slot++) {
    if (set.isAlive(slot) && !set.isRapier(slot) && !holds(set, slot, cars, h)) {
      set.release(slot);
      _work[slot * W_STRIDE + W_LIVE] = 0;
    }
  }
  for (let pass = 0; pass < PASSES; pass++) {
    for (let slot = 0; slot < MAX_TETHERS; slot++) pull(slot);
  }
  for (let slot = 0; slot < MAX_TETHERS; slot++) wear(set, slot, h);
}

/** Whether cable `slot` can be solved this slice and stands the load it is about to carry: a shock past its strength snaps it before it stops anything. */
function holds(set: TetherSet, slot: number, cars: readonly DeformableCar[], h: number): boolean {
  return prepare(set, slot, cars, h) && tensionAfter(set, slot, wanted(slot), h) <= set.rows[slot * ROW + R_STRENGTH]!;
}

/** The impulse (N s) cable `slot` still wants to give: what brings its ends' closing speed down to what it asks, within the room the retract's force leaves. */
function wanted(slot: number): number {
  const w = slot * W_STRIDE;
  const axis = _axes[slot]!;
  pointVelocity(_ends[2 * slot]!);
  pointVelocity(_ends[2 * slot + 1]!);
  const closing = _to.copy(_ends[2 * slot + 1]!.velocity).sub(_ends[2 * slot]!.velocity).dot(axis);
  const excess = closing - _work[w + W_TARGET]!;
  return excess <= 0 ? 0 : Math.min(excess / _work[w + W_INVERSE_MASS]!, _work[w + W_ROOM]! - _work[w + W_GIVEN]!);
}

/** One pass of cable `slot`: its wanted impulse, given to the two ends. */
function pull(slot: number): void {
  if (_work[slot * W_STRIDE + W_LIVE] === 0) return;
  const j = wanted(slot);
  if (j <= 0) return;
  push(_ends[2 * slot]!, _axes[slot]!, j);
  push(_ends[2 * slot + 1]!, _axes[slot]!, -j);
  _work[slot * W_STRIDE + W_GIVEN] = _work[slot * W_STRIDE + W_GIVEN]! + j;
}

/** Cable `slot`'s tension (N) after a slice of `h` s in which it gives `impulse` (N s): the impulse as a force, averaged over `BREAK_SMOOTH_S`. */
function tensionAfter(set: TetherSet, slot: number, impulse: number, h: number): number {
  const tension = set.rows[slot * ROW + R_TENSION]!;
  return tension + (impulse / h - tension) * (h / (BREAK_SMOOTH_S + h));
}

/** Cable `slot` keeps this slice's tension; it snaps past its strength. */
function wear(set: TetherSet, slot: number, h: number): void {
  if (_work[slot * W_STRIDE + W_LIVE] === 0) return;
  const tension = tensionAfter(set, slot, _work[slot * W_STRIDE + W_GIVEN]!, h);
  set.rows[slot * ROW + R_TENSION] = tension;
  if (tension > set.rows[slot * ROW + R_STRENGTH]!) set.release(slot);
}
