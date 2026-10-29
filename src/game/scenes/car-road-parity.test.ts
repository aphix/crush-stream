import { describe, expect, it } from "vitest";
import { todoRow } from "../kernel/todo-row.test-util.ts";
import * as THREE from "three";
import { applyDrive, type DriveInput } from "../vehicle/car-drive.ts";
import { DeformableCar } from "../vehicle/car.ts";
import { carFrame } from "../vehicle/car-rig.ts";
import { CAR_STYLES } from "../vehicle/car-variants.ts";
import { fit, frame, makeCar, DEG, FRAME } from "../vehicle/ground-probe.test-util.ts";
import { newWorld, type World } from "../engine/world-step.ts";
import { FLAT_GROUND, Ground, setGround, STEP_UP } from "../world/ground.ts";
import { Corkscrew, CORKSCREW } from "./corkscrew.ts";
import { FleetRamps, RAMP } from "./fleet-ramps.ts";
import { collideOn } from "./ramp-collide.test-util.ts";

/**
 * Cars as the road, a ramp or a platform (docs/UNIFIED_CONTACT.md stage 0): a car pressed into a profile and held, the same
 * run driven over the real feature and over the cars that stand for it.
 */

/** The share of a mass's travel the skin takes (about 0.7: strain 0.65 and the cages). */
const SKIN_FOLLOW = 0.7;
const FIT_PASSES = 5;
/** Half the length (m) over which a pressed car's top is the layer's: out to about its bumper masses. */
const TOP_HALF_M = 2;
/** Samples per metre of the plane fitted to a layer's top. */
const PLANE_PER_M = 5;

/** A car's top and bottom surface (car-local y) at car-local z. */
type Layer = { top: (z: number) => number; bottom: (z: number) => number };
/** Where a car is held. */
type Pose = { pos: THREE.Vector3; rot: THREE.Euler };
type Held = { car: DeformableCar; pose: Pose };

/** Put `car` at `pose`, its masses where its own `local` points say, at rest. */
function hold(car: DeformableCar, pose: Pose): void {
  const g = car.group;
  g.position.copy(pose.pos);
  g.rotation.copy(pose.rot);
  g.updateWorldMatrix(false, false);
  for (const m of car.deform.masses) {
    m.world.copy(m.local).applyMatrix4(g.matrixWorld);
    m.vel.set(0, 0, 0);
  }
  car.velocity.set(0, 0, 0);
  car.angular.set(0, 0, 0);
  car.speed = 0;
  car.refreshBasis();
}

/** The drawn skin's highest y (car-local) per 1 / `perM` m of length, keyed by round(z * perM). */
function skinTops(car: DeformableCar, perM: number): Map<number, number> {
  const pos = car.body.geometry.getAttribute("position") as THREE.BufferAttribute;
  const bins = new Map<number, number>();
  for (let i = 0; i < pos.count; i++) {
    const k = Math.round(pos.getZ(i) * perM);
    bins.set(k, Math.max(bins.get(k) ?? -Infinity, pos.getY(i)));
  }
  return bins;
}

/** One re-solve and one write of the skin from the masses as they stand. */
function reskin(car: DeformableCar): void {
  car.deform["loadDirty"][0] = 1;
  car.stepBreakage(FRAME);
  car.updateSkin();
}

/**
 * The plane (height at z 0, rise per metre along z) that fits `layer`'s top over the judged span: the shape a pressed top takes is a plane
 * in the body frame (`DeformRig.imprint`), and the skin above it is cut down to it, as a roof pressed under another body's is.
 */
function pressTop(car: DeformableCar, layer: Layer): void {
  const zs: number[] = [];
  for (let k = -PLANE_PER_M * TOP_HALF_M; k <= PLANE_PER_M * TOP_HALF_M; k++) zs.push(k / PLANE_PER_M);
  const meanTop = zs.reduce((sum, z) => sum + layer.top(z), 0) / zs.length;
  const spread = zs.reduce((sum, z) => sum + z * z, 0);
  const rise = zs.reduce((sum, z) => sum + z * (layer.top(z) - meanTop), 0) / spread;
  car.deform.imprint[0] = meanTop;
  car.deform.imprint[1] = 0;
  car.deform.imprint[2] = rise;
}

/**
 * A sedan pressed into `layer` and held at `pose`: every mass (the wheels' hubs too) is placed at its rest z along the profile,
 * its height in proportion to its rest height between its lowest and highest mass, inside the band between the layer's bottom
 * and top less the pristine skin's own reach under the lowest mass (to the ride height) and over the highest (to the roof line);
 * the frame may yield (`deepCrush`), or the roof stays within 0.14 m of rest. The skin follows the masses at only `SKIN_FOLLOW`
 * of their travel and the hood, roof and boot differ, so a few passes then lift or sink every mass by what the drawn top is still
 * off the layer's top at its z, each held inside the layer at its own z: a mass driven under the ground levers its cluster's far
 * end up (the tail bumper over a sunk rear axle), which the next pass reads as skin too high and sinks it further.
 */
function shapeCar(layer: Layer, pose: Pose): Held {
  const car = makeCar("sedan");
  car.spawnFacing(0, 0, 0, 0);
  car.deform.frameCrush = true;
  car.deform.deepCrush = true;
  const restY = car.deform.masses.map((m) => m.rest.y);
  const massLo = Math.min(...restY);
  const massHi = Math.max(...restY);
  const skinBelow = massLo - car.style.dims.rideHeight;
  const skinAbove = car.style.dims.height - massHi;
  const bands = car.deform.masses.map((m) => {
    const top = layer.top(m.rest.z);
    const lo = Math.min(layer.bottom(m.rest.z), top - skinBelow - skinAbove) + skinBelow;
    return { lo, hi: top - skinAbove };
  });
  for (const [i, m] of car.deform.masses.entries()) {
    const { lo, hi } = bands[i]!;
    m.local.set(m.rest.x, lo + ((m.rest.y - massLo) / (massHi - massLo)) * (hi - lo), m.rest.z);
  }
  hold(car, pose);
  reskin(car);
  for (let pass = 0; pass < FIT_PASSES; pass++) {
    const tops = skinTops(car, 10);
    for (const m of car.deform.masses) {
      // A mass past the judged span (a bumper) is fitted on its edge bin: the skin's rounded end beyond it is no top.
      const k = THREE.MathUtils.clamp(Math.round(m.local.z * 10), -10 * TOP_HALF_M, 10 * TOP_HALF_M);
      const y = tops.get(k) ?? tops.get(k - 1) ?? tops.get(k + 1);
      if (y !== undefined) m.local.y = THREE.MathUtils.clamp(m.local.y - (y - layer.top(k / 10)) / SKIN_FOLLOW, layer.bottom(m.rest.z), layer.top(m.rest.z));
    }
    hold(car, pose);
    reskin(car);
  }
  pressTop(car, layer);
  reskin(car);
  return { car, pose };
}

/** The drawn skin's top against the layer's top, per 0.2 m along the car within `TOP_HALF_M` of its middle (past that the nose and tail round off): the largest gap (m). The skin's own tolerance is 0.2 m (`SKIN`), ideally 5 cm. */
function skinGap(held: Held, layer: Layer): number {
  let gap = 0;
  for (const [k, y] of skinTops(held.car, 5)) if (Math.abs(k) <= 5 * TOP_HALF_M) gap = Math.max(gap, Math.abs(y - layer.top(k / 5)));
  return gap;
}

/** Hold `bodies` where they are: every slice puts each back (its masses at their `local` points) with no speed, a prop's way. */
function holdStatic(w: World, bodies: readonly Held[]): void {
  const at = new Map(bodies.map((b) => [b.car, b.pose]));
  w.afterCar = (car) => {
    const pose = at.get(car);
    if (pose) hold(car, pose);
  };
}

/**
 * The height of `surface` (world y at world x, z) in car-local terms: `y` of the car-local point (0, y, z) that lies on it
 * when the car is at `pose`, found along the car's own up axis.
 */
function surfaceInFrame(surface: (x: number, z: number) => number, pose: Pose): (z: number) => number {
  const q = new THREE.Quaternion().setFromEuler(pose.rot);
  const p = new THREE.Vector3();
  return (z) => {
    let lo = -3;
    let hi = 3;
    for (let i = 0; i < 40; i++) {
      const mid = (lo + hi) / 2;
      p.set(0, mid, z).applyQuaternion(q).add(pose.pos);
      if (p.y > surface(p.x, p.z)) hi = mid;
      else lo = mid;
    }
    return (lo + hi) / 2;
  };
}

/** The pose that lays a car on the corkscrew's floor at floor distance `s` along its centreline, flush with it. */
function corkPose(cork: Corkscrew, s: number): Pose {
  const hc = (z: number) => cork.heightAt(0, z);
  let z = CORKSCREW.mouthZ;
  for (let acc = 0; acc < s; z += 0.005) acc += Math.hypot(0.005, hc(z + 0.005) - hc(z));
  const t = new THREE.Vector3(0, (hc(z + 0.01) - hc(z - 0.01)) / 0.02, 1).normalize();
  const n = cork.normalAt(0, z, new THREE.Vector3(), hc(z) + 0.01);
  n.addScaledVector(t, -n.dot(t)).normalize();
  const right = new THREE.Vector3().crossVectors(n, t);
  const rot = new THREE.Euler().setFromRotationMatrix(new THREE.Matrix4().makeBasis(right, n, t), "YXZ");
  return { pos: new THREE.Vector3(0, hc(z), z), rot };
}

type DriveSetup = {
  /** The driven sedan's start: (x, z), speed (m/s). */
  x: number;
  z: number;
  v: number;
  /** The world's ground and its contact hook (walls). The cars' version of a feature runs on the flat ground. */
  ground: Ground;
  collide?: (c: DeformableCar, h: number) => unknown;
  /** Where wheel gaps are read: the real feature, for both versions of it. */
  ref: Ground;
  held: readonly Held[];
  seconds: number;
  /** No driver input at all (a driverless coast) instead of throttle holding `v`. */
  coast?: boolean;
  /** End the run when the car passes this z, or has been under 0.3 m/s this many frames. */
  stopZ?: number;
  stopStill?: number;
};

type Run = {
  /** Speed (m/s) at the end and the highest the car's origin rose (m). */
  speedEnd: number;
  yMax: number;
  /** Largest turn of the car's heading from its start (deg). */
  headingMax: number;
  crashed: boolean;
  /** The longest flight (s) and the z it came down at (NaN with none). */
  airSeconds: number;
  landZ: number;
  /** Wheels within 10 cm of the real feature, frame by frame, as a sequence of changes (runs under 3 frames dropped). */
  wheels: number[];
};

const MIN_RUN = 3;
const GROUNDED = 0.1;

function sequence(counts: readonly number[]): number[] {
  const out: number[] = [];
  for (let i = 0; i < counts.length; ) {
    let j = i;
    while (j < counts.length && counts[j] === counts[i]) j++;
    if (j - i >= MIN_RUN && out[out.length - 1] !== counts[i]) out.push(counts[i]!);
    i = j;
  }
  return out;
}

/** One sedan driven through `o`'s world (held cars and all) at 60 Hz frames, the ground restored after. */
function driveOver(o: DriveSetup): Run {
  setGround(o.ground);
  const car = makeCar("sedan");
  car.spawnFacing(o.x, o.z, 0, o.v);
  car.speed = o.v;
  const w = newWorld([car, ...o.held.map((b) => b.car)], null);
  holdStatic(w, o.held);
  if (o.collide) w.collide = (c, _i, h) => void o.collide!(c, h);
  const input: DriveInput = { throttle: 0, steer: 0, brake: 0, ebrake: false, boost: false };
  if (!o.coast) {
    w.beforeSlice = (h) => {
      input.throttle = Math.max(0, Math.min(1, (o.v - car.speed) / 1.5));
      applyDrive(car, input, h);
      return false;
    };
  }
  const fwd = new THREE.Vector3();
  const heading = () => Math.atan2(fwd.set(0, 0, 1).applyQuaternion(car.group.quaternion).x, fwd.z);
  const heading0 = heading();
  const st = { acc: 0 };
  const counts: number[] = [];
  const run: Run = { speedEnd: 0, yMax: 0, headingMax: 0, crashed: false, airSeconds: 0, landZ: NaN, wheels: [] };
  let flight = 0;
  let still = 0;
  for (let f = 0; f < o.seconds * 60; f++) {
    frame(w, null, st);
    const p = car.group.position;
    const speed = Math.hypot(car.velocity.x, car.velocity.z);
    run.yMax = Math.max(run.yMax, p.y);
    run.headingMax = Math.max(run.headingMax, Math.abs(Math.atan2(Math.sin(heading() - heading0), Math.cos(heading() - heading0))) * DEG);
    run.crashed ||= car.crashed;
    counts.push(fit(car, o.ref).gaps.filter((g) => g < GROUNDED).length);
    if (car.airborne) flight++;
    else {
      if (flight * FRAME > run.airSeconds) {
        run.airSeconds = flight * FRAME;
        run.landZ = p.z;
      }
      flight = 0;
    }
    still = speed < 0.3 ? still + 1 : 0;
    run.speedEnd = speed;
    if ((o.stopZ !== undefined && p.z > o.stopZ) || (o.stopStill !== undefined && still >= o.stopStill)) break;
  }
  run.wheels = sequence(counts);
  setGround(null);
  return run;
}

const SEDAN_HALF = carFrame(CAR_STYLES.sedan).half;

// docs/UNIFIED_CONTACT.md stage 0: one situation, built from different kinds of object, the same outcome.

const NO_TURN = new THREE.Euler(0, 0, 0, "YXZ");
/** Heading may differ by this much (deg): the doors' own hinge tolerance (`sameParts`). */
const HEADING = 3;

type Tol = { speed?: number; y: number; heading: number; air?: number; land?: number };

/** Where `cars` differs from the real feature, one line each (empty: the same). */
function mismatches(real: Run, cars: Run, tol: Tol): string[] {
  const out: string[] = [];
  const f = (n: number) => n.toFixed(2);
  if (tol.speed !== undefined && Math.abs(cars.speedEnd - real.speedEnd) > tol.speed * real.speedEnd) out.push(`speed ${f(cars.speedEnd)} vs ${f(real.speedEnd)} m/s`);
  if (Math.abs(cars.yMax - real.yMax) > tol.y) out.push(`rise ${f(cars.yMax)} vs ${f(real.yMax)} m`);
  if (Math.abs(cars.headingMax - real.headingMax) > tol.heading) out.push(`heading turn ${f(cars.headingMax)} vs ${f(real.headingMax)} deg`);
  if (cars.crashed !== real.crashed) out.push(`crashed ${cars.crashed} vs ${real.crashed}`);
  if (tol.air !== undefined && Math.abs(cars.airSeconds - real.airSeconds) > tol.air) out.push(`air ${f(cars.airSeconds)} vs ${f(real.airSeconds)} s`);
  if (tol.land !== undefined && real.airSeconds > 0 && cars.airSeconds > 0 && Math.abs(cars.landZ - real.landZ) > tol.land) out.push(`landing z ${f(cars.landZ)} vs ${f(real.landZ)} m`);
  if (cars.wheels.join() !== real.wheels.join()) out.push(`wheels on the feature [${cars.wheels}] vs [${real.wheels}]`);
  return out;
}

/** The same drive over the real feature (`real`) and over `held` on flat ground: what the cars' run does differently. */
function compare(real: DriveSetup, held: readonly Held[], tol: Tol, t: { annotate: (m: string) => unknown }): string[] {
  const a = driveOver(real);
  const b = driveOver({ ...real, ground: FLAT_GROUND, collide: undefined, held });
  t.annotate(`real: ${JSON.stringify(a)}\ncars: ${JSON.stringify(b)}`);
  return mismatches(a, b, tol);
}

describe("given a flat strip of ground 0.894 m high over four car lengths, and the same strip built from four held cars pressed to that height", () => {
  const H = 0.894;
  const N = 4;
  const SPACING = 2 * SEDAN_HALF.z + 0.1;
  const END = N * SPACING - 0.1;
  class Strip extends Ground {
    constructor() {
      super();
      this.addPlane(0, -1e7, 1e7, -1e7, 1e7, Infinity);
      this.addPlane(H, -0.9, 0.9, 0, END, STEP_UP);
    }
  }
  const strip: Ground = new Strip();
  const flat: Layer = { top: () => H, bottom: () => 0 };
  const road = () => Array.from({ length: N }, (_, k) => shapeCar(flat, { pos: new THREE.Vector3(0, 0, SEDAN_HALF.z + k * SPACING), rot: NO_TURN }));

  it("when each pressed car's drawn top is read against the pressed height, then the skin follows the masses within the skin's 0.2 m", (t) => {
    const [first] = road();
    const gap = skinGap(first!, flat);
    t.annotate(`skin vs layer ${gap.toFixed(3)} m`);
    expect(gap, `skin ${gap.toFixed(3)} m off the pressed height`).toBeLessThanOrEqual(0.2);
  });

  const stripRuns = [
    { v: 8, speed: 7.85 },
    { v: 12, speed: 11.04 },
    { v: 20, speed: 19.46 },
    { v: 28, speed: 27.22 },
  ] as const;
  // The 8 and 12 m/s rows are todo -> after the plan: lift the body by the appeared row's share of the depth, with the ramp-lip, loose-part and
  // monster head-on rows re-pinned together. The cause is the rigid step's position lift (no held car in these rows): the lift takes the deepest
  // row out by moving the whole body, so a rear tyre sunk 0.6 m in the strip's face (the nose already up 0.26 rad, the front tyres on the top)
  // lifts the body 0.6 m. Measured on main (REPLAY 56): the plain sedan's origin rises 1.29 / 1.08 m at 8 / 12 m/s (bound 0.894 + 0.05); speed,
  // heading and crash pass. A lift that shares an appeared row's depth between the centre and the turn (impulse at the point, `reach`) gives
  // 0.91 / 0.89 / 1.03 / 0.94 m at 8 / 12 / 20 / 28 m/s and, run to every row, 0.91 / 0.94 / 0.94 / 0.94 m; both move the settled states of cars
  // resting on a ramp's rear lip (ground-fit: 2 + 2 cells float / pen), loose parts (loose-step 'beside a parked car', equal to the bit) and a
  // monster's head-on crush (car-cage), so it is not taken here. 20 and 28 m/s pass.
  for (const testCase of stripRuns) {
    const row = testCase.v <= 12 ? it.todo : it;
    row(`when a sedan drives onto the strip itself at ${testCase.v} m/s, then it ends at ${testCase.speed} m/s within 5 %, rises to ${H} m within 5 cm, turns within 1 deg and never crashes (the road the cars must match)`, (t) => {
      const run = driveOver({ x: 0, z: -14, v: testCase.v, ground: strip, ref: strip, held: [], seconds: 7, stopZ: END + 6 });
      t.annotate(JSON.stringify(run));
      const wrong: string[] = [];
      if (Math.abs(run.speedEnd - testCase.speed) > 0.05 * testCase.speed) wrong.push(`speed ${run.speedEnd.toFixed(2)} m/s`);
      if (Math.abs(run.yMax - H) > 0.05) wrong.push(`rise ${run.yMax.toFixed(2)} m`);
      if (run.headingMax > 1) wrong.push(`heading turn ${run.headingMax.toFixed(2)} deg`);
      if (run.crashed) wrong.push("crashed");
      expect(wrong).toHaveLength(0);
    });
  }

  // todo -> after the plan: fit the held car's cage top to the layer in the rig. The pressed held cars' cage top is not a slab: `shapeCar` fits
  // the skin, not `cage.fields.top` (ridge / trough +0.37 / -0.50 m, ny 0.06 over a 0.894 m slab); the contact law (a kerb top in the store, the
  // held belly-edge rows) is solved separately. Measured on main (REPLAY 56), real vs reference at 8 / 12 / 20 / 28 m/s: speed 0.12 / 0.11 / 0.12
  // / 0.12 vs 7.81 / 11.42 / 19.46 / 27.24 m/s (bound 5 %), rise 0.00 / 0.00 / 0.06 / 0.00 vs 1.29 / 1.08 / 0.94 / 0.92 m (bound 0.05), crashed
  // true vs false at every speed, heading turn 0 / 4.16 / 1.26 / 0 deg vs 0 (bound 1), wheels [4] vs the reference's sequence.
  for (const v of [8, 12, 20, 28]) {
    todoRow(`when a sedan drives onto each at ${v} m/s, then its speed is within 5 %, it rises within 0.05 m, turns within 1 deg, drives over the same wheel sequence and never crashes`, true, (t) => {
      const real: DriveSetup = { x: 0, z: -14, v, ground: strip, ref: strip, held: [], seconds: 7, stopZ: END + 6 };
      expect(compare(real, road(), { speed: 0.05, y: 0.05, heading: 1 }, t)).toHaveLength(0);
    });
  }
});

describe("given the fleet's jump wedge, and a car pressed into its profile and held at its high end", () => {
  const scene = new THREE.Scene();
  const ramps = new FleetRamps(scene);
  ramps.place(0, null);
  const zc = -RAMP.start - SEDAN_HALF.z;
  const layer: Layer = { top: (z) => ramps.heightAt(0, zc + z), bottom: () => 0 };
  const wedge = () => [shapeCar(layer, { pos: new THREE.Vector3(0, 0, zc), rot: NO_TURN })];

  it("when the drawn top of the pressed car is read against the wedge's, then the skin follows the masses within the skin's 0.2 m", (t) => {
    const gap = skinGap(wedge()[0]!, layer);
    t.annotate(`skin vs wedge ${gap.toFixed(3)} m`);
    expect(gap, `skin ${gap.toFixed(3)} m off the wedge`).toBeLessThanOrEqual(0.2);
  });

  // todo -> after the plan: fit the held car's cage top to the layer in the rig. The pressed held car's cage top is not a slab (`shapeCar`
  // fits the skin, not `cage.fields.top`). Measured on main (REPLAY 56), real vs reference at 8 / 12 m/s: rise 0.02 / 0.03 vs 1.36 / 1.72 m
  // (bound 0.1), crashed true vs false, air 0.00 vs 0.13 / 0.68 s (bound 0.1), wheels [4] vs [4,2,0,2,4].
  for (const v of [8, 12]) {
    todoRow(`when a sedan drives up each at ${v} m/s, then it rises within 0.1 m, stays in the air within 0.1 s, lands within 0.5 m, turns within ${HEADING} deg and touches down on the same wheels`, true, (t) => {
      // Past the landing: a flight is recorded when it ends, and the 12 m/s jump comes down about 10 m beyond the high end.
      const real: DriveSetup = { x: 0, z: -16, v, ground: ramps, collide: (c, h) => collideOn(ramps)(c, 0, h), ref: ramps, held: [], seconds: 6, stopZ: 30 };
      expect(compare(real, wedge(), { y: 0.1, air: 0.1, land: 0.5, heading: HEADING }, t)).toHaveLength(0);
    });
  }
});

describe("given the corkscrew channel, and cars pressed into its floor along its length and held", () => {
  const cork = new Corkscrew(new THREE.Scene());
  const PITCH = 2 * SEDAN_HALF.z + 0.1;
  const floor = () =>
    Array.from({ length: Math.ceil(CORKSCREW.len / PITCH) }, (_, k) => {
      const pose = corkPose(cork, PITCH / 2 + k * PITCH);
      const top = surfaceInFrame((x, z) => cork.heightAt(x, z), pose);
      return shapeCar({ top, bottom: (z) => top(z) - 0.5 }, pose);
    });

  // todo -> after the plan: fit the held car's cage top to the layer in the rig. The pressed held cars' cage top is not a slab (`shapeCar` fits
  // the skin, not `cage.fields.top`; ridge / trough +0.37 / -0.50 m, ny 0.06), plus one of its own: the pressed cars lie along the twisting
  // floor with plans that overlap their neighbours, so the pair SAT hits the held cars against each other in the first slice (cars 1-2
  // impulse 0.45, 2-3 impulse 2.30, before any driver contact). Measured on main (REPLAY 56), real vs reference at 6 / 14 / 22 / 27 m/s: rise
  // 0.00 vs 1.96 / 6.07 / 11.31 / 15.16 m (bound 0.1), air 0.00 vs 0 / 1.42 / 2.45 / 2.98 s (bound 0.1), heading turn 0.00 vs 0 / 179.95 / 70.64 /
  // 103.56 deg, crashed at 6 m/s, wheels [4] vs the reference's sequence.
  for (const v of [6, 14, 22, 27]) {
    todoRow(`when a driverless sedan is launched at ${v} m/s 6 m short of each, then it rises within 0.1 m, stays in the air within 0.1 s, lands within 0.5 m, turns within ${HEADING} deg and touches down on the same wheels`, true, (t) => {
      const real: DriveSetup = { x: 0, z: CORKSCREW.mouthZ - 6, v, ground: cork, collide: (c) => cork.contact(c), ref: cork, held: [], seconds: 12, coast: true, stopStill: 90 };
      expect(compare(real, floor(), { y: 0.1, air: 0.1, land: 0.5, heading: HEADING }, t)).toHaveLength(0);
    });
  }
});
