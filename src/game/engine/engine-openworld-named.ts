import * as THREE from "three";
import type { CrowdPoses } from "../ai/civilians/crowd-poses.ts";
import type { LookRay } from "../ai/civilians/civilian-look.ts";
import { FOOT_COP_COUNT } from "../ai/openworld-crime/crime-constants.ts";
import { hypot2, hypot3 } from "../kernel/physics-core.js";
import { BODY_KIND } from "../net/body-codec.ts";
import { NAMED, type Named } from "../net/act-codec.ts";
import { SPRINT_SPEED } from "../present/walker-locomotion.ts";
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
/** A walker cannot outrun a sprint (m/s). */
const PERSON_TOP_MPS = SPRINT_SPEED;
/** A car on the open world's streets: twice the 20 m/s it was measured crossing at (m/s); how far from its origin its surface lies (m). */
const CAR_TOP_MPS = 40;
const CAR_REACH_M = 4;

const _spot = { x: 0, z: 0 };
const _foot = { x: 0, z: 0, velocityX: 0, velocityZ: 0 };
const _place = { x: 0, y: 0, z: 0, heading: 0, velocityX: 0, velocityZ: 0 };
const _v = new THREE.Vector3();
const _q = new THREE.Quaternion();

/** Whether `named` kind's offset (x, y, z) lies within that kind of thing. */
export function namedFits(kind: number, x: number, y: number, z: number): boolean {
  if (kind === NAMED.car) return hypot3(x, y, z) <= CAR_REACH_M;
  return kind !== NAMED.nothing && hypot2(x, z) <= PERSON_RADIUS_M && y >= PERSON_LOW_M && y <= PERSON_TOP_M;
}

/** How far (m) a named thing may stand from the line a guest aimed along: what it moves in the oldest honest view, and its radius. */
export function namedReach(kind: number): number {
  return kind === NAMED.car ? CAR_TOP_MPS * NAMED_AGE_S + CAR_REACH_M : PERSON_TOP_MPS * NAMED_AGE_S + PERSON_RADIUS_M;
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

  /** Where person `person` (`people-index`) stands on this machine, into `_spot`: her body's torso, else where she is drawn, else the table of her kind. */
  private personAt(person: number): boolean {
    const table = this.world.crowd();
    if (table === null) return false;
    const body = this.world.bodies();
    if (body !== null && body.torsoOf(person, _spot)) return true;
    const drawn = this.world.shared();
    if (drawn !== null && drawn.drawnAt(person, _spot) !== DRAWN.none) return true;
    const kind = kindOf(person, table.count);
    const id = idOf(person, table.count);
    if (kind === BODY_KIND.player) return this.playerAt(id);
    const rows = kind === BODY_KIND.civilian ? table : this.world.cops();
    if (rows === null || rows.shown[id] === 0) return false;
    _spot.x = rows.x[id]!;
    _spot.z = rows.z[id]!;
    return true;
  }

  /** Player `actor`'s torso (x, z) into `_spot`: this machine's own player on foot, or another as his record has him. */
  private playerAt(actor: number): boolean {
    const world = this.world;
    if (actor === world.ownCar()) {
      if (!world.ownFoot(_foot)) return false;
      _spot.x = _foot.x;
      _spot.z = _foot.z;
      return true;
    }
    if (!world.playerPlace(actor, _place)) return false;
    _spot.x = _place.x;
    _spot.z = _place.z;
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

  /** The world point of named thing (`kind`, `id`) plus its offset (ox, oy, oz) as this machine has it now, into `out`; false when it is not there (no such index, not shown). */
  place(kind: number, id: number, ox: number, oy: number, oz: number, out: { x: number; y: number; z: number }): boolean {
    const world = this.world;
    if (kind === NAMED.car) {
      const car = id < MAX_CARS ? world.cars()[id] : undefined;
      if (car === undefined || car.stored) return false;
      _v.set(ox, oy, oz).applyQuaternion(car.group.quaternion).add(car.group.position);
      out.x = _v.x;
      out.y = _v.y;
      out.z = _v.z;
      return true;
    }
    const table = world.crowd();
    if (table === null) return false;
    const person = kind === NAMED.civilian && id < table.count ? id : kind === NAMED.cop && id < FOOT_COP_COUNT ? personOf(BODY_KIND.cop, id, table.count) : kind === NAMED.player && id < MAX_CARS ? personOf(BODY_KIND.player, id, table.count) : -1;
    if (person < 0 || !this.personAt(person)) return false;
    out.x = _spot.x + ox;
    out.y = activeGround().heightAt(_spot.x, _spot.z) + oy;
    out.z = _spot.z + oz;
    return true;
  }
}
