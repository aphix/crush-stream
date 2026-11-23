import { punchGap } from "../ai/civilians/civilian-contact.ts";
import { PLAYER_KO_BLOWS, PLAYER_KO_WINDOW, PLAYER_PUNCH_COOLDOWN } from "../ai/civilians/civilian-constants.ts";
import { LookRay } from "../ai/civilians/civilian-look.ts";
import { detCos, detSin, hypot2, hypot3 } from "../kernel/physics-core.js";
import { ACT, ACT_KINDS, type Act } from "../net/act-codec.ts";
import { MAX_CARS } from "../scenes/fleet.ts";
import { gunAt, slotOfGun, STRAIGHT_UP, type Gun } from "./engine-onfoot-arms.ts";

/** Where an actor stands on foot: his torso (m) and the way he faces (rad, `atan2(x, z)`). */
export type ActorPlace = { x: number; y: number; z: number; heading: number };

/** Actors are car indexes. */
const MAX_ACTORS = MAX_CARS;
/** A punch's eye is his torso: an act whose eye is farther than this from it (m) is not his. */
const ACT_EYE_REACH = 4;
/** The aim ray of a shot passes his torso this near (m): the on-foot camera looks at a point 0.55 m over his torso, shifted 0.5 m across by the shoulder and 0.45 m more by the aim (`PIVOT_OVER_TORSO`, `SHOULDER_ACROSS`, `AIM_SIDE`, `AIM_UP`), so at most 1.2 m from it; the margin is for his moving on. A far camera (the wheel's 32 m, a sprint's longer boom) is on this line, so it gains no reach. */
const SHOT_RAY_REACH = 1.5;
/** Network jitter bunches honest acts, so an actor's acts of one kind may run this far (s) ahead of the gun's own rate, and no further: a faster stream than the gun's is refused. */
const ACT_BACKLOG_S = 0.5;
/** Each act spends this share of its cooldown: a little under the gun's own rate, so honest timing noise is not refused. */
const ACT_COOLDOWN_SHARE = 0.9;
/** A guest does not know what its shot met: its tracer runs this far (m). */
const GUEST_TRACER_M = 60;
/** A direction the host reads must be a unit vector to within this. */
const UNIT_SLACK = 0.05;
/** The level part of a punch's direction must be at least this long. */
const LEVEL_PUNCH = 0.9;
/** Multiplier that gives every actor his own scatter stream; actor 0's stream starts at 1. */
const STREAM_STEP = 0x9e3779b1;
const LCG_MUL = 1664525;
const LCG_ADD = 1013904223;
const U32 = 4294967296;

const _place: ActorPlace = { x: 0, y: 0, z: 0, heading: 0 };
const _aim = new LookRay();
const _ray = new LookRay();
const _near = new LookRay();

/** What the director resolves at the authority for an actor. */
type ActResolver = {
  punch(actor: number, x: number, z: number, dirX: number, dirZ: number): void;
  shoot(actor: number, ray: LookRay, gun: Gun): number;
  shotFired(): void;
};

/** What the acts need of the engine. */
type ActPorts = {
  /** Where actor `actor` stands on foot, into `out`; false when he is not on foot. */
  actorPlace(actor: number, out: ActorPlace): boolean;
  /** The wall clock (s). */
  now(): number;
  /** This machine's own player's actor. */
  self(): number;
  /** This machine is a guest: it sends its acts to the host instead of resolving them. */
  guest(): boolean;
  /** The guest's way to the host: `NetPlay.sendAct`. */
  sendAct(kind: number, arg: number, eye: { x: number; y: number; z: number }, dir: { x: number; y: number; z: number }): void;
};

/** What a blow on another player does where his body is (`strikeActor`) and the crowd of actors there are. */
type PlayerBlowPorts = {
  actorPlace(actor: number, out: ActorPlace): boolean;
  /** The cars of the field: car indexes `0 .. cars().length - 1` may be players. */
  cars(): readonly unknown[];
  /** Player `victim` takes a punch along (dirX, dirZ); `knockedOut`: it is the blow that fells him. */
  strikeActor(victim: number, dirX: number, dirZ: number, knockedOut: boolean): void;
};

/** Punches on other players: the nearest one in reach and arc takes it, and his third inside `PLAYER_KO_WINDOW` s fells him as a civilian's does. */
export class PlayerBlows {
  private readonly ports: PlayerBlowPorts;
  private readonly count = new Uint8Array(MAX_ACTORS);
  private readonly at = new Float64Array(MAX_ACTORS).fill(-Infinity);
  private readonly place: ActorPlace = { x: 0, y: 0, z: 0, heading: 0 };

  constructor(ports: PlayerBlowPorts) {
    this.ports = ports;
  }

  /** A punch from `attacker` at (x, z) along the unit (dirX, dirZ) at `now` crowd seconds: true when another player took it. */
  punch(attacker: number, x: number, z: number, dirX: number, dirZ: number, now: number): boolean {
    let victim = -1;
    let nearest = Infinity;
    const actors = Math.min(this.ports.cars().length, MAX_ACTORS);
    for (let actor = 0; actor < actors; actor++) {
      if (actor === attacker || !this.ports.actorPlace(actor, this.place)) continue;
      const gap = punchGap(x, z, dirX, dirZ, this.place.x, this.place.z);
      if (gap < 0 || gap >= nearest) continue;
      nearest = gap;
      victim = actor;
    }
    if (victim < 0) return false;
    if (now - this.at[victim]! > PLAYER_KO_WINDOW) this.count[victim] = 0;
    this.at[victim] = now;
    const knockedOut = ++this.count[victim]! >= PLAYER_KO_BLOWS;
    if (knockedOut) this.count[victim] = 0;
    this.ports.strikeActor(victim, dirX, dirZ, knockedOut);
    return true;
  }
}

/**
 * What every player on foot does at the host: the dispatcher of `MSG.act` (`hear`), the one punch and the one shot function for any actor
 * (`punchBy`, `shootBy`; the host's own player calls the same ones), and a guest's side of them (`punchLanded`, `shootLocal`).
 */
export class OpenWorldActs {
  private readonly ports: ActPorts;
  private readonly resolver: ActResolver;
  private readonly streams = new Uint32Array(MAX_ACTORS);
  /** Per actor and act kind, the time (s) his acts so far have used the gun's rate up to. */
  private readonly busyUntil = new Float64Array(MAX_ACTORS * ACT_KINDS);
  private readonly eye = { x: 0, y: 0, z: 0 };
  private readonly dir = { x: 0, y: 0, z: 0 };

  constructor(ports: ActPorts, resolver: ActResolver) {
    this.ports = ports;
    this.resolver = resolver;
    for (let actor = 0; actor < MAX_ACTORS; actor++) this.streams[actor] = (Math.imul(actor, STREAM_STEP) + 1) >>> 0;
  }

  /** A guest's act reached the host: carried out when it could be real, else refused and nothing happens. */
  hear(actor: number, act: Act): void {
    if (actor < 0 || actor >= MAX_ACTORS) return;
    if (act.kind === ACT.punch) {
      const level = hypot2(act.dirX, act.dirZ);
      if (level < LEVEL_PUNCH || level > 1 + UNIT_SLACK || !this.admit(actor, act, PLAYER_PUNCH_COOLDOWN, 0, ACT_EYE_REACH)) return;
      this.punchBy(actor, act.dirX / level, act.dirZ / level);
      return;
    }
    if (act.kind !== ACT.shot) return;
    const gun = gunAt(act.arg);
    const length = hypot3(act.dirX, act.dirY, act.dirZ);
    if (gun === null || Math.abs(length - 1) > UNIT_SLACK || !this.admit(actor, act, gun.every, ACT_BACKLOG_S, Infinity)) return;
    _aim.eyeX = act.eyeX;
    _aim.eyeY = act.eyeY;
    _aim.eyeZ = act.eyeZ;
    _aim.dirX = act.dirX / length;
    _aim.dirY = act.dirY / length;
    _aim.dirZ = act.dirZ / length;
    this.shootBy(actor, _aim, gun);
  }

  /** On foot, the eye within `eyeReach` of his torso, and his acts of this kind no more than `backlog` s ahead of the rate `cooldown` sets (a punch has no backlog: a bunched one is not a second). */
  private admit(actor: number, act: Act, cooldown: number, backlog: number, eyeReach: number): boolean {
    if (!this.ports.actorPlace(actor, _place)) return false;
    if (hypot3(act.eyeX - _place.x, act.eyeY - _place.y, act.eyeZ - _place.z) > eyeReach) return false;
    const slot = actor * ACT_KINDS + act.kind;
    const now = this.ports.now();
    const start = Math.max(this.busyUntil[slot]!, now);
    if (start - now > backlog) return false;
    this.busyUntil[slot] = start + ACT_COOLDOWN_SHARE * cooldown;
    return true;
  }

  /** Actor `actor`, on foot, throws a punch along the unit (dirX, dirZ) from where he stands. */
  punchBy(actor: number, dirX: number, dirZ: number): void {
    if (!this.ports.actorPlace(actor, _place)) return;
    this.resolver.punch(actor, _place.x, _place.z, dirX, dirZ);
  }

  /**
   * Actor `actor`, on foot, fires `gun` along `aim`, the unscattered sight line. It is his only if it passes within `SHOT_RAY_REACH` of his torso; the rays start at its point nearest him
   * (so nothing between a far camera and him is hit), each scattered by his own seeded stream. How far (m) the farthest ray went from `aim`'s eye; 0 when refused.
   */
  shootBy(actor: number, aim: LookRay, gun: Gun): number {
    if (!this.ports.actorPlace(actor, _place)) return 0;
    const behind = Math.max(0, (_place.x - aim.eyeX) * aim.dirX + (_place.y - aim.eyeY) * aim.dirY + (_place.z - aim.eyeZ) * aim.dirZ);
    _near.eyeX = aim.eyeX + aim.dirX * behind;
    _near.eyeY = aim.eyeY + aim.dirY * behind;
    _near.eyeZ = aim.eyeZ + aim.dirZ * behind;
    _near.dirX = aim.dirX;
    _near.dirY = aim.dirY;
    _near.dirZ = aim.dirZ;
    if (hypot3(_near.eyeX - _place.x, _near.eyeY - _place.y, _near.eyeZ - _place.z) > SHOT_RAY_REACH) return 0;
    let far = 0;
    for (let ray = 0; ray < gun.rays; ray++) {
      this.scatter(actor, _near, gun.cone, _ray);
      far = Math.max(far, this.resolver.shoot(actor, _ray, gun));
    }
    this.resolver.shotFired();
    return behind + far;
  }

  /** This machine's player's punch lands: a guest tells the host, the host carries it out. */
  punchLanded(dirX: number, dirZ: number): void {
    if (!this.ports.guest()) {
      this.punchBy(this.ports.self(), dirX, dirZ);
      return;
    }
    if (!this.ports.actorPlace(this.ports.self(), _place)) return;
    this.eye.x = _place.x;
    this.eye.y = _place.y;
    this.eye.z = _place.z;
    this.dir.x = dirX;
    this.dir.y = 0;
    this.dir.z = dirZ;
    this.ports.sendAct(ACT.punch, 0, this.eye, this.dir);
  }

  /** This machine's player fires `gun` along `aim`: a guest tells the host, the host carries it out. How far (m) to draw the tracer. */
  shootLocal(aim: LookRay, gun: Gun): number {
    if (!this.ports.guest()) return this.shootBy(this.ports.self(), aim, gun);
    this.eye.x = aim.eyeX;
    this.eye.y = aim.eyeY;
    this.eye.z = aim.eyeZ;
    this.dir.x = aim.dirX;
    this.dir.y = aim.dirY;
    this.dir.z = aim.dirZ;
    this.ports.sendAct(ACT.shot, slotOfGun(gun), this.eye, this.dir);
    return Math.min(gun.range, GUEST_TRACER_M);
  }

  private draw(actor: number): number {
    this.streams[actor] = (Math.imul(this.streams[actor]!, LCG_MUL) + LCG_ADD) >>> 0;
    return this.streams[actor]! / U32;
  }

  /** `from` with its direction tilted inside a cone of half-angle `cone` (rad) by two draws of actor `actor`'s stream, into `out`. */
  private scatter(actor: number, from: LookRay, cone: number, out: LookRay): void {
    const r1 = this.draw(actor);
    const r2 = this.draw(actor);
    out.eyeX = from.eyeX;
    out.eyeY = from.eyeY;
    out.eyeZ = from.eyeZ;
    // u: a level unit vector across the direction (straight up or down: +x); v = direction x u.
    const flat = hypot2(from.dirX, from.dirZ);
    const ux = flat > STRAIGHT_UP ? -from.dirZ / flat : 1;
    const uz = flat > STRAIGHT_UP ? from.dirX / flat : 0;
    const vx = from.dirY * uz;
    const vy = from.dirZ * ux - from.dirX * uz;
    const vz = -from.dirY * ux;
    const tilt = cone * Math.sqrt(r1);
    const spread = detSin(tilt) / detCos(tilt);
    const c = detCos(2 * Math.PI * r2) * spread;
    const s = detSin(2 * Math.PI * r2) * spread;
    const x = from.dirX + c * ux + s * vx;
    const y = from.dirY + s * vy;
    const z = from.dirZ + c * uz + s * vz;
    const n = 1 / hypot3(x, y, z);
    out.dirX = x * n;
    out.dirY = y * n;
    out.dirZ = z * n;
  }
}
