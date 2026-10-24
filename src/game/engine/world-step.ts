import * as THREE from "three";
import { bleedAfterSlide, DeformableCar } from "../vehicle/car.ts";
import { StrongestContact, type ContactHit, type JerseyBarrier } from "../scenes/engine-props.ts";
import { partContactPair } from "../contact/external-contact.ts";
import { markApproaches, resolveCarPair } from "../contact/pair-contact.ts";
import { bandsMeet } from "../contact/cage-outline.ts";
import { HULL_STRIDE, hullsClear, readHull } from "../contact/hull-gap.ts";
import type { EjectionWatch } from "../vehicle/ejection.ts";
import { armCrushRows, takeCrossingsSkipped } from "../vehicle/car-air.ts";
import { contactHz } from "../vehicle/car-air-points.ts";
import { REST_SPEED } from "../vehicle/car-air-body.ts";
import { CarSurfaces, REACH } from "../vehicle/car-surfaces.ts";
import { armTops, calmSolids } from "../world/surfaces.ts";
import { EPICENTER } from "../deform/epicenter.ts";
import { STOCK_PAINT } from "../vehicle/constants.ts";
import { FINE_HZ, SLICES_PER_STEP } from "../kernel/constants.ts";
import { FINE_SLICE } from "./sim-pace.ts";
import { lap, PHASE, SimPhases, WORK } from "./sim-phases.ts";

/**
 * Everything one physics step touches besides the cars. The engine fills it per scene; a headless harness
 * sets the parts its scenario has. The hooks run at fixed points of the step, in car order.
 */
export type World = {
  /** Live cars, slot order. */
  cars: readonly DeformableCar[];
  /** The jersey slab while it is in the scene. */
  barrier: JerseyBarrier | null;
  /** Per car index, set when the slab took a hit from it. */
  barrierHits: boolean[];
  /** Cleared each step, then offered every hit: the strongest one is the step's impact. */
  readonly strongest: StrongestContact;
  /** Before each slice; true when it stepped the slice itself (a rig scene drives its car). */
  beforeSlice: ((h: number) => boolean) | null;
  /** Each SAT pair hit, before it is offered to `strongest`. */
  pairHit: ((a: number, b: number, hit: ContactHit) => void) | null;
  /** A door, mirror or panel of one car met the other (`partContactPair`), a mass of one met a mass of the other (`collideWith`), or one stood on or touched the other's top (`CarSurfaces.met`): they touched without a SAT hit. */
  partTouch: ((a: number, b: number) => void) | null;
  /** A torn part or popped wheel of car `own` met car `top`'s top (`CarSurfaces.partMet`): `top` moved it, so a clip that keeps `own` keeps `top`. */
  partMet: ((own: number, top: number) => void) | undefined;
  /** Each car right after its `afterContacts` (the derby bowl). */
  afterCar: ((car: DeformableCar, h: number) => void) | null;
  /** Each car at the end of a slice of `h` s (race walls and props). */
  collide: ((car: DeformableCar, i: number, h: number) => void) | null;
  /**
   * Decides, at the end of every step, whether a disabling hit throws a driver out (`car.driverOut`, an `Ejection`
   * event). Null where the cars' record already says who was thrown when: a highlight replay.
   */
  ejection: EjectionWatch | null;
  /** What a body in flight stands on besides the ground: the other cars' tops (and the roofs' load crush). */
  surfaces: CarSurfaces;
  /**
   * The step's schedule as the last `stepWorld` ran it: its slice count − 1. It follows every car in the world (any pair anywhere
   * can hold the slices up), so a replay of a few cars cannot work it out: the recorder keeps it (`HighlightClip.shape`).
   */
  shape: number;
  /** A recorded `shape` the next `stepWorld` runs to the letter (a highlight replay); −1: the cars decide, as live. */
  plan: number;
  /**
   * A replay's recorded stirs for the next `stepWorld`, flat `[slice, car, slice, car, …]` (car: index in `cars`): each sleeping wreck listed is woken at the start
   * of that slice, as the live step woke it when something that moves came within reach (`stirNear`) - a car the replay leaves out, whose roof the replay world
   * does not have. Empty live (the cars decide: `DeformableCar.stirSlice` says which slice woke each sleeper) and where a clip records none.
   */
  stirs: number[];
  /**
   * A replay's recorded part stirs for the next `stepWorld`, flat `[slice, car, body, ...]` (car: index in `cars`, body: `LOOSE_BODIES` index): each sleeping torn part or
   * popped wheel listed is woken at the start of that slice, as the live step woke it when something that moves came within reach (`stirNear`) - a car the replay leaves out.
   * Empty live (`DeformableCar.stirredBodies` says which slices woke each) and where a clip records none.
   */
  partStirs: number[];
  /** The scene lets a car with nothing in its reach run the step as one slice of the step's whole length (`loneCars`): the race. Off, every car runs the step's slices (a derby bowl and the slab hold a car per slice). */
  lone: boolean;
  /** The cars the last `stepWorld` ran as lone cars (bit i: `cars[i]`, the first 32): the recorder keeps it (`HighlightClip.lone`), next to `shape`. */
  loners: number;
  /** A recorded `loners` the next `stepWorld` runs to the letter (a highlight replay, with `plan`). */
  planLoners: number;
  /** The slice (s) the pacer's 1/240 s floor takes now (`SimPacer.fine`), which a step in contact is cut to; 0 where no pacer steps the world (a harness: contact is cut to `FINE_SLICE`; a replay: the recorded `shape` decides). */
  fine: number;
  /** Steps in contact that `stepWorld` ran in more slices than a step of that length out of contact takes (1, or 2 for a step longer than the quiet step), counted up for ever where `fine` is set (the bench reads differences). */
  fineCuts: number;
  /** Steps a cut for a pair in the centre-to-centre reach ran as the quiet step because every car was lone (hulls clear), counted up for ever (the bench reads differences). */
  quietCollapses: number;
  /** Where the live step's time goes and how much work it did (`SimPhases`): the engine's bench switches the clock reads on for its measured window; a world nobody times keeps them off. */
  readonly phases: SimPhases;
};

export function newWorld(cars: readonly DeformableCar[], barrier: JerseyBarrier | null = null, ejection: EjectionWatch | null = null): World {
  return {
    cars,
    barrier,
    barrierHits: [],
    strongest: new StrongestContact(),
    beforeSlice: null,
    lone: false,
    loners: 0,
    planLoners: 0,
    pairHit: null,
    partTouch: null,
    partMet: undefined,
    afterCar: null,
    collide: null,
    ejection,
    surfaces: new CarSurfaces(),
    shape: 0,
    plan: -1,
    stirs: [],
    partStirs: [],
    fine: 0,
    fineCuts: 0,
    quietCollapses: 0,
    phases: new SimPhases(),
  };
}

/**
 * Car pairs within this squared plan distance (m^2) at a step's or slice's start are the ones its contact passes visit and
 * `markApproaches` looks ahead from: a pair resolves only inside `resolveCarPair`'s 5.2 m (27 m^2 here), a slice moves a car
 * by its step's travel and the capped pushes, and the approach look-ahead wants a car length plus 3 m (a step or two of a
 * 200 m/s closing), so 8 m covers both.
 */
const NEAR_PAIR2 = 64;
/** Pairs the slice visits, as car index pairs (a, b), a < b, in the order a plain double loop would reach them.
 *  A module scratch like the file's other per-step temporaries; `collectNear` grows it when a field outgrows it. */
const near = { pairs: new Int32Array(2 * 496) };

/** Cars the lone mask names (a `Uint32`'s width). */
const LONE_CARS = 32;
/**
 * Plan distance (m) within which the slice's contact passes read a pair of cars: `partContactPair`'s and `resolveCarPair`'s reach (28 m^2 of plan, 5.29 m).
 * A hard approach inside the look-ahead is `nearHit` (`markApproach`), a car that touches something `contactHz`; this is the distance of the rest.
 */
export const CONTACT_REACH = 5.3;
/** A sleeping wreck wakes when a car's top box is over its `REACH` square (`stirNear`): up to `REACH` + `REACH` per axis, the diagonal of it between centres (m). */
const WAKE_REACH = 2 * Math.SQRT2 * REACH;
/**
 * Slack (m) added to a car's reach over the step in the lone test: the capped pushes a slice's contacts may give a car (`PUSH_SPEED` 1 m/s
 * of a 1/80 s step, 1.3 cm) and a drive's acceleration over the step are a few cm; a metre is far more than both, so a car meeting
 * another one inside the step is never run as lone.
 */
export const LONE_MARGIN = 1;
/** Per car, a module scratch: its plan speed (m/s) at the step's start, whether it runs the step as a lone car (1), whether its hull is read, and the hulls. */
const lonely = { speed: new Float64Array(LONE_CARS), flag: new Uint8Array(LONE_CARS), hulled: new Uint8Array(LONE_CARS), hulls: new Float64Array(LONE_CARS * HULL_STRIDE) };

/** A car the race put away takes no step (`EPICENTER.storedSkip`): the knob and the car's flag. */
function idle(car: DeformableCar): boolean {
  return car.stored && EPICENTER.storedSkip === 1;
}

/** A car resting on the ground: slower than rest and touching. Its wreck's masses ride its body (`DeformFreeze.ridesBody`). */
function atRest(car: DeformableCar): boolean {
  return !car.moving && !car.airborne;
}

/** Scratch for the weight an unstepped car's roof drops (`stepWorld`). */
const _borneV = new THREE.Vector3();
const _borneW = new THREE.Vector3();

/** Fills `near.pairs` with the pairs of `cars` within `NEAR_PAIR2` of each other in plan; the count of ints written. */
function collectNear(cars: readonly DeformableCar[]): number {
  const n = cars.length;
  if (n * (n - 1) > near.pairs.length) near.pairs = new Int32Array(n * (n - 1));
  const out = near.pairs;
  let k = 0;
  for (let a = 0; a < n; a++) {
    const pa = cars[a]!.group.position;
    for (let b = a + 1; b < n; b++) {
      const pb = cars[b]!.group.position;
      const dx = pa.x - pb.x;
      const dz = pa.z - pb.z;
      if (dx * dx + dz * dz > NEAR_PAIR2) continue;
      out[k++] = a;
      out[k++] = b;
    }
  }
  return k;
}

/** Two cars on one level within `resolveCarPair`'s reach (5.2 m, 27 m^2 of plan): their step is in contact, as a car at the barrier's is. */
function carsInReach(cars: readonly DeformableCar[]): boolean {
  const count = collectNear(cars);
  for (let k = 0; k < count; k += 2) {
    const a = cars[near.pairs[k]!]!;
    const b = cars[near.pairs[k + 1]!]!;
    const dx = a.group.position.x - b.group.position.x;
    const dz = a.group.position.z - b.group.position.z;
    if (dx * dx + dz * dz <= 27 && bandsMeet(a, b) && !a.falling && !b.falling) return true;
  }
  return false;
}

/** `lonely`'s rows hold `n` cars. */
function growLonely(n: number): void {
  if (lonely.flag.length >= n) return;
  lonely.speed = new Float64Array(n);
  lonely.flag = new Uint8Array(n);
  lonely.hulled = new Uint8Array(n);
  lonely.hulls = new Float64Array(n * HULL_STRIDE);
}

/**
 * The cars of `cars` that nothing can reach this step, as a mask (bit i: `cars[i]`, the first `LONE_CARS`): each runs the step as one slice of its
 * whole length (`stepWorld`), the length a quiet step takes every car at, where the slices of a step in contact are for the cars in it. A car is
 * in the step's contact, so not lone, when a hit is about to land on it (`nearHit`: the course's solids and the pairs, `markApproach`), when its
 * crush runs on (`crushing`), when its body touches something (`contactHz`), and when another car can meet it over the step. Two intact cars on the road
 * (`readHull`) can meet when their hulls are not clear (`hullsClear`: the gap along a separating axis less the closing along it over the step); any other pair
 * (a wreck, a car in the air, a sleeper) when the centres are within `CONTACT_REACH` m in plan (what the pair pass and the part contacts read; `WAKE_REACH`
 * where one is a sleeping wreck, which a mover's top wakes) plus the two cars' travel over the step and `LONE_MARGIN`. A lone car meets the course as a car of
 * a quiet step does (the hard approaches are `nearHit`).
 */
function loneCars(cars: readonly DeformableCar[], dt: number): number {
  const n = cars.length;
  growLonely(n);
  const { speed, flag, hulled, hulls } = lonely;
  for (let i = 0; i < n; i++) {
    const car = cars[i]!;
    const v = car.velocity;
    speed[i] = Math.sqrt(v.x * v.x + v.z * v.z);
    flag[i] = car.nearHit || car.deform.crushing || contactHz(car) > 0 ? 0 : 1;
    hulled[i] = readHull(car, hulls, i * HULL_STRIDE) ? 1 : 0;
  }
  for (let a = 0; a < n; a++) {
    const pa = cars[a]!.group.position;
    for (let b = a + 1; b < n; b++) {
      const pb = cars[b]!.group.position;
      const dx = pa.x - pb.x;
      const dz = pa.z - pb.z;
      const reach = (cars[a]!.asleep || cars[b]!.asleep ? WAKE_REACH : CONTACT_REACH) + LONE_MARGIN + (speed[a]! + speed[b]!) * dt;
      if (dx * dx + dz * dz > reach * reach) continue;
      if (hulled[a] === 1 && hulled[b] === 1 && hullsClear(hulls, a, b, dt)) continue;
      flag[a] = 0;
      flag[b] = 0;
    }
  }
  let mask = 0;
  for (let i = 0; i < Math.min(n, LONE_CARS); i++) if (flag[i]) mask |= 1 << i;
  return mask >>> 0;
}

/** Whether `mask` names every one of `n` cars. */
function allLone(mask: number, n: number): boolean {
  return n > 0 && n <= LONE_CARS && mask === (n === LONE_CARS ? 0xffffffff : (1 << n) - 1);
}

/**
 * One fixed step of the world (`dt` from `physicsSlice`), split into 1–8 slices: integrate or pose, part contact, one pass over the
 * slice's contacts (slab, car pairs), then the structure step, slab clip and `afterContacts` per car. The pair loops visit the
 * slice's near pairs only (`collectNear`).
 */
export function stepWorld(w: World, dt: number): void {
  const ph = w.phases;
  const work = ph.work;
  armTops(w.surfaces);
  const { cars, barrier, strongest } = w;
  const n = cars.length;
  w.ejection?.seed(cars);
  let nearWall = false;
  if (barrier) {
    for (let i = 0; i < n; i++) {
      if (cars[i]!.group.position.lengthSq() < 160) {
        nearWall = true;
        break;
      }
    }
  }
  let slices: number;
  let mask = 0;
  if (w.plan >= 0) {
    slices = (w.plan & 7) + 1;
    mask = w.planLoners;
  } else {
    // Contact (the barrier's reach, a car in reach, a hit about to land: the pairs are marked here, the solids by the course's collide pass of the step before) is solved in slices of the pacer's fine floor (`fine`, `FINE_SLICE` where none is set), whatever the step: one law for a hit at the quiet step and at the 1/240 s one. A step is solved at the rate a car in it asks for (`contactHz`): a body in flight touching something.
    if (w.fine > 0) {
      const count = collectNear(cars);
      markApproaches(cars, near.pairs, count);
    }
    let hz = 0;
    let hit = false;
    for (let i = 0; i < n; i++) {
      const car = cars[i]!;
      hz = Math.max(hz, contactHz(car));
      hit = hit || car.nearHit;
    }
    const quiet = Math.ceil(dt * FINE_HZ - 1e-6) > SLICES_PER_STEP ? 2 : 1;
    const cut = Math.min(8, Math.ceil(dt / (w.fine > 0 ? w.fine : FINE_SLICE) - 1e-6));
    const contact = cut !== quiet && (hit || nearWall || carsInReach(cars));
    slices = contact ? cut : quiet;
    if (dt * hz > slices + 1e-6) slices = Math.min(8, Math.ceil(dt * hz - 1e-6));
    // A lone car's one slice is the step: with every car lone nothing is in contact and the step is the quiet one.
    if (w.lone && !barrier && slices > 1) {
      mask = loneCars(cars, dt);
      if (allLone(mask, n)) {
        mask = 0;
        if (slices > quiet) w.quietCollapses++;
        slices = quiet;
      }
    }
    if (contact && w.fine > 0 && slices > quiet) w.fineCuts++;
  }
  // Read once: this step's collide passes mark the next.
  for (let i = 0; i < n; i++) cars[i]!.nearHit = false;
  w.loners = mask;
  // Per car, whether it runs the step as a lone car: it takes the step whole in slice 0 and stands out of the rest.
  growLonely(n);
  for (let i = 0; i < n; i++) lonely.flag[i] = i < LONE_CARS ? (mask >>> i) & 1 : 0;
  const h = dt / slices;
  strongest.clear();
  // Every roof stands where its car's state puts it as the step begins: a car stepped before its neighbour reads that neighbour's roof, which a keyframe does not hold.
  w.surfaces.cars = cars;
  for (let ci = 0; ci < n; ci++) {
    cars[ci]!.slot = ci;
    cars[ci]!.stirSlice = -1;
    cars[ci]!.clearStirredBodies();
    cars[ci]!.surfaces = w.surfaces;
    cars[ci]!.group.updateWorldMatrix(false, false);
    w.surfaces.sync(ci, cars[ci]!);
  }
  w.surfaces.retire(n);
  lap(ph, PHASE.plan);

  for (let i = 0; i < slices; i++) {
    if (w.beforeSlice?.(h)) {
      lap(ph, PHASE.integrate);
      continue;
    }
    work[WORK.slices] = work[WORK.slices]! + 1;
    w.surfaces.cars = cars;
    w.surfaces.met = w.partTouch;
    w.surfaces.partMet = w.partMet;
    for (let ci = 0; ci < n; ci++) {
      if (i > 0 && lonely.flag[ci]) continue;
      const car = cars[ci]!;
      // A put-away car (`EPICENTER.storedSkip`) is not stepped: reset, hidden and still 4 km off the course until the race places it again. What a stepped one takes of
      // the weight carried on its roof (`takeBorne`, zeroed by the take) is taken and dropped: left in the slot it would reach the car's first step after it is placed again.
      if (idle(car)) {
        w.surfaces.takeBorne(ci, _borneV, _borneW);
        continue;
      }
      const hc = lonely.flag[ci] ? dt : h;
      car.deform.beginSlice(hc);
      car.surfaces = w.surfaces;
      car.slot = ci;
      // A wreck is its rigid body's: `integrate` steps the body and carries its masses.
      const wreck = car.deform.massActive;
      for (let k = 0; k < w.stirs.length; k += 2) if (w.stirs[k] === i && w.stirs[k + 1] === ci) car.wake();
      car.sliceBit = 1 << i;
      for (let k = 0; k < w.partStirs.length; k += 3) if (w.partStirs[k] === i && w.partStirs[k + 1] === ci) car.wakeBody(w.partStirs[k + 2]!);
      // A sleeper at rest that this slice wakes (`integrateWreck`: nothing but `stirNear` wakes a still one) was stirred in slice `i`.
      const sleeper = wreck && car.asleep && car.velocity.lengthSq() + car.angular.lengthSq() === 0;
      const slot = car.asleep ? WORK.asleepCarSlices : wreck ? WORK.wreckCarSlices : WORK.liveCarSlices;
      work[slot] = work[slot]! + 1;
      car.integrate(hc);
      if (sleeper && !car.asleep) car.stirSlice = i;
      if (!wreck) {
        if (car.deform.massActive) car.syncPose(hc);
        else car.refreshBasis();
      }
      lap(ph, wreck ? PHASE.wreck : PHASE.integrate);
    }
    work[WORK.crossingsSkipped] = work[WORK.crossingsSkipped]! + takeCrossingsSkipped();
    // Every roof moves to where its car now is once all the cars have stepped: each car stepped against the roofs as the slice began,
    // whichever order the list has them in. Synced as each car stepped, the cars after it read its new roof and those before it its
    // old one, and a mirror-symmetric 150 km/h head-on came out 10.6 mm apart by which car was first.
    for (let ci = 0; ci < n; ci++) if (i === 0 || !lonely.flag[ci]) w.surfaces.sync(ci, cars[ci]!);

    const pairs = collectNear(cars);
    const nearList = near.pairs;
    for (let k = 0; k < pairs; k += 2) {
      const a = nearList[k]!;
      const b = nearList[k + 1]!;
      const ca = cars[a]!;
      const cb = cars[b]!;
      if (lonely.flag[a] || lonely.flag[b] || (barrier && barrier.blocksPair(ca, cb))) continue;
      const dx = ca.group.position.x - cb.group.position.x;
      const dz = ca.group.position.z - cb.group.position.z;
      // Cars at different heights (one flying over the other, on a bridge over it) never touch; nor does a fake falling off the fleet disc.
      if (dx * dx + dz * dz > 28 || !bandsMeet(ca, cb) || ca.falling || cb.falling) continue;
      if (partContactPair(ca, cb, h)) {
        work[WORK.partContacts] = work[WORK.partContacts]! + 1;
        wakePair(ca, cb);
        w.partTouch?.(a, b);
      }
    }

    // One pass over the slice's contacts: the barrier, then every near pair through the one kernel, then the barrier's clip; accuracy
    // comes from the slice (substeps, `CONTACT_HZ`), not from passes over it.
    for (let ci = 0; ci < n; ci++) {
      if (i > 0 && lonely.flag[ci]) continue;
      const car = cars[ci]!;
      if (idle(car)) continue;
      if (car.deform.massActive) {
        if (!car.deform.ridesBody(atRest(car))) car.syncPose(0);
      } else car.refreshBasis();
    }
    if (barrier) {
      for (let ci = 0; ci < n; ci++) {
        const hit = barrier.resolve(cars[ci]!, true, true, h);
        if (hit) {
          w.barrierHits[ci] = true;
          strongest.offer(hit);
        }
      }
    }
    for (let k = 0; k < pairs; k += 2) {
      const a = nearList[k]!;
      const b = nearList[k + 1]!;
      if (lonely.flag[a] || lonely.flag[b] || (barrier && barrier.blocksPair(cars[a]!, cars[b]!))) continue;
      if (!bandsMeet(cars[a]!, cars[b]!) || cars[a]!.falling || cars[b]!.falling) continue;
      work[WORK.pairTests] = work[WORK.pairTests]! + 1;
      const pair = resolveCarPair(cars[a]!, cars[b]!, h);
      if (pair) {
        work[WORK.pairContacts] = work[WORK.pairContacts]! + 1;
        if (pair.closing > REST_SPEED) wakePair(cars[a]!, cars[b]!);
        w.pairHit?.(a, b, pair);
        strongest.offer(pair);
      }
    }
    if (barrier) for (let ci = 0; ci < n; ci++) barrier.resolve(cars[ci]!, false, false, h);
    // The pair pass moved the wrecks' masses (a tilted wreck's frame jumped 0.35 m in one re-measure): their pose and velocity are derived
    // from them now, before the structure step reads them, as the second pass's start did (the mixed fleet's column read a wreck at
    // -7.4 m/s against its masses' -2.8 without it: stack-column 'owner's drops').
    for (let ci = 0; ci < n; ci++) if (cars[ci]!.deform.massActive && !cars[ci]!.deform.ridesBody(atRest(cars[ci]!)) && (i === 0 || !lonely.flag[ci])) cars[ci]!.syncPose(0);
    armCrushRows(h);
    lap(ph, PHASE.pairs);

    for (let ci = 0; ci < n; ci++) {
      if (i > 0 && lonely.flag[ci]) continue;
      const car = cars[ci]!;
      if (idle(car)) continue;
      const hc = lonely.flag[ci] ? dt : h;
      const d = car.deform;
      if (d.massActive) {
        // A relocked wreck (`epicenter` activation) and one at rest run their clock and ride their body: no solve, no frame re-measure.
        if (d.ridesBody(atRest(car))) {
          d.stepFrozen(hc, car.group, car.asleep);
          if (d.frozen) work[WORK.frozenCarSlices] = work[WORK.frozenCarSlices]! + 1;
        } else {
          d.stepStructure(hc, car.group.quaternion);
          car.syncPose(hc);
        }
        work[WORK.nodesLoose] = work[WORK.nodesLoose]! + d.nodesLoose;
        work[WORK.nodesLocked] = work[WORK.nodesLocked]! + d.nodesLocked;
      }
      if (barrier) barrier.clip(car);
      car.afterContacts(hc);
      w.afterCar?.(car, hc);
      // After this slice's solve, so the slice that crossed the quiet time still ran it: the next one freezes the car.
      d.settleFreeze(hc);
      work[WORK.freezes] = work[WORK.freezes]! + d.freezes;
      work[WORK.thaws] = work[WORK.thaws]! + d.thaws;
      d.freezes = 0;
      d.thaws = 0;
      work[WORK.crushDroppedUm] = work[WORK.crushDroppedUm]! + d.crushDropped * 1e6;
      d.crushDropped = 0;
    }
    lap(ph, PHASE.structure);
    if (w.collide) {
      for (let ci = 0; ci < n; ci++) {
        if (i > 0 && lonely.flag[ci]) continue;
        // The next slice's structure step reads the face this pass counts: a car that left the face is counted by no pass.
        cars[ci]!.deform.faceContacts = 0;
        w.collide(cars[ci]!, ci, lonely.flag[ci] ? dt : h);
      }
    }
    lap(ph, PHASE.course);
    for (let ci = 0; ci < n; ci++) if ((i === 0 || !lonely.flag[ci]) && !idle(cars[ci]!)) cars[ci]!.deform.endSlice();
    // A step's last slice is baked by its caller (`stepBreakage`); the slices before it take their own, so the next slice reads the body
    // as this one's crush left it, not as the step began (a hit cut in two slices crushed what its first slice did not see). A lone car's one slice is its last.
    if (i < slices - 1) for (let ci = 0; ci < n; ci++) if (!lonely.flag[ci] && !idle(cars[ci]!)) cars[ci]!.bakeBetweenSlices(h);
    lap(ph, PHASE.bake);
  }
  w.ejection?.step(cars, dt);
  w.shape = slices - 1;
  armTops(null);
  calmSolids();
}

/**
 * After each `stepWorld` (`CrashEngine.tickInner`, a highlight replay): a dead drivetrain's drive bleeds away, with
 * `bleed` (the crash clock is past the hit) a wreck slides to a stop on tyre-style friction, and each car's parts
 * follow the crash (`stepBreakage`: hinges, tears, lamps, glass) once for the whole step, never by the frame rate.
 */
export function settleStep(cars: readonly DeformableCar[], h: number, bleed: boolean): void {
  for (let i = 0; i < cars.length; i++) {
    const car = cars[i]!;
    if (car.deform.massActive && !car.deform.drivetrainAlive) car.deform.cutDrive(h);
    if (bleed && car.crashed) bleedAfterSlide(car, h);
    car.stepBreakage(h);
  }
}

/** Warm-up crashes: car A at (x, z) facing `yaw` at 14 m/s into car B parked at the origin facing `yawB`, or driving at `vB`. */
const WARM_HITS = [
  // Head-on, 14 m/s each (100 km/h closing), noses 1.7 m apart.
  [0, -6, 0, Math.PI, 14],
  // T-bone into a parked car's door.
  [-4.5, 0, Math.PI / 2, 0, 0],
] as const;

/**
 * Run two throwaway crashes through `stepWorld` (1 s each) so V8 has compiled the crush path before play.
 * Cold, a race's first crashes ran it unoptimised: single frames took 21–27 ms of physics headless (oval, 8 cars),
 * 26–48 ms in the browser (docs/PERF_HITCH.md); after this warm-up, ≤ 7.4 ms. Returns whether every hit crashed
 * both cars (else it no longer warms the code it is for).
 */
export function warmCrashPath(): boolean {
  const scene = new THREE.Scene();
  const paint = { ...STOCK_PAINT, name: "warm-up" };
  let crashed = true;
  for (const [x, z, yaw, yawB, vB] of WARM_HITS) {
    const a = new DeformableCar(paint, scene);
    const b = new DeformableCar(paint, scene);
    a.spawnFacing(x, z, yaw, 14);
    b.spawnFacing(0, 0, yawB, vB);
    const w = newWorld([a, b]);
    for (let i = 0; i < FINE_HZ; i++) stepWorld(w, 1 / FINE_HZ);
    crashed &&= a.crashed && b.crashed && a.deform.massActive && b.deform.massActive;
    a.dispose();
    b.dispose();
  }
  return crashed;
}

/**
 * A contact between two cars wakes both only when one of them moves: wrecks resting in a pile touch every slice, and waking them there
 * restarts their rest timers, so none would ever sleep. A pair contact wakes them only while it closes faster than rest: a wreck rolling
 * level beside a still one at a constant 1 cm overlap kept its neighbour awake 0.6 s past its own rest (fleet capture, seed 3).
 */
function wakePair(a: DeformableCar, b: DeformableCar): void {
  if (!a.moving && !b.moving) return;
  a.wake();
  b.wake();
}
