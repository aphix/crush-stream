import { punchGap } from "../ai/civilians/civilian-contact.ts";
import { PLAYER_KO_BLOWS, PLAYER_KO_WINDOW, PLAYER_PUNCH_COOLDOWN } from "../ai/civilians/civilian-constants.ts";
import { LookRay } from "../ai/civilians/civilian-look.ts";
import { detAtan2, detCos, detSin, hypot2, hypot3 } from "../kernel/physics-core.js";
import { wrapAngle } from "../present/walker-math.ts";
import { SEATS_NOTICE } from "../net/seats-codec.ts";
import { ACT, ACT_KINDS, type Act } from "../net/act-codec.ts";
import { MAX_CARS } from "../scenes/fleet.ts";
import { gunAt, slotOfGun, STRAIGHT_UP, type Gun } from "./engine-onfoot-arms.ts";
import type { ActorPlace } from "./engine-openworld-law.ts";

/** Actors are car indexes. */
const MAX_ACTORS = MAX_CARS;
/** A punch's eye is his torso: an act whose eye is farther than this from it (m) is not his. */
const ACT_EYE_REACH = 4;
/** The hook is aimed along the camera's sight line: its eye may be the whole boom from him (the orbit's 32 m and a sprint's stretch), and its fires come no faster than this (s). */
const HOOK_EYE_REACH = 40;
const HOOK_FIRE_COOLDOWN = 0.2;
/** A camera is behind him or at his head: an eye farther ahead of his torso along its sight line than this (m) is no camera of his (his head's 0.3 m plus a sprint's lag at the oldest view of him, 7 m/s x 0.32 s = 2.24 m, rounded up). An eye ahead of him at all must have no wall between it and his torso: a camera behind him is not asked, for it may stand over a roof, where the footprint test would call a wall. */
const HOOK_EYE_AHEAD = 2.6;
/** The line of a shot must pass within this (m) of the actor's torso: the gun's tip held out in front of his chest (0.8 m) plus the most the host's view of a sprinting guest can lag across a shot to his side (7 m/s x 0.25 s = 1.75 m, the age the shared bodies extrapolate to: the interpolation delay 0.1 s, a 15 Hz foot message's 0.067 s and 0.05 to 0.15 s of latency make 0.22 to 0.32 s) plus 0.3 m of margin. Where the shot may start is bounded apart, by `SHOT_ORIGIN_REACH` and the wall test, so this line test only has to cover those two. */
const SHOT_RAY_REACH = 2.9;
/** The point of a shot's line the rays start at (the eye, or the line's point nearest his torso when the eye is behind him) must be within this (m) of his torso: the farthest tip (the shotgun's, 0.7 m past a hand held 0.7 m out: 1.4 m) plus a sprint's lag at the oldest view of him (7 m/s x 0.32 s = 2.24 m) plus 0.3 m of margin, so no eye far along his line fires from there. */
const SHOT_ORIGIN_REACH = 4;
/** Network jitter bunches honest acts, so an actor's acts of one kind may run this far (s) ahead of the gun's own rate, and no further: a faster stream than the gun's is refused. */
const ACT_BACKLOG_S = 0.5;
/** A punch has no backlog to absorb jitter, so it spends this share of its cooldown: a little under the rate, so honest timing noise is not refused. A gun spends its whole cooldown: the backlog absorbs the noise and the long-run rate is the gun's. */
const ACT_PUNCH_SHARE = 0.9;
/** A guest does not know what its shot met: its tracer runs this far (m). */
const GUEST_TRACER_M = 60;
/** A target nearer the tip than this (m) gives no direction: the shot keeps its ray. */
const MIN_TIP_TO_TARGET_M = 0.05;
/** A target nearer his torso than this (m) is underfoot: he does not turn to it. */
const NO_TURN_UNDERFOOT_M = 1;
/** The gun lies on a target at any facing, so he turns to one only when it is farther than this (rad) off his facing: a quarter turn, behind him. */
const FACE_TARGET_FROM_RAD = Math.PI / 2;
/** A direction the host reads must be a unit vector to within this. */
const UNIT_SLACK = 0.05;
/** The level part of a punch's direction must be at least this long. */
const LEVEL_PUNCH = 0.9;
/** Two honest get-in acts from one actor come no closer than this (s): he cannot cross a car's door and ask again sooner. */
const GET_IN_COOLDOWN = 0.5;
/** Multiplier that gives every actor his own scatter stream; actor 0's stream starts at 1. */
const STREAM_STEP = 0x9e3779b1;
const LCG_MUL = 1664525;
const LCG_ADD = 1013904223;
const U32 = 4294967296;

const _place: ActorPlace = { x: 0, y: 0, z: 0, heading: 0, velocityX: 0, velocityZ: 0 };
const _aim = new LookRay();
const _ray = new LookRay();
const _near = new LookRay();
const _muzzle = { x: 0, y: 0, z: 0 };

/** What the director resolves at the authority for an actor. */
type ActResolver = {
  punch(actor: number, x: number, z: number, dirX: number, dirZ: number): void;
  shoot(actor: number, ray: LookRay, gun: Gun): number;
  /** How far (m) along `ray`, within `range`, the nearest wall, ground, person, dummy, car or prop is, or `range`; nothing is struck. */
  meet(actor: number, ray: LookRay, range: number): number;
  /** Whether a wall of a place stands between the points a and b (m). */
  wallBetween(ax: number, ay: number, az: number, bx: number, by: number, bz: number): boolean;
  /** Actor `actor` fired a gun: the law hears of him. */
  shotFired(actor: number): void;
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
  /** This machine's player turns toward the level direction (dx, dz): called when it is more than `FACE_TARGET_FROM_RAD` off his facing. */
  face(dx: number, dz: number): void;
  /** A shot is fired at (x, y, z): the gun in this machine's player's hand is laid from the hand straight at it, and `out` is its tip; false while no gun is in his hand. */
  layGun(x: number, y: number, z: number, out: { x: number; y: number; z: number }): boolean;
  /** The guest's way to the host: `NetPlay.sendAct`. */
  sendAct(kind: number, arg: number, eye: { x: number; y: number; z: number }, dir: { x: number; y: number; z: number }): void;
  /** The car actor `actor` sits in (the seat table), -1 when none. */
  seatedCar(actor: number): number;
  /** Actor `actor`, on foot, gets in car `car` (`OpenWorldSeats.getIn`): 0, or the `SEATS_NOTICE` that says why not. */
  getIn(actor: number, car: number): number;
  /** Actor `actor` gets out of his seat (`OpenWorldSeats.getOut`): 0, or the `SEATS_NOTICE` that says why not. */
  getOut(actor: number): number;
  /** Actor `actor` fires the hook along `ray`; `sawPerson`: his own reticle had lit a person (`TetherDirector.fireFor`). */
  hookFire(actor: number, ray: LookRay, sawPerson: boolean): void;
  /** Actor `actor` cuts his cables (`TetherDirector.cutFor`). */
  hookCut(actor: number): void;
  /** Actor `actor`'s winch reels or stops (`TetherDirector.reelFor`). */
  hookReel(actor: number, on: boolean): void;
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
  private readonly place: ActorPlace = { x: 0, y: 0, z: 0, heading: 0, velocityX: 0, velocityZ: 0 };

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

  /** A guest's act reached the host: carried out when it could be real, else refused and nothing happens. The `SEATS_NOTICE` a refused get-in or get-out tells the guest (0 for anything else). */
  hear(actor: number, act: Act): number {
    if (actor < 0 || actor >= MAX_ACTORS) return SEATS_NOTICE.none;
    if (act.kind === ACT.getIn) return this.hearGetIn(actor, act);
    if (act.kind === ACT.getOut) return this.ports.seatedCar(actor) < 0 ? SEATS_NOTICE.noCar : this.ports.getOut(actor);
    if (act.kind === ACT.hookFire) return this.hearHookFire(actor, act);
    if (act.kind === ACT.hookCut) {
      this.ports.hookCut(actor);
      return SEATS_NOTICE.none;
    }
    if (act.kind === ACT.hookReelOn || act.kind === ACT.hookReelOff) {
      this.ports.hookReel(actor, act.kind === ACT.hookReelOn);
      return SEATS_NOTICE.none;
    }
    if (act.kind === ACT.punch) {
      const level = hypot2(act.dirX, act.dirZ);
      if (level < LEVEL_PUNCH || level > 1 + UNIT_SLACK || !this.admit(actor, act, PLAYER_PUNCH_COOLDOWN, 0, ACT_EYE_REACH)) return SEATS_NOTICE.none;
      this.punchBy(actor, act.dirX / level, act.dirZ / level);
      return SEATS_NOTICE.none;
    }
    if (act.kind !== ACT.shot) return SEATS_NOTICE.none;
    const gun = gunAt(act.arg);
    const length = hypot3(act.dirX, act.dirY, act.dirZ);
    if (gun === null || Math.abs(length - 1) > UNIT_SLACK || !this.admit(actor, act, gun.every, ACT_BACKLOG_S, Infinity)) return SEATS_NOTICE.none;
    _aim.eyeX = act.eyeX;
    _aim.eyeY = act.eyeY;
    _aim.eyeZ = act.eyeZ;
    _aim.dirX = act.dirX / length;
    _aim.dirY = act.dirY / length;
    _aim.dirZ = act.dirZ / length;
    this.shootBy(actor, _aim, gun);
    return SEATS_NOTICE.none;
  }

  /** A guest asks to get in car `act.arg`: one already sitting in it is re-seated by the fill rule, one on foot must pass `admit` (on foot, eye at his torso) and then gets in at the door nearest him. */
  private hearGetIn(actor: number, act: Act): number {
    if (this.ports.seatedCar(actor) !== act.arg && !this.admit(actor, act, GET_IN_COOLDOWN, 0, ACT_EYE_REACH)) return SEATS_NOTICE.noCar;
    return this.ports.getIn(actor, act.arg);
  }

  /** On foot, the eye within `eyeReach` of his torso, and his acts of this kind no more than `backlog` s ahead of the rate `cooldown` sets (a punch has no backlog: a bunched one is not a second). */
  private admit(actor: number, act: Act, cooldown: number, backlog: number, eyeReach: number): boolean {
    if (!this.ports.actorPlace(actor, _place)) return false;
    if (hypot3(act.eyeX - _place.x, act.eyeY - _place.y, act.eyeZ - _place.z) > eyeReach) return false;
    const slot = actor * ACT_KINDS + act.kind;
    const now = this.ports.now();
    const start = Math.max(this.busyUntil[slot]!, now);
    if (start - now > backlog) return false;
    this.busyUntil[slot] = start + (backlog > 0 ? 1 : ACT_PUNCH_SHARE) * cooldown;
    return true;
  }

  /** A guest fires the hook along his camera's sight line: his when he is on foot, the eye is within the camera's boom of his torso and not ahead of him along the line (a camera is behind him or at his head; an eye out in front would reach past him and past walls), and the line passes within `SHOT_RAY_REACH` of his torso, as a shot's must. */
  private hearHookFire(actor: number, act: Act): number {
    const length = hypot3(act.dirX, act.dirY, act.dirZ);
    if (Math.abs(length - 1) > UNIT_SLACK || !this.admit(actor, act, HOOK_FIRE_COOLDOWN, 0, HOOK_EYE_REACH)) return SEATS_NOTICE.none;
    _aim.eyeX = act.eyeX;
    _aim.eyeY = act.eyeY;
    _aim.eyeZ = act.eyeZ;
    _aim.dirX = act.dirX / length;
    _aim.dirY = act.dirY / length;
    _aim.dirZ = act.dirZ / length;
    const ahead = (act.eyeX - _place.x) * _aim.dirX + (act.eyeY - _place.y) * _aim.dirY + (act.eyeZ - _place.z) * _aim.dirZ;
    if (ahead > HOOK_EYE_AHEAD || (ahead > 0 && this.resolver.wallBetween(_place.x, _place.y, _place.z, act.eyeX, act.eyeY, act.eyeZ))) return SEATS_NOTICE.none;
    if (this.nearestToTorso(_aim) <= SHOT_RAY_REACH) this.ports.hookFire(actor, _aim, act.arg === 1);
    return SEATS_NOTICE.none;
  }

  /** Actor `actor`, on foot, throws a punch along the unit (dirX, dirZ) from where he stands. */
  punchBy(actor: number, dirX: number, dirZ: number): void {
    if (!this.ports.actorPlace(actor, _place)) return;
    this.resolver.punch(actor, _place.x, _place.z, dirX, dirZ);
  }

  /**
   * Actor `actor`, on foot, fires `gun` along `aim`, the unscattered line of the shot. It is his only if the line passes within `SHOT_RAY_REACH` of his torso, its start (the eye, or the line's point nearest his torso when the eye is behind him) is
   * within `SHOT_ORIGIN_REACH` of it, and no wall of a place stands between his torso and that start; the rays start there (so nothing between a far camera and him is hit), each scattered by his own seeded stream.
   * How far (m) the farthest ray went from `aim`'s eye; 0 when refused.
   */
  shootBy(actor: number, aim: LookRay, gun: Gun): number {
    if (!this.ports.actorPlace(actor, _place)) return 0;
    if (this.nearestToTorso(aim) > SHOT_RAY_REACH || this.apartFromTorso(_near) > SHOT_ORIGIN_REACH) return 0;
    if (this.resolver.wallBetween(_place.x, _place.y, _place.z, _near.eyeX, _near.eyeY, _near.eyeZ)) return 0;
    let far = 0;
    for (let ray = 0; ray < gun.rays; ray++) {
      this.scatter(actor, _near, gun.cone, _ray);
      far = Math.max(far, this.resolver.shoot(actor, _ray, gun));
    }
    this.resolver.shotFired(actor);
    return hypot3(_near.eyeX - aim.eyeX, _near.eyeY - aim.eyeY, _near.eyeZ - aim.eyeZ) + far;
  }

  /** How far (m) the point (`ray`'s eye) is from the torso in `_place`. */
  private apartFromTorso(ray: LookRay): number {
    return hypot3(ray.eyeX - _place.x, ray.eyeY - _place.y, ray.eyeZ - _place.z);
  }

  /** Writes into `_near` the start of `aim` for a cast: its point nearest the torso in `_place`, not behind the eye, with its direction. How far (m) the torso is from the whole line, ahead of the eye or behind it. */
  private nearestToTorso(aim: LookRay): number {
    const along = (_place.x - aim.eyeX) * aim.dirX + (_place.y - aim.eyeY) * aim.dirY + (_place.z - aim.eyeZ) * aim.dirZ;
    const behind = Math.max(0, along);
    _near.eyeX = aim.eyeX + aim.dirX * behind;
    _near.eyeY = aim.eyeY + aim.dirY * behind;
    _near.eyeZ = aim.eyeZ + aim.dirZ * behind;
    _near.dirX = aim.dirX;
    _near.dirY = aim.dirY;
    _near.dirZ = aim.dirZ;
    return hypot3(aim.eyeX + aim.dirX * along - _place.x, aim.eyeY + aim.dirY * along - _place.y, aim.eyeZ + aim.dirZ * along - _place.z);
  }

  /** He turns to face the level direction (dx, dz) of a target when it is behind him: more than `FACE_TARGET_FROM_RAD` off his facing (`_place`) and not underfoot. */
  private faceTarget(dx: number, dz: number): void {
    if (hypot2(dx, dz) < NO_TURN_UNDERFOOT_M || Math.abs(wrapAngle(detAtan2(dx, dz) - _place.heading)) <= FACE_TARGET_FROM_RAD) return;
    this.ports.face(dx, dz);
  }

  /**
   * Where a shot is aimed is found along the aim ray, looked along from its point nearest his torso (`_near`), within the gun's range: what it first meets, else its point at that range (the target T). The gun is laid from his hand
   * straight at T (`ports.layGun`), so its barrel, its tip and the bullet's line are one line, and `aim` becomes the ray from that tip to T; he turns to face T when it is behind him. The ray is cast from his torso instead when T is
   * nearer his torso than the tip is (a point-blank target), or a wall stands between his torso and the tip (he is pressed against it): it starts on his side. With no gun shown his torso is the tip. How far (m) the ray
   * is aimed to go; -1 when `aim` keeps its direction.
   */
  private aimFromMuzzle(aim: LookRay, gun: Gun): number {
    this.nearestToTorso(aim);
    const met = this.resolver.meet(this.ports.self(), _near, gun.range);
    const targetX = _near.eyeX + _near.dirX * met;
    const targetY = _near.eyeY + _near.dirY * met;
    const targetZ = _near.eyeZ + _near.dirZ * met;
    this.faceTarget(targetX - _place.x, targetZ - _place.z);
    const laid = this.ports.layGun(targetX, targetY, targetZ, _muzzle);
    const behindWall = laid && this.resolver.wallBetween(_place.x, _place.y, _place.z, _muzzle.x, _muzzle.y, _muzzle.z);
    const pointBlank = laid && hypot3(targetX - _place.x, targetY - _place.y, targetZ - _place.z) <= hypot3(_muzzle.x - _place.x, _muzzle.y - _place.y, _muzzle.z - _place.z);
    const origin = laid && !behindWall && !pointBlank ? _muzzle : _place;
    const x = targetX - origin.x;
    const y = targetY - origin.y;
    const z = targetZ - origin.z;
    const length = hypot3(x, y, z);
    aim.eyeX = origin.x;
    aim.eyeY = origin.y;
    aim.eyeZ = origin.z;
    if (length < MIN_TIP_TO_TARGET_M) return -1;
    aim.dirX = x / length;
    aim.dirY = y / length;
    aim.dirZ = z / length;
    return length;
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

  /** This machine's player fires `gun` along `aim`: a guest tells the host, the host carries it out. `aim` is rewritten to the ray the shot leaves along (`aimFromMuzzle`). How far (m) to draw the tracer from `aim`'s eye. */
  shootLocal(aim: LookRay, gun: Gun): number {
    const self = this.ports.self();
    const known = this.ports.actorPlace(self, _place) ? this.aimFromMuzzle(aim, gun) : -1;
    if (!this.ports.guest()) return this.shootBy(self, aim, gun);
    this.eye.x = aim.eyeX;
    this.eye.y = aim.eyeY;
    this.eye.z = aim.eyeZ;
    this.dir.x = aim.dirX;
    this.dir.y = aim.dirY;
    this.dir.z = aim.dirZ;
    this.ports.sendAct(ACT.shot, slotOfGun(gun), this.eye, this.dir);
    return known >= 0 ? known : Math.min(gun.range, GUEST_TRACER_M);
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
