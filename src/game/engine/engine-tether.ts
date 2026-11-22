import * as THREE from "three";
import { LookRay, type Meeting } from "../ai/civilians/civilian-look.ts";
import type { DeformableCar } from "../vehicle/car.ts";
import { rigidCentre } from "../vehicle/car-air.ts";
import { MAX_TETHERS } from "../kernel/constants.ts";
import { RAPIER, THING, TETHER_RANGE, thingCode, thingIndex, thingKind, WORLD, type TetherSet } from "../contact/tether.ts";
import { AIM, TetherArt, type ReticleView } from "../present/tether-art.ts";
import type { RagdollSystem } from "../present/engine-ragdoll.ts";
import { ANIMAL_MESH_NAMES } from "../present/animal-figure.ts";
import { CIVILIAN_FIGURES_NAME } from "../present/civilian-figure.ts";
import { BOXES_MESH_NAME } from "../present/minigame-art.ts";
import { DummyMesh } from "../present/ragdoll-mesh.ts";
import { RAGDOLLS_MESH_NAME } from "../present/ragdoll-pool.ts";
import { ROPE_A, ROPE_FLOATS, ROPE_JOINED, ROPE_LENGTH, ROPE_NONE, ROPE_STATE, type RopeEnd } from "../present/ragdoll-wire.ts";
import type { TetherHud } from "../hud/hud-store.ts";

/** Seconds between two reads of the aim while no fire is waiting: the reticle's colour lags a tenth of a second, and a fire always reads it fresh. */
const AIM_PERIOD_S = 0.1;
/** How far (m) the sight line is cast, so a surface past the hook's reach still reads red instead of nothing. */
const SIGHT_M = 400;
/** Nothing nearer than this (m) to the eye is hit: the player's own chase camera sits inside its car. */
const NEAR_CLIP_M = 0.5;
/** Where a chase camera's aim passes through its view, as a share of the view's height from the top: above the middle, as a third-person shooter's, since the middle of a chase view meets the ground about 11 m in front of the car. */
const CHASE_RETICLE_FROM_TOP = 0.38;
const CHASE_RETICLE_NDC = 1 - 2 * CHASE_RETICLE_FROM_TOP;
/** A drawn civilian is hooked when her chest axis lies within this far (m) behind the first surface the sight line meets: her own figure's front is that surface. */
const PERSON_SLACK_M = 0.5;

/** The dummies' world, as the tether talks to it: its ropes, and which dummies are out. */
type TetherRopes = Pick<RagdollSystem, "ropeAttach" | "ropeCut" | "ropeReel" | "dollOut" | "ropeReport" | "torso">;

/** What the director reads of the engine. */
interface TetherHost {
  readonly tethers: TetherSet;
  readonly camera: THREE.PerspectiveCamera;
  /** The scene whose drawn meshes the sight line meets. */
  readonly scene: THREE.Object3D;
  /** The dummies' world, which holds the cables that have a dummy, a prop or a box for an end. */
  readonly ropes: TetherRopes;
  cars(): readonly DeformableCar[];
  /** Drawn things that move and are not a car (the wheel, lamp and part batches, the balls): a cable cannot hook the place they were drawn at. */
  movers(): readonly THREE.Object3D[];
  /** The car the player's cable starts from (the driven or followed one): its index, -1 for none (the free camera, the whole field). */
  playerCar(): number;
  /** Whether the tether is on offer now: a scene is running, nothing (a menu, the garage, a reel, the walker) holds it, and this browser runs the sim. */
  offered(): boolean;
  /** The camera is a chase camera (not first person, not the free camera): its aim runs through a point above the middle of the view. */
  chase(): boolean;
  /** The player is on foot in the open world on a machine that holds authority: cables exist only then. */
  afoot(): boolean;
  /** The dummy pool slot of the player's own walker: the sight line passes through him. */
  self(): number;
  /** The drawn civilian with no body whose chest the sight line passes nearer than `reach` m, into `out` (index -1: none). */
  personMet(ray: LookRay, reach: number, out: Meeting): Meeting;
  /** A body stood now for drawn civilian `civilian`: its dummy slot, -1 when she can have none. */
  standPerson(civilian: number): number;
  /** The dummy in pool slot `slot` is held as a first end: whatever stands it keeps it until the second fire. */
  holdDoll(slot: number): void;
}

/** What the sight line met: a car (its index), the static world, or a thing in the dummies' world (`RAPIER`, and `thing`: its `thingCode`). */
interface Mark {
  car: number;
  thing: number;
}

const _eye = new THREE.Vector3();
const _point = new THREE.Vector3();
const _origin = new THREE.Vector3();

/** `code`'s thing at `at` as the end of a rope. */
function thingEnd(code: number, at: [number, number, number]): RopeEnd {
  const kind = thingKind(code);
  return { kind: kind === THING.doll ? "doll" : kind === THING.prop ? "prop" : "box", id: thingIndex(code), at };
}

/**
 * The player's side of the tether: the aim from the camera (its middle, or a point above it on a chase camera), the fire, the retract and the cut. With a car of the player's (driven or followed): a first fire hooks the target
 * and ties it to that car, the second moves the player's end to a second target (object to object), a third starts another cable. With none (the free camera): the first fire hooks
 * an object and the second another, and the cable forms between them; the reach counts from the camera. Two cables at most, the oldest goes. Fires are read at the next frame
 * (`frame`), when the cars stand where the camera saw them. A target is a car, the static world, or a thing of the dummies' world (a dummy, a knocked or knockable prop, a box): a cable with
 * such an end is a rope there (`Ropes`) and the sim leaves it alone.
 */
export class TetherDirector {
  readonly art = new TetherArt();
  private reelHeld = false;
  private fireDue = false;
  /** The cable the first fire made and the second is to move the player's end of: -1 for none. */
  private pendingSlot = -1;
  /** Without a player's car: the first object hooked, waiting for the second (`heldCar`, a car index, `WORLD` or `RAPIER`; `heldAt`, its car-frame or world point; `heldThing`, its thing). */
  private held = false;
  private heldCar = WORLD;
  private heldThing = 0;
  private readonly heldAt = new THREE.Vector3();
  private sinceAim = AIM_PERIOD_S;
  private readonly host: TetherHost;
  private readonly raycaster = new THREE.Raycaster();
  private readonly view: ReticleView = { state: AIM.none, dir: new THREE.Vector3(), point: new THREE.Vector3() };
  /** What the aim would hook: a car index, `WORLD` or `RAPIER` (and its thing), a car-frame point for a car, the world point otherwise. */
  private aimCar = WORLD;
  private aimThing = 0;
  private readonly aimAt = new THREE.Vector3();
  private readonly heldWorld = new THREE.Vector3();
  /** A held dummy's hook point less its torso, so the held marker rides her. */
  private readonly heldOffset = new THREE.Vector3();
  /** The drawn civilian with no body the aim would hook (-1: none): a body is stood for her when the fire is made. */
  private aimPerson = -1;
  private readonly sight = new LookRay();
  private readonly personAim: Meeting = { index: -1, along: 0 };
  /** Per cable slot, the number of the rope command that tied it in the dummies' world (0: none there), and whether the winch was last told to reel. */
  private readonly commands: number[] = Array.from({ length: MAX_TETHERS }, () => 0);
  private reelSent = false;

  constructor(host: TetherHost) {
    this.host = host;
  }

  /** The retract key or button is down (read every poll). */
  holdReel(down: boolean): void {
    this.reelHeld = down;
  }

  /** A fire, taken at the next frame. */
  fire(): void {
    if (this.ready()) this.fireDue = true;
  }

  /** Every cable cut. */
  cut(): void {
    this.host.tethers.clear();
    if (this.commands.some((command) => command > 0)) this.host.ropes.ropeCut(-1);
    this.commands.fill(0);
    this.reelSent = false;
    this.pendingSlot = -1;
    this.held = false;
    this.fireDue = false;
  }

  /** The HUD's read of the tether: null while it is not on offer. */
  hud(): TetherHud | null {
    if (!this.ready()) return null;
    return { count: this.host.tethers.count, pending: this.pendingSlot >= 0 || this.held, aim: this.view.state, free: this.host.playerCar() < 0, sight: this.sightFromTop() };
  }

  /** Once per drawn frame, after the camera and the cars' drawn poses are set: the retract, the aim, a waiting fire, and the drawing. */
  frame(wallDt: number): void {
    if (!this.host.afoot() && (this.host.tethers.count > 0 || this.held)) this.cut();
    const { tethers } = this.host;
    const ready = this.ready();
    tethers.reeling = ready && this.reelHeld;
    this.syncRopes();
    if (this.pendingSlot >= 0 && !tethers.isAlive(this.pendingSlot)) this.pendingSlot = -1;
    if (this.held && this.host.playerCar() >= 0) this.held = false;
    this.sinceAim += wallDt;
    if (ready && (this.fireDue || this.sinceAim >= AIM_PERIOD_S)) {
      this.sinceAim = 0;
      this.aim();
    }
    if (ready && this.fireDue) this.attach();
    this.fireDue = false;
    this.art.update(tethers, this.host.cars(), this.host.camera, ready ? this.view : null, this.heldPlace());
  }

  /** The tether is on offer (a scene is running and nothing holds it). */
  private ready(): boolean {
    return this.host.offered();
  }

  dispose(): void {
    this.art.dispose();
  }

  /** How far down the view (0 at the top, 1 at the bottom) the aim passes: the middle, or `CHASE_RETICLE_FROM_TOP` on a chase camera. */
  private sightFromTop(): number {
    return this.host.chase() ? CHASE_RETICLE_FROM_TOP : 0.5;
  }

  /** The dummies' world's word on the cables it holds: the winch told to reel while one is out, a cable it has dropped (its thing gone) released, a joined rope's ends and length taken for drawing. */
  private syncRopes(): void {
    const { tethers, ropes } = this.host;
    const reel = tethers.reeling && this.commands.some((command) => command > 0);
    if (reel !== this.reelSent) {
      this.reelSent = reel;
      ropes.ropeReel(reel);
    }
    const report = ropes.ropeReport;
    for (let slot = 0; slot < MAX_TETHERS; slot++) {
      const command = this.commands[slot]!;
      if (command === 0 || report.command < command) continue;
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

  /** Where the held first object is now (its car's drawn pose, a dummy's torso), or null when none is held. */
  private heldPlace(): THREE.Vector3 | null {
    if (!this.held) return null;
    if (this.heldCar === RAPIER && thingKind(this.heldThing) === THING.doll) {
      if (this.host.ropes.torso(thingIndex(this.heldThing), this.heldWorld, null)) return this.heldWorld.add(this.heldOffset);
      this.held = false;
      return null;
    }
    if (this.heldCar === WORLD || this.heldCar === RAPIER) return this.heldWorld.copy(this.heldAt);
    const car = this.host.cars()[this.heldCar];
    if (car === undefined) {
      this.held = false;
      return null;
    }
    return this.heldWorld.copy(this.heldAt).applyQuaternion(car.group.quaternion).add(car.group.position);
  }

  /** The aim from the camera through its aim point, read as the last frame drew it: the first surface the one sight line meets. */
  private aim(): void {
    const cars = this.host.cars();
    const player = this.host.playerCar();
    this.view.state = AIM.none;
    this.aimCar = WORLD;
    this.aimThing = 0;
    this.aimPerson = -1;
    const matrix = this.host.camera.matrixWorld;
    _eye.setFromMatrixPosition(matrix);
    const rise = this.host.chase() ? CHASE_RETICLE_NDC * Math.tan(THREE.MathUtils.degToRad(this.host.camera.getEffectiveFOV()) / 2) : 0;
    this.view.dir.set(0, rise, -1).transformDirection(matrix);
    _origin.copy(cars[player]?.group.position ?? _eye);
    const surface = this.firstSurface(cars, player);
    const sight = this.sight;
    sight.eyeX = _eye.x;
    sight.eyeY = _eye.y;
    sight.eyeZ = _eye.z;
    sight.dirX = this.view.dir.x;
    sight.dirY = this.view.dir.y;
    sight.dirZ = this.view.dir.z;
    const person = this.host.personMet(sight, surface ? _eye.distanceTo(this.view.point) + PERSON_SLACK_M : SIGHT_M, this.personAim);
    if (person.index >= 0) {
      this.aimPerson = person.index;
      this.aimCar = WORLD;
      this.aimThing = 0;
      this.view.point.copy(_eye).addScaledVector(this.view.dir, person.along);
      this.aimAt.copy(this.view.point);
    }
    if (surface || person.index >= 0) this.view.state = this.view.point.distanceTo(_origin) <= TETHER_RANGE ? AIM.valid : AIM.far;
  }

  /**
   * The first drawn surface along the sight line, the player's own car and what moves aside: a car's body is hooked at that point of its frame, a dummy, a prop that can be knocked
   * or a box at the world point (and as that thing), anything else at the world point. The same sight line and meshes as picking a car (`carAt`), the garage's spray and the showcase's
   * shove, over the whole scene.
   */
  private firstSurface(cars: readonly DeformableCar[], player: number): boolean {
    this.raycaster.set(_eye, this.view.dir);
    this.raycaster.camera = this.host.camera;
    this.raycaster.near = NEAR_CLIP_M;
    this.raycaster.far = SIGHT_M;
    const movers = this.host.movers();
    for (const hit of this.raycaster.intersectObject(this.host.scene, true)) {
      const mark = this.markOf(hit, movers, cars);
      if (mark === undefined || (player >= 0 && mark.car === player)) continue;
      this.view.point.copy(hit.point);
      this.aimCar = mark.car;
      this.aimThing = mark.thing;
      if (mark.car < 0) this.aimAt.copy(hit.point);
      else this.aimAt.copy(cars[mark.car]!.group.worldToLocal(_point.copy(hit.point)));
      return true;
    }
    return false;
  }

  /** What `hit` is a surface of: a car, a thing of the dummies' world, or the static world; undefined where the sight line passes through (not drawn, not a mesh, a mover, a dummy not out or the tether's own art). */
  private markOf(hit: THREE.Intersection, movers: readonly THREE.Object3D[], cars: readonly DeformableCar[]): Mark | undefined {
    const object = hit.object;
    if (!(object instanceof THREE.Mesh)) return undefined;
    let car = WORLD;
    for (let o: THREE.Object3D | null = object; o; o = o.parent) {
      if (!o.visible || o === this.art.group || movers.includes(o)) return undefined;
      const index: unknown = o.userData.carIndex;
      if (typeof index === "number" && cars[index]?.group === o) car = index;
    }
    if (car !== WORLD) return { car, thing: 0 };
    // A far figure of the crowd is no surface of the world: the sight line passes her, and the person test hooks her by her chest (a hit on her front had hooked the air where she stood). A cat or a dog is not hooked at all: the sight line passes them too.
    if (object.name === CIVILIAN_FIGURES_NAME || object.name === ANIMAL_MESH_NAMES.cat || object.name === ANIMAL_MESH_NAMES.dog) return undefined;
    // Only the pool's mesh is drawn by slot: a crowd, guard or seated driver drawn on another `DummyMesh` is no dummy of that world, and the sight line passes her.
    if (object instanceof DummyMesh && (object.name !== RAGDOLLS_MESH_NAME || hit.instanceId === undefined || hit.instanceId === this.host.self() || !this.host.ropes.dollOut(hit.instanceId))) return undefined;
    const thing = this.thingOf(object, hit.instanceId);
    return thing === 0 ? { car: WORLD, thing } : { car: RAPIER, thing };
  }

  /** The thing of the dummies' world instance `instance` of `object` is drawn as (`thingCode`), or 0 where it is none: a dummy, a prop that can be knocked, a box. */
  private thingOf(object: THREE.Mesh, instance: number | undefined): number {
    if (instance === undefined) return 0;
    if (object instanceof DummyMesh) return thingCode(THING.doll, instance);
    if (object.name === BOXES_MESH_NAME) return thingCode(THING.box, instance);
    const knockOf: unknown = object.userData.knockOf;
    const prop = knockOf instanceof Int32Array ? knockOf[instance] : undefined;
    return prop !== undefined && prop >= 0 ? thingCode(THING.prop, prop) : 0;
  }

  /** The aim is where cable `slot`'s end `end` is already (a cable between a thing and itself, or two points of the world, ties nothing). */
  private sameAs(slot: number, end: number): boolean {
    const { tethers } = this.host;
    return this.sameTarget(tethers.endCar(slot, end), tethers.thing(slot, end));
  }

  private sameTarget(car: number, thing: number): boolean {
    return this.aimCar === car && (car !== RAPIER || this.aimThing === thing);
  }

  /** A waiting fire. With a player's car: the first hooks the target to it, the second moves the player's end to the new target. Without: the first holds the object, the second ties the two. */
  private attach(): void {
    if (this.view.state !== AIM.valid) return;
    if (this.aimPerson >= 0) {
      // A drawn civilian with no body: one is stood for her now, and the fire hooks it.
      const slot = this.host.standPerson(this.aimPerson);
      this.aimPerson = -1;
      if (slot < 0) return;
      this.aimCar = RAPIER;
      this.aimThing = thingCode(THING.doll, slot);
    }
    if (this.host.playerCar() < 0) {
      this.attachFree();
      return;
    }
    const { tethers } = this.host;
    const cars = this.host.cars();
    if (this.pendingSlot >= 0) {
      if (this.sameAs(this.pendingSlot, 0)) return;
      this.aimEnd(this.pendingSlot, 1);
      this.tie(this.pendingSlot);
      this.pendingSlot = -1;
      return;
    }
    const slot = this.open();
    this.aimEnd(slot, 0);
    const player = this.host.playerCar();
    const centre = rigidCentre(cars[player]!);
    tethers.setEnd(slot, 1, player, centre.x, centre.y, centre.z);
    this.tie(slot);
    this.pendingSlot = slot;
  }

  /** The free camera's fire: an object held already and a different one aimed at make a cable between them; else the aim is held as the first. */
  private attachFree(): void {
    this.pendingSlot = -1;
    const place = this.heldPlace();
    if (place === null) {
      this.held = true;
      this.heldCar = this.aimCar;
      this.heldThing = this.aimThing;
      this.heldAt.copy(this.aimAt);
      if (this.aimCar === RAPIER && thingKind(this.aimThing) === THING.doll) {
        this.host.holdDoll(thingIndex(this.aimThing));
        if (this.host.ropes.torso(thingIndex(this.aimThing), _point, null)) this.heldOffset.subVectors(this.aimAt, _point);
      }
      return;
    }
    if (this.sameTarget(this.heldCar, this.heldThing)) return;
    const slot = this.open();
    // A car's end is a point of its frame; any other is where the held thing is now.
    const at = this.heldCar >= 0 ? this.heldAt : place;
    this.host.tethers.setEnd(slot, 0, this.heldCar, at.x, at.y, at.z, this.heldThing);
    this.aimEnd(slot, 1);
    this.tie(slot);
    this.held = false;
  }

  /** A fresh cable slot: whatever the dummies' world held in it (the oldest cable's rope, when the set was full) is let go. */
  private open(): number {
    const slot = this.host.tethers.open();
    this.untie(slot);
    return slot;
  }

  private untie(slot: number): void {
    if (this.commands[slot]! === 0) return;
    this.host.ropes.ropeCut(slot);
    this.commands[slot] = 0;
  }

  /** End `end` of cable `slot` on what the aim holds. */
  private aimEnd(slot: number, end: number): void {
    this.host.tethers.setEnd(slot, end, this.aimCar, this.aimAt.x, this.aimAt.y, this.aimAt.z, this.aimThing);
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
    this.reelSent = false;
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
