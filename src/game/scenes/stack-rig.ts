import * as THREE from "three";
import type { DeformableCar } from "../vehicle/car.ts";
import { beginContacts, readContact, wheelsAt } from "../vehicle/car-air-points.ts";
import { crownY, keelY } from "../vehicle/car-cage-rig.ts";
import { SKIN } from "../vehicle/car-surfaces.ts";
import { armTops, C_OWNER, C_TOUCH, HIT_SIZE } from "../world/surfaces.ts";
import { hypot2 } from "../kernel/physics-core.js";
import { UPRIGHT } from "./constants.ts";

/**
 * The stack scene (docs/LOAD_CRUSH.md): cars dropped one at a time onto a base car, so the bottom roof crushes by the
 * weight above it. The physics is the headless test's (`vehicle/stack-crush.test.ts`): the same world step, the same
 * load crush; only the drop is sequential.
 */

export type StackConfig = {
  /** Cars in the finished stack, the base car included. */
  cars: number;
  /** Gap (m) from the stack's top to the belly of the car about to fall. */
  drop: number;
  /** Seconds from one drop to the next, and from the last drop to the loop's restart. */
  gap: number;
};

/** The test's own values: `stack(4)` (cars), `GAP = 0.02` (drop), `SETTLE_S = 8` (gap). */
export const STACK_DEFAULTS: Readonly<StackConfig> = { cars: 4, drop: 0.02, gap: 8 };

/** Slider and share-URL bounds: the owner's perf smoke tests run 10 to 20 cars. */
export const STACK_RANGES = {
  cars: { min: 2, max: 20 },
  drop: { min: 0.02, max: 2 },
  gap: { min: 1, max: 20 },
} as const;

/** Seconds from the scene's start to the first drop: the empty base car shows first. */
export const LEAD_S = 1;
const G = 9.81;
/** The stock keel's height (m) over the origin, for the camera's framing of a tower. */
const STOCK_KEEL_Y = 0.13;

/** The opening orbit shot for a finished stack of `n` cars (one car adds about 1.17 m): looking at the base car's roof, far enough back for the whole tower. */
export function stackShot(n: number): { lookY: number; radius: number; pitch: number } {
  return { lookY: 0.65, radius: Math.min(30, Math.max(12, (n * 1.17 + STOCK_KEEL_Y) * 1.3)), pitch: 0.32 };
}

export class StackRig {
  config: StackConfig = { ...STACK_DEFAULTS };
  /** Cars in the stack so far, the base car included. */
  dropped = 1;

  /** A fresh run: the base car alone. */
  restart(): void {
    this.dropped = 1;
  }

  /**
   * Where the run stands at sim time `t` (s the physics has stepped since the restart): "drop" when the next car falls now
   * (`dropped` already counts it), "loop" once the finished stack has had its last gap. Drops are on the physics clock, so
   * a slow frame that steps less does not drop ahead of the stack.
   */
  step(t: number): "drop" | "loop" | null {
    const { cars, gap } = this.config;
    if (this.dropped < cars) {
      if (t < LEAD_S + (this.dropped - 1) * gap) return null;
      this.dropped++;
      return "drop";
    }
    return t >= LEAD_S + (cars - 1) * gap ? "loop" : null;
  }
}

const _support = new THREE.Vector3();
/** The world point over the middle of `car`'s roof (y is its origin's): every style's roof sits behind its belly pan, so a car above stands over it, not over the lower car's origin. */
function roofSupport(car: DeformableCar): THREE.Vector3 {
  const [rear, front] = car.style.roofZ;
  return _support.set(0, 0, 0.5 * (rear + front)).applyQuaternion(car.group.quaternion).add(car.group.position);
}

/** Stand car `k` (hidden or spent) upright over the roof's support of the car below it (`cars[k-1]`), turned from it, over the crushed roofs of the stack (`cars[0..k-1]`), `drop` m clear of them (`dropGap`), falling. */
export function placeDrop(cars: readonly DeformableCar[], k: number, drop: number): void {
  const top = stackTop(cars, k);
  const car = cars[k]!;
  car.group.visible = true;
  const over = k > 0 ? roofSupport(cars[k - 1]!) : _support.set(0, 0, 0);
  car.spawnFacing(over.x, over.z, (k % 2) * Math.PI, 0);
  car.parked = true;
  car.group.position.y = top - keelY(car) + drop;
  liftClear(cars, k, drop);
  readContact(car);
  // The load crush reads the car below's matrixWorld in the next step; the renderer's update comes after it.
  car.group.updateMatrixWorld(true);
}

/** How close (m) a drop's start is found to its height: a tenth of the millimetre the stack's rows read it to. */
const PLACE_TOL = 1e-4;

/** Raise car `k` (set by its keel) to the least height from which it falls `drop` before meeting the stack. A tyre reads a face over its hub as a wall and one under it as a floor, so the gap jumps as the car rises: bisected, not raised by the shortfall. */
function liftClear(cars: readonly DeformableCar[], k: number, drop: number): void {
  const p = cars[k]!.group.position;
  let lo = p.y;
  for (let g = dropGap(cars, k); g < drop - PLACE_TOL; g = dropGap(cars, k)) {
    lo = p.y;
    p.y += drop - g;
  }
  let hi = p.y;
  while (hi - lo > PLACE_TOL) {
    p.y = 0.5 * (lo + hi);
    if (dropGap(cars, k) < drop - PLACE_TOL) lo = p.y;
    else hi = p.y;
  }
  p.y = hi;
}

/** The highest crown (m, world y) of the stack's cars under car `k`, the ground's 0 if none stands higher. */
function stackTop(cars: readonly DeformableCar[], k: number): number {
  let top = 0;
  for (let i = 0; i < k; i++) top = Math.max(top, cars[i]!.group.position.y + crownY(cars[i]!));
  return top;
}

/** How far (m) car `k`, as posed, falls before it first meets the cars under it: its keel over their highest crown, or a tyre's tread over the roof under that tyre, whichever is less (a turned wagon's front tyres reach under its keel). */
export function dropGap(cars: readonly DeformableCar[], k: number): number {
  const car = cars[k]!;
  let gap = car.group.position.y + keelY(car) - stackTop(cars, k);
  const surf = car.surfaces;
  // A car never stepped is in no world: no roof to meet but the keel's.
  if (surf === null) return gap;
  car.group.updateMatrixWorld(true);
  surf.sync(car.slot, car);
  armTops(surf);
  beginContacts(car);
  wheelsAt(car, 0);
  armTops(null);
  const hit = car.wheelHit;
  for (let i = 0; i < 4; i++) if (hit[i * HIT_SIZE + C_OWNER]! >= 0) gap = Math.min(gap, -hit[i * HIT_SIZE + C_TOUCH]!);
  return gap;
}

/** How far (m) a car may sit off the axis of the car under it and still stand on it. */
const COLUMN_OFFSET = 0.6;
/** How far (m) a car's belly may ride over the roof under it and still read as standing on it (a drop in flight carries nothing yet; one from higher reads null). */
const COLUMN_CLEAR = 0.5;

/**
 * Per car in the stack (bottom first): the weight above it (kN) and its roof's sink (mm), read off the sim's cars. Load
 * counts the cars still standing in the column on the base car, each upright, within `COLUMN_OFFSET` of the car under
 * it with its belly on that roof; a car off the column (toppled, fallen, still in the air) carries and reads null.
 * The load-crush step's own force is per slice and is not kept, so the column is read from the poses.
 */
export function stackLoads(cars: readonly DeformableCar[], n: number): { loadKn: (number | null)[]; crushMm: number[] } {
  let column = 1;
  while (column < n && stands(cars[column - 1]!, cars[column]!)) column++;
  const loadKn: (number | null)[] = [];
  const crushMm: number[] = [];
  let above = 0;
  for (let i = n - 1; i >= 0; i--) {
    const c = cars[i]!;
    if (i < column) {
      loadKn[i] = (above * G) / 1000;
      above += c.deform.totalMass;
    } else loadKn[i] = null;
    crushMm[i] = (c.roofRestY - c.deform.massLocal("roof").y) * 1000;
  }
  return { loadKn, crushMm };
}

/** Whether `upper` stands on `lower`: upright, its origin near the support of the roof (`COLUMN_OFFSET`) and its belly on it (at most `SKIN` in it, `COLUMN_CLEAR` over it), whatever the two bodies' heights, lifts and crush. */
function stands(lower: DeformableCar, upper: DeformableCar): boolean {
  const a = lower.group.position;
  const b = upper.group.position;
  const over = b.y + keelY(upper) - (a.y + crownY(lower));
  const support = roofSupport(lower);
  return upper.group.matrixWorld.elements[5]! > UPRIGHT && hypot2(b.x - support.x, b.z - support.z) < COLUMN_OFFSET && over > -SKIN && over < COLUMN_CLEAR;
}
