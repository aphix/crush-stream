import { detAtan2, detCos, detSin, hypot2 } from "../kernel/physics-core.js";
import { ACTIVITY } from "../ai/civilians/civilian-activity.ts";
import { DOWNED_LIFE_SECONDS } from "../ai/civilians/civilian-crowd-constants.ts";
import { punchGap } from "../ai/civilians/civilian-contact.ts";
import type { CrowdPoses } from "../ai/civilians/crowd-poses.ts";
import { dressOfLook } from "../present/civilian-dress.ts";
import type { DriverLook } from "../present/driver-look.ts";
import type { FigureStrike } from "../scenes/figure-strike.ts";
import type { Place } from "../world/openworld/walk-graph.ts";

/** Physical bodies for the civilians near a player, desktop and phone: each costs a ragdoll in the dummies' world (10 parts, their joints and motors) every step. */
export const BODY_COUNT = { desktop: 6, phone: 3 } as const;
/** Pool slots kept beyond the bodies for the figures thrown and left lying (a civilian run down far from a body, a driver thrown out). */
const LYING_RESERVE = 4;
/** The dummies' pool builds its first slots at load: the last of them is the player's walker, and bodies live past them. */
const FIRST_BODY_SLOT = 4;
/** A civilian within this far (m) of an eye takes a body (a car coming at 13 m/s meets her in two seconds from the camera behind it, and a body wants a few ticks to stand), and one that has one keeps it out to `KEEP_RADIUS`, so a civilian on the edge does not flicker between drawn and body. */
const NEAR_RADIUS = 28;
const KEEP_RADIUS = 36;
/** Bodies are chosen this often (s). */
const SELECT_SECONDS = 0.25;
/** A body lagging more than this far (m) behind the crowd's spot for her (blocked by a car, a wall) is let go: she is drawn at her spot again. */
const LEASH = 3;
/** A body that fell or stumbled may be this far (m) behind her spot and still run back to it. */
const REJOIN_LEASH = 15;
/** She is standing when her crowd pace is under this (m/s); her body then stands, facing as she does, once within `STAND_REACH` (m) of her spot, and walks to it from farther. */
const STILL = 0.15;
const STAND_REACH = 0.4;
/** How hard a body is pulled to her spot: the speed (m/s) added toward it per metre it lags. */
const CATCH_UP = 2.5;
/** A body is never asked faster than this (m/s): a run. */
const FASTEST = 3.5;
/** A body down (a bump, a car's nudge the crowd did not judge a knockdown) is asked to get up after this long (s), and let go if it is not up by `RELEASE_DOWN`. */
const GET_UP_AFTER = 1.5;
const RELEASE_DOWN = 8;
/** Her feet are on the street when within this far (m) of the ground's height: on a stoop or an interior's floor she is drawn as a posed dummy. */
const ON_STREET = 0.1;
/** A footprint grown by this much (m) is a building: no body inside it, where the ragdoll world has no floor of its own. */
const BUILDING_MARGIN = 0.4;
/** What a civilian may be doing and keep her body: standing about, talking, bumped, flinching from a car, on the phone. The rest (a counter, a door, a seat, a fight, a car's door, an arrest) is posed against something a body cannot stand against. */
const BODY_ACTIVITY = new Set<number>([ACTIVITY.none, ACTIVITY.idle, ACTIVITY.talk, ACTIVITY.bump, ACTIVITY.recoil, ACTIVITY.phoneCall]);
const NOBODY = -1;
/** A body that was struck lies until the crowd's hospital has her (\`DOWNED_LIFE_SECONDS\`). */
const LIES_SECONDS = DOWNED_LIFE_SECONDS;

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
  /** The body in `slot` is on its feet. */
  standing(slot: number): boolean;
  /** The body in `slot` is out and held up by its motors (a walker): not a thrown figure, not gone. */
  holds(slot: number): boolean;
  /** The body in `slot` gets up. */
  getUp(slot: number): void;
  /** Whether the body in `slot` is on its feet at full strength: not fallen, not staggering. */
  steady(slot: number): boolean;
  /** A strike lands on the body in `slot`: every part moves as the strike's launch (`FigureStrike`) and it goes limp. */
  knock(slot: number, strike: FigureStrike): void;
  /** A blow of `speed` m/s along (dirX, dirY, dirZ) lands on the torso of the body in `slot`, and it staggers instead of falling. */
  blow(slot: number, dirX: number, dirY: number, dirZ: number, speed: number): void;
  /** The ground's height (m) at (x, z). */
  groundAt(x: number, z: number): number;
};

const _torso = { x: 0, z: 0 };
const _path = { x: 0, z: 0 };
const _look: DriverLook = { woman: false, shirt: 0, pants: 0, hair: 0, hat: null, mustache: false };

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
  private readonly places: readonly Place[];
  private readonly size: number;
  private readonly bodyOf: Int16Array;
  private readonly resident: Int32Array;
  private readonly slot: Int32Array;
  private readonly downFor: Float64Array;
  /** 1 for a body that fell or stumbled and has not yet rejoined her spot. */
  private readonly recovering: Uint8Array;
  private readonly struckAt: Float64Array;
  private sinceSelect = SELECT_SECONDS;
  private seconds = 0;

  constructor(host: BodyHost, places: readonly Place[], capacity: number, size: number) {
    this.host = host;
    this.places = places;
    this.size = size;
    this.held = new Uint8Array(capacity);
    this.bodyOf = new Int16Array(capacity).fill(NOBODY);
    this.resident = new Int32Array(size).fill(NOBODY);
    this.slot = new Int32Array(size).fill(NOBODY);
    this.downFor = new Float64Array(size);
    this.recovering = new Uint8Array(size);
    this.struckAt = new Float64Array(size).fill(-Infinity);
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
      if (this.resident[body]! === NOBODY || this.struckAt[body]! > -Infinity) continue;
      const slot = this.slot[body]!;
      if (!this.host.torso(slot, _torso) || punchGap(x, z, dirX, dirZ, _torso.x, _torso.z) < 0) continue;
      this.host.blow(slot, dirX, 0.3, dirZ, speed);
      return this.resident[body]!;
    }
    return NOBODY;
  }

  /** One step of \`dt\` s at crowd second \`seconds\`, after the crowd's: the bodies are steered to their civilians' spots, and the nearest civilians to (eyeX, eyeZ) are given bodies. */
  step(poses: CrowdPoses, eyeX: number, eyeZ: number, seconds: number, dt: number): void {
    this.seconds = seconds;
    for (let body = 0; body < this.size; body++) if (this.resident[body]! !== NOBODY) this.tend(body, poses, eyeX, eyeZ, dt);
    this.sinceSelect += dt;
    if (this.sinceSelect < SELECT_SECONDS) return;
    this.sinceSelect = 0;
    this.fill(poses, eyeX, eyeZ);
  }

  /** A civilian run down (the crowd's strike) lands on her live body: true. False when she has none, and the strike is thrown as a figure instead. */
  knock(strike: FigureStrike): boolean {
    const body = this.bodyOf[strike.guard]!;
    if (body === NOBODY) return false;
    this.host.knock(this.slot[body]!, strike);
    this.struckAt[body] = this.seconds;
    return true;
  }

  /** Civilian `civilian`'s body goes (the ambulance has taken her): true when she had one. */
  remove(civilian: number): boolean {
    const body = this.bodyOf[civilian]!;
    if (body === NOBODY) return false;
    this.release(body);
    return true;
  }

  /** Every body goes: the slots are free for the next scene. */
  dispose(): void {
    for (let body = 0; body < this.size; body++) if (this.resident[body]! !== NOBODY) this.release(body);
  }

  private tend(body: number, poses: CrowdPoses, eyeX: number, eyeZ: number, dt: number): void {
    const civilian = this.resident[body]!;
    const slot = this.slot[body]!;
    if (!this.host.holds(slot) && this.struckAt[body]! === -Infinity) return this.release(body);
    if (this.struckAt[body]! > -Infinity) {
      if (this.seconds - this.struckAt[body]! >= LIES_SECONDS) this.release(body);
      return;
    }
    if (!this.eligible(poses, civilian, eyeX, eyeZ, KEEP_RADIUS) || !this.host.torso(slot, _torso)) return this.release(body);
    if (!this.host.standing(slot)) {
      this.recovering[body] = 1;
      this.downFor[body] = this.downFor[body]! + dt;
      if (this.downFor[body]! > RELEASE_DOWN) return this.release(body);
      if (this.downFor[body]! > GET_UP_AFTER) this.host.getUp(slot);
      return;
    }
    this.downFor[body] = 0;
    const dx = poses.x[civilian]! - _torso.x;
    const dz = poses.z[civilian]! - _torso.z;
    const lag = hypot2(dx, dz);
    if (!this.host.steady(slot)) this.recovering[body] = 1;
    else if (lag <= LEASH) this.recovering[body] = 0;
    if (lag > (this.recovering[body] === 1 ? REJOIN_LEASH : LEASH)) return this.release(body);
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

  /** Whether civilian \`civilian\` may have a body: shown, walking or standing about, on the street (not on a stoop, not in a building) and within \`radius\` of the eye. */
  private eligible(poses: CrowdPoses, civilian: number, eyeX: number, eyeZ: number, radius: number): boolean {
    if (poses.shown[civilian] === 0 || !BODY_ACTIVITY.has(poses.activity[civilian]!)) return false;
    const x = poses.x[civilian]!;
    const z = poses.z[civilian]!;
    if (hypot2(x - eyeX, z - eyeZ) > radius || poses.feetY[civilian]! - this.host.groundAt(x, z) > ON_STREET) return false;
    return !this.insideBuilding(x, z);
  }

  private insideBuilding(x: number, z: number): boolean {
    for (let place = 0; place < this.places.length; place++) {
      const entry = this.places[place]!;
      if (entry.doorNode < 0) continue;
      const dx = x - entry.x;
      const dz = z - entry.z;
      const cos = detCos(entry.yaw);
      const sin = detSin(entry.yaw);
      if (Math.abs(dx * cos - dz * sin) < entry.depth / 2 + BUILDING_MARGIN && Math.abs(dx * sin + dz * cos) < entry.width / 2 + BUILDING_MARGIN) return true;
    }
    return false;
  }

  /** The nearest eligible civilians without a body take the free ones, nearest first, while there are any. */
  private fill(poses: CrowdPoses, eyeX: number, eyeZ: number): void {
    for (let taken = this.count(); taken < this.size; taken++) {
      let nearest = NOBODY;
      let nearestDistance = NEAR_RADIUS;
      for (let civilian = 0; civilian < this.bodyOf.length; civilian++) {
        if (this.bodyOf[civilian]! !== NOBODY || !this.eligible(poses, civilian, eyeX, eyeZ, nearestDistance)) continue;
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
    const slot = this.host.freeSlot(FIRST_BODY_SLOT);
    if (slot < 0) return false;
    dressOfLook(poses.look[civilian]!, _look);
    const x = poses.x[civilian]!;
    const z = poses.z[civilian]!;
    const yaw = poses.yaw[civilian]!;
    const speed = poses.speed[civilian]!;
    const started = this.host.start(x, this.host.groundAt(x, z), z, yaw, _look, slot, detSin(yaw) * speed, detCos(yaw) * speed);
    if (started < 0) return false;
    this.resident[body] = civilian;
    this.slot[body] = started;
    this.downFor[body] = 0;
    this.recovering[body] = 0;
    this.struckAt[body] = -Infinity;
    this.bodyOf[civilian] = body;
    this.held[civilian] = 1;
    return true;
  }

  private release(body: number): void {
    const civilian = this.resident[body]!;
    this.host.stop(this.slot[body]!);
    this.bodyOf[civilian] = NOBODY;
    this.held[civilian] = 0;
    this.resident[body] = NOBODY;
    this.slot[body] = NOBODY;
  }
}
