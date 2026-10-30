import * as THREE from "three";
import type { DeformableCar } from "../vehicle/car.ts";
import { activeGround, type Ground } from "../world/ground.ts";
import type { Track } from "../world/track.ts";
import type { Placed } from "../world/placements.ts";
import { EJECT_ROLL, ejectionVelocity, type Ejection } from "../vehicle/ejection.ts";
import type { DriverLook } from "./driver-look.ts";
import { VIP_LOOK } from "./dummy-dress.ts";
import { guardDress, passengerThrow } from "./people.ts";
import type { FigureStrike } from "../scenes/figure-strike.ts";
import type { PropDraw } from "./ragdoll-props.ts";
import { NO_RELEASE_SCALE, type ReleaseScale } from "./ragdoll-boxes.ts";
import { SLOTS, thrownGroups } from "./ragdoll-config.ts";
import { ARM, blendPose, MASS, PARTS, SHOULDER_Y } from "./ragdoll-body.ts";
import { strikeAt } from "./ragdoll-hit.ts";
import type { Solid } from "./ragdoll-solids.ts";
import { hypot2 } from "../kernel/physics-core.js";
import { DOLL_CAR, DOLL_FLOATS, DOLL_HEADER, DOLL_LIVE, DOLL_RIDES, DOLL_SETTLED, DOLL_STILL, DOLL_VELOCITY, PROP_FLOATS, type ResultMessage } from "./ragdoll-wire.ts";
import { LIFE, STEP_LOG, type Throw, WALKER_SLOT } from "./ragdoll-pool.ts";
import { RagdollStepper } from "./ragdoll-step.ts";
import { PATCH_HALF, STATICS_HALF, terrainColliders } from "./ragdoll-ground.ts";

/** The walker's ground patch is built again when he is this far (m) from its middle: half of what it reaches, so he is never near its edge. */
const WALKER_FOLLOW = PATCH_HALF / 2;

const _q = new THREE.Quaternion();
const _qx = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _r = new THREE.Vector3();
const _c = new THREE.Vector3();
const _cq = new THREE.Quaternion();
const _v = { x: 0, y: 0, z: 0 };
const Y = new THREE.Vector3(0, 1, 0);
const _roll = new THREE.Vector3();
const _com = new THREE.Vector3();
const NO_MOTION = new THREE.Vector3();

/** A thrown driver's centre of mass from his torso, standing, arms raised (`spawn`'s layout, each part at its own mass): his roll turns about it. */
const RAISED_COM = PARTS.reduce((sum, p, k) => {
  const y = ARM(k) ? 2 * SHOULDER_Y - p.c[1] : p.c[1];
  return sum.add(_r.set(p.c[0] - PARTS[0].c[0], y - PARTS[0].c[1], p.c[2] - PARTS[0].c[2]).multiplyScalar(MASS[k]!));
}, new THREE.Vector3()).divideScalar(MASS.reduce((sum, m) => sum + m, 0));

/** `velocity`'s horizontal speed becomes its whole speed, aimed `elevation` rad above its horizontal heading (a standing-still release stays still). */
function turnToElevation(velocity: THREE.Vector3, elevation: number): void {
  const speed = hypot2(velocity.x, velocity.z);
  if (speed === 0) return;
  const flat = Math.cos(elevation);
  velocity.set(velocity.x * flat, speed * Math.sin(elevation), velocity.z * flat);
}

/** The throwing layer: launching drivers, figures and passengers, the walker, knocked props, which world a run uses, and the mirror of the worker's answer. `RagdollSystem` adds the frame and camera on top. */
export abstract class RagdollThrower extends RagdollStepper {
  /**
   * A driver is thrown out of `cars[e.car]`: the exit pane smashes and the way out gets its cover (`onExit`) now, the
   * dummy flies now or (Rapier still loading) once it is in. The sim's own event (`EjectionWatch`), a netplay host's
   * message or a highlight clip's record: the dummy starts from the event's numbers alone, so the same event is the
   * same throw wherever it is launched. `rides` false: the ride-along never frames him (a reel's throw from another
   * crash than its own, `ownThrow`). `releaseScale` changes his launch velocity (the range minigames' boost: `forward` scales the horizontal, `upward` the vertical, `elevation` turns the whole of the scaled horizontal speed up to an angle; unset: the event's own).
   */
  launch(e: Ejection, cars: readonly DeformableCar[], rides = true, releaseScale: ReleaseScale = NO_RELEASE_SCALE): void {
    this.cars = cars;
    const car = cars[e.car]!;
    if (this.authority) car.smashGlass(e.exit);
    const t = this.next;
    // The cover's centre, half a metre out of the pane: over the bonnet, or the door; its frame's z out of the pane.
    const side = e.exit === "windshield" ? 0 : e.exit === "doorL" ? -1 : 1;
    car.glassWorld(e.exit, _c).addScaledVector(e.dir, 0.5);
    _cq.copy(car.group.quaternion).multiply(_qx.setFromAxisAngle(Y, (side * Math.PI) / 2));
    t.p.copy(e.pos);
    t.q.copy(e.quat);
    t.w.copy(e.spin);
    ejectionVelocity(e, t.v);
    t.v.set(t.v.x * releaseScale.forward, t.v.y * releaseScale.upward, t.v.z * releaseScale.forward);
    if (releaseScale.elevation !== null) turnToElevation(t.v, releaseScale.elevation);
    const flight = t.v.length();
    if (flight > 0) {
      t.w.add(_roll.copy(t.v).multiplyScalar(EJECT_ROLL / flight));
      // About his centre of mass, not the torso point he is placed by: the roll moves none of him along.
      t.v.sub(_roll.cross(_com.copy(RAISED_COM).applyQuaternion(t.q)));
    }
    t.car = e.car;
    t.age = 0;
    t.cop = e.cop;
    t.rides = rides;
    t.loose = true;
    this.driverThrows[e.car] = { ...t, p: t.p.clone(), q: t.q.clone(), v: t.v.clone(), w: t.w.clone() };
    this.onExit(_c, _cq, car.velocity);
    this.pick();
    if (this.mode === "remote") this.launchRemote(t, cars);
    else if (this.world) this.spawn(t);
    else this.later(t);
  }

  /**
   * Throw `t`'s dummy in the world's worker: it goes now, in whichever slot the worker has free; what its look and purse are
   * is decided here (`dressed`: a look of its own, else its car's driver's) and applied (`dress`) when the worker answers with the slot.
   * The ride-along and the sandbox's follow hook hear of the throw at once, as an inline one's.
   */
  protected launchRemote(t: Throw, cars: readonly DeformableCar[], dressed: DriverLook | null = null): void {
    const { look, spray } = this.dressingOf(t, dressed);
    const purse = look.woman && !t.cop;
    const id = this.remote!.throwDummy(t, purse, this.lookSeed, cars);
    this.dressing.set(id, { cop: t.cop, look, spray, purse, car: t.car, seed: this.lookSeed });
    this.ride.exit(t.car, hypot2(t.v.x, t.v.z), t.p);
    if (this.sandbox && t.car >= 0) this.onThrow(t.car);
  }

  /**
   * A figure a car or a loose part of it ran down (`FigureStrike`: a lawn guard, or the VIP on his walk) is thrown where he stood, standing,
   * in the dress he wore (`guardDress`, `VIP_LOOK`) with his arms hanging, at the strike's velocity and spin, ignoring the car that struck
   * him for `GRACE` s (none for a part's: he stands clear of its car, and the part must meet him): through the launch a driver's throw
   * takes (the worker's world, this thread's, or waiting for Rapier up to `PENDING_MAX`).
   */
  throwFigure(s: FigureStrike, cars: readonly DeformableCar[]): void {
    this.cars = cars;
    const dress = s.guard >= 0 ? guardDress(s.guard) : { cop: false, look: VIP_LOOK };
    const t = this.figure;
    t.p.set(s.x, s.y + PARTS[0]!.c[1], s.z);
    t.q.setFromAxisAngle(Y, Math.atan2(s.faceX, s.faceZ));
    t.v.set(s.vx, s.vy, s.vz);
    t.w.set(s.wx, s.wy, s.wz);
    t.car = s.loose ? -1 : s.car;
    t.age = 0;
    t.cop = dress.cop;
    t.look = dress.look;
    this.pick();
    if (this.mode === "remote") this.launchRemote(t, cars);
    else if (this.world) this.spawn(t);
    else this.later(t);
  }

  /** Throw `t` once Rapier is in (`stepWorld`): a copy of it, waiting. */
  protected later(t: Throw): void {
    this.pending.push({ ...t, p: t.p.clone(), q: t.q.clone(), v: t.v.clone(), w: t.w.clone() });
  }

  /**
   * A passenger (the course's VIP, in `look`) thrown with car `car`'s driver, whose throw (`launch`) is kept for him: beside him, toward the
   * passenger side, with his motion, in this thread's world or the worker's. Nothing when that car's driver has not been thrown (or his passenger has), or when no world is up to take him.
   */
  throwPassenger(car: number, look: DriverLook): void {
    const ride = this.cars[car];
    const t = this.driverThrows[car];
    if (!ride || !t || t.cop) return;
    if (this.mode !== "remote" && !this.world) return;
    this.driverThrows[car] = undefined;
    passengerThrow(ride, t.p);
    t.age = 0;
    if (this.mode === "remote") this.launchRemote(t, this.cars, look);
    else this.spawn(t, -1, this.thrownLife, look);
  }

  /**
   * A dummy in `dress` stands with his feet at `at` facing `yaw`, held up and walked by the walker of his pool slot (`slot`: the player's, or a free one); his slot, or -1 while Rapier is still loading.
   * He lives in this thread's world, so a run the worker holds is begun again here, and a bounded ground gets its fixed colliders wide enough for everyone after him.
   */
  startWalker(at: THREE.Vector3, yaw: number, dress: { cop: boolean; look: DriverLook }, slot = WALKER_SLOT): number {
    if (!this.R || !this.world) return -1;
    if (this.mode === "remote") this.reset();
    this.mode = "inline";
    const c = this.course;
    if (c === null || activeGround() !== c.ground) this.buildStatics(at.x, at.z, at.y, STATICS_HALF);
    _p.set(at.x, at.y + PARTS[0].c[1], at.z);
    _q.setFromAxisAngle(Y, yaw);
    const placed = this.place(_p, _q, NO_MOTION, NO_MOTION, Infinity, slot, dress);
    if (placed < 0) return placed;
    this.walkers[placed]!.attach(this.R, this.world, this.dolls[placed]!, yaw);
    if (placed === WALKER_SLOT) {
      this.walkerPatchX = at.x;
      this.walkerPatchZ = at.z;
    }
    return placed;
  }

  /** The walker in `slot` leaves the pool: the slot is free for a throw again. */
  stopWalker(slot = WALKER_SLOT): void {
    if (this.walkers[slot]!.active) this.despawn(slot);
  }

  /** The player's walker has walked `WALKER_FOLLOW` m from the middle of the ground patch he stands on: it is built again round him (a heightfield 96 m across reaches no further than 48 m). */
  protected followWalkerGround(): void {
    const d = this.dolls[WALKER_SLOT];
    if (!d?.live || !d.driven || !this.R || !this.world) return;
    const x = d.cur[0]!;
    const z = d.cur[2]!;
    if (hypot2(x - this.walkerPatchX, z - this.walkerPatchZ) < WALKER_FOLLOW) return;
    for (const c of d.patch) this.world.removeCollider(c, false);
    d.patch.length = 0;
    const c = this.course;
    if (c !== null && activeGround() === c.ground) d.patch.push(...this.patchAt(x, z, d.cur[1]!, PATCH_HALF));
    else d.patch.push(...terrainColliders(this.R, this.world, x, z, d.cur[1]!, PATCH_HALF));
    this.walkerPatchX = x;
    this.walkerPatchZ = z;
  }

  /** A push of `speed` m/s along `direction` lands on the world `point` of the dummy the walker in `slot` is (`strikeAt`), and he goes limp: a ragdoll that reacts to where it landed. */
  strikeWalker(slot: number, point: THREE.Vector3, direction: THREE.Vector3, speed: number): void {
    const d = this.dolls[slot];
    if (!d?.live) return;
    strikeAt(d.bodies, point, direction, speed);
    this.walkers[slot]!.struck();
  }

  /** His torso as drawn this frame (between the last two steps) into `out`; false while he is not out. */
  walkerTorso(out: THREE.Vector3, slot = WALKER_SLOT): boolean {
    const d = this.dolls[slot];
    if (!d?.live) return false;
    blendPose(d.prev, d.cur, 0, this.alpha, out, _q);
    return true;
  }

  /**
   * A car ran him down (`runsDown`; `s` from `fell`, the launch a lawn guard or the VIP takes): every part moves as one body at the strike's
   * velocity and spin, he goes limp (`Walker.struck`) and ignores the car for `GRACE` s, as a thrown figure does. Nothing while he is not out.
   */
  knockWalker(s: FigureStrike): void {
    const d = this.dolls[WALKER_SLOT];
    if (!d?.live) return;
    const centre = d.bodies[0]!.translation();
    _s.set(s.wx, s.wy, s.wz);
    const groups = thrownGroups(WALKER_SLOT, s.car);
    for (const body of d.bodies) {
      const at = body.translation();
      _r.set(at.x - centre.x, at.y - centre.y, at.z - centre.z);
      _c.copy(_s).cross(_r);
      _v.x = s.vx + _c.x;
      _v.y = s.vy + _c.y;
      _v.z = s.vz + _c.z;
      body.setLinvel(_v, true);
      _v.x = s.wx;
      _v.y = s.wy;
      _v.z = s.wz;
      body.setAngvel(_v, true);
      body.collider(0).setCollisionGroups(groups);
    }
    d.age = 0;
    this.walker.struck();
  }

  /**
   * The course a throw collides with, and its knockable props (`placed`; drawn by `props`, null headless), all back on their
   * spots. Its solids are built at the first throw on it, as recipes: Rapier colliders live only from a throw to its despawn.
   * The world's worker builds the same course from the track's JSON.
   */
  setCourse(track: Track, placed: readonly Placed[], props: PropDraw | null): void {
    this.course = { ground: track.ground(), track, placed };
    this.solids = null;
    this.props.set(placed, props);
    this.tumble = props;
    if (this.live === 0) this.mode = null;
    this.remote?.setCourse(track.json);
  }

  /**
   * A scene's own solids (the Lab's wall, brackets and solid props) a dummy collides with while `ground` is the active one,
   * as a course's are, and its knockable props (`placed`, drawn by `props`), all back on their spots.
   */
  setSolids(ground: Ground, solids: readonly Solid[], placed: readonly Placed[], props: PropDraw | null): void {
    this.course = { ground, track: null, placed };
    this.solids = solids;
    this.props.set(placed, props);
    this.tumble = props;
    if (this.live === 0) this.mode = null;
  }

  /**
   * Knockable prop `i` of the course or scene knocked off its spot by car `car` (-1: none) at (vx, vy, vz) m/s: it flies,
   * tumbles and comes to rest in this world (cosmetic: nothing here reaches the sim); knocked before Rapier is in, once it is.
   */
  knockProp(i: number, car: number, vx: number, vy: number, vz: number): void {
    this.pick();
    if (this.mode === "remote") {
      this.remote!.knock(i, car, vx, vy, vz);
      return;
    }
    this.wake();
    this.props.knock(i, car, vx, vy, vz);
  }

  /** Knocked prop `i`'s middle after the last step into `p`, and its velocity into `v`; false while it is not out. */
  propAt(i: number, p: THREE.Vector3, v: THREE.Vector3): boolean {
    return this.props.centre(i, p, v);
  }

  /** Dummies launched from now on lie about until `releaseThrown`, not `LIFE` s (a minigame's score is read while he lies). */
  holdThrown(): void {
    this.thrownLife = Infinity;
  }

  /** The dummies held lying about for ever go, and later ones lie `LIFE` s again. */
  releaseThrown(): void {
    this.thrownLife = LIFE;
    this.pending.length = 0;
    for (let s = 0; s < this.dolls.length; s++) if (this.dolls[s]!.live && this.dolls[s]!.life === Infinity) this.despawn(s);
  }

  /**
   * Which world this run's dummies are in, decided at its first throw or knock and kept until `reset`: the worker's when it is up
   * (and this thread's Rapier too, which owns the dummy pool the draw reads) and the course is a track's, which the worker builds
   * from its JSON; else this thread's.
   */
  protected pick(): void {
    if (this.mode !== null) return;
    const course = this.course;
    const onTrack = course !== null && course.track !== null && activeGround() === course.ground;
    this.mode = this.remote?.ready && this.world !== null && onTrack ? "remote" : "inline";
  }

  /** The sim must not run its next frame yet: the worker's answer it is to hear of first is not in (`RagdollRemote.behind`). */
  get waiting(): boolean {
    return this.mode === "remote" && this.remote!.behind(this.authority);
  }

  /** This system is the world's worker's: it draws nothing (`snapshot` gives the main thread what to draw), and `wanted` says which cars it wants cages of. */
  host(): void {
    this.hosted = true;
  }

  /** A dummy or a knocked prop is out. */
  get busy(): boolean {
    return this.live > 0 || this.props.count > 0;
  }

  /** How far (0-1) into the next step the last frame's draw is. */
  get drawAlpha(): number {
    return this.alpha;
  }

  /** Every dummy's and purse set's state after the last frame into `dolls` and `purses` (`DOLL_FLOATS` and `PURSE_BLOCK` floats a slot), for the main thread to draw. Returns the latest throw's slot. */
  snapshot(dolls: Float32Array, purses: Float32Array): number {
    for (let s = 0; s < SLOTS; s++) {
      const d = this.dolls[s]!;
      const o = s * DOLL_FLOATS;
      dolls[o + DOLL_LIVE] = d.live ? 1 : 0;
      if (!d.live) continue;
      dolls[o + DOLL_RIDES] = d.rides ? 1 : 0;
      dolls[o + DOLL_CAR] = d.car;
      dolls[o + DOLL_STILL] = d.still;
      dolls[o + DOLL_SETTLED] = d.settled ? 1 : 0;
      dolls.set(d.vel, o + DOLL_VELOCITY);
      dolls.set(d.prev, o + DOLL_HEADER);
      dolls.set(d.cur, o + DOLL_HEADER + PARTS.length * 7);
    }
    this.purses?.exportPoses(purses);
    return this.lastSlot;
  }

  /** A frame in the worker's world: post it, then draw what the worker has answered with since. */
  protected updateRemote(dt: number, cars: readonly DeformableCar[]): void {
    const remote = this.remote!;
    remote.post(dt, cars, this.authority, this.sandbox, this.lookSeed, this.onPartHit);
    for (const result of remote.drain()) this.adopt(result);
  }

  /** The worker's answer on screen: its dummies' and purses' poses, its knocked props placed, the slot of each dummy it just threw dressed. */
  protected adopt(r: ResultMessage): void {
    this.alpha = r.alpha;
    this.lastSlot = r.lastSlot;
    for (const { id, slot } of r.spawned) this.dress(id, slot);
    let live = 0;
    for (let s = 0; s < SLOTS; s++) {
      const d = this.dolls[s]!;
      const o = s * DOLL_FLOATS;
      if (r.dolls[o + DOLL_LIVE] !== 1) {
        if (d.live) {
          d.live = false;
          this.mesh.hide(s);
          this.debug.hide(s);
        }
        continue;
      }
      live++;
      d.live = true;
      d.rides = r.dolls[o + DOLL_RIDES] === 1;
      d.car = r.dolls[o + DOLL_CAR]!;
      d.still = r.dolls[o + DOLL_STILL]!;
      d.settled = r.dolls[o + DOLL_SETTLED] === 1;
      d.vel.set(r.dolls.subarray(o + DOLL_VELOCITY, o + DOLL_VELOCITY + 3));
      d.prev.set(r.dolls.subarray(o + DOLL_HEADER, o + DOLL_HEADER + PARTS.length * 7));
      d.cur.set(r.dolls.subarray(o + DOLL_HEADER + PARTS.length * 7, o + DOLL_FLOATS));
      for (let k = 0; k < PARTS.length; k++) {
        this.blend(d, k, _p, _q);
        this.mesh.pose(s, k, _p, _q);
        if (this.debug.on) this.debug.pose(s, k, _p, _q);
      }
    }
    this.live = live;
    this.mesh.visible = live > 0;
    this.purses?.importPoses(r.purses);
    this.purses?.pose(this.alpha);
    if (r.propsReset) this.tumble?.reset();
    for (let k = 0; k < r.props.length; k += PROP_FLOATS) this.tumble?.place(r.props[k]!, _p.fromArray(r.props, k + 1), _q.fromArray(r.props, k + 4));
    for (const ms of r.stepMs) this.stepMs[this.steps++ % STEP_LOG] = ms;
    this.remoteSize.colliders = r.colliders;
    this.remoteSize.bodies = r.bodies;
  }

  /** The dummy sent as throw `id` took slot `slot`: dress it as it was sent. */
  protected dress(id: number, slot: number): void {
    const dressing = this.dressing.get(id);
    if (dressing === undefined) return;
    this.dressing.delete(id);
    this.mesh.dress(slot, dressing.cop, dressing.look);
    this.mesh.spray(slot, dressing.spray);
    if (dressing.purse) this.purses?.paint(slot, dressing.car, dressing.seed);
  }

  /** The worker failed: this thread's world takes the next throw, and what the worker had out is gone. */
  protected fallBack(err: Error): void {
    console.error("Crush Stream ragdoll worker failed", err);
    this.remote?.dispose();
    this.remote = null;
    if (this.mode === "remote") this.reset();
  }
}
