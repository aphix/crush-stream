import { COMPACTOR, CompactorRig, PLATE } from "./compactor.ts";
import { FREEWHEEL, makeCar, relaunchDamaged } from "../contact/crash-scenarios.test-util.ts";
import { bodyHit, makeBox, strikeCar, type ContactBox } from "../contact/external-contact.ts";
import { physicsSlice } from "../contact/sat.ts";
import { newWorld, stepWorld } from "../engine/world-step.ts";
import { applyDrive, idleDrive } from "../vehicle/car-drive.ts";
import { armKill, carClass, DEFAULT_REALISM } from "../vehicle/vehicle-classes.ts";
import { DT } from "../vehicle/test-support.ts";
import type { DeformableCar } from "../vehicle/car.ts";

/** How far (m) inboard of the hub line the plates stop, and how long (s) they hold there before they open: deep enough for a squeeze (`deepCrush`), hubs still on. */
const PAST_HUB = 0.03;
const HOLD_S = 0.4;
/** The nose plate stops this far (m) inboard of the nose bumper's rest: shallower than the tail's, so the two ends crush unequally, as a corner wreck's do. */
const FRONT_IN = 0.15;
/** The wreck sits this long (s) after the plates open (the contact window closes), then drives into a wall `WALL_Z` m ahead of the press's centre. */
const SETTLE_S = 0.9;
const WALL_Z = 3;
/** The wall is met this long (s) after its first touch, then gone: the wreck's last contact. */
const TOUCH_S = 0.12;
/** The reading runs this long (s) past the last contact: the contact window (0.4 s), the freeze after it, and the drive on. */
const AFTER_S = 1;
const THROTTLE = 0.6;

function standingCar(): DeformableCar {
  const car = makeCar("shape", 0.32, 0.45);
  armKill(car.deform, carClass(car), DEFAULT_REALISM, "derby");
  car.spawnFacing(0, 0, 0, 0);
  return car;
}

function pressed(holdS: number, frontIn = FRONT_IN): CompactorRig {
  const car = standingCar();
  const rig = new CompactorRig(car);
  car.parked = true;
  const front = makeBox();
  const rear = makeBox();
  let frontFace = rig.faces.startFace;
  let rearFace = rig.faces.startFace;
  const frontStop = rig.faces.bumperZ - frontIn;
  const rearStop = rig.faces.hubZ - PAST_HUB;
  const plate = (box: ContactBox, end: 1 | -1, face: number, closing: boolean): void => {
    box.y = PLATE.y;
    box.z = end * (face + PLATE.hz);
    box.hx = PLATE.hx;
    box.hy = PLATE.hy;
    box.hz = PLATE.hz;
    box.yaw = end > 0 ? Math.PI : 0;
    box.vz = closing ? -end * COMPACTOR.speed : 0;
  };
  const step = (): void => {
    const closing = [frontFace > frontStop, rearFace > rearStop] as const;
    frontFace = Math.max(frontStop, frontFace - COMPACTOR.speed * DT);
    rearFace = Math.max(rearStop, rearFace - COMPACTOR.speed * DT);
    car.integrate(DT);
    car.refreshBasis();
    plate(front, 1, frontFace, closing[0]);
    plate(rear, -1, rearFace, closing[1]);
    strikeCar(car, front, DT, true);
    if (bodyHit.touching) car.noteContactEnd(1, frontFace);
    strikeCar(car, rear, DT, true);
    if (bodyHit.touching) car.noteContactEnd(-1, rearFace);
    car.deform.stepStructure(DT, car.group.quaternion);
    car.syncPose(DT);
    car.afterContacts(DT);
    car.stepBreakage(DT);
  };
  while (frontFace > frontStop || rearFace > rearStop) step();
  for (let t = 0; t < holdS; t += DT) step();
  return rig;
}

/** How far (m) a rear bumper's distance to the cell has shortened from rest, the two bumpers' mean. */
function rearCrush(rig: CompactorRig): number {
  const d = rig.d;
  const cell = d.masses.find((m) => m.name === "cell")!;
  let sum = 0;
  for (const name of ["bumperRL", "bumperRR"]) {
    const m = d.masses.find((n) => n.name === name)!;
    sum += m.rest.distanceTo(cell.rest) - m.local.distanceTo(cell.local);
  }
  return sum / 2;
}

/** A car held `seconds` in the press at its deepest: how far its rear bumpers have crushed (m). */
export function heldRearCrush(seconds: number): number {
  return rearCrush(pressed(seconds));
}

/**
 * `car` driven at `throttle` into a wall `wallZ` m ahead of its centre after `settle` s, met for `TOUCH_S` (its last contact) and read for `AFTER_S` more: the most (m) a rear hub's place in the
 * car frame moves forward, into the car, after that contact. The wall is no fixed solid (it never re-arms a wreck's hit), like the plates.
 */
function intoWall(car: DeformableCar, wallZ: number, throttle: number, settle: number): number {
  const hubs = car.deform.masses.filter((m) => m.hub && m.rest.z < 0);
  const world = newWorld([car]);
  const wall = makeBox();
  wall.y = PLATE.y;
  wall.hx = PLATE.hx;
  wall.hy = PLATE.hy;
  wall.hz = PLATE.hz;
  wall.z = wallZ + PLATE.hz;
  wall.yaw = Math.PI;
  const input = idleDrive();
  let t = 0;
  let touchedAt = -1;
  let lastContact = Infinity;
  let from: number[] = [];
  let creep = 0;
  while (t < lastContact + AFTER_S) {
    const h = physicsSlice(DT, Math.max(8, car.speed));
    input.throttle = t < settle ? 0 : throttle;
    applyDrive(car, input, h);
    if (t >= settle && t < lastContact) {
      strikeCar(car, wall, h, true);
      if (bodyHit.touching && touchedAt < 0) touchedAt = t;
      if (touchedAt >= 0 && t >= touchedAt + TOUCH_S) {
        lastContact = t;
        from = hubs.map((m) => m.local.z);
      }
    }
    stepWorld(world, h);
    t += h;
    if (t > lastContact) for (const [i, m] of hubs.entries()) creep = Math.max(creep, m.local.z - from[i]!);
  }
  if (touchedAt < 0) throw new Error("the wreck never met the wall");
  return creep;
}

/**
 * A car squeezed in the press, the plates opened, left to settle and then driven into a wall for `TOUCH_S` (its last contact): the most (m) a rear hub's
 * place in the car frame moves forward, into the car, in the `AFTER_S` after that contact.
 */
export function hubCreepAfterLastContact(): number {
  return intoWall(pressed(HOLD_S).car!, WALL_Z, THROTTLE, SETTLE_S);
}

/** The wall hits' speeds (m/s), 65 to 79 km/h: hard enough that a squeezed wreck's dent, left to its own clamp, goes deeper than a fresh car's on the nose hit (gentler, the two read alike). */
export const WALL_HIT_SPEEDS = [18, 20, 22] as const;

/** A hit's reading: each body mass's name and permanent set (`crushSet`, m) the slice before the wall was met and `AFTER_S` after its last contact. */
export type WallHit = { names: string[]; before: number[]; after: number[] };

/** The nose plate's `frontIn` for a wreck whose nose the press left nearly clean (the nose plate stops at the bumper's rest): the tail alone holds a deep set. */
export const CLEAN_NOSE_IN = 0;

/** A wreck squeezed in the press, the plates opened and `SETTLE_S` passed (its contact window closed). */
export function pressedWreck(frontIn = FRONT_IN): DeformableCar {
  const car = pressed(HOLD_S, frontIn).car!;
  const world = newWorld([car]);
  const input = idleDrive();
  for (let t = 0; t < SETTLE_S; ) {
    const h = physicsSlice(DT, Math.max(8, car.speed));
    applyDrive(car, input, h);
    stepWorld(world, h);
    t += h;
  }
  return car;
}

/** A car standing on the ground, as the press scene's car is before it is pressed. */
export function freshCar(): DeformableCar {
  return standingCar();
}

/**
 * `car` (re-aimed where it stands, as a wreck backing off between hits is: `relaunchDamaged`) launched at `mps` m/s into a wall `WALL_Z` m off its `end` (+1 nose, -1 tail), freewheeling, the wall
 * met for `TOUCH_S` and read `AFTER_S` more.
 */
export function wallHit(car: DeformableCar, end: 1 | -1, mps: number): WallHit {
  relaunchDamaged(car, 0, 0, 0, 0, end * mps);
  const bodies = car.deform.masses.filter((m) => !m.hub);
  const world = newWorld([car]);
  const wall = makeBox();
  wall.y = PLATE.y;
  wall.hx = PLATE.hx;
  wall.hy = PLATE.hy;
  wall.hz = PLATE.hz;
  wall.z = end * (WALL_Z + PLATE.hz);
  wall.yaw = end > 0 ? Math.PI : 0;
  wall.fixed = true;
  const before = bodies.map((m) => m.crushSet);
  let t = 0;
  let touchedAt = -1;
  let lastContact = Infinity;
  while (t < lastContact + AFTER_S) {
    const h = physicsSlice(DT, Math.max(8, car.speed));
    applyDrive(car, FREEWHEEL, h);
    if (t < lastContact) {
      strikeCar(car, wall, h, true);
      if (bodyHit.touching && touchedAt < 0) touchedAt = t;
      if (touchedAt >= 0 && t >= touchedAt + TOUCH_S) lastContact = t;
    }
    stepWorld(world, h);
    t += h;
  }
  if (touchedAt < 0) throw new Error("the car never met the wall");
  return { names: bodies.map((m) => m.name), before, after: bodies.map((m) => m.crushSet) };
}

/** How much (m) each body mass's permanent set moved in `hit`: its size after minus before, so a dent given back reads negative. */
export function setChanges(hit: WallHit): number[] {
  return hit.after.map((a, i) => Math.abs(a) - Math.abs(hit.before[i]!));
}
