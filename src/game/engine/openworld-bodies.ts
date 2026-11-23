import { detAtan2, detCos, detSin, hypot2 } from "../kernel/physics-core.js";
import { ACTIVITY } from "../ai/civilians/civilian-activity.ts";
import { DOWNED_LIFE_SECONDS, LOOK } from "../ai/civilians/civilian-crowd-constants.ts";
import { SPECIES } from "../ai/civilians/civilian-constants.ts";
import { punchGap } from "../ai/civilians/civilian-contact.ts";
import type { CrowdPoses } from "../ai/civilians/crowd-poses.ts";
import { dressOfLook } from "../present/civilian-dress.ts";
import type { DriverLook } from "../present/driver-look.ts";
import type { SightField } from "../present/openworld-sight.ts";
import { blankStrike, type FigureStrike } from "../scenes/figure-strike.ts";
import { PlaceFootprints } from "../world/openworld/place-footprints.ts";
import type { Place } from "../world/openworld/walk-graph.ts";
import { addBodyRecord, BODY_FLAG, BODY_KIND, type BodyFrame, type BodyMotion } from "../net/body-codec.ts";
import { CATCH_UP, FASTEST, FOLLOW, followAnchor, SNAP_M, STAND_REACH, STILL, TORSO_ABOVE_FEET } from "./body-follow.ts";
import { idOf, kindOf, PEOPLE_EXTRA } from "./people-index.ts";

/** Physical bodies for the civilians near a player, desktop and phone: each costs a ragdoll in the dummies' world (10 parts, their joints and motors) every step. */
export const BODY_COUNT = { desktop: 6, phone: 3 } as const;
/** Pool slots kept beyond the bodies for the figures thrown and left lying (a civilian run down far from a body, a driver thrown out). */
const LYING_RESERVE = 4;
/** The dummies' pool builds its first slots at load: the last of them is the player's walker, and bodies live past them. */
const FIRST_BODY_SLOT = 4;
/** A civilian within this far (m) of an eye takes a body (a car coming at 13 m/s meets her in two seconds from the camera behind it, and a body wants a few ticks to stand), and one that has one keeps it out to `KEEP_RADIUS`, so a civilian on the edge does not flicker between drawn and body. */
export const NEAR_RADIUS = 28;
export const KEEP_RADIUS = 36;
/** Bodies are chosen this often (s). */
const SELECT_SECONDS = 0.25;
/** A body lagging more than this far (m) behind the crowd's spot for her (blocked by a car, a wall) is let go: she is drawn at her spot again. */
const LEASH = SNAP_M;
/** A body that fell or stumbled may be this far (m) behind her spot and still run back to it. */
const REJOIN_LEASH = 15;
/** A body down (a bump, a car's nudge the crowd did not judge a knockdown) is asked to get up after this long (s), and let go if it is not up by `RELEASE_DOWN`. */
const GET_UP_AFTER = 1.5;
const RELEASE_DOWN = 8;
/** A body stood for the hook's first fire is kept this long (s) for the second to tie it; then a cable must hold it, or the usual rules let it go. */
const HOOK_HOLD_SECONDS = 6;
/** Her feet are on the street when within this far (m) of the ground's height: on a stoop or an interior's floor she is drawn as a posed dummy. */
const ON_STREET = 0.1;
/** A footprint grown by this much (m) is a building: no body inside it, where the ragdoll world has no floor of its own. */
const BUILDING_MARGIN = 0.4;
/** What a civilian may be doing and keep her body: standing about, talking, bumped, flinching from a car, on the phone. The rest (a counter, a door, a seat, a fight, a car's door, an arrest) is posed against something a body cannot stand against. */
const BODY_ACTIVITY = new Set<number>([ACTIVITY.none, ACTIVITY.idle, ACTIVITY.talk, ACTIVITY.bump, ACTIVITY.recoil, ACTIVITY.phoneCall]);
const NOBODY = -1;
/** A body that was struck lies until the crowd's hospital has her (\`DOWNED_LIFE_SECONDS\`). */
const LIES_SECONDS = DOWNED_LIFE_SECONDS;
/** The class of a body that follows no record: this machine's own civilian's, the first given up. */
const OWN_CLASS = 3;

/** What the bodies need of the dummies' world (`RagdollSystem`, through `RagdollBodyHost`): a pool of slots, a walker in each that is held up and steered, and a launch for a strike. */
export type BodyHost = {
  /** Pool slots (the capacity is the bodies' own plus a reserve of lying figures). */
  setCapacity(slots: number): void;
  /** The first slot at or after `from` with nobody out in it, -1 when none. */
  freeSlot(from: number): number;
  /** A walker in `slot` stands at (x, y, z) facing `yaw`, dressed in `look`, moving at (vx, vz); the slot, -1 while the world is not up. */
  start(x: number, y: number, z: number, yaw: number, look: DriverLook, slot: number, vx: number, vz: number): number;
  /** The body in `slot` goes (his slot is free again). */
  stop(slot: number): void;
  /** The torso's (x, z) into `out`; false while nobody is out in the slot. */
  torso(slot: number, out: { x: number; z: number }): boolean;
  /** Where the body in `slot` walks (x, z) into `out`: its torso's path without the step's sway. */
  path(slot: number, out: { x: number; z: number }): void;
  /** Where the body in `slot` faces (rad) and how fast (m/s) it is asked to go. */
  steer(slot: number, heading: number, speed: number): void;
  /** The body in `slot` turns its neck `turn` toward its +x and nods it `nod` down (rad) on top of its gait, and turns its eyes in its head by `eyeYaw` and `eyePitch`: where its civilian looks. */
  look(slot: number, turn: number, nod: number, eyeYaw: number, eyePitch: number): void;
  /** The body in `slot` is on its feet. */
  standing(slot: number): boolean;
  /** The body in `slot` is out and held up by its motors (a walker): not a thrown figure, not gone. */
  holds(slot: number): boolean;
  /** The body in `slot` gets up. */
  getUp(slot: number): void;
  /** Whether the body in `slot` is on its feet at full strength: not fallen, not staggering. */
  steady(slot: number): boolean;
  /** A cable holds the body in `slot`: she is held where it holds her, so she is not let go for lying or for lagging her spot. */
  roped(slot: number): boolean;
  /** A strike lands on the body in `slot`: every part moves as the strike's launch (`FigureStrike`) and it goes limp. */
  knock(slot: number, strike: FigureStrike): void;
  /** A blow of `speed` m/s along (dirX, dirY, dirZ) lands on the torso of the body in `slot`, and it staggers instead of falling. */
  blow(slot: number, dirX: number, dirY: number, dirZ: number, speed: number): void;
  /** The body in `slot`'s torso and velocity, its facing and its posture (`BODY_POSTURE`) into `out`; false while nobody is out in the slot. */
  motion(slot: number, out: BodyMotion): boolean;
  /** The limp body in `slot` is hauled so its torso moves at (vx, vy, vz) m/s. */
  drag(slot: number, vx: number, vy: number, vz: number): void;
  /** Every part of the body in `slot` moves by (dx, dy, dz) m. */
  shift(slot: number, dx: number, dy: number, dz: number): void;
  /** The ground's height (m) at (x, z). */
  groundAt(x: number, z: number): number;
};

const _torso = { x: 0, z: 0 };
const _path = { x: 0, z: 0 };
const _look: DriverLook = { woman: false, shirt: 0, pants: 0, hair: 0, hat: null, mustache: false };
const _motion: BodyMotion = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, heading: 0, posture: 0 };
const _strike = blankStrike();

/** `to` holds `from`'s look. */
export function copyLook(from: DriverLook, to: DriverLook): void {
  to.woman = from.woman;
  to.shirt = from.shirt;
  to.pants = from.pants;
  to.hair = from.hair;
  to.hat = from.hat;
  to.mustache = from.mustache;
  to.portly = from.portly;
  to.outfit = from.outfit;
  to.shades = from.shades;
  to.face = from.face;
  to.tie = from.tie;
}

/** `to` holds `from`. */
function copyMotion(from: BodyMotion, to: BodyMotion): void {
  to.x = from.x;
  to.y = from.y;
  to.z = from.z;
  to.vx = from.vx;
  to.vy = from.vy;
  to.vz = from.vz;
  to.heading = from.heading;
  to.posture = from.posture;
}

/**
 * The civilians near a player as physical bodies: the crowd's spot for each is a mark a walker of the dummies' world (the one the player on foot is, and the showcase's figures) is steered to, so
 * it meets cars, props and other bodies as they do, and a car that runs her down (`crowd.takeStrikes`) knocks that live body (\`knock\`), never a separate throw. The crowd stays the authority on what
 * happens to her (the strike, the knock in its log, her hospital); a body only stands for her where she is drawn. Beyond \`NEAR_RADIUS\`, indoors, on a stoop or at an activity of the crowd's (a
 * counter, a door, a seat) she is drawn by the crowd's art as before (\`held\` names those a body stands for). Each machine makes its own bodies from the crowd it has.
 */
export class OpenWorldBodies {
  /** Per civilian, 1 while a body stands for her: the crowd's art draws none of those. */
  readonly held: Uint8Array;
  private readonly host: BodyHost;
  /** The buildings' footprints grown by `BUILDING_MARGIN`: no body stands inside one. */
  private readonly buildings: PlaceFootprints;
  private readonly size: number;
  private readonly bodyOf: Int16Array;
  private readonly resident: Int32Array;
  private readonly slot: Int32Array;
  private readonly downFor: Float64Array;
  /** 1 for a body that fell or stumbled and has not yet rejoined her spot. */
  private readonly recovering: Uint8Array;
  private readonly struckAt: Float64Array;
  /** Per body, the crowd second the hook's pin on it ends (`stand`). */
  private readonly hookedUntil: Float64Array;
  /** Per body: 1 while it follows a host's record (`aim`), the class that decides who is given up for whom (1 players, 2 other recorded people, 3 this machine's own), the most it is steered (m/s), where the record puts it and the look it was stood in. */
  private readonly followed: Uint8Array;
  private readonly classOf: Uint8Array;
  private readonly cap: Float32Array;
  private readonly target: BodyMotion[];
  private readonly looks: DriverLook[];
  private sinceSelect = SELECT_SECONDS;
  private seconds = 0;

  constructor(host: BodyHost, places: readonly Place[], capacity: number, size: number) {
    this.host = host;
    this.buildings = new PlaceFootprints(places, BUILDING_MARGIN);
    this.size = size;
    this.held = new Uint8Array(capacity);
    this.bodyOf = new Int16Array(capacity + PEOPLE_EXTRA).fill(NOBODY);
    this.resident = new Int32Array(size).fill(NOBODY);
    this.slot = new Int32Array(size).fill(NOBODY);
    this.downFor = new Float64Array(size);
    this.recovering = new Uint8Array(size);
    this.followed = new Uint8Array(size);
    this.cap = new Float32Array(size);
    this.classOf = new Uint8Array(size).fill(OWN_CLASS);
    this.target = Array.from({ length: size }, () => ({ x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, heading: 0, posture: 0 }));
    this.looks = Array.from({ length: size }, () => ({ woman: false, shirt: 0, pants: 0, hair: 0, hat: null, mustache: false }));
    this.struckAt = new Float64Array(size).fill(-Infinity);
    this.hookedUntil = new Float64Array(size).fill(-Infinity);
    host.setCapacity(FIRST_BODY_SLOT + size + LYING_RESERVE);
  }

  /** Bodies standing for civilians now (the struck ones lying included). */
  count(): number {
    let count = 0;
    for (let body = 0; body < this.size; body++) if (this.resident[body]! !== NOBODY) count++;
    return count;
  }

  /** The pool slot of civilian \`civilian\`'s body, -1 when she has none. */
  slotOf(civilian: number): number {
    const body = this.bodyOf[civilian]!;
    return body === NOBODY ? NOBODY : this.slot[body]!;
  }

  /** The player's punch from (x, z) along (dirX, dirZ): the first body on its feet in its reach and arc is blown at `speed` and staggered; its civilian, or -1. */
  punch(x: number, z: number, dirX: number, dirZ: number, speed: number): number {
    for (let body = 0; body < this.size; body++) {
      if (this.resident[body]! === NOBODY || this.resident[body]! >= this.held.length || this.struckAt[body]! > -Infinity) continue;
      const slot = this.slot[body]!;
      if (!this.host.torso(slot, _torso) || punchGap(x, z, dirX, dirZ, _torso.x, _torso.z) < 0) continue;
      this.host.blow(slot, dirX, 0.3, dirZ, speed);
      return this.resident[body]!;
    }
    return NOBODY;
  }

  /** The civilian the body in pool slot `slot` stands for, or -1. */
  civilianOf(slot: number): number {
    for (let body = 0; body < this.size; body++) if (this.resident[body]! !== NOBODY && this.resident[body]! < this.held.length && this.slot[body] === slot) return this.resident[body]!;
    return NOBODY;
  }

  /** Each body's neck turned where its civilian looks: per civilian, the head's turn from the torso, the torso's (the body's neck takes both), the nod, and the eyes' turn in the head (`CrowdGaze`). */
  aimNecks(headYaw: Float32Array, torsoTwist: Float32Array, headPitch: Float32Array, eyeYaw: Float32Array, eyePitch: Float32Array): void {
    for (let body = 0; body < this.size; body++) {
      const civilian = this.resident[body]!;
      if (civilian !== NOBODY && civilian < this.held.length) this.host.look(this.slot[body]!, headYaw[civilian]! + torsoTwist[civilian]!, headPitch[civilian]!, eyeYaw[civilian]!, eyePitch[civilian]!);
    }
  }

  /** The hook takes civilian `civilian` wherever she is and whatever she does: a body is stood for her at her drawn feet and pinned `HOOK_HOLD_SECONDS`; its pool slot, -1 for no body (not a person, none free). With every body in use the farthest one that can be let go (`farthestToRelease`) is let go first. */
  stand(poses: CrowdPoses, civilian: number, eyeX: number, eyeZ: number): number {
    if (this.bodyOf[civilian]! === NOBODY) {
      if (!this.eligible(poses, civilian, eyeX, eyeZ, Infinity, true)) return NOBODY;
      if (this.count() === this.size) {
        const farthest = this.farthestToRelease(eyeX, eyeZ);
        if (farthest === NOBODY) return NOBODY;
        this.release(farthest);
      }
      if (!this.give(poses, civilian)) return NOBODY;
    }
    const body = this.bodyOf[civilian]!;
    this.hookedUntil[body] = this.seconds + HOOK_HOLD_SECONDS;
    return this.slot[body]!;
  }

  /** Whether the hook could stand a body for a civilian who has none now: a body and a pool slot are free (thrown figures may fill the slots), or a body can be let go for her. When not, her reticle must not light. */
  canStand(eyeX: number, eyeZ: number): boolean {
    return this.count() < this.size ? this.nextSlot() >= 0 : this.farthestToRelease(eyeX, eyeZ) !== NOBODY;
  }

  /** The pool slot a new body takes, -1 when none is free: `give` and `canStand` ask the one question. */
  private nextSlot(): number {
    return this.host.freeSlot(FIRST_BODY_SLOT);
  }

  /** The body farthest from (eyeX, eyeZ) that is on its feet, steady, in step with her and held by no cable or pin (a body lying or catching up is never let go for another: she would vanish and reappear upright at her spot); NOBODY when there is none. */
  private farthestToRelease(eyeX: number, eyeZ: number): number {
    let farthest = NOBODY;
    let farthestDistance = -1;
    for (let body = 0; body < this.size; body++) {
      if (this.resident[body]! === NOBODY || this.followed[body] === 1) continue;
      const slot = this.slot[body]!;
      if (this.host.roped(slot) || !this.host.torso(slot, _torso)) continue;
      if (this.recovering[body] === 1 || this.seconds < this.hookedUntil[body]! || !this.host.steady(slot)) continue;
      const distance = hypot2(_torso.x - eyeX, _torso.z - eyeZ);
      if (distance <= farthestDistance) continue;
      farthestDistance = distance;
      farthest = body;
    }
    return farthest;
  }

  /** The hook holds the body in pool slot `slot` as a cable's first end: it is pinned `HOOK_HOLD_SECONDS` as a body `stand` makes is, so making room never takes it. */
  pin(slot: number): void {
    for (let body = 0; body < this.size; body++) if (this.resident[body]! !== NOBODY && this.slot[body] === slot) this.hookedUntil[body] = this.seconds + HOOK_HOLD_SECONDS;
  }

  /** Where the bodies the hook holds stand (a first end pinned, or a cable on them): their torsos' x and z into `xs` and `zs`, as many as fit; how many. The interiors keep the floor under each of them (`DoorOpeners.pinned`). */
  hookedSpots(xs: Float32Array, zs: Float32Array): number {
    let count = 0;
    for (let body = 0; body < this.size && count < xs.length; body++) {
      if (this.resident[body]! === NOBODY) continue;
      const slot = this.slot[body]!;
      if (!this.host.roped(slot) && this.seconds >= this.hookedUntil[body]! && !(this.followed[body] === 1 && this.resident[body]! < this.held.length)) continue;
      if (!this.host.torso(slot, _torso)) continue;
      xs[count] = _torso.x;
      zs[count++] = _torso.z;
    }
    return count;
  }

  /** One step of \`dt\` s at crowd second \`seconds\`, after the crowd's: the bodies are steered to their civilians' spots, and the nearest civilians to (eyeX, eyeZ) that `sight` sees (null: all) are given bodies. */
  step(poses: CrowdPoses, eyeX: number, eyeZ: number, seconds: number, dt: number, sight: Pick<SightField, "seen"> | null = null): void {
    this.seconds = seconds;
    for (let body = 0; body < this.size; body++) if (this.resident[body]! !== NOBODY) this.tend(body, poses, eyeX, eyeZ, dt);
    this.sinceSelect += dt;
    if (this.sinceSelect < SELECT_SECONDS) return;
    this.sinceSelect = 0;
    this.fill(poses, eyeX, eyeZ, sight);
  }

  /** A civilian run down (the crowd's strike) lands on her live body: true. False when she has none, and the strike is thrown as a figure instead. */
  knock(strike: FigureStrike): boolean {
    const body = this.bodyOf[strike.guard]!;
    if (body === NOBODY) return false;
    this.host.knock(this.slot[body]!, strike);
    this.struckAt[body] = this.seconds;
    return true;
  }

  /** Civilian `civilian`'s body goes (the ambulance has taken her): true when she had one. A body a cable holds stays on it, lying out its time, and goes once the cable is cut (`tend`). */
  remove(civilian: number): boolean {
    const body = this.bodyOf[civilian]!;
    if (body === NOBODY) return false;
    if (this.host.roped(this.slot[body]!)) this.struckAt[body] = this.seconds - LIES_SECONDS;
    else this.release(body);
    return true;
  }

  /** Every body goes: the slots are free for the next scene. */
  dispose(): void {
    for (let body = 0; body < this.size; body++) if (this.resident[body]! !== NOBODY) this.release(body);
  }

  private tend(body: number, poses: CrowdPoses, eyeX: number, eyeZ: number, dt: number): void {
    if (this.followed[body] === 1) return this.follow(body);
    const civilian = this.resident[body]!;
    const slot = this.slot[body]!;
    // A body a cable holds is hers until the cable is cut, whatever the crowd does with her meanwhile (thrown, lying past her time, gone indoors in the brain).
    const roped = this.host.roped(slot);
    if (!this.host.holds(slot) && this.struckAt[body]! === -Infinity) {
      if (!roped) this.release(body);
      return;
    }
    if (this.struckAt[body]! > -Infinity) {
      if (this.seconds - this.struckAt[body]! >= LIES_SECONDS && !roped) this.release(body);
      return;
    }
    // A body the hook holds (or is about to tie) stays wherever the cable keeps her.
    const kept = roped || this.seconds < this.hookedUntil[body]!;
    if (!this.host.torso(slot, _torso)) return this.release(body);
    if (!this.eligible(poses, civilian, eyeX, eyeZ, kept ? Infinity : KEEP_RADIUS, kept)) {
      if (!roped) return this.release(body);
      this.host.steer(slot, poses.yaw[civilian]!, 0);
      return;
    }
    if (!this.host.standing(slot)) {
      this.recovering[body] = 1;
      this.downFor[body] = this.downFor[body]! + dt;
      if (this.downFor[body]! > RELEASE_DOWN && !kept) return this.release(body);
      if (this.downFor[body]! > GET_UP_AFTER) this.host.getUp(slot);
      return;
    }
    this.downFor[body] = 0;
    const dx = poses.x[civilian]! - _torso.x;
    const dz = poses.z[civilian]! - _torso.z;
    const lag = hypot2(dx, dz);
    if (!this.host.steady(slot)) this.recovering[body] = 1;
    else if (lag <= LEASH) this.recovering[body] = 0;
    if (lag > (this.recovering[body] === 1 ? REJOIN_LEASH : LEASH) && !kept) return this.release(body);
    const yaw = poses.yaw[civilian]!;
    const pace = poses.speed[civilian]!;
    if (pace < STILL && lag < STAND_REACH) {
      this.host.steer(slot, yaw, 0);
      return;
    }
    // Pulled from the walker's path, not the torso: the torso's step sway fed back through the pull swings her facing a few times a second.
    this.host.path(slot, _path);
    const vx = detSin(yaw) * pace + CATCH_UP * (poses.x[civilian]! - _path.x);
    const vz = detCos(yaw) * pace + CATCH_UP * (poses.z[civilian]! - _path.z);
    this.host.steer(slot, detAtan2(vx, vz), Math.min(FASTEST, hypot2(vx, vz)));
  }

  /** Whether civilian `civilian` may have a body: a person (a body is a human dummy) shown, within `radius` of the eye, and, unless `hooked`, walking or standing about, on the street (not on a stoop) and not in a building. The hook (`hooked`) takes her wherever she is drawn and whatever she does: a counter, a seat, a stoop, a room, an arrest. */
  private eligible(poses: CrowdPoses, civilian: number, eyeX: number, eyeZ: number, radius: number, hooked = false): boolean {
    if (poses.shown[civilian] === 0 || poses.look[civilian]! >>> LOOK.speciesShift !== SPECIES.person) return false;
    if (!hooked && !BODY_ACTIVITY.has(poses.activity[civilian]!)) return false;
    const x = poses.x[civilian]!;
    const z = poses.z[civilian]!;
    if (hypot2(x - eyeX, z - eyeZ) > radius) return false;
    if (hooked) return true;
    if (poses.feetY[civilian]! - this.host.groundAt(x, z) > ON_STREET) return false;
    return !this.buildings.inside(poses.x, poses.z, civilian);
  }

  /** The nearest eligible civilians this machine's eye sees, without a body, take the free ones, nearest first, while there are any. */
  private fill(poses: CrowdPoses, eyeX: number, eyeZ: number, sight: Pick<SightField, "seen"> | null): void {
    for (let taken = this.count(); taken < this.size; taken++) {
      let nearest = NOBODY;
      let nearestDistance = NEAR_RADIUS;
      for (let civilian = 0; civilian < this.held.length; civilian++) {
        if (this.bodyOf[civilian]! !== NOBODY || !this.eligible(poses, civilian, eyeX, eyeZ, nearestDistance)) continue;
        if (sight !== null && !sight.seen(poses.x[civilian]!, poses.z[civilian]!, 1)) continue;
        nearestDistance = hypot2(poses.x[civilian]! - eyeX, poses.z[civilian]! - eyeZ);
        nearest = civilian;
      }
      if (nearest === NOBODY || !this.give(poses, nearest)) return;
    }
  }

  /** Stands a body for civilian \`civilian\` in a free slot; false when there is none, or the world is not up yet. */
  private give(poses: CrowdPoses, civilian: number): boolean {
    let body = 0;
    while (this.resident[body]! !== NOBODY) body++;
    const slot = this.nextSlot();
    if (slot < 0) return false;
    dressOfLook(poses.look[civilian]!, _look);
    const x = poses.x[civilian]!;
    const z = poses.z[civilian]!;
    const yaw = poses.yaw[civilian]!;
    const speed = poses.speed[civilian]!;
    // She stands where she is drawn: on the street the ground, off it (a stoop the hook took her from) her feet.
    const ground = this.host.groundAt(x, z);
    const feet = poses.feetY[civilian]! - ground > ON_STREET ? poses.feetY[civilian]! : ground;
    const started = this.host.start(x, feet, z, yaw, _look, slot, detSin(yaw) * speed, detCos(yaw) * speed);
    if (started < 0) return false;
    this.seat(body, civilian, started);
    return true;
  }

  private release(body: number): void {
    this.host.stop(this.slot[body]!);
    this.forget(body);
  }

  /** Body `body`'s person has it no more: her bookkeeping is cleared (`held` only for a civilian). */
  private forget(body: number): void {
    const person = this.resident[body]!;
    this.bodyOf[person] = NOBODY;
    if (person < this.held.length) this.held[person] = 0;
    this.resident[body] = NOBODY;
    this.slot[body] = NOBODY;
    this.followed[body] = 0;
  }

  /** Body `body` is `person`'s, standing in pool slot `slot`: this machine's own until `takeFor` has it follow a record. */
  private seat(body: number, person: number, slot: number): void {
    this.resident[body] = person;
    this.slot[body] = slot;
    this.downFor[body] = 0;
    this.recovering[body] = 0;
    this.hookedUntil[body] = -Infinity;
    this.struckAt[body] = -Infinity;
    this.followed[body] = 0;
    this.classOf[body] = OWN_CLASS;
    this.bodyOf[person] = body;
    if (person < this.held.length) this.held[person] = 1;
  }

  /** A followed body goes where its record's target says (`followAnchor`); one the record has the walker stood again for is stood at the target in its kept look, and one the world no longer holds goes. */
  private follow(body: number): void {
    const slot = this.slot[body]!;
    if (!this.host.holds(slot) && !this.host.roped(slot)) return this.release(body);
    if (followAnchor(this.host, slot, this.target[body]!, this.cap[body]!) !== FOLLOW.restand) return;
    const t = this.target[body]!;
    this.host.stop(slot);
    const started = this.host.start(t.x, t.y - TORSO_ABOVE_FEET, t.z, t.heading, this.looks[body]!, slot, t.vx, t.vz);
    if (started < 0) return this.forget(body);
    this.slot[body] = started;
  }

  /** Person `person` (of class `classOf`: 1 players, 2 other recorded people) takes a body at `t`, following her record from now on at most `cap` m/s. With every body in use one of a higher class is given up first (`giveUpFor`). False when she has one, none can be given up, or the world has no slot. */
  takeFor(person: number, classOf: number, look: DriverLook, t: BodyMotion, cap: number, eyeX: number, eyeZ: number): boolean {
    if (this.bodyOf[person]! !== NOBODY) return false;
    if (this.count() === this.size && !this.giveUpFor(classOf, eyeX, eyeZ)) return false;
    const slot = this.nextSlot();
    if (slot < 0) return false;
    const started = this.host.start(t.x, t.y - TORSO_ABOVE_FEET, t.z, t.heading, look, slot, t.vx, t.vz);
    if (started < 0) return false;
    let body = 0;
    while (this.resident[body]! !== NOBODY) body++;
    this.seat(body, person, started);
    this.followed[body] = 1;
    this.classOf[body] = classOf;
    this.cap[body] = cap;
    copyLook(look, this.looks[body]!);
    copyMotion(t, this.target[body]!);
    return true;
  }

  /** The body of the highest class number above `classOf` (the farthest from the eye among those) that nothing holds, lies, recovers or has just been struck is let go; whether one was. */
  private giveUpFor(classOf: number, eyeX: number, eyeZ: number): boolean {
    let chosen = NOBODY;
    let chosenDistance = -1;
    for (let body = 0; body < this.size; body++) {
      if (this.resident[body]! === NOBODY || this.classOf[body]! <= classOf) continue;
      const slot = this.slot[body]!;
      if (this.host.roped(slot) || !this.host.torso(slot, _torso)) continue;
      if (this.seconds < this.hookedUntil[body]! || this.struckAt[body]! > -Infinity || this.recovering[body] === 1 || !this.host.steady(slot)) continue;
      const distance = hypot2(_torso.x - eyeX, _torso.z - eyeZ);
      if (chosen !== NOBODY && (this.classOf[body]! < this.classOf[chosen]! || (this.classOf[body] === this.classOf[chosen] && distance <= chosenDistance))) continue;
      chosen = body;
      chosenDistance = distance;
    }
    if (chosen === NOBODY) return false;
    this.release(chosen);
    return true;
  }

  /** Person `person`'s body follows target `t` as a body of class `classOf`, at most `cap` m/s. */
  aim(person: number, t: BodyMotion, classOf: number, cap: number): void {
    const body = this.bodyOf[person]!;
    copyMotion(t, this.target[body]!);
    this.followed[body] = 1;
    this.classOf[body] = classOf;
    this.cap[body] = cap;
  }

  /** The host's frame no longer has `person`: a civilian's body is this machine's own again and runs back to her spot, any other kind's goes. */
  unfollow(person: number): void {
    const body = this.bodyOf[person]!;
    if (body === NOBODY) return;
    if (person >= this.held.length) return this.release(body);
    this.followed[body] = 0;
    this.classOf[body] = OWN_CLASS;
    this.recovering[body] = 1;
    this.downFor[body] = 0;
  }

  /** Whether a cable of this machine holds person `person`'s body. */
  ropedPerson(person: number): boolean {
    const body = this.bodyOf[person]!;
    return body !== NOBODY && this.host.roped(this.slot[body]!);
  }

  /** Person `person`'s body, when it stands, is knocked limp at its torso, launched at (vx, vy, vz) m/s. */
  knockPerson(person: number, vx: number, vy: number, vz: number): void {
    const body = this.bodyOf[person]!;
    if (body === NOBODY || !this.host.standing(this.slot[body]!) || !this.host.motion(this.slot[body]!, _motion)) return;
    _strike.guard = -1;
    _strike.car = -1;
    _strike.x = _motion.x;
    _strike.y = _motion.y;
    _strike.z = _motion.z;
    _strike.faceX = detSin(_motion.heading);
    _strike.faceZ = detCos(_motion.heading);
    _strike.vx = vx;
    _strike.vy = vy;
    _strike.vz = vz;
    this.host.knock(this.slot[body]!, _strike);
  }

  /** Person `person`'s body's torso, velocity, facing and posture into `out`; false when she has none. */
  motionOf(person: number, out: BodyMotion): boolean {
    const body = this.bodyOf[person]!;
    return body !== NOBODY && this.host.motion(this.slot[body]!, out);
  }

  /** The car of the player whose body is in pool slot `slot` (`capacity`: the crowd's residents), -1 for none. */
  playerOfSlot(slot: number, capacity: number): number {
    const person = this.personOfSlot(slot);
    return person === NOBODY || kindOf(person, capacity) !== BODY_KIND.player ? NOBODY : idOf(person, capacity);
  }

  /** Whether a body stands for person `person` here. */
  has(person: number): boolean {
    return this.bodyOf[person]! !== NOBODY;
  }

  /** Person `person`'s body's torso (x, z) into `out`; false when she has none. */
  torsoOf(person: number, out: { x: number; z: number }): boolean {
    const body = this.bodyOf[person]!;
    return body !== NOBODY && this.host.torso(this.slot[body]!, out);
  }

  /** The person the body in pool slot `slot` stands for, -1 for none. */
  personOfSlot(slot: number): number {
    for (let body = 0; body < this.size; body++) if (this.resident[body]! !== NOBODY && this.slot[body] === slot) return this.resident[body]!;
    return NOBODY;
  }

  /** How many bodies follow a record now. */
  followedCount(): number {
    let count = 0;
    for (let body = 0; body < this.size; body++) if (this.resident[body]! !== NOBODY && this.followed[body] === 1) count++;
    return count;
  }

  /** The person of the `at`th followed body (in body order), -1 past the last. */
  followedPerson(at: number): number {
    let seen = 0;
    for (let body = 0; body < this.size; body++) {
      if (this.resident[body]! === NOBODY || this.followed[body] !== 1) continue;
      if (seen++ === at) return this.resident[body]!;
    }
    return NOBODY;
  }

  /** Host: a record for each civilian's body that a cable holds or the hook has pinned: its posture, flags, torso, velocity and facing. */
  writeHooked(out: BodyFrame): void {
    for (let body = 0; body < this.size; body++) {
      const civilian = this.resident[body]!;
      if (civilian === NOBODY || civilian >= this.held.length) continue;
      const slot = this.slot[body]!;
      const roped = this.host.roped(slot);
      const pinned = this.seconds < this.hookedUntil[body]!;
      if ((!roped && !pinned) || !this.host.motion(slot, _motion)) continue;
      const at = addBodyRecord(out, BODY_KIND.civilian, civilian, _motion.posture | (roped ? BODY_FLAG.roped : 0) | (pinned ? BODY_FLAG.pinned : 0));
      if (at < 0) return;
      out.pos[3 * at] = _motion.x;
      out.pos[3 * at + 1] = _motion.y;
      out.pos[3 * at + 2] = _motion.z;
      out.vel[3 * at] = _motion.vx;
      out.vel[3 * at + 1] = _motion.vy;
      out.vel[3 * at + 2] = _motion.vz;
      out.heading[at] = _motion.heading;
    }
  }
}
