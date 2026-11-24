import * as THREE from "three";
import { LookRay, type Meeting } from "../ai/civilians/civilian-look.ts";
import type { DeformableCar } from "../vehicle/car.ts";
import { rigidCentre } from "../vehicle/car-air.ts";
import { MAX_TETHERS } from "../kernel/constants.ts";
import { MAX_CARS } from "../scenes/fleet.ts";
import { RAPIER, THING, TETHER_RANGE, thingCode, thingIndex, thingKind, WORLD, type TetherSet } from "../contact/tether.ts";
import { ACT, Named } from "../net/act-codec.ts";
import { AIM, TetherArt } from "../present/tether-art.ts";
import type { RagdollSystem } from "../present/engine-ragdoll.ts";
import { Aim, SightCaster, type SightHost } from "./tether-sight.ts";
import { ROPE_A, ROPE_FLOATS, ROPE_JOINED, ROPE_LENGTH, ROPE_NONE, ROPE_STATE, type RopeEnd } from "../present/ragdoll-wire.ts";
import type { TetherHud } from "../hud/hud-store.ts";

/** Seconds between two reads of the aim while no fire is waiting: the reticle's colour lags a tenth of a second, and a fire always reads it fresh. */
const AIM_PERIOD_S = 0.1;
/** Where a chase camera's aim passes through its view, as a share of the view's height from the top: above the middle, as a third-person shooter's, since the middle of a chase view meets the ground about 11 m in front of the car. */
const CHASE_RETICLE_FROM_TOP = 0.38;
const CHASE_RETICLE_NDC = 1 - 2 * CHASE_RETICLE_FROM_TOP;

/** The dummies' world, as the tether talks to it: its ropes, and which dummies are out. */
type TetherRopes = Pick<RagdollSystem, "ropeAttach" | "ropeCut" | "ropeReel" | "dollOut" | "ropeReport" | "torso">;

/** A point or a direction, as an act carries it. */
type Triple = { x: number; y: number; z: number };

/** What the director reads of the engine. */
interface TetherHost extends SightHost {
  readonly tethers: TetherSet;
  /** The dummies' world, which holds the cables that have a dummy, a prop or a box for an end. */
  readonly ropes: TetherRopes;
  cars(): readonly DeformableCar[];
  /** The car the player's cable starts from (the driven or followed one): its index, -1 for none (the free camera, the whole field). */
  playerCar(): number;
  /** Whether the tether is on offer now: a scene is running, nothing (a menu, the garage, a reel, the walker) holds it, and this browser runs the sim. */
  offered(): boolean;
  /** The camera is a chase camera (not first person, not the free camera): its aim runs through a point above the middle of the view. */
  chase(): boolean;
  /** This machine's player is on foot in the open world: his cables exist only then. */
  afoot(): boolean;
  /** The dummy pool slot of this machine's own walker: his sight line passes through him. */
  self(): number;
  /** This machine's player as an actor: his car index. */
  actor(): number;
  /** The dummy pool slot of another actor's body on this machine, -1 while he has none: his sight line passes it. */
  actorSlot(actor: number): number;
  /** Whether another actor is on foot in the open world, as this machine (the host) has him. */
  actorAfoot(actor: number): boolean;
  /** This machine is a guest in a room: it holds no cable, and its fire, cut and reel are acts sent to the host. */
  guest(): boolean;
  /** Guest: whether the host has this machine's player holding a first end, and how many of the host's cables are his. */
  hostHolds(): boolean;
  /** Guest: where the host says this machine's player's first end is, into `out`; false when he holds none. */
  hostHoldAt(out: { x: number; y: number; z: number }): boolean;
  hostCables(): number;
  /** Sends act `kind` to the host with the sight line it was made along; a hook fire names what its reticle lit. */
  sendAct(kind: number, arg: number, eye: Triple, dir: Triple, name?: Named | null): void;
  /** The person the reticle lit, into `out` (`OpenWorldDirector.nameHook`): civilian `civilian` or the dummy in pool slot `slot`, hit at (x, y, z); nothing when neither is a person. */
  nameHook(civilian: number, slot: number, x: number, y: number, z: number, out: Named): void;
  /** The drawn civilian with no body whose chest the sight line passes nearer than `reach` m, into `out` (index -1: none). `remote`: the ray is another actor's, so buildings are the crowd's footprints and not the host's streamed rooms. */
  personMet(ray: LookRay, reach: number, out: Meeting, remote: boolean): Meeting;
  /** A body stood now for drawn civilian `civilian` by an actor whose eye is at (eyeX, eyeZ): its dummy slot, -1 when she can have none. */
  standPerson(civilian: number, eyeX: number, eyeZ: number, actor: number): number;
  /** The dummy in pool slot `slot` is held as a first end: whatever stands it keeps it until the second fire. */
  holdDoll(slot: number): void;
}

/** One actor's first end, held while the second fire is awaited. */
class Hold {
  held = false;
  car = WORLD;
  thing = 0;
  readonly at = new THREE.Vector3();
  readonly world = new THREE.Vector3();
  /** A held dummy's hook point less its torso, so the held marker rides her. */
  readonly offset = new THREE.Vector3();
  /** With a car of the player's: the cable the first fire made, the second moves the player's end of (-1: none). */
  pending = -1;
}

const _eye = new THREE.Vector3();
const _point = new THREE.Vector3();
const _origin = new THREE.Vector3();
const _held = new THREE.Vector3();

/** `code`'s thing at `at` as the end of a rope. */
function thingEnd(code: number, at: [number, number, number]): RopeEnd {
  const kind = thingKind(code);
  return { kind: kind === THING.doll ? "doll" : kind === THING.prop ? "prop" : "box", id: thingIndex(code), at };
}

/**
 * The hook's host logic for any actor (an actor is a car index): `fireFor`, `cutFor` and `reelFor` carry out a fire along a ray, a cut and the winch for one actor, and the host's own player goes through them too.
 * Each cable belongs to the actor who fired it; reel and cut act on that actor's cables only. An actor's first fire holds a thing (a car, the static world, a dummy, a prop, a box) and his second ties it to
 * the thing then under the sight line; with a car of the player's (a host that names one) the first ties the target to that car. `MAX_TETHERS` cables at most in all, the oldest goes. A cable with an end
 * in the dummies' world is a rope there (`Ropes`) and the sim leaves it alone. This machine's own aim and fire are read at the next frame, when the cars stand where the camera saw them; on a guest they are sent as acts.
 */
export class TetherDirector {
  readonly art = new TetherArt();
  private reelHeld = false;
  private fireDue = false;
  /** Per actor: his held first end, and whether his winch is on. */
  private readonly holds = Array.from({ length: MAX_CARS }, () => new Hold());
  private readonly reelOn = new Uint8Array(MAX_CARS);
  /** A guest's last reel act: on or off. */
  private reelSentAct = false;
  private sinceAim = AIM_PERIOD_S;
  private readonly host: TetherHost;
  private readonly caster: SightCaster;
  /** This machine's reticle, and a scratch aim for other actors' fires. */
  private readonly mine = new Aim();
  private readonly theirs = new Aim();
  /** The sight line of this machine's camera, and the person the sight line met. */
  private readonly sight = new LookRay();
  private readonly personAim: Meeting = { index: -1, along: 0 };
  private readonly lit = new Named();
  /** Per cable slot, the number of the rope command that tied it in the dummies' world (0: none there), and whether the winch was last told to reel it. */
  private readonly commands: number[] = Array.from({ length: MAX_TETHERS }, () => 0);
  private readonly reelSent: boolean[] = Array.from({ length: MAX_TETHERS }, () => false);

  constructor(host: TetherHost) {
    this.host = host;
    this.caster = new SightCaster(host, this.art.group);
  }

  /** The retract key or button is down (read every poll). */
  holdReel(down: boolean): void {
    this.reelHeld = down;
  }

  /** A fire, taken at the next frame. */
  fire(): void {
    if (this.ready()) this.fireDue = true;
  }

  /** This machine's player cuts his cables. */
  cut(): void {
    if (!this.host.guest()) this.cutFor(this.host.actor());
    else if (this.host.afoot()) this.sendAct(ACT.hookCut);
  }

  /**
   * `actor` fires the hook along `ray`: the first fire holds what the ray meets, the second ties it to what the ray then meets. `sawPerson`: whether the actor's own reticle lit a person, which only he can know
   * (his machine has the walls and windows of his own eyes); the act names her. Another actor's fire meets no person when it is false; this machine's own player is not judged by it. When it is true for another actor and the ray
   * meets no person here (no body can be stood for a civilian, she has moved off the line, a wall), the fire is a miss: it does not hold the wall behind her. This machine's own player's reticle never lights such a person, so his fire holds
   * the surface as it always has. False where nothing was held or tied: the actor is not on foot, the ray meets nothing in reach, no body can be stood for the person it meets, or he saw a person it does not meet. A guest holds no cable and does nothing.
   */
  fireFor(actor: number, ray: LookRay, sawPerson: boolean): boolean {
    if (this.host.guest() || actor < 0 || actor >= MAX_CARS || !this.onFoot(actor)) return false;
    const local = actor === this.host.actor();
    this.aimFrom(actor, ray, this.theirs, sawPerson || local);
    // A person met is a drawn civilian, cop or medic (`person`), or one already out as a dummy of the dummies' world.
    const met = this.theirs.person >= 0 || (this.theirs.car === RAPIER && thingKind(this.theirs.thing) === THING.doll);
    if (sawPerson && !local && !met) return false;
    return this.attachFor(actor, this.theirs);
  }

  /** Every cable `actor` fired is cut, and the first end he held is let go. */
  cutFor(actor: number): void {
    const { tethers } = this.host;
    for (let slot = 0; slot < MAX_TETHERS; slot++) {
      if (!tethers.isAlive(slot) || tethers.owner(slot) !== actor) continue;
      this.untie(slot);
      tethers.release(slot);
    }
    if (actor < 0 || actor >= MAX_CARS) return;
    const hold = this.holds[actor]!;
    hold.held = false;
    hold.pending = -1;
    this.reelOn[actor] = 0;
    if (actor === this.host.actor()) this.fireDue = false;
  }

  /** `actor`'s winch reels his cables in (or stops): his cables only, those he fires later too. */
  reelFor(actor: number, on: boolean): void {
    if (actor < 0 || actor >= MAX_CARS) return;
    this.reelOn[actor] = on ? 1 : 0;
    this.host.tethers.setReel(actor, on);
  }

  /** The HUD's read of the tether: null while it is not on offer. */
  hud(): TetherHud | null {
    if (!this.ready()) return null;
    const guest = this.host.guest();
    const hold = this.holds[this.host.actor()];
    const pending = guest ? this.host.hostHolds() : hold !== undefined && (hold.pending >= 0 || hold.held);
    return { count: guest ? this.host.hostCables() : this.ownCount(), pending, aim: this.mine.state, free: this.host.playerCar() < 0, sight: this.sightFromTop() };
  }

  /** Where `actor`'s first end is now, into `out`; false when he holds none. The host tells every machine through his record (`PLAYER_FLAG.holds` and the point). */
  heldPoint(actor: number, out: { x: number; y: number; z: number }): boolean {
    const hold = this.holds[actor];
    const at = hold === undefined ? null : this.heldPlaceOf(hold);
    if (at === null) return false;
    out.x = at.x;
    out.y = at.y;
    out.z = at.z;
    return true;
  }

  /** Once per drawn frame, after the camera and the cars' drawn poses are set: the retract, the aim, a waiting fire, and the drawing. */
  frame(wallDt: number): void {
    const { tethers } = this.host;
    const local = this.host.actor();
    const guest = this.host.guest();
    const ready = this.ready();
    if (guest) this.sendReel(ready && this.reelHeld);
    else {
      this.cutOffFoot(local);
      this.reelFor(local, ready && this.reelHeld);
      this.syncRopes();
      const hold = this.holds[local];
      if (hold !== undefined) {
        if (hold.pending >= 0 && !tethers.isAlive(hold.pending)) hold.pending = -1;
        if (hold.held && this.host.playerCar() >= 0) hold.held = false;
      }
    }
    this.sinceAim += wallDt;
    const due = ready && this.fireDue;
    if (due || (ready && this.sinceAim >= AIM_PERIOD_S)) {
      this.sinceAim = 0;
      this.aim();
      if (due) this.attach();
    }
    this.fireDue = false;
    this.art.update(tethers, this.host.cars(), this.host.camera, ready ? this.mine : null, this.heldPlace());
  }

  /** This machine's reticle: the aim of its camera's sight line. */
  private aim(): void {
    this.cameraRay();
    this.aimFrom(this.host.actor(), this.sight, this.mine);
  }

  /** This machine's fire, read as the reticle's aim: a guest sends it to the host, the host carries it out as `fireFor` does for any actor. */
  private attach(): void {
    if (this.host.guest()) this.sendAct(ACT.hookFire, 0, this.litPerson());
    else if (this.host.afoot()) this.attachFor(this.host.actor(), this.mine);
  }

  /** The tether is on offer (a scene is running and nothing holds it). */
  private ready(): boolean {
    return this.host.offered();
  }

  dispose(): void {
    this.art.dispose();
  }

  /** Whether `actor` is on foot in the open world: this machine's player by `afoot`, any other as the host has him. */
  private onFoot(actor: number): boolean {
    return actor === this.host.actor() ? this.host.afoot() : this.host.actorAfoot(actor);
  }

  /** Cables alive that this machine's player fired. */
  private ownCount(): number {
    const { tethers } = this.host;
    const local = this.host.actor();
    let count = 0;
    for (let slot = 0; slot < MAX_TETHERS; slot++) if (tethers.isAlive(slot) && tethers.owner(slot) === local) count++;
    return count;
  }

  /** Every cable and held first end of an actor who is no longer on foot is cut, this machine's player included. */
  private cutOffFoot(local: number): void {
    const { tethers } = this.host;
    for (let slot = 0; slot < MAX_TETHERS; slot++) {
      if (!tethers.isAlive(slot)) continue;
      const owner = tethers.owner(slot);
      if (owner >= 0 && owner !== local && !this.onFoot(owner)) this.cutFor(owner);
    }
    for (let actor = 0; actor < MAX_CARS; actor++) {
      const hold = this.holds[actor]!;
      if (actor !== local && (hold.held || hold.pending >= 0) && !this.onFoot(actor)) this.cutFor(actor);
    }
    if (!this.host.afoot()) this.cutFor(local);
  }

  /** A guest sends its winch's change to the host. */
  private sendReel(on: boolean): void {
    if (on === this.reelSentAct) return;
    this.reelSentAct = on;
    this.sendAct(on ? ACT.hookReelOn : ACT.hookReelOff);
  }

  /** The person this machine's reticle lit (a drawn civilian, or a dummy that is a person), named for the host. */
  private litPerson(): Named {
    const aim = this.mine;
    const slot = aim.car === RAPIER && thingKind(aim.thing) === THING.doll ? thingIndex(aim.thing) : -1;
    this.host.nameHook(aim.person, slot, aim.point.x, aim.point.y, aim.point.z, this.lit);
    return this.lit;
  }

  /** Act `kind` goes to the host along this machine's sight line, `arg` its argument byte, `name` what it lit. */
  private sendAct(kind: number, arg = 0, name: Named | null = null): void {
    this.cameraRay();
    this.mine.eye.set(this.sight.eyeX, this.sight.eyeY, this.sight.eyeZ);
    this.mine.dir.set(this.sight.dirX, this.sight.dirY, this.sight.dirZ);
    this.host.sendAct(kind, arg, this.mine.eye, this.mine.dir, name);
  }

  /** How far down the view (0 at the top, 1 at the bottom) the aim passes: the middle, or `CHASE_RETICLE_FROM_TOP` on a chase camera. */
  private sightFromTop(): number {
    return this.host.chase() ? CHASE_RETICLE_FROM_TOP : 0.5;
  }

  /** The sight line of this machine's camera into `sight`: through the middle of the view, or a point above it on a chase camera. */
  private cameraRay(): void {
    const matrix = this.host.camera.matrixWorld;
    _eye.setFromMatrixPosition(matrix);
    const rise = this.host.chase() ? CHASE_RETICLE_NDC * Math.tan(THREE.MathUtils.degToRad(this.host.camera.getEffectiveFOV()) / 2) : 0;
    _point.set(0, rise, -1).transformDirection(matrix);
    const sight = this.sight;
    sight.eyeX = _eye.x;
    sight.eyeY = _eye.y;
    sight.eyeZ = _eye.z;
    sight.dirX = _point.x;
    sight.dirY = _point.y;
    sight.dirZ = _point.z;
  }

  /** The dummies' world's word on the cables it holds: each winch told to reel while its cable does, a cable it has dropped (its thing gone) released, a joined rope's ends and length taken for drawing. */
  private syncRopes(): void {
    const { tethers, ropes } = this.host;
    const report = ropes.ropeReport;
    for (let slot = 0; slot < MAX_TETHERS; slot++) {
      const command = this.commands[slot]!;
      if (command === 0) continue;
      const reel = tethers.reels(slot);
      if (reel !== this.reelSent[slot]) {
        this.reelSent[slot] = reel;
        ropes.ropeReel(reel, slot);
      }
      if (report.command < command) continue;
      const o = slot * ROPE_FLOATS;
      const state = report.floats[o + ROPE_STATE]!;
      if (state === ROPE_NONE) {
        tethers.release(slot);
        this.commands[slot] = 0;
      } else if (state === ROPE_JOINED) {
        for (let end = 0; end < 2; end++) {
          if (tethers.endCar(slot, end) !== RAPIER) continue;
          const at = o + ROPE_A + 3 * end;
          tethers.setPlace(slot, end, report.floats[at]!, report.floats[at + 1]!, report.floats[at + 2]!, report.floats[o + ROPE_LENGTH]!);
        }
      }
    }
  }

  /** Where this machine's player's held first object is now, or null when none is held (a guest holds none: the host says where his is). */
  private heldPlace(): THREE.Vector3 | null {
    if (this.host.guest()) return this.host.hostHoldAt(_held) ? _held : null;
    const hold = this.holds[this.host.actor()];
    return hold === undefined ? null : this.heldPlaceOf(hold);
  }

  /** The aim of `actor`'s sight line `ray` into `into`: the first surface it meets, and (`people`) the first drawn person within reach of it. */
  private aimFrom(actor: number, ray: LookRay, into: Aim, people = true): void {
    const cars = this.host.cars();
    const local = actor === this.host.actor();
    const player = local ? this.host.playerCar() : -1;
    this.caster.skipSlot = local ? this.host.self() : this.host.actorSlot(actor);
    this.caster.skipCar = player;
    this.caster.remote = !local;
    into.state = AIM.none;
    into.car = WORLD;
    into.thing = 0;
    into.person = -1;
    into.eye.set(ray.eyeX, ray.eyeY, ray.eyeZ);
    into.dir.set(ray.dirX, ray.dirY, ray.dirZ);
    _origin.copy(cars[player]?.group.position ?? into.eye);
    const surface = this.caster.cast(cars, into);
    const person = this.personAim;
    if (people) this.host.personMet(ray, into.personReach, person, !local);
    else person.index = -1;
    if (person.index >= 0) {
      into.person = person.index;
      into.car = WORLD;
      into.thing = 0;
      into.point.copy(into.eye).addScaledVector(into.dir, person.along);
      into.at.copy(into.point);
    }
    if (surface || person.index >= 0) into.state = into.point.distanceTo(_origin) <= TETHER_RANGE ? AIM.valid : AIM.far;
  }

  /** The aim is where cable `slot`'s end `end` is already (a cable between a thing and itself, or two points of the world, ties nothing). */
  private sameAs(aim: Aim, slot: number, end: number): boolean {
    const { tethers } = this.host;
    return this.sameTarget(aim, tethers.endCar(slot, end), tethers.thing(slot, end));
  }

  private sameTarget(aim: Aim, car: number, thing: number): boolean {
    return aim.car === car && (car !== RAPIER || aim.thing === thing);
  }

  /** `actor`'s fire read as `aim`. With a player's car: the first hooks the target to it, the second moves the player's end to the new target. Without: the first holds the object, the second ties the two. */
  private attachFor(actor: number, aim: Aim): boolean {
    if (aim.state !== AIM.valid) return false;
    if (aim.person >= 0) {
      // A drawn civilian with no body: one is stood for her now, and the fire hooks it.
      const slot = this.host.standPerson(aim.person, aim.eye.x, aim.eye.z, actor);
      aim.person = -1;
      if (slot < 0) return false;
      aim.car = RAPIER;
      aim.thing = thingCode(THING.doll, slot);
    }
    const hold = this.holds[actor]!;
    const player = actor === this.host.actor() ? this.host.playerCar() : -1;
    if (player < 0) return this.attachFree(actor, aim, hold);
    const { tethers } = this.host;
    const cars = this.host.cars();
    if (hold.pending >= 0) {
      if (this.sameAs(aim, hold.pending, 0)) return false;
      this.aimEnd(aim, hold.pending, 1);
      this.tie(hold.pending);
      hold.pending = -1;
      return true;
    }
    const slot = this.open(actor);
    this.aimEnd(aim, slot, 0);
    const centre = rigidCentre(cars[player]!);
    tethers.setEnd(slot, 1, player, centre.x, centre.y, centre.z);
    this.tie(slot);
    hold.pending = slot;
    return true;
  }

  /** The free fire: an object held already and a different one aimed at make a cable between them; else the aim is held as the first. */
  private attachFree(actor: number, aim: Aim, hold: Hold): boolean {
    hold.pending = -1;
    const place = this.heldPlaceOf(hold);
    if (place === null) {
      hold.held = true;
      hold.car = aim.car;
      hold.thing = aim.thing;
      hold.at.copy(aim.at);
      if (aim.car === RAPIER && thingKind(aim.thing) === THING.doll) {
        this.host.holdDoll(thingIndex(aim.thing));
        if (this.host.ropes.torso(thingIndex(aim.thing), _point, null)) hold.offset.subVectors(aim.at, _point);
      }
      return true;
    }
    if (this.sameTarget(aim, hold.car, hold.thing)) return false;
    const slot = this.open(actor);
    // A car's end is a point of its frame; any other is where the held thing is now.
    const at = hold.car >= 0 ? hold.at : place;
    this.host.tethers.setEnd(slot, 0, hold.car, at.x, at.y, at.z, hold.thing);
    this.aimEnd(aim, slot, 1);
    this.tie(slot);
    hold.held = false;
    return true;
  }

  /** Where `hold`'s first object is now (its car's drawn pose, a dummy's torso), or null when none is held; a held dummy or car that is gone is let go. */
  private heldPlaceOf(hold: Hold): THREE.Vector3 | null {
    if (!hold.held) return null;
    if (hold.car === RAPIER && thingKind(hold.thing) === THING.doll) {
      if (this.host.ropes.torso(thingIndex(hold.thing), hold.world, null)) return hold.world.add(hold.offset);
      hold.held = false;
      return null;
    }
    if (hold.car === WORLD || hold.car === RAPIER) return hold.world.copy(hold.at);
    const car = this.host.cars()[hold.car];
    if (car === undefined) {
      hold.held = false;
      return null;
    }
    return hold.world.copy(hold.at).applyQuaternion(car.group.quaternion).add(car.group.position);
  }

  /** A fresh cable of `actor`'s in a free slot: whatever the dummies' world held in it (the oldest cable's rope, when the set was full) is let go, and his winch's state is its own. */
  private open(actor: number): number {
    const slot = this.host.tethers.open(actor);
    this.untie(slot);
    this.host.tethers.setReel(actor, this.reelOn[actor] === 1);
    return slot;
  }

  private untie(slot: number): void {
    if (this.commands[slot]! === 0) return;
    this.host.ropes.ropeCut(slot);
    this.commands[slot] = 0;
    this.reelSent[slot] = false;
  }

  /** End `end` of cable `slot` on what `aim` holds. */
  private aimEnd(aim: Aim, slot: number, end: number): void {
    this.host.tethers.setEnd(slot, end, aim.car, aim.at.x, aim.at.y, aim.at.z, aim.thing);
  }

  /** Cable `slot`'s ends are set: it is as long as they stand apart, and one with an end in the dummies' world is handed to it (the sim leaves it alone; a world that cannot hold it, none being up, drops it). */
  private tie(slot: number): void {
    const { tethers } = this.host;
    tethers.fit(slot, this.host.cars());
    this.untie(slot);
    if (!tethers.isRapier(slot)) return;
    const command = this.host.ropes.ropeAttach(slot, this.ropeEnd(slot, 0), this.ropeEnd(slot, 1));
    if (command < 0) {
      tethers.release(slot);
      return;
    }
    this.commands[slot] = command;
    this.reelSent[slot] = false;
  }

  /** End `end` of cable `slot` as the dummies' world is told it. */
  private ropeEnd(slot: number, end: number): RopeEnd {
    const { tethers } = this.host;
    tethers.point(slot, end, _point);
    const at: [number, number, number] = [_point.x, _point.y, _point.z];
    const car = tethers.endCar(slot, end);
    if (car === RAPIER) return thingEnd(tethers.thing(slot, end), at);
    return car === WORLD ? { kind: "world", at } : { kind: "car", id: car, at };
  }
}
