import * as THREE from "three";
import type { DeformableCar } from "../vehicle/car.ts";
import { rigidCentre } from "../vehicle/car-air.ts";
import { TETHER_RANGE, WORLD, type TetherSet } from "../contact/tether.ts";
import { AIM, TetherArt, type ReticleView } from "../present/tether-art.ts";
import { DummyMesh } from "../present/ragdoll-mesh.ts";
import type { TetherHud } from "../hud/hud-store.ts";
import { TetherMouse } from "./tether-pointer.ts";

/** Seconds between two reads of the aim while no fire is waiting: the reticle's colour lags a tenth of a second, and a fire always reads it fresh. */
const AIM_PERIOD_S = 0.1;
/** How far (m) the sight line is cast, so a surface past the hook's reach still reads red instead of nothing. */
const SIGHT_M = 400;
/** Nothing nearer than this (m) to the eye is hit: the player's own chase camera sits inside its car. */
const NEAR_CLIP_M = 0.5;

/** What the director reads of the engine. */
interface TetherHost {
  readonly tethers: TetherSet;
  readonly camera: THREE.Camera;
  /** The canvas whose right and middle mouse buttons are the tether's. */
  readonly canvas: HTMLElement;
  /** The scene whose drawn meshes the sight line meets. */
  readonly scene: THREE.Object3D;
  cars(): readonly DeformableCar[];
  /** Drawn things that move and are not a car (the wheel, lamp and part batches, the balls): a cable cannot hook the place they were drawn at. */
  movers(): readonly THREE.Object3D[];
  /** The car the player's cable starts from (the driven or followed one): its index, -1 for none (the free camera, the whole field). */
  playerCar(): number;
  /** Whether the tether is on offer now: a scene is running, nothing (a menu, the garage, a reel, the walker) holds it, and this browser runs the sim. */
  offered(): boolean;
}

const _eye = new THREE.Vector3();
const _look = new THREE.Vector3();
const _point = new THREE.Vector3();
const _origin = new THREE.Vector3();

/**
 * The player's side of the tether: the aim from the camera's centre, the fire, the retract and the cut. With a car of the player's (driven or followed): a first fire hooks the target
 * and ties it to that car, the second moves the player's end to a second target (object to object), a third starts another cable. With none (the free camera): the first fire hooks
 * an object and the second another, and the cable forms between them; the reach counts from the camera. Two cables at most, the oldest goes. Fires are read at the next frame
 * (`frame`), when the cars stand where the camera saw them.
 */
export class TetherDirector {
  readonly art = new TetherArt();
  private reelHeld = false;
  private fireDue = false;
  /** The cable the first fire made and the second is to move the player's end of: -1 for none. */
  private pendingSlot = -1;
  /** Without a player's car: the first object hooked, waiting for the second (`heldCar`, a car index or `WORLD`, and `heldAt`, its car-frame or world point). */
  private held = false;
  private heldCar = WORLD;
  private readonly heldAt = new THREE.Vector3();
  private sinceAim = AIM_PERIOD_S;
  private readonly host: TetherHost;
  private readonly mouse: TetherMouse;
  private readonly raycaster = new THREE.Raycaster();
  private readonly view: ReticleView = { state: AIM.none, point: new THREE.Vector3() };
  /** What the aim would hook: a car index (or `WORLD`) and a car-frame point for a car, the world point for the world. */
  private aimCar = WORLD;
  private readonly aimAt = new THREE.Vector3();
  private readonly heldWorld = new THREE.Vector3();

  constructor(host: TetherHost) {
    this.host = host;
    this.mouse = new TetherMouse(host.canvas, { fire: () => this.fire(), cut: () => this.cut(), cabled: () => this.host.tethers.count > 0 || this.held, offered: () => this.ready() });
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
    this.pendingSlot = -1;
    this.held = false;
    this.fireDue = false;
  }

  /** The HUD's read of the tether: null while it is not on offer. */
  hud(): TetherHud | null {
    if (!this.ready()) return null;
    return { count: this.host.tethers.count, pending: this.pendingSlot >= 0 || this.held, aim: this.view.state, free: this.host.playerCar() < 0 };
  }

  /** Once per drawn frame, after the camera and the cars' drawn poses are set: the retract, the aim, a waiting fire, and the drawing. */
  frame(wallDt: number): void {
    const { tethers } = this.host;
    const ready = this.ready();
    tethers.reeling = ready && (this.mouse.reeling(wallDt) || this.reelHeld);
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
    this.mouse.dispose();
    this.art.dispose();
  }

  /** Where the held first object is now (its car's drawn pose), or null when none is held. */
  private heldPlace(): THREE.Vector3 | null {
    if (!this.held) return null;
    if (this.heldCar === WORLD) return this.heldWorld.copy(this.heldAt);
    const car = this.host.cars()[this.heldCar];
    if (car === undefined) {
      this.held = false;
      return null;
    }
    return this.heldWorld.copy(this.heldAt).applyQuaternion(car.group.quaternion).add(car.group.position);
  }

  /** The aim from the camera's centre, read as the last frame drew it: the first surface the one sight line meets. */
  private aim(): void {
    const cars = this.host.cars();
    const player = this.host.playerCar();
    this.view.state = AIM.none;
    this.aimCar = WORLD;
    const matrix = this.host.camera.matrixWorld;
    _eye.setFromMatrixPosition(matrix);
    _look.set(0, 0, -1).transformDirection(matrix);
    _origin.copy(cars[player]?.group.position ?? _eye);
    if (this.firstSurface(cars, player)) this.view.state = this.view.point.distanceTo(_origin) <= TETHER_RANGE ? AIM.valid : AIM.far;
  }

  /**
   * The first drawn surface along the sight line, the player's own car and what moves aside: a car's body is hooked at that point of its frame, anything else at
   * the world point. The same sight line and meshes as picking a car (`carAt`), the garage's spray and the showcase's shove, over the whole scene.
   */
  private firstSurface(cars: readonly DeformableCar[], player: number): boolean {
    this.raycaster.set(_eye, _look);
    this.raycaster.camera = this.host.camera;
    this.raycaster.near = NEAR_CLIP_M;
    this.raycaster.far = SIGHT_M;
    const movers = this.host.movers();
    for (const hit of this.raycaster.intersectObject(this.host.scene, true)) {
      const owner = this.solidOwner(hit.object, movers, cars);
      if (owner === undefined || owner === player) continue;
      this.view.point.copy(hit.point);
      this.aimCar = owner === null ? WORLD : owner;
      if (owner === null) this.aimAt.copy(hit.point);
      else this.aimAt.copy(cars[owner]!.group.worldToLocal(_point.copy(hit.point)));
      return true;
    }
    return false;
  }

  /** What `object` is a surface of: a car's index, null for the static world, undefined where the sight line passes through (not drawn, not a mesh, a mover, a dummy or the tether's own art). */
  private solidOwner(object: THREE.Object3D, movers: readonly THREE.Object3D[], cars: readonly DeformableCar[]): number | null | undefined {
    if (!(object instanceof THREE.Mesh)) return undefined;
    let owner: number | null = null;
    for (let o: THREE.Object3D | null = object; o; o = o.parent) {
      if (!o.visible || o === this.art.group || o instanceof DummyMesh || movers.includes(o)) return undefined;
      const index: unknown = o.userData.carIndex;
      if (typeof index === "number" && cars[index]?.group === o) owner = index;
    }
    return owner;
  }

  /** A waiting fire. With a player's car: the first hooks the target to it, the second moves the player's end to the new target. Without: the first holds the object, the second ties the two. */
  private attach(): void {
    if (this.view.state !== AIM.valid) return;
    if (this.host.playerCar() < 0) {
      this.attachFree();
      return;
    }
    const { tethers } = this.host;
    const cars = this.host.cars();
    if (this.pendingSlot >= 0) {
      if (this.aimCar === tethers.endCar(this.pendingSlot, 0)) return;
      this.aimEnd(this.pendingSlot, 1);
      tethers.fit(this.pendingSlot, cars);
      this.pendingSlot = -1;
      return;
    }
    const slot = tethers.open();
    this.aimEnd(slot, 0);
    const player = this.host.playerCar();
    const centre = rigidCentre(cars[player]!);
    tethers.setEnd(slot, 1, player, centre.x, centre.y, centre.z);
    tethers.fit(slot, cars);
    this.pendingSlot = slot;
  }

  /** The free camera's fire: an object held already and a different one aimed at make a cable between them; else the aim is held as the first. */
  private attachFree(): void {
    this.pendingSlot = -1;
    if (!this.held) {
      this.held = true;
      this.heldCar = this.aimCar;
      this.heldAt.copy(this.aimAt);
      return;
    }
    if (this.aimCar === this.heldCar) return;
    const { tethers } = this.host;
    const slot = tethers.open();
    tethers.setEnd(slot, 0, this.heldCar, this.heldAt.x, this.heldAt.y, this.heldAt.z);
    this.aimEnd(slot, 1);
    tethers.fit(slot, this.host.cars());
    this.held = false;
  }

  /** End `end` of cable `slot` on what the aim holds. */
  private aimEnd(slot: number, end: number): void {
    this.host.tethers.setEnd(slot, end, this.aimCar, this.aimAt.x, this.aimAt.y, this.aimAt.z);
  }
}
