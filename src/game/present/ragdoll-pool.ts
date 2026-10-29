import * as THREE from "three";
import type { Collider, World } from "@dimforge/rapier3d-simd";
import type { DeformableCar } from "../vehicle/car.ts";
import { activeGround, type Ground } from "../world/ground.ts";
import { MAX_CARS } from "../scenes/fleet.ts";
import type { Track } from "../world/track.ts";
import type { Placed } from "../world/placements.ts";
import { disable, loadRapier, type Rapier } from "../kernel/rapier.ts";
import { DummyMesh } from "./ragdoll-mesh.ts";
import { type DriverLook, driverLook, ownLook } from "./driver-look.ts";
import type { PersonPick } from "../match/look-data.ts";
import type { SprayBitmap } from "./spray.ts";
import { Purses } from "./ragdoll-purse.ts";
import { type PropDraw, PropBodies } from "./ragdoll-props.ts";
import { BoxPile } from "./ragdoll-boxes.ts";
import { CarProxies, PROP_BAND_HIGH, PROP_BAND_LOW } from "./ragdoll-cars.ts";
import { LooseProxies } from "./ragdoll-loose.ts";
import { dollGroups, FIXED_GROUPS, knockedGroups, propGroups, SLOTS, STEP, thrownGroups } from "./ragdoll-config.ts";
import { RagdollDebug } from "./ragdoll-debug.ts";
import { RagdollRemote, type PostTraffic } from "./ragdoll-remote.ts";
import { RideAlong } from "./ragdoll-ride.ts";
import { AIR_ANGULAR, AIR_LINEAR, ARM, blendPose, type Doll, JOINTS, limp, PARTS, partDensity, readPose, SHOULDER_Y } from "./ragdoll-body.ts";
import { brace, joinUp, loosen } from "./ragdoll-joints.ts";
import { Walker } from "./ragdoll-walker.ts";
import { groundColliders, PATCH_AHEAD, PATCH_HALF, type Pole } from "./ragdoll-ground.ts";
import { courseSolids, type Solid } from "./ragdoll-solids.ts";
import { hypot2, hypot3 } from "../kernel/physics-core.js";
import { GRAVITY } from "../kernel/constants.ts";

const _q = new THREE.Quaternion();
const _qb = new THREE.Quaternion();
const _qx = new THREE.Quaternion();
const _arm = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI);
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _r = new THREE.Vector3();
const _v = { x: 0, y: 0, z: 0 };
const Y = new THREE.Vector3(0, 1, 0);
const _w = new THREE.Vector3();

/** Seconds a dummy lies about before it goes. */
export const LIFE = 10;
/** Seconds after the throw the dummy ignores his own car (`thrownGroups`): he starts inside its cabin, over its lower box. */
export const GRACE = 0.35;
/** Dummy friction against anything (the lower of the pair counts): low, so it slides a good way (owner, 2026-10-02). */
const SLIDE = 0.12;
/** The pool slot the player's walker takes: the last, so a throw that takes the oldest slot finds him driven and passes him by. */
export const WALKER_SLOT = SLOTS - 1;
/** Rapier's solver iterations (default 4); no CCD on the parts (it tears the joints: 11–28 cm apart vs 0.9 cm at 8 iterations of 1/120). At 1/960 four hold a joint to 0.1 cm; two kicked one to 125 rad/s. */
export const ITERATIONS = 4;
/** Rapier's internal solver passes per iteration (default 1): at the first touch of a 29 m/s throw one pass rose energy 75–325 J in a frame at 1/120 and 26–30 J (1 of 5 runs) at 1/480 and 1/960; two at most 0.6 J over 60 runs (60/144/240 Hz). */
export const INTERNAL_PASSES = 2;
/** A throw, placed: car (-1: none, `place`; else the one he ignores for `GRACE` s), torso point and orientation, linear and angular velocity (world), sim seconds waiting, a police driver, whether the ride-along may frame him, whether his purse flies too (unset: when his look is a woman's), arms hanging (a figure thrown standing) instead of raised, a look of his own (unset: his car's driver's), and whether his limbs leave loose (`limp`: a driver thrown out of a car). */
export type Throw = { car: number; p: THREE.Vector3; q: THREE.Quaternion; v: THREE.Vector3; w: THREE.Vector3; age: number; cop: boolean; rides: boolean; purse?: boolean; armsDown?: boolean; look?: DriverLook; loose?: boolean };

/** What a dummy sent to the worker looks like, applied (`mesh.dress`, `spray`, `Purses.paint`) once the worker says which slot he took. */
type Dressing = { cop: boolean; look: DriverLook; spray: SprayBitmap | null; purse: boolean; car: number; seed: number };

/** `world.step()` timings kept (the newest): a 30 s window steps the world at most a few thousand times. */
export const STEP_LOG = 8192;

/** The cosmetic world's cost so far: `world.step()` calls, the ring of their wall ms (the call `n` is at `log[n % log.length]`), the world's size. */
export interface RagdollStats {
  steps: number;
  log: Float64Array;
  colliders: number;
  bodies: number;
}

/** The dummies' pool layer: Rapier world, the doll, prop, box and proxy state, and what spawns, places and removes a dummy. The stepper, thrower and `RagdollSystem` build on it. */
export abstract class RagdollPool {
  /** The sandbox's lamp posts: the standing ones are fixed colliders in the run's statics (set by the engine). */
  poles: readonly Pole[] = [];
  /**
   * The solids a throw collides with while `ground` is the active one: a race course's walls and solids (`setCourse`), or a
   * scene's own (`setSolids`, no track).
   */
  protected course: { ground: Ground; track: Track | null; placed: readonly Placed[] } | null = null;
  /** The course's `courseSolids` (built at its first throw), or the scene's own. */
  protected solids: readonly Solid[] | null = null;
  protected readonly mesh: DummyMesh;
  /** The HUD's Rig and Particles views of the dummies (`set`). */
  readonly debug: RagdollDebug;
  protected readonly onThrow: (car: number) => void;
  /** The look seed (`driverLook`) the engine sets each frame: a driver keeps his tee and hair through a race. */
  lookSeed = 0;
  /** A player's own driver for car `car` (the engine's looks: this browser's, or a netplay peer's), null for a drawn one. */
  lookOf: (car: number) => { person: PersonPick; personSpray: SprayBitmap } | null = () => null;
  /** Each car's driver look as `carDriverLook` last built it, with what it was built from. */
  protected readonly carLooks = new Map<number, { seed: number; person: PersonPick | null; look: DriverLook }>();
  protected purses: Purses | null = null;
  /** The course's or the scene's knockable props: standing fixed on their spots, knocked ones tumbling (`knockProp`); a car's front meets one over its lower box's height. */
  protected readonly props = new PropBodies(knockedGroups, FIXED_GROUPS, GRACE, PROP_BAND_LOW, PROP_BAND_HIGH, (cx, cz, y, half) => this.patchAt(cx, cz, y, half));
  /** The range minigames' cardboard boxes (`setBoxes`): dynamic cuboids in this world, asleep until hit. */
  protected readonly boxes = new BoxPile();
  /** Seconds a thrown dummy lies about (`LIFE`; for ever between `holdThrown` and `releaseThrown`). */
  protected thrownLife = LIFE;
  protected readonly onExit: (at: THREE.Vector3, frame: THREE.Quaternion, inherit: THREE.Vector3) => void;
  protected R: Rapier | null = null;
  protected world: World | null = null;
  /** `world.step()` calls so far and the wall ms of the latest `STEP_LOG` of them (`stats`): what the bench reads, nothing else does. In the worker's world they are the worker's, as it reports them. */
  protected steps = 0;
  protected readonly stepMs = new Float64Array(STEP_LOG);
  protected readonly remoteSize = { colliders: 0, bodies: 0 };
  /** The Rapier world's cost so far (`RagdollStats`): steps run, their ms ring, and how many colliders and bodies the world holds. */
  get stats(): RagdollStats {
    if (this.mode === "remote") return { steps: this.steps, log: this.stepMs, ...this.remoteSize };
    return { steps: this.steps, log: this.stepMs, colliders: this.world?.colliders.len() ?? 0, bodies: this.world?.bodies.len() ?? 0 };
  }

  /** Where this run's dummies are simulated: the worker (`remote`), this thread (`inline`) or not yet chosen (`none`): the bench card says whether the page's worker was in use. */
  get placement(): "remote" | "inline" | "none" {
    return this.mode ?? "none";
  }

  protected readonly dolls: Doll[] = [];
  protected live = 0;
  /** Throws judged before Rapier was in (`PENDING_MAX`). */
  protected readonly pending: Throw[] = [];
  protected readonly next: Throw = { car: 0, p: new THREE.Vector3(), q: new THREE.Quaternion(), v: new THREE.Vector3(), w: new THREE.Vector3(), age: 0, cop: false, rides: true };
  /** Per car, the throw of the driver thrown out of it this run (`launch`) until his passenger is thrown with him (`throwPassenger`): later throws of other cars' drivers do not take it. */
  protected readonly driverThrows: (Throw | undefined)[] = [];
  /** The figure being thrown (`throwFigure`): its own record, not the driver's (`next`). */
  protected readonly figure: Throw = { car: 0, p: new THREE.Vector3(), q: new THREE.Quaternion(), v: new THREE.Vector3(), w: new THREE.Vector3(), age: 0, cop: false, rides: false, purse: false, armsDown: true };
  /** Fixed colliders every dummy shares off a course (pad or disc with its ramps, corkscrew, poles), built at the run's first throw: Rapier's step allocates per collider (0.31 KB, RapierEval). */
  protected readonly statics: Collider[] = [];
  protected disposed = false;
  /** Rapier's load, started once: a second `preload` while it runs (the engine's, a test's) is the same one. */
  protected loading: Promise<void> | null = null;
  /** The world's worker (null: none, or it failed). */
  protected remote: RagdollRemote | null = null;
  /** What this system has posted to its worker (messages, array bytes): the bench reads the difference over its window. */
  readonly traffic: PostTraffic = { messages: 0, bytes: 0 };
  /** Where this run's dummies are, chosen at its first throw or knock (`pick`): this thread's world or the worker's. Null: not yet. */
  protected mode: "inline" | "remote" | null = null;
  /** The course's props as drawn (`setCourse`): where the worker's world has them, `adopt` places them. */
  protected tumble: PropDraw | null = null;
  /** How each throw sent to the worker is dressed, until the worker says which slot it took (`adopt`). */
  protected readonly dressing = new Map<number, Dressing>();
  /** This system is the world's worker's (`host`): it draws nothing and reports the cars it `wanted` cages of. */
  protected hosted = false;
  /** Per car, 1 when a dummy, purse thing or knocked prop may reach it within `FIT_AHEAD` frames (set by `stepWorld` while hosted). */
  readonly wanted = new Uint8Array(MAX_CARS);
  /** Busy frames stepped this run (the world's worker is told its frame's number, `RagdollRemote`'s count): a strike is applied to the cars `LAG` frames after its frame. */
  frameNo = 0;
  /** Panes struck here and not yet applied to the cars (`applyStruck`): the frame struck in, the car, the pane. */
  protected readonly struck: { frame: number; car: number; pane: number }[] = [];
  protected cars: readonly DeformableCar[] = [];
  protected authority = true;
  /** Neither a race nor a derby: only here does `onThrow` fire. */
  protected sandbox = true;
  /** Sim seconds the world has not stepped yet (under a step after each frame), and how far into the next step the draw is; the step of the frame that last stepped (`STEP` with a dummy out, else `PROP_STEP`). */
  protected acc = 0;
  protected step = STEP;
  /** Steps since the first dummy out: every `WATCH_EVERY`th one the skin, spin limit and purses are watched. */
  protected tick = 0;
  protected alpha = 0;
  /** The last frame stepped nothing (`dormant`), so the proxies are where the cars were when it began. */
  protected slept = false;
  /** Each part's velocity at the end of the last step, and a flag (0 none, 1 hit last step, 3 just spawned), 4 numbers per part per slot: `hits`. */
  protected readonly vel = new Float32Array(SLOTS * PARTS.length * 4);
  protected lastSlot = 0;
  /** The cars' proxies in the dummies' world. */
  protected readonly proxies = new CarProxies(this.dolls);
  /** The sim's loose car parts and wheels as kinematic bodies the dummies meet. */
  protected readonly loose = new LooseProxies();
  /** The ride-along camera over the dummies (`follow`, `frameCamera`). */
  protected readonly ride = new RideAlong();
  /** One walker per pool slot: a dummy of the pool (`startWalker`) held up and walked by motors, in this world with the cars and the ground. The player on foot is the one in `WALKER_SLOT`. */
  readonly walkers: readonly Walker[] = Array.from({ length: SLOTS }, () => new Walker());
  /** Where the ground patch under the player's walker is centred (`followWalkerGround`). */
  protected walkerPatchX = 0;
  protected walkerPatchZ = 0;

  /**
   * `onThrow(car)`: a sandbox driver just left car `car` (the engine decides whether the camera follows).
   * `onExit(at, frame, inherit)`: any driver is being thrown; his way out is centred on `at`, `frame`'s z out of the
   * pane, and his car moves at `inherit` (the engine covers it with a burst).
   */
  constructor(scene: THREE.Scene, onThrow: (car: number) => void, onExit: (at: THREE.Vector3, frame: THREE.Quaternion, inherit: THREE.Vector3) => void) {
    this.onThrow = onThrow;
    this.onExit = onExit;
    this.mesh = new DummyMesh(SLOTS, true);
    this.debug = new RagdollDebug(scene, PARTS, JOINTS, SLOTS);
    this.mesh.name = "ragdolls";
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.mesh.frustumCulled = false;
    // Shown only while a dummy is out; the boot warm-up draws hidden meshes too, so its programs link there.
    this.mesh.visible = false;
    scene.add(this.mesh);
  }

  /** A new run: the system implements it; the thrower's `fallBack` calls it. */
  abstract reset(): void;

  /** The world's worker failed: the thrower implements it; `load` hands it to the worker. */
  protected abstract fallBack(err: Error): void;

  protected async load(): Promise<void> {
    if (!this.hosted) this.remote ??= RagdollRemote.open((err) => this.fallBack(err), this.traffic);
    const R = await loadRapier();
    if (this.disposed) return;
    this.R = R;
    const world = new R.World({ x: 0, y: -GRAVITY, z: 0 });
    this.world = world;
    world.timestep = STEP;
    world.numSolverIterations = ITERATIONS;
    world.integrationParameters.numInternalPgsIterations = INTERNAL_PASSES;
    this.proxies.load(R, world);
    this.loose.load(R, world);
    for (let s = 0; s < SLOTS; s++) {
      const bodies = PARTS.map((p, k) => {
        const body = world.createRigidBody(
          R.RigidBodyDesc.dynamic().setTranslation(p.c[0], p.c[1] - 200, p.c[2]).setLinearDamping(AIR_LINEAR).setAngularDamping(AIR_ANGULAR).setEnabled(false),
        );
        world.createCollider(
          R.ColliderDesc.cuboid(p.h[0], p.h[1], p.h[2])
            .setDensity(partDensity(k))
            .setFriction(SLIDE)
            .setFrictionCombineRule(R.CoefficientCombineRule.Min)
            .setRestitution(0)
            .setRestitutionCombineRule(R.CoefficientCombineRule.Min)
            .setCollisionGroups(dollGroups(s)),
          body,
        );
        return body;
      });
      const joints = joinUp(R, world, bodies);
      this.dolls.push({ bodies, joints, loose: false, braced: false, live: false, age: 0, life: LIFE, still: 0, patch: [], car: -1, rides: false, prev: new Float32Array(PARTS.length * 7), cur: new Float32Array(PARTS.length * 7), ground: false, settled: false, calm: 0, speed: 0, vel: new Float32Array(3), driven: false });
    }
    // A child of the dummies' mesh, so the scene root keeps its one `ragdolls` child and the props draw only while a dummy is out.
    this.mesh.add((this.purses = this.proxies.purses = new Purses(R, world, SLOTS, propGroups, GRACE)).mesh);
    this.props.load(R, world);
    this.boxes.load(R, world);
    // One step with a dummy out, far below the world: links the step path before a crash needs it.
    const d = this.dolls[0]!;
    for (const b of d.bodies) b.setEnabled(true);
    world.step();
    for (const b of d.bodies) disable(b);
  }

  /** Part `k` of `d` as drawn: `alpha` of the way from its pose one step before the last to the last. */
  protected blend(d: Doll, k: number, p: THREE.Vector3, q: THREE.Quaternion): void {
    blendPose(d.prev, d.cur, 7 * k, this.alpha, p, q);
  }

  protected capture(d: Doll, into: Float32Array): void {
    for (let k = 0; k < PARTS.length; k++) readPose(d.bodies[k]!, into, 7 * k);
  }

  /** How throw `t` is dressed: `dressed`, else the look of his own (`t.look`), else his car's driver's (`carDriverLook`) with a player's own spray. */
  protected dressingOf(t: Throw, dressed: DriverLook | null): { look: DriverLook; spray: SprayBitmap | null } {
    const given = dressed ?? t.look ?? null;
    if (given) return { look: given, spray: null };
    return { look: this.carDriverLook(t.car, t.cop), spray: (t.cop ? null : this.lookOf(t.car))?.personSpray ?? null };
  }

  /** Car `car`'s driver as he sits in it and is thrown from it: a player's own look when his car is a player's (`ownLook`, the same in every scene and seed), else the seed's drawn one; a cop wears the uniform over the drawn one. Kept per car while its seed and pick stand (picks are replaced, never mutated): the seated drivers ask every frame. */
  carDriverLook(car: number, cop: boolean): DriverLook {
    const person = (cop ? null : this.lookOf(car))?.person ?? null;
    const kept = this.carLooks.get(car);
    if (kept && kept.seed === this.lookSeed && kept.person === person) return kept.look;
    const look = person ? ownLook(person) : driverLook(this.lookSeed, car);
    this.carLooks.set(car, { seed: this.lookSeed, person, look });
    return look;
  }

  /**
   * A dummy of the scene's own, with no car (the Lab's, the showcase's): torso at `p` turned `q` (standing upright at identity, arms up),
   * moving at `v` and spinning at `w` (world), lying about `life` sim s, in slot `slot` (-1: a free one, else the oldest). With a `dress`
   * he is a figure thrown standing, as `throwFigure` throws one: arms hanging, in that dress.
   * Nobody is thrown: no exit, no throw hook, no ride-along. Returns his slot; -1 while Rapier is still loading.
   */
  place(p: THREE.Vector3, q: THREE.Quaternion, v: THREE.Vector3, w: THREE.Vector3, life: number, slot: number, dress?: { cop: boolean; look: DriverLook }): number {
    if (!this.world) return -1;
    const t = dress ? this.figure : this.next;
    t.p.copy(p);
    t.q.copy(q);
    t.v.copy(v);
    t.w.copy(w);
    t.car = -1;
    t.age = 0;
    t.cop = dress?.cop ?? false;
    t.look = dress?.look;
    t.rides = false;
    t.loose = false;
    return this.spawn(t, slot, life);
  }

  /** Slot `s`'s torso centre after the last step into `p`, and its velocity (world) into `v` unless null; false while no dummy is out in it. */
  torso(s: number, p: THREE.Vector3, v: THREE.Vector3 | null): boolean {
    const d = this.dolls[s];
    if (!d?.live) return false;
    p.set(d.cur[0]!, d.cur[1]!, d.cur[2]!);
    if (v) {
      const u = d.bodies[0]!.linvel();
      v.set(u.x, u.y, u.z);
    }
    return true;
  }

  /** Slot `s`'s dummy leaves from where he is, turned as he is, moving at `v` (world) and spinning at none. */
  leave(s: number, v: THREE.Vector3): void {
    const d = this.dolls[s];
    if (!d?.live) return;
    this.place(_p.set(d.cur[0]!, d.cur[1]!, d.cur[2]!), _q.set(d.cur[3]!, d.cur[4]!, d.cur[5]!, d.cur[6]!), v, _w.set(0, 0, 0), Infinity, s);
  }

  /** The dummies' instanced mesh: what a press picks a dummy from (its instance is his pool slot). */
  get pickMesh(): DummyMesh {
    return this.mesh;
  }

  /** The player on foot: his walker. */
  get walker(): Walker {
    return this.walkers[WALKER_SLOT]!;
  }

  /** The first slot no dummy is out in, or -1. */
  freeSlot(): number {
    return this.dolls.findIndex((d) => !d.live);
  }

  /** Throw `t`'s dummy into slot `at` (-1: a free slot, else the oldest one's), to lie about `life` sim s, in `dressed` (none: his car's driver's look); returns the slot. */
  spawn(t: Throw, at = -1, life = this.thrownLife, dressed: DriverLook | null = null): number {
    let slot = at >= 0 ? at : this.dolls.findIndex((d) => !d.live);
    if (slot < 0) slot = this.dolls.reduce((o, d, s) => (!d.driven && (this.dolls[o]!.driven || d.age > this.dolls[o]!.age) ? s : o), 0);
    this.despawn(slot);
    const d = this.dolls[slot]!;
    const t0 = PARTS[0]!.c;
    const groups = thrownGroups(slot, t.car);
    for (let k = 0; k < PARTS.length; k++) {
      const b = d.bodies[k]!;
      const c = PARTS[k]!.c;
      // A raised arm is the hanging one turned over about its shoulder.
      const y = ARM(k) && !t.armsDown ? 2 * SHOULDER_Y - c[1] : c[1];
      _r.set(c[0] - t0[0], y - t0[1], c[2] - t0[2]).applyQuaternion(t.q);
      _v.x = t.p.x + _r.x;
      _v.y = t.p.y + _r.y;
      _v.z = t.p.z + _r.z;
      b.setTranslation(_v, false);
      _qx.copy(t.q);
      if (ARM(k) && !t.armsDown) _qx.multiply(_arm);
      b.setRotation(_qx, false);
      // Rigid motion: v + ω × r.
      _s.copy(t.w).cross(_r);
      _v.x = t.v.x + _s.x;
      _v.y = t.v.y + _s.y;
      _v.z = t.v.z + _s.z;
      b.setLinvel(_v, false);
      _v.x = t.w.x;
      _v.y = t.w.y;
      _v.z = t.w.z;
      b.setAngvel(_v, false);
      b.collider(0).setCollisionGroups(groups);
      b.setEnabled(true);
      b.wakeUp();
    }
    if (t.loose) {
      limp(d.bodies, _w.set(1, 0, 0).applyQuaternion(t.q));
      loosen(this.world!, d.joints);
      brace(this.world!, d.joints, true);
    } else if (d.loose) {
      for (const joint of d.joints) this.world!.removeImpulseJoint(joint, false);
      d.joints = joinUp(this.R!, this.world!, d.bodies);
    }
    d.braced = t.loose === true;
    d.loose = t.loose === true;
    const speed = hypot2(t.v.x, t.v.z);
    this.buildPatch(d, t.p.x + (speed > 0.5 ? (t.v.x / speed) * PATCH_AHEAD : 0), t.p.z + (speed > 0.5 ? (t.v.z / speed) * PATCH_AHEAD : 0), t.p.y);
    d.live = true;
    d.age = 0;
    d.life = life;
    d.still = 0;
    d.car = t.car;
    d.rides = t.rides;
    d.calm = 0;
    d.speed = hypot3(t.v.x, t.v.y, t.v.z);
    d.vel[0] = t.v.x;
    d.vel[1] = t.v.y;
    d.vel[2] = t.v.z;
    this.proxies.release(slot);
    for (let k = 0; k < PARTS.length; k++) this.vel[(slot * PARTS.length + k) * 4 + 3] = 3;
    if (d.ground) {
      d.ground = false;
      d.settled = false;
      for (const b of d.bodies) {
        b.setLinearDamping(AIR_LINEAR);
        b.setAngularDamping(AIR_ANGULAR);
      }
    }
    // The pose one step before the release, along his launch motion: from the first frame he is drawn moving out of the
    // pane, one step behind the sim as on every later frame, not held at it until his first step (4 frames at 0.03× and
    // 60 Hz, 16 at 240).
    this.capture(d, d.cur);
    const spin = t.w.length();
    _qx.setFromAxisAngle(spin > 0 ? _s.copy(t.w).divideScalar(spin) : Y, -spin * STEP);
    for (let k = 0; k < PARTS.length; k++) {
      const v = d.bodies[k]!.linvel();
      const o = 7 * k;
      d.prev[o] = d.cur[o]! - v.x * STEP;
      d.prev[o + 1] = d.cur[o + 1]! - v.y * STEP;
      d.prev[o + 2] = d.cur[o + 2]! - v.z * STEP;
      _qb.set(d.cur[o + 3]!, d.cur[o + 4]!, d.cur[o + 5]!, d.cur[o + 6]!).premultiply(_qx);
      d.prev[o + 3] = _qb.x;
      d.prev[o + 4] = _qb.y;
      d.prev[o + 5] = _qb.z;
      d.prev[o + 6] = _qb.w;
    }
    const { look, spray } = this.dressingOf(t, dressed);
    this.mesh.dress(slot, t.cop, look);
    this.mesh.spray(slot, spray);
    if (t.purse ?? (look.woman && !t.cop)) this.purses?.launch(slot, t.car, t.p, t.v, this.lookSeed);
    this.wake();
    this.live++;
    this.lastSlot = slot;
    this.mesh.visible = true;
    this.ride.exit(t.car, hypot2(t.v.x, t.v.z), t.p);
    if (this.sandbox && t.car >= 0) this.onThrow(t.car);
    return slot;
  }

  /** Nothing was out: the stepping starts afresh (no leftover from an earlier throw shifts the first step) and the proxies jump to the cars. */
  protected wake(): void {
    if (this.live > 0 || this.props.count > 0) return;
    this.acc = this.tick = 0;
    this.proxies.teleport = true;
  }

  /** The ground under a throw (`groundColliders`): the active surface's solids (pad, disc and ramps, corkscrew) built once, its terrain's heightfield patch per dummy on a course or a scene's solids. */
  protected buildPatch(d: Doll, cx: number, cz: number, y: number): void {
    const c = this.course;
    if (c !== null && activeGround() === c.ground) d.patch.push(...this.patchAt(cx, cz, y, PATCH_HALF));
    else this.buildStatics(cx, cz, y, PATCH_HALF);
  }

  /** The run's fixed colliders off a course, built once round (`cx`, `cz`): the first dummy of the run builds them. */
  protected buildStatics(cx: number, cz: number, y: number, half: number): void {
    if (this.statics.length === 0) this.statics.push(...groundColliders(this.R!, this.world!, FIXED_GROUPS, null, this.poles, cx, cz, y, half));
  }

  /** The course's or the scene's ground, walls and solids `half` m around (`cx`, `cz`) at height `y` (`groundColliders`): a dummy's patch, or knocked props'. */
  protected patchAt(cx: number, cz: number, y: number, half: number): Collider[] {
    const c = this.course!;
    if (c.track) this.solids ??= courseSolids(c.track, c.placed);
    return groundColliders(this.R!, this.world!, FIXED_GROUPS, { track: c.track, solids: this.solids! }, this.poles, cx, cz, y, half);
  }

  protected despawn(s: number): void {
    const d = this.dolls[s]!;
    if (d.driven) this.walkers[s]!.detach();
    if (d.live) this.live--;
    d.live = false;
    for (const b of d.bodies) disable(b);
    for (const c of d.patch) this.world!.removeCollider(c, false);
    d.patch.length = 0;
    this.mesh.hide(s);
    this.purses?.clear(s);
    this.debug.hide(s);
    if (this.live === 0) this.mesh.visible = false;
  }
}
