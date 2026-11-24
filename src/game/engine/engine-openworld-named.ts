import * as THREE from "three";
import type { CrowdPoses } from "../ai/civilians/crowd-poses.ts";
import type { LookRay } from "../ai/civilians/civilian-look.ts";
import { FOOT_COP_COUNT } from "../ai/openworld-crime/crime-constants.ts";
import { hypot2, hypot3 } from "../kernel/physics-core.js";
import { BODY_KIND, type BodyMotion } from "../net/body-codec.ts";
import { NAMED, type Named } from "../net/act-codec.ts";
import { MAX_CARS } from "../scenes/fleet.ts";
import type { DeformableCar } from "../vehicle/car.ts";
import { activeGround } from "../world/ground.ts";
import type { OpenWorldBodies } from "./openworld-bodies.ts";
import { DRAWN, type OpenWorldShared } from "./openworld-shared.ts";
import { idOf, kindOf, personOf } from "./people-index.ts";

/** The oldest honest view a guest aims by: the interpolation delay, a 15 Hz foot message and 0.15 s of link, plus the act's own 0.15 s flight. */
const NAMED_AGE_S = 0.5;
/** A person's body radius about her origin (m), the height her offset may reach (m) and the lowest (m). */
const PERSON_RADIUS_M = 0.5;
const PERSON_TOP_M = 2.2;
const PERSON_LOW_M = -0.3;
/** The most a walker gains speed (m/s²): the push up to a run (`ACCEL_TO_RUN`, walker-locomotion.ts). */
const PERSON_ACCEL = 12;
/** The most a car gains speed (m/s²): the hardest launch of any class (20.4, vehicle-classes.ts) times the boost's acceleration (1.55). */
const CAR_ACCEL = 32;
/** How far (m) a car's surface lies from its origin (the guest's pre-filter sphere), and its size in the window (m). */
const CAR_REACH_M = 4;
const CAR_SIZE_M = 2.5;
/** The host holds a named car's offset to the car's own box grown by this much (m) on each axis. */
const CAR_BOX_SLACK_M = 0.3;
/** A shot re-aimed at a named thing flies this far past the point (m): a car's box holds air over the hood, a person's chest is 0.35 m round. */
const CAR_SLACK_M = 0.5;
const PERSON_SLACK_M = 0.35;

/** A named thing as the host places it: the world point, the thing's own speed (m/s), whether it can speed up (a driver, or a person), and how far past the point a shot aimed at it may fly (m). */
export type Placed = { x: number; y: number; z: number; speed: number; driven: boolean; slack: number };

const _spot = { x: 0, z: 0, speed: 0 };
const _motion: BodyMotion = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, heading: 0, posture: 0 };
const _foot = { x: 0, z: 0, velocityX: 0, velocityZ: 0 };
const _place = { x: 0, y: 0, z: 0, heading: 0, velocityX: 0, velocityZ: 0 };
const _v = new THREE.Vector3();
const _q = new THREE.Quaternion();

/** Whether `named` kind's offset (x, y, z) lies within that kind of thing: a person's cylinder, a car's sphere (the guest's pre-filter; the host holds a car to its own box, `inCarBox`). */
export function namedFits(kind: number, x: number, y: number, z: number): boolean {
  if (kind === NAMED.car) return hypot3(x, y, z) <= CAR_REACH_M;
  return kind !== NAMED.nothing && hypot2(x, z) <= PERSON_RADIUS_M && y >= PERSON_LOW_M && y <= PERSON_TOP_M;
}

/** Whether the offset (x, y, z) in `car`'s frame lies in its own body box: `CAR_BOX_SLACK_M` past its half extents about the box's middle, which is on the ground under the origin's level: x and z at the origin, y at the half height (`car-rig.ts`: the origin is on the ground under the body's middle; the frame's `centre` is the centre of mass, not the box's). */
function inCarBox(car: DeformableCar, x: number, y: number, z: number): boolean {
  const { half } = car.frame;
  return Math.abs(x) <= half.x + CAR_BOX_SLACK_M && Math.abs(y - half.y) <= half.y + CAR_BOX_SLACK_M && Math.abs(z) <= half.z + CAR_BOX_SLACK_M;
}

/** How far (m) a named thing may stand from the line a guest aimed along: what it moves in the oldest honest view at its own present `speed`, what it can have gained if it has a driver (`driven`: a person always has), and its size. */
export function namedReach(kind: number, speed: number, driven: boolean): number {
  const car = kind === NAMED.car;
  const gained = driven ? 0.5 * (car ? CAR_ACCEL : PERSON_ACCEL) * NAMED_AGE_S * NAMED_AGE_S : 0;
  return speed * NAMED_AGE_S + gained + (car ? CAR_SIZE_M : PERSON_RADIUS_M);
}

/** What the picks of a look along a ray hold, as the director fills them. */
type Pick = { along: number; x: number; y: number; z: number };

/** What naming reads of the engine. */
type NamedWorld = {
  crowd(): CrowdPoses | null;
  cops(): CrowdPoses | null;
  bodies(): OpenWorldBodies | null;
  shared(): OpenWorldShared | null;
  ownCar(): number;
  ownFoot(out: typeof _foot): boolean;
  playerPlace(actor: number, out: typeof _place): boolean;
  cars(): readonly DeformableCar[];
  /** Whether car `id` has nobody in it: the traffic parks it, or it stands at a kerb. */
  carEmpty(id: number, car: DeformableCar): boolean;
  /** How fast the host has seen player `actor` move, from where his records put him (not the speed he reports). */
  playerSpeed(actor: number): number;
  doll: Pick & { slot: number };
  car: Pick & { car: number };
  person: { along: number; index: number };
  cop: { along: number; index: number };
};

/** A guest names what its aim ray met, and the host finds that thing where it stands now: the same thing, whichever machine draws it. */
export class NamedThings {
  private readonly world: NamedWorld;

  constructor(world: NamedWorld) {
    this.world = world;
  }

  /** Where person `person` (`people-index`) stands on this machine and how fast she moves, into `_spot`: her body's torso, else where she is drawn, else the table of her kind. */
  private personAt(person: number): boolean {
    const table = this.world.crowd();
    if (table === null) return false;
    const body = this.world.bodies();
    if (body !== null && body.motionOf(person, _motion)) {
      _spot.x = _motion.x;
      _spot.z = _motion.z;
      _spot.speed = hypot2(_motion.vx, _motion.vz);
      return true;
    }
    _spot.speed = 0;
    const drawn = this.world.shared();
    if (drawn !== null && drawn.drawnAt(person, _spot) !== DRAWN.none) return true;
    const kind = kindOf(person, table.count);
    const id = idOf(person, table.count);
    if (kind === BODY_KIND.player) return this.playerAt(id);
    const rows = kind === BODY_KIND.civilian ? table : this.world.cops();
    if (rows === null || rows.shown[id] === 0) return false;
    _spot.x = rows.x[id]!;
    _spot.z = rows.z[id]!;
    _spot.speed = rows.speed[id]!;
    return true;
  }

  /** Player `actor`'s torso (x, z) and speed into `_spot`: this machine's own player on foot, or another as his record has him. */
  private playerAt(actor: number): boolean {
    const world = this.world;
    if (actor === world.ownCar()) {
      if (!world.ownFoot(_foot)) return false;
      _spot.x = _foot.x;
      _spot.z = _foot.z;
      _spot.speed = hypot2(_foot.velocityX, _foot.velocityZ);
      return true;
    }
    if (!world.playerPlace(actor, _place)) return false;
    _spot.x = _place.x;
    _spot.z = _place.z;
    _spot.speed = hypot2(_place.velocityX, _place.velocityZ);
    return true;
  }

  /** The hit point (x, y, z) on person `person` as an offset from her origin (`_spot` below the feet's ground) into `out`; nothing when she is none of ours or the offset is past her. */
  private namePerson(person: number, x: number, y: number, z: number, out: Named): void {
    const table = this.world.crowd();
    if (table === null || person < 0 || !this.personAt(person)) return;
    const kind = kindOf(person, table.count);
    const named = kind === BODY_KIND.civilian ? NAMED.civilian : kind === BODY_KIND.cop ? NAMED.cop : kind === BODY_KIND.player ? NAMED.player : NAMED.nothing;
    const dx = x - _spot.x;
    const dy = y - activeGround().heightAt(_spot.x, _spot.z);
    const dz = z - _spot.z;
    if (!namedFits(named, dx, dy, dz)) return;
    out.kind = named;
    out.id = idOf(person, table.count);
    out.x = dx;
    out.y = dy;
    out.z = dz;
  }

  /** What the look along `ray` (reach `reach`, its nearest pick `nearest`) first met, into `out`: the pick the shot would take, in the shot's order. */
  name(nearest: number, reach: number, ray: LookRay, out: Named): void {
    out.kind = NAMED.nothing;
    const world = this.world;
    const table = world.crowd();
    if (nearest >= reach || table === null) return;
    if (world.doll.along === nearest) {
      this.namePerson(world.bodies()?.personOfSlot(world.doll.slot) ?? -1, world.doll.x, world.doll.y, world.doll.z, out);
    } else if (world.person.along === nearest) {
      this.namePerson(world.person.index, ray.eyeX + ray.dirX * nearest, ray.eyeY + ray.dirY * nearest, ray.eyeZ + ray.dirZ * nearest, out);
    } else if (world.cop.along === nearest) {
      this.namePerson(personOf(BODY_KIND.cop, world.cop.index, table.count), ray.eyeX + ray.dirX * nearest, ray.eyeY + ray.dirY * nearest, ray.eyeZ + ray.dirZ * nearest, out);
    } else this.nameCar(out);
  }

  /** The car of the pick, its hit point in the car's own frame. */
  private nameCar(out: Named): void {
    const pick = this.world.car;
    const car = this.world.cars()[pick.car];
    if (car === undefined) return;
    _v.set(pick.x, pick.y, pick.z).sub(car.group.position).applyQuaternion(_q.copy(car.group.quaternion).invert());
    if (!namedFits(NAMED.car, _v.x, _v.y, _v.z)) return;
    out.kind = NAMED.car;
    out.id = pick.car;
    out.x = _v.x;
    out.y = _v.y;
    out.z = _v.z;
  }

  /** The hook's reticle lit civilian `civilian` (-1: none) or the dummy in pool slot `slot` (-1: none) at (x, y, z): the person named, nothing when it is neither. */
  nameHook(civilian: number, slot: number, x: number, y: number, z: number, out: Named): void {
    out.kind = NAMED.nothing;
    this.namePerson(civilian >= 0 ? civilian : (this.world.bodies()?.personOfSlot(slot) ?? -1), x, y, z, out);
  }

  /** The world point of named thing (`kind`, `id`) plus its offset (ox, oy, oz) as this machine has it now, and the thing's own speed, into `out`; false when it is not there (no such index, not shown), or a car's offset lies outside that car's own box. */
  place(kind: number, id: number, ox: number, oy: number, oz: number, out: Placed): boolean {
    const world = this.world;
    if (kind === NAMED.car) {
      const car = id < MAX_CARS ? world.cars()[id] : undefined;
      if (car === undefined || car.stored || !inCarBox(car, ox, oy, oz)) return false;
      _v.set(ox, oy, oz).applyQuaternion(car.group.quaternion).add(car.group.position);
      out.x = _v.x;
      out.y = _v.y;
      out.z = _v.z;
      out.speed = hypot3(car.velocity.x, car.velocity.y, car.velocity.z);
      out.driven = !world.carEmpty(id, car);
      out.slack = CAR_SLACK_M;
      return true;
    }
    const table = world.crowd();
    if (table === null) return false;
    const person = kind === NAMED.civilian && id < table.count ? id : kind === NAMED.cop && id < FOOT_COP_COUNT ? personOf(BODY_KIND.cop, id, table.count) : kind === NAMED.player && id < MAX_CARS ? personOf(BODY_KIND.player, id, table.count) : -1;
    if (person < 0 || !this.personAt(person)) return false;
    out.x = _spot.x + ox;
    out.y = activeGround().heightAt(_spot.x, _spot.z) + oy;
    out.z = _spot.z + oz;
    out.speed = kind === NAMED.player && id !== world.ownCar() ? world.playerSpeed(id) : _spot.speed;
    out.driven = true;
    out.slack = PERSON_SLACK_M;
    return true;
  }
}
