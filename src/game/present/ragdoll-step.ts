import * as THREE from "three";
import { activeGround, fellOffRim } from "../world/ground.ts";
import { MAX_CARS } from "../scenes/fleet.ts";
import { BARRIER_HALF } from "../contact/sat.ts";
import { CAR_BOX } from "./ragdoll-props.ts";
import { DOLL_REACH, NEAR_HOLD, NEAR_MARGIN, PURSE_REACH } from "./ragdoll-cars.ts";
import type { RagCar } from "./ragdoll-car-view.ts";
import { dollGroups, MAX_ACC, SLOTS, STEP } from "./ragdoll-config.ts";
import { CALM_FOR, type Doll, GROUND_ANGULAR, GROUND_LINEAR, give, isCalm, limit, lowestPoint, PARTS, SETTLE_AFTER, SETTLE_ANGULAR, SETTLE_LINEAR } from "./ragdoll-body.ts";
import { brace } from "./ragdoll-joints.ts";
import { hypot2, hypot3 } from "../kernel/physics-core.js";
import { FIT_AHEAD, WANT_PARTS } from "./ragdoll-wire.ts";
import { GRACE, INTERNAL_PASSES, ITERATIONS, RagdollPool, STEP_LOG } from "./ragdoll-pool.ts";

const _q = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _r = new THREE.Vector3();
const _c = new THREE.Vector3();
const _cq = new THREE.Quaternion();

/** Torso speed (m/s) under which a dummy counts as lying still. */
const REST_SPEED = 0.4;

/**
 * Sim seconds a throw judged before Rapier is in may wait for it; later it is dropped (a dummy out of a car that
 * stopped a second ago reads as a glitch). Rapier lands 0.45 s after `ready` in a production build, a fleet's
 * first hit 1–2 s after it.
 */
const PENDING_MAX = 1;
/** The step rate (Hz) while knocked props alone are out and none moves fast: rigid shapes with no joints to tear, with CCD (`PropBodies`) for the walls a coarser step would get wrong. */
const PROP_STEP_HZ = 120;
const PROP_STEP = 1 / PROP_STEP_HZ;
/**
 * A knocked prop any point of whose shape moves faster than this (m/s: its middle's speed plus its turn times its reach)
 * keeps the world at `STEP`: at 1/120 a spinning cone flung at 31 m/s landed with its tip 110 mm in the ground. Deepest
 * lowest point over 80 run-overs of a lying cone at 10-40 m/s: 110.8 mm at 1/120, 50.4 with this at 12 m/s, 22.8 at 8,
 * 23.0 at 1/480 throughout.
 */
const PROP_FAST = 8;
/** The solver's iterations and internal passes while a thrown dummy is out (`thrownOut`): at 4 x 2 a landing arm sank 6.4 cm (bar 5) through the joint chain's pull; at 6 x 3 the deepest of the 28 range throws is 3.9 cm and the monster's flat throw 54.8 m (54.6 at 4 x 2, 56.6 at 6 x 2, 65.4 at 8 x 2: its slide is chaotic in the solver). */
const THROWN_ITERATIONS = 6;
const THROWN_PASSES = 3;
/** The skin's hits, the spin limit and the purses are judged at this rate (Hz) whatever `STEP` is: `HIT_DV` is a speed change per interval. */
const WATCH_HZ = 120;
const WATCH = 1 / WATCH_HZ;
const WATCH_EVERY = Math.round(WATCH / STEP);
/** A car moving faster than this (m/s) and this near (m) to a dummy that lies asleep keeps the world stepping (a car moves 1.2 m a frame at 70 m/s; a wreck lying beside him does not); the barrier's reach is its half diagonal. A sleeping knocked prop is stirred only by such a car that can touch it this frame (`PropBodies.touches`). */
const WAKE_SPEED = 0.5;
const WAKE_NEAR = 10;
const BARRIER_REACH = hypot2(BARRIER_HALF.x, BARRIER_HALF.z);

/**
 * A part whose velocity jumps by this much (m/s) in one step has hit something (gravity adds 0.08 per step): the skin
 * gives once at its first step (`hits`). Rapier's contact events say the same, but `drainCollisionEvents` passes a JS
 * closure through the wasm, and Vite's dev server serves the package's glue module twice (the closure's slot is not in
 * the other copy's table): every step then throws "reading 'memory'" and the dummy never lands (measured in the
 * browser; a production build has one copy).
 */
export const HIT_DV = 4;
/** His torso centre this near (m) the ground: he has touched down (lying, it rests at 0.1–0.3 m; thrown, it is over 0.5 m). */
export const GROUND_REACH = 0.45;

/** The stepping layer: one frame's physics and draw (`stepWorld`), its sleep test, which cars need a proxy, and the skin and settling that run after each step. */
export abstract class RagdollStepper extends RagdollPool {
  /** A thrown dummy (live, not the player's walker) is out. */
  private thrownOut(): boolean {
    for (const d of this.dolls) if (d.live && !d.driven) return true;
    return false;
  }

  /** The frame's physics and its draw, here: what `update` does in this thread and the world's worker does for each posted frame. `loose`: the frame's loose car bodies (`recordLoose`). */
  stepWorld(dt: number, cars: readonly RagCar[], authority: boolean, sandbox: boolean, barrier: THREE.Object3D | null, loose: Float64Array): void {
    this.authority = authority;
    this.sandbox = sandbox;
    const world = this.world;
    for (const t of this.pending) t.age += dt;
    if (!world) return;
    for (const t of this.pending) if (t.age <= PENDING_MAX) this.spawn(t);
    this.pending.length = 0;
    this.wake();
    this.props.here(this.course !== null && activeGround() === this.course.ground);
    if (this.live === 0 && this.props.count === 0 && this.boxes.asleep()) {
      this.loose.clear();
      for (let i = 0; i < MAX_CARS; i++) this.proxies.follow(i, null);
      this.wanted.fill(0);
      return;
    }
    this.proxies.at(++this.frameNo);
    this.loose.follow(loose, this.dolls, this.proxies.teleport || this.slept);
    const dormant = this.dormant(cars, barrier, dt);
    // The proxies stood still while nothing stepped: jump them to where the cars are now instead of flinging dummies.
    this.proxies.teleport ||= this.slept;
    this.slept = dormant;
    for (let i = 0; i < MAX_CARS; i++) {
      const alive = i < cars.length && !cars[i]!.falling && !cars[i]!.vaporized;
      this.wanted[i] = alive ? this.near(i, cars[i]!, dt, FIT_AHEAD) : 0;
      // In the worker a car whose cage has not been sent has no proxy yet.
      const car = alive && (!this.hosted || cars[i]!.cage !== null) && this.near(i, cars[i]!, dt) !== 0 ? cars[i]! : null;
      if (car) this.proxies.frame(i, car);
      this.proxies.follow(i, car ? this.proxies.frames[i]! : null);
      if (car) {
        this.proxies.fitProxy(i, car);
        this.proxies.cull(i, cars, false, dt);
      }
      // Its lower box where this frame's steps take it: a knocked prop it would squeeze against a wall, or has swallowed, lets it by.
      if (car) this.props.press(i, car.group.position, car.group.quaternion, car.velocity, dt, this.proxies.boxes);
    }
    this.proxies.follow(MAX_CARS, barrier);
    this.proxies.teleport = false;
    this.proxies.glassNear(cars, dt);
    // Whole steps out of the accumulator (`STEP` with a dummy out or a knocked prop moving fast, `PROP_STEP` for knocked
    // props alone), each proxy a step further along its frame's path.
    const step = this.live > 0 || !this.boxes.asleep() || this.props.faster(PROP_FAST) ? STEP : PROP_STEP;
    const lead = this.acc;
    this.acc = dormant ? 0 : Math.min(lead + dt, MAX_ACC);
    const steps = Math.floor(this.acc / step + 1e-6);
    if (steps > 0 && step !== this.step) {
      this.step = step;
      world.timestep = step;
    }
    if (steps > 0) for (let s = 0; s < SLOTS; s++) this.walkers[s]!.control(steps * step);
    if (steps > 0) {
      const thrown = this.thrownOut();
      world.numSolverIterations = thrown ? THROWN_ITERATIONS : ITERATIONS;
      world.integrationParameters.numInternalPgsIterations = thrown ? THROWN_PASSES : INTERNAL_PASSES;
    }
    for (let j = 1; j <= steps; j++) {
      this.proxies.move(Math.min(1, (j * step - lead) / dt));
      this.loose.move(Math.min(1, (j * step - lead) / dt));
      // One step this frame: the pose before it is the last frame's last (nothing moves a part between steps but a step).
      if (j === steps) {
        for (const d of this.dolls) {
          if (!d.live) continue;
          if (steps === 1) d.prev.set(d.cur);
          else this.capture(d, d.prev);
        }
      }
      if (j === steps) this.purses?.capture(false);
      if (j === steps) this.props.capture(false);
      this.proxies.glassTouch(cars, authority);
      this.loose.partTouch(step, authority);
      this.props.strikeDolls(this.dolls, step, this.goLimp);
      const stepAt = performance.now();
      this.untangle.step(world);
      this.stepMs[this.steps++ % STEP_LOG] = performance.now() - stepAt;
      if (++this.tick % WATCH_EVERY !== 0) continue;
      this.purses?.advance(WATCH_EVERY * STEP);
      for (let s = 0; s < SLOTS; s++) {
        const d = this.dolls[s]!;
        if (!d.live) continue;
        if (!d.driven) this.hits(s, d);
        limit(d.bodies);
      }
    }
    this.acc = Math.max(0, this.acc - steps * step);
    if (steps > 0 && this.live > 0) this.untangle.frame(world, this.dolls, steps * step);
    this.alpha = dormant ? 1 : Math.min(1, this.acc / step);
    if (steps > 0) for (const d of this.dolls) if (d.live) this.capture(d, d.cur);
    if (steps > 0) this.purses?.capture(true);
    if (steps > 0) this.props.capture(true);
    if (steps > 0) this.boxes.capture();
    for (let s = 0; s < SLOTS; s++) {
      const d = this.dolls[s]!;
      if (!d.live) continue;
      const before = d.age;
      d.age += dt;
      if (before < GRACE && d.age >= GRACE) for (const b of d.bodies) b.collider(0).setCollisionGroups(dollGroups(s));
      if (d.age > d.life || d.bodies[0]!.translation().y < -30 || this.fellOff(d)) {
        this.despawn(s);
        continue;
      }
      const v = d.bodies[0]!.linvel();
      d.speed = hypot3(v.x, v.y, v.z);
      d.vel[0] = v.x;
      d.vel[1] = v.y;
      d.vel[2] = v.z;
      d.still = d.speed < REST_SPEED ? d.still + dt : 0;
      if (!d.driven) this.calm(d, dt);
      if (this.hosted) continue;
      for (let k = 0; k < PARTS.length; k++) {
        this.blend(d, k, _p, _q);
        this.mesh.pose(s, k, _p, _q);
        if (this.debug.on) this.debug.pose(s, k, _p, _q);
      }
    }
    if (!this.hosted) this.purses?.pose(this.alpha);
    this.props.advance(dt, this.step);
    this.props.pose(this.alpha);
  }

  /** Whether his lowest point has fallen off the active ground's rim (`fellOffRim`): he is put away at once, not 30 m down. */
  private fellOff(d: Doll): boolean {
    if (!activeGround().rimmed) return false;
    lowestPoint(d.cur, _c);
    return fellOffRim(_c.x, _c.y, _c.z);
  }

  /**
   * Nothing to step: every dummy, purse thing and knocked prop lies asleep; no car moving over `WAKE_SPEED` nor the
   * barrier is within `WAKE_NEAR` of a dummy, no such car can touch a knocked prop this frame (`touches`), and the
   * barrier is not within `WAKE_NEAR` of one.
   */
  protected dormant(cars: readonly RagCar[], barrier: THREE.Object3D | null, dt: number): boolean {
    if (this.purses && !this.purses.asleep()) return false;
    if (!this.props.asleep()) return false;
    if (!this.boxes.asleep() || this.loose.moving > 0) return false;
    for (const d of this.dolls) {
      if (!d.live) continue;
      if (!d.bodies[0]!.isSleeping() || this.stirred(_r.set(d.cur[0]!, d.cur[1]!, d.cur[2]!), cars, barrier)) return false;
    }
    if (barrier && this.props.touches(barrier.position, WAKE_NEAR + BARRIER_REACH, 0, 0)) return false;
    for (let i = 0; i < cars.length && i < MAX_CARS; i++) {
      const car = cars[i]!;
      if (!car.falling && !car.vaporized && car.velocity.lengthSq() > WAKE_SPEED ** 2 && this.props.touches(car.group.position, this.proxies.reach[i]!, car.velocity.length(), dt)) return false;
    }
    return true;
  }

  /** Is the barrier, or a car moving over `WAKE_SPEED`, within `WAKE_NEAR` of `p`? */
  protected stirred(p: THREE.Vector3, cars: readonly RagCar[], barrier: THREE.Object3D | null): boolean {
    if (barrier && barrier.position.distanceTo(p) < WAKE_NEAR + BARRIER_REACH) return true;
    for (let i = 0; i < cars.length; i++) {
      const car = cars[i]!;
      if (!car.falling && !car.vaporized && car.velocity.lengthSq() > WAKE_SPEED ** 2 && car.group.position.distanceTo(p) < WAKE_NEAR) return true;
    }
    return false;
  }

  /**
   * Does car `i` need its proxy in the world: a dummy out within `DOLL_REACH` plus `NEAR_MARGIN` and two frames of both their travels
   * of the car's box (`CAR_BOX`; its sphere of `reach` before its first fit), a purse thing within its reach, or a knocked prop it can
   * touch within a frame of `dt` (`touches`)? A proxy already in the world stays until `NEAR_HOLD` m further out. A car that gets in
   * from outside in one frame moved over 4 m, which `CarProxies.follow` teleports for anyway, so the proxy it gets is the one it had.
   * `frames` > 1: whether it will within that many frames (the cars the main thread should send cages of, `FIT_AHEAD`), and an awake carton
   * within its reach counts too. `WANT_PARTS` when a knocked prop or carton is the reason (its parts that stand out meet them), 1 a dummy or purse, 0 none.
   */
  protected near(i: number, car: RagCar, dt: number, frames = 1): number {
    const { boxes, reach: reaches, whole, on } = this.proxies;
    const p = car.group.position;
    // The props first, as before any dummy: a car that can touch a knocked prop this frame gets its whole proxy (`cull`).
    const touched = this.props.touches(p, reaches[i]!, car.velocity.length(), dt * frames);
    if (frames === 1) whole[i] = touched ? 1 : 0;
    if (touched || (frames > 1 && !this.boxes.asleep() && this.boxes.touches(p, reaches[i]! + car.velocity.length() * dt * frames))) return WANT_PARTS;
    const hold = on[i] ? NEAR_HOLD : 0;
    const frame = Math.min(dt, MAX_ACC) * frames;
    const speed = car.velocity.length();
    // The car's box as fitted (`CAR_BOX`: its centre height, forward offset and half extents, in the car's frame), else its reach sphere.
    const b = i * CAR_BOX;
    const boxed = boxes[b + 2]! > 0;
    if (boxed) _cq.copy(car.group.quaternion).invert();
    for (let s = 0; s < SLOTS; s++) {
      const d = this.dolls[s]!;
      if (!d.live) continue;
      const r = DOLL_REACH + NEAR_MARGIN + hold + 2 * (speed + d.speed) * frame;
      _c.set(d.cur[0]! - p.x, d.cur[1]! - p.y, d.cur[2]! - p.z);
      if (!boxed) {
        const reach = r + reaches[i]!;
        if (_c.lengthSq() < reach * reach) return 1;
        continue;
      }
      _c.applyQuaternion(_cq);
      const ex = Math.max(Math.abs(_c.x) - boxes[b + 2]!, 0);
      const ey = Math.max(Math.abs(_c.y - boxes[b]!) - boxes[b + 3]!, 0);
      const ez = Math.max(Math.abs(_c.z - boxes[b + 1]!) - boxes[b + 4]!, 0);
      if (ex * ex + ey * ey + ez * ez < r * r) return 1;
    }
    return this.purses !== null && this.purses.near(p, reaches[i]! + PURSE_REACH + NEAR_MARGIN + hold) ? 1 : 0;
  }

  /**
   * After a step: a part that has just hit something (`HIT_DV`) gives at each of its joints (`give`), once per hit (a hit
   * runs a few steps; only its first counts). His torso touching down for the first time damps him harder from then on.
   * Velocities are recorded after the giving, so its own change is not read as the next hit: read again only when a
   * part gave (each read is a Rapier getter that allocates).
   */
  protected hits(s: number, d: Doll): void {
    const o = s * PARTS.length * 4;
    let gave = false;
    for (let k = 0; k < PARTS.length; k++) {
      const v = d.bodies[k]!.linvel();
      const i = o + 4 * k;
      const fresh = this.vel[i + 3] === 3;
      const jump = !fresh && hypot3(v.x - this.vel[i]!, v.y - this.vel[i + 1]!, v.z - this.vel[i + 2]!) > HIT_DV;
      if (jump && this.vel[i + 3] === 0) {
        give(d.bodies, k);
        gave = true;
      }
      this.vel[i] = v.x;
      this.vel[i + 1] = v.y;
      this.vel[i + 2] = v.z;
      this.vel[i + 3] = jump ? 1 : 0;
    }
    if (gave && d.braced) {
      brace(this.world!, d.joints, false);
      d.braced = false;
    }
    if (gave) {
      for (let k = 0; k < PARTS.length; k++) {
        const v = d.bodies[k]!.linvel();
        const i = o + 4 * k;
        this.vel[i] = v.x;
        this.vel[i + 1] = v.y;
        this.vel[i + 2] = v.z;
      }
    }
    if (d.ground) return;
    const t = d.bodies[0]!.translation();
    // At his own height: under a bridge the road is his ground, not the deck over him.
    const g = activeGround().heightAt(t.x, t.z, t.y);
    if (t.y - (Number.isFinite(g) ? g : 0) >= GROUND_REACH) return;
    // Flung from lying, his torso starts under GROUND_REACH: ground damping waits until he comes down.
    if (d.bodies[0]!.linvel().y > 0) return;
    d.ground = true;
    for (const body of d.bodies) {
      body.setLinearDamping(GROUND_LINEAR);
      body.setAngularDamping(GROUND_ANGULAR);
    }
  }

  /**
   * A dummy on the ground whose torso has lain still damps hard (`SETTLE_*`), then goes to sleep once his whole body
   * is calm (Rapier's own thresholds cannot be set from JS).
   */
  protected calm(d: Doll, dt: number): void {
    if (d.ground && !d.settled && d.still >= SETTLE_AFTER) {
      d.settled = true;
      for (const b of d.bodies) {
        b.setLinearDamping(SETTLE_LINEAR);
        b.setAngularDamping(SETTLE_ANGULAR);
      }
    }
    d.calm = d.ground && isCalm(d.bodies) ? d.calm + dt : 0;
    if (d.calm >= CALM_FOR && !d.bodies[0]!.isSleeping()) for (const b of d.bodies) b.sleep();
  }
}
