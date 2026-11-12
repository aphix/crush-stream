import * as THREE from "three";
import type { DeformableCar } from "../vehicle/car.ts";
import { activeGround, type Ground } from "../world/ground.ts";
import type { Track } from "../world/track.ts";
import { SCENERY_ARM, type SceneryArm } from "../world/constants.ts";
import type { Placed } from "../world/placements.ts";
import { EJECT_ROLL, ejectionVelocity, type Ejection } from "../vehicle/ejection.ts";
import type { DriverLook } from "./driver-look.ts";
import { VIP_LOOK } from "./dummy-dress.ts";
import { guardDress, passengerThrow } from "./people.ts";
import { FIGURE_KG, knocksDown, type FigureStrike } from "../scenes/figure-strike.ts";
import type { PropDraw, PropTrace } from "./ragdoll-props.ts";
import { NO_RELEASE_SCALE, type ReleaseScale } from "./ragdoll-boxes.ts";
import type { Shape } from "@dimforge/rapier3d-simd";
import { BASE_SLOTS, SIGHT_GROUPS, SLOTS, thrownGroups } from "./ragdoll-config.ts";
import { ARM, blendPose, MASS, PARTS, SHOULDER_Y } from "./ragdoll-body.ts";
import { strikeAt } from "./ragdoll-hit.ts";
import type { Solid } from "./ragdoll-solids.ts";
import { assertFloorBoxes, type FloorBox } from "./walker-floor.ts";
import { propColliders } from "../world/placements.ts";
import { flightsOf, NO_STAIRS, StairField } from "../world/stairs.ts";
import { detAtan2, detCos, detSin, hypot2 } from "../kernel/physics-core.js";
import { DOLL_CAR, DOLL_FLOATS, DOLL_HEADER, DOLL_LIVE, DOLL_RIDES, DOLL_SETTLED, DOLL_STILL, DOLL_VELOCITY, PROP_FLOATS, packBoxes, type ResultMessage } from "./ragdoll-wire.ts";
import { LIFE, STEP_LOG, type Throw, WALKER_SLOT } from "./ragdoll-pool.ts";
import { RagdollStepper } from "./ragdoll-step.ts";
import { PATCH_HALF, STATICS_HALF, terrainColliders } from "./ragdoll-ground.ts";

/** A dummy out as the capture trace has it: pool slot, his walker's state (null: thrown limp, no motors), sim s out, torso (m) and its velocity (m/s). */
export type DummyTrace = { slot: number; state: string | null; age: number; x: number; y: number; z: number; vx: number; vy: number; vz: number };

/** The walker's ground patch is built again when he is this far (m) from its middle: half of what it reaches, so he is never near its edge. */
const WALKER_FOLLOW = PATCH_HALF / 2;
/** A slot taken for a figure thrown this long ago (sim s) is still his: a later throw restarts a slot's age. */
const FIGURE_AGE_SLACK = 4;

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
const _sightAt = { x: 0, y: 0, z: 0 };
const _sightWay = { x: 0, y: 0, z: 0 };
const UNTURNED = { x: 0, y: 0, z: 0, w: 1 };

/** Two bodies whose torsos are within this far (m, level) of each other are touching. */
const BODY_TOUCH = 0.6;
/** A body is not judged again for this long (s) after a meeting that knocked someone. */
const BODY_AGAIN = 0.5;
const _meetPoint = new THREE.Vector3();
const _meetDir = new THREE.Vector3();

/** A thrown driver's centre of mass from his torso, standing, arms raised (`spawn`'s layout, each part at its own mass): his roll turns about it. */
const RAISED_COM = PARTS.reduce((sum, p, k) => {
  const y = ARM(k) ? 2 * SHOULDER_Y - p.c[1] : p.c[1];
  return sum.add(_r.set(p.c[0] - PARTS[0].c[0], y - PARTS[0].c[1], p.c[2] - PARTS[0].c[2]).multiplyScalar(MASS[k]!));
}, new THREE.Vector3()).divideScalar(MASS.reduce((sum, m) => sum + m, 0));

/** `velocity`'s horizontal speed becomes its whole speed, aimed `elevation` rad above its horizontal heading (a standing-still release stays still). */
function turnToElevation(velocity: THREE.Vector3, elevation: number): void {
  const speed = hypot2(velocity.x, velocity.z);
  if (speed === 0) return;
  const flat = detCos(elevation);
  velocity.set(velocity.x * flat, speed * detSin(elevation), velocity.z * flat);
}

/** The throwing layer: launching drivers, figures and passengers, the walker, knocked props, which world a run uses, and the mirror of the worker's answer. `RagdollSystem` adds the frame and camera on top. */
export abstract class RagdollThrower extends RagdollStepper {
  /** The ball a camera's sweep moves (`sightClear`), made at the first sweep and again for another radius. */
  private sightBall: Shape | null = null;
  private sightRadius = 0;

  /**
   * A driver is thrown out of `cars[e.car]`: the exit pane smashes and the way out gets its cover (`onExit`) now, the
   * dummy flies now or (Rapier still loading) once it is in. The sim's own event (`EjectionWatch`), a netplay host's
   * message or a highlight clip's record: the dummy starts from the event's numbers alone, so the same event is the
   * same throw wherever it is launched. `rides` false: the ride-along never frames him (a reel's throw from another
   * crash than its own, `ownThrow`). `releaseScale` changes his launch velocity (the range minigames' boost: `forward` scales the horizontal, `upward` the vertical, `elevation` turns the whole of the scaled horizontal speed up to an angle; unset: the event's own).
   */
  launch(e: Ejection, cars: readonly DeformableCar[], rides = true, releaseScale: ReleaseScale = NO_RELEASE_SCALE): void {
    const t = this.ejectThrow(e, cars, rides, releaseScale);
    this.pick();
    if (this.mode === "remote") this.launchRemote(t, cars);
    else if (this.world) this.spawn(t);
    else this.later(t);
  }

  /**
   * The player takes his own thrown-out driver over (`e`, the open world): the throw `launch` makes, in this thread's world and in the walker's slot,
   * limp from the first step and up again once asked (`Walker.ask`), the ride-along not framing him (the on-foot camera does). His slot, or -1 while
   * Rapier is still loading (nothing thrown: `launch` then).
   */
  ejectWalker(e: Ejection, cars: readonly DeformableCar[]): number {
    if (!this.R || !this.world) return -1;
    if (this.mode === "remote") this.reset();
    this.mode = "inline";
    const t = this.ejectThrow(e, cars, false, NO_RELEASE_SCALE);
    // A walker's joints are the ones `attach` sets, not a thrown driver's loosened and braced ones.
    t.loose = false;
    const placed = this.spawn(t, WALKER_SLOT, Infinity);
    if (placed < 0) return placed;
    const forward = _p.set(0, 0, 1).applyQuaternion(t.q);
    this.walkers[placed]!.attach(this.R, this.world, this.dolls[placed]!, detAtan2(forward.x, forward.z));
    this.walkers[placed]!.struck();
    this.walkerPatchX = t.p.x;
    this.walkerPatchZ = t.p.z;
    return placed;
  }

  /** Car `e.car`'s driver's throw out of its pane (the pane smashed and its cover burst), `next` filled with it and kept for his passenger (`throwPassenger`). */
  private ejectThrow(e: Ejection, cars: readonly DeformableCar[], rides: boolean, releaseScale: ReleaseScale): Throw {
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
    t.cop = this.uniformOn(e.car, e.cop);
    t.rides = rides;
    t.loose = true;
    this.driverThrows[e.car] = { ...t, p: t.p.clone(), q: t.q.clone(), v: t.v.clone(), w: t.w.clone() };
    this.onExit(_c, _cq, car.velocity);
    return t;
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
   * A figure a car or a loose part of it ran down (`FigureStrike`: a lawn guard, the VIP on his walk, or a civilian of the open world, whose `look` is
   * the drawn crowd's dress of them) is thrown where he stood, standing, in the dress he wore (`guardDress`, `VIP_LOOK`, or `look`) with his arms hanging, at the strike's velocity and spin, ignoring the car that struck
   * him for `GRACE` s (none for a part's: he stands clear of its car, and the part must meet him): through the launch a driver's throw
   * takes (the worker's world, this thread's, or waiting for Rapier up to `PENDING_MAX`). `life`: sim s he lies about (default: the pool's).
   */
  throwFigure(s: FigureStrike, cars: readonly DeformableCar[], look?: DriverLook, life?: number): number {
    this.cars = cars;
    const dress = look ? { cop: false, look } : s.guard >= 0 ? guardDress(s.guard) : { cop: false, look: VIP_LOOK };
    const t = this.figure;
    t.p.set(s.x, s.y + PARTS[0]!.c[1], s.z);
    t.q.setFromAxisAngle(Y, detAtan2(s.faceX, s.faceZ));
    t.v.set(s.vx, s.vy, s.vz);
    t.w.set(s.wx, s.wy, s.wz);
    t.car = s.loose ? -1 : s.car;
    t.age = 0;
    t.cop = dress.cop;
    t.look = dress.look;
    t.life = life;
    this.pick();
    if (this.mode === "remote") this.launchRemote(t, cars);
    else if (this.world) return this.spawn(t);
    else this.later(t);
    return -1;
  }

  /**
   * The figure thrown `age` sim s ago into slot `slot` (`throwFigure`'s answer) is taken away, if the slot still holds one that old (within `FIGURE_AGE_SLACK` s: a slot a later throw took is not his). False when it does not,
   * or the figure was thrown in the worker's world (no slot is known then).
   */
  removeFigure(slot: number, age: number): boolean {
    const d = this.dolls[slot];
    if (!d?.live || d.driven || Math.abs(d.age - age) > FIGURE_AGE_SLACK) return false;
    this.despawn(slot);
    return true;
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
   * A dummy in `dress` stands with his feet at `at` facing `yaw`, held up and walked by the walker of his pool slot (`slot`: the player's, or a free one), leaving at `v` m/s; his slot, or -1 while Rapier is still loading.
   * He lives in this thread's world, so a run the worker holds is begun again here, and a bounded ground gets its fixed colliders wide enough for everyone after him.
   */
  startWalker(at: THREE.Vector3, yaw: number, dress: { cop: boolean; look: DriverLook }, slot = WALKER_SLOT, v: THREE.Vector3 = NO_MOTION): number {
    if (!this.R || !this.world) return -1;
    if (this.mode === "remote") this.reset();
    this.mode = "inline";
    const c = this.course;
    if (c === null || activeGround() !== c.ground) this.buildStatics(at.x, at.z, at.y, STATICS_HALF);
    _p.set(at.x, at.y + PARTS[0].c[1], at.z);
    _q.setFromAxisAngle(Y, yaw);
    const placed = this.place(_p, _q, v, NO_MOTION, Infinity, slot, dress);
    if (placed < 0) return placed;
    this.walkers[placed]!.attach(this.R, this.world, this.dolls[placed]!, yaw);
    if (placed === WALKER_SLOT) {
      this.walkerPatchX = at.x;
      this.walkerPatchZ = at.z;
    }
    return placed;
  }

  /** A dummy in `dress` thrown from his feet at `at` at `v` m/s (`startWalker`), limp from the first step: a ragdoll in flight that gets up once asked (`Walker.ask`). */
  throwWalker(at: THREE.Vector3, yaw: number, v: THREE.Vector3, dress: { cop: boolean; look: DriverLook }, slot = -1): number {
    const placed = this.startWalker(at, yaw, dress, slot, v);
    if (placed >= 0) this.walkers[placed]!.struck();
    return placed;
  }

  /** The walker in `slot` leaves the pool: the slot is free for a throw again. */
  stopWalker(slot = WALKER_SLOT): void {
    if (this.walkers[slot]!.active) this.despawn(slot);
  }

  /** The player's walker has walked `WALKER_FOLLOW` m from the middle of the ground patch he stands on: it is built again round him (a heightfield 96 m across reaches no further than 48 m). A scene's one patch is under every walker. */
  protected followWalkerGround(): void {
    const d = this.dolls[WALKER_SLOT];
    if (!d?.live || !d.driven || !this.R || !this.world) return;
    const c = this.course;
    if (c !== null && activeGround() === c.ground && c.track === null) return;
    const x = d.cur[0]!;
    const z = d.cur[2]!;
    if (hypot2(x - this.walkerPatchX, z - this.walkerPatchZ) < WALKER_FOLLOW) return;
    for (const k of d.patch) this.world.removeCollider(k, false);
    d.patch.length = 0;
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

  /** A blow that does not fell by itself: the part at `point` is struck as `strikeWalker` strikes it, and the walker keeps his feet. */
  blowWalker(slot: number, point: THREE.Vector3, direction: THREE.Vector3, speed: number): void {
    const d = this.dolls[slot];
    if (!d?.live) return;
    strikeAt(d.bodies, point, direction, speed);
  }

  /** The walker in `slot` staggers to at most `share` of his strength (`Walker.stagger`). */
  staggerWalker(slot: number, share: number): void {
    this.walkers[slot]?.stagger(share);
  }

  private meetClock = 0;
  private readonly metAt = new Float64Array(SLOTS).fill(-Infinity);

  /** Bodies that meet are judged by the one knock law: closing at 2 m/s or more (`knocksDown` for a man's mass), the one being run into is knocked down and the runner staggers; slower, both keep their feet. */
  protected override meetWalkers(dt: number): void {
    this.meetClock += dt;
    const dolls = this.dolls;
    for (let s = 0; s < dolls.length; s++) this.walkers[s]!.beside = false;
    for (let a = 0; a < dolls.length; a++) {
      const da = dolls[a];
      if (!da?.live) continue;
      for (let b = a + 1; b < dolls.length; b++) {
        const db = dolls[b];
        if (!db?.live) continue;
        const wa = this.walkers[a]!;
        const wb = this.walkers[b]!;
        // A thrown dummy has a walker too, one that holds no doll: only a body some walker holds up is judged.
        if (!wa.active || !wb.active) continue;
        const aStands = wa.state === "stand";
        const bStands = wb.state === "stand";
        if (!aStands && !bStands) continue;
        const dx = db.cur[0]! - da.cur[0]!;
        const dz = db.cur[2]! - da.cur[2]!;
        const gap = hypot2(dx, dz);
        if (gap > BODY_TOUCH || gap === 0 || Math.abs(db.cur[1]! - da.cur[1]!) > 1) continue;
        wa.beside = true;
        wb.beside = true;
        if (this.meetClock - this.metAt[a]! < BODY_AGAIN || this.meetClock - this.metAt[b]! < BODY_AGAIN) continue;
        const nx = dx / gap;
        const nz = dz / gap;
        const towardB = aStands ? wa.rootSpeedAlong(nx, nz) : da.vel[0]! * nx + da.vel[2]! * nz;
        const towardA = bStands ? wb.rootSpeedAlong(-nx, -nz) : -(db.vel[0]! * nx + db.vel[2]! * nz);
        const closing = towardB + towardA;
        if (!knocksDown(FIGURE_KG, closing)) continue;
        this.metAt[a] = this.meetClock;
        this.metAt[b] = this.meetClock;
        // The slower of the two toward the other is the one run into (a tie: the higher slot).
        const struck = towardB < towardA ? a : b;
        const runner = struck === a ? b : a;
        const sign = struck === b ? 1 : -1;
        if (this.walkers[struck]!.state === "stand") {
          const hit = dolls[struck]!;
          _meetPoint.set(hit.cur[0]!, hit.cur[1]!, hit.cur[2]!);
          _meetDir.set(nx * sign, 0.3, nz * sign).normalize();
          this.strikeWalker(struck, _meetPoint, _meetDir, closing / 2);
        }
        this.walkers[runner]!.stagger(0.5);
      }
    }
  }

  /**
   * How far (m, at most `length`) a ball of `radius` m swept from (`x`, `y`, `z`) along the unit (`dx`, `dy`, `dz`) runs before a fixed solid or a car's
   * proxy of this world: what the walker meets, the dummies passed through. A camera on him stands short of it. `length` while there is no world.
   */
  sightClear(x: number, y: number, z: number, dx: number, dy: number, dz: number, length: number, radius: number): number {
    const R = this.R;
    const world = this.world;
    if (R === null || world === null || length <= 0) return Math.max(0, length);
    if (this.sightBall === null || this.sightRadius !== radius) {
      this.sightBall = new R.Ball(radius);
      this.sightRadius = radius;
    }
    _sightAt.x = x;
    _sightAt.y = y;
    _sightAt.z = z;
    _sightWay.x = dx;
    _sightWay.y = dy;
    _sightWay.z = dz;
    const hit = world.castShape(_sightAt, UNTURNED, _sightWay, this.sightBall, 0, length, true, R.QueryFilterFlags.EXCLUDE_SENSORS, SIGHT_GROUPS);
    return hit === null ? length : Math.min(length, hit.time_of_impact);
  }

  /** Whether the camera sees the walker's head and torso: not while its eye is in his head (first person). His shadow keeps them. */
  showWalkerHead(shown: boolean): void {
    this.mesh.viewHidden.value = shown ? -1 : WALKER_SLOT;
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
   * `slot`: the walker struck (the player's, or a civilian's body).
   */
  knockWalker(s: FigureStrike, slot = WALKER_SLOT): void {
    const d = this.dolls[slot];
    if (!d?.live) return;
    const centre = d.bodies[0]!.translation();
    _s.set(s.wx, s.wy, s.wz);
    const groups = thrownGroups(slot, s.car);
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
    this.walkers[slot]!.struck();
  }

  /**
   * The course a throw collides with, and its knockable props (`placed`; drawn by `props`, null headless), all back on their
   * spots. Its solids are built at the first throw on it, as recipes: Rapier colliders live only from a throw to its despawn.
   * The world's worker builds the same course from the track's JSON, dressed under the same bench scenery `arm` (`placeCourse`).
   */
  setCourse(track: Track, placed: readonly Placed[], props: PropDraw | null, arm: SceneryArm = SCENERY_ARM.on): void {
    this.course = { ground: track.ground(), track, placed };
    this.solids = null;
    this.setFlights(placed);
    this.freeScenePatch();
    this.props.set(placed, props);
    this.tumble = props;
    if (this.live === 0) this.mode = null;
    this.remote?.setCourse(track.json, arm);
  }

  /**
   * A scene's own solids (the Lab's wall, brackets and solid props) a dummy collides with while `ground` is the active one,
   * as a course's are, and its knockable props (`placed`, drawn by `props`), all back on their spots. Their one patch goes into
   * the world with the scene's first frame (`stepWorld`), not here: the scene has hidden what it hides (the sandbox's posts) by then.
   */
  setSolids(ground: Ground, solids: readonly Solid[], placed: readonly Placed[], props: PropDraw | null): void {
    this.course = { ground, track: null, placed };
    this.solids = solids;
    this.setFlights(placed);
    this.freeScenePatch();
    this.props.set(placed, props);
    this.tumble = props;
    if (this.live === 0) this.mode = null;
  }

  /**
   * The boxes of a building streamed in (an interior's slabs, treads, walls), the whole list each call (`[]`: none): fixed colliders in this thread's world,
   * in the worker's too, and the floor every walker reads (`Walker.floor`). The list before is gone: what lay on it falls. Throws on an empty or non-finite box.
   */
  setFixedBoxes(boxes: readonly FloorBox[]): void {
    assertFloorBoxes(boxes);
    this.boxList = boxes.slice();
    for (const walker of this.walkers) this.equipFloor(walker);
    this.remote?.setBoxes(packBoxes(this.boxList));
    this.buildFixedBoxes();
  }

  /** The flights of stairs among `placed` (stairs props), under every walker's feet. */
  private setFlights(placed: readonly Placed[]): void {
    this.flights = placed.some((p) => p.stairs === true) ? new StairField(flightsOf(propColliders(placed), placed)) : NO_STAIRS;
    for (const walker of this.walkers) this.equipFloor(walker);
  }

  /** No scene's solids or props any more, and the pool back to its base capacity: leaving the showcase, whose ground (the fleet's disc) the other sandbox scenes share. */
  clearScene(): void {
    this.course = null;
    this.solids = null;
    this.setFlights([]);
    this.freeScenePatch();
    this.props.set([], null);
    this.tumble = null;
    this.setCapacity(BASE_SLOTS);
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

  /**
   * Knockable prop `i` of the scene thrown by a hand from `at` at `v` m/s (the showcase's number keys): it flies as a knocked one,
   * meeting dummies and cars' parts the same way. This thread's world only, as a scene's solids are. False while it cannot fly yet.
   */
  throwProp(i: number, at: THREE.Vector3, v: THREE.Vector3): boolean {
    this.pick();
    if (this.mode === "remote") return false;
    this.wake();
    return this.props.throwFrom(i, at, v.x, v.y, v.z);
  }

  /** Every prop of the scene back on its spot, the dummies as they are. */
  clearProps(): void {
    this.props.clear();
  }

  /** Is a knocked prop flying within `r` m of `p`, plus its reach and how far it travels in `dt` s? */
  flyingPropNear(p: THREE.Vector3, r: number, dt: number): boolean {
    return this.props.flyingNear(p, r, dt);
  }

  /** Knocked prop `i`'s middle after the last step into `p`, and its velocity into `v`; false while it is not out. */
  propAt(i: number, p: THREE.Vector3, v: THREE.Vector3): boolean {
    return this.props.centre(i, p, v);
  }

  /** What is out now, for the capture trace: each dummy (pool slot, his walker's state while its motors hold him up, sim s out, torso as last stepped and its velocity) and each knocked prop. */
  outNow(): { dummies: DummyTrace[]; props: PropTrace[] } {
    const dummies: DummyTrace[] = [];
    for (let s = 0; s < this.dolls.length; s++) {
      const d = this.dolls[s]!;
      if (!d.live) continue;
      dummies.push({ slot: s, state: d.driven ? this.walkers[s]!.state : null, age: d.age, x: d.cur[0]!, y: d.cur[1]!, z: d.cur[2]!, vx: d.vel[0]!, vy: d.vel[1]!, vz: d.vel[2]! });
    }
    return { dummies, props: this.props.outNow() };
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

  /** Every dummy's and purse set's state after the last frame into `dolls` and `purses` (`DOLL_FLOATS` and `PURSE_BLOCK` floats a built slot, `builtSlots` of them), for the main thread to draw. Returns the latest throw's slot. */
  snapshot(dolls: Float32Array, purses: Float32Array): number {
    for (let s = 0; s < this.dolls.length; s++) {
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
    // A slot only this thread built lies past the worker's records: reads undefined, not live.
    for (let s = 0; s < this.dolls.length; s++) {
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
