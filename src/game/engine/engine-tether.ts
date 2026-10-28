import * as THREE from "three";
import type { DeformableCar } from "../vehicle/car.ts";
import { rigidCentre } from "../vehicle/car-air.ts";
import { TETHER_RANGE, WORLD, type TetherSet } from "../contact/tether.ts";
import { AIM, TetherArt, type AimState, type ReticleView } from "../present/tether-art.ts";
import { activeGround, NO_FLOOR, type Ground } from "../world/ground.ts";
import type { TetherHud } from "../hud/hud-store.ts";

/** Half angle (degrees) of the cone round the reticle that snaps to a car it does not quite cover: the 10° the research gives for a player on foot, a little under what a driver gets. */
const SNAP_DEG = 10;
const SNAP_TAN = Math.tan(THREE.MathUtils.degToRad(SNAP_DEG));
/** Seconds between two reads of the aim while no fire is waiting: the reticle's colour lags a tenth of a second, and a fire always reads it fresh. */
const AIM_PERIOD_S = 0.1;
/** The ground search walks the sight line in steps of this many metres, then bisects the step that crossed (`BISECT_STEPS`). */
const GROUND_STEP_M = 0.5;
const BISECT_STEPS = 8;
/** A car is never aimed at from inside this distance (m) of the eye: the player's own chase camera sits at it. */
const NEAR_CLIP_M = 0.5;

/** What the director reads of the engine. */
interface TetherHost {
  readonly tethers: TetherSet;
  readonly camera: THREE.Camera;
  cars(): readonly DeformableCar[];
  /** The car the player's cable starts from (the driven or followed one): its index, -1 for none. */
  playerCar(): number;
  /** Whether the tether is on offer now: a scene is running, nothing (a menu, the garage, a reel, the walker) holds it, and this browser runs the sim. */
  offered(): boolean;
}

const _eye = new THREE.Vector3();
const _look = new THREE.Vector3();
const _point = new THREE.Vector3();
const _step = new THREE.Vector3();
const _origin = new THREE.Vector3();

/**
 * The player's side of the tether: the aim from the camera's centre, the fire, the retract and the cut. A first fire hooks the target and ties it to the player's car;
 * the second moves the player's end to a second target (object to object); a third starts another cable, and the oldest goes when two are out.
 * Fires are read at the next frame (`frame`), when the cars stand where the camera saw them.
 */
export class TetherDirector {
  readonly art = new TetherArt();
  private reelHeld = false;
  private fireDue = false;
  /** The cable the first fire made and the second is to move the player's end of: -1 for none. */
  private pendingSlot = -1;
  private sinceAim = AIM_PERIOD_S;
  private readonly host: TetherHost;
  private readonly raycaster = new THREE.Raycaster();
  private readonly view: ReticleView = { state: AIM.none, point: new THREE.Vector3() };
  /** What the aim would hook: a car index (or `WORLD`) and a car-frame point for a car, the world point for the world. */
  private aimCar = WORLD;
  private readonly aimAt = new THREE.Vector3();

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
    this.pendingSlot = -1;
    this.fireDue = false;
  }

  /** The HUD's read of the tether: null while it is not on offer. */
  hud(): TetherHud | null {
    return this.ready() ? { count: this.host.tethers.count, pending: this.pendingSlot >= 0, aim: this.view.state } : null;
  }

  /** Once per drawn frame, after the camera and the cars' drawn poses are set: the retract, the aim, a waiting fire, and the drawing. */
  frame(wallDt: number): void {
    const { tethers } = this.host;
    const ready = this.ready();
    tethers.reeling = ready && this.reelHeld;
    if (this.pendingSlot >= 0 && !tethers.isAlive(this.pendingSlot)) this.pendingSlot = -1;
    this.sinceAim += wallDt;
    if (ready && (this.fireDue || this.sinceAim >= AIM_PERIOD_S)) {
      this.sinceAim = 0;
      this.aim();
    }
    if (ready && this.fireDue) this.attach();
    this.fireDue = false;
    this.art.update(tethers, this.host.cars(), this.host.camera, ready ? this.view : null);
  }

  /** The tether is on offer and the player has a car to cable from. */
  private ready(): boolean {
    return this.host.offered() && this.host.playerCar() >= 0;
  }

  dispose(): void {
    this.art.dispose();
  }

  /** The aim from the camera's centre, read as the last frame drew it: a car under the sight line, else a car near it, else the ground. */
  private aim(): void {
    const cars = this.host.cars();
    const player = this.host.playerCar();
    this.view.state = AIM.none;
    this.aimCar = WORLD;
    if (player < 0 || cars[player] === undefined) return;
    const matrix = this.host.camera.matrixWorld;
    _eye.setFromMatrixPosition(matrix);
    _look.set(0, 0, -1).transformDirection(matrix);
    _origin.copy(cars[player]!.group.position);
    if (this.castCar(cars, player) || this.snapCar(cars, player) || this.castGround()) this.view.state = this.reach(_origin);
  }

  /** In reach of `from` (m) or not. */
  private reach(from: THREE.Vector3): AimState {
    return this.view.point.distanceTo(from) <= TETHER_RANGE ? AIM.valid : AIM.far;
  }

  /** The nearest car, but the player's, the sight line crosses: its car-frame point under the view's point. */
  private castCar(cars: readonly DeformableCar[], player: number): boolean {
    this.raycaster.set(_eye, _look);
    this.raycaster.near = NEAR_CLIP_M;
    this.raycaster.far = TETHER_RANGE + _eye.distanceTo(_origin);
    const groups: THREE.Object3D[] = [];
    for (let i = 0; i < cars.length; i++) if (i !== player && cars[i]!.group.visible && !cars[i]!.stored) groups.push(cars[i]!.group);
    for (const hit of this.raycaster.intersectObjects(groups, true)) {
      for (let obj: THREE.Object3D | null = hit.object; obj; obj = obj.parent) {
        const index: unknown = obj.userData.carIndex;
        if (typeof index !== "number" || cars[index]?.group !== obj) continue;
        this.view.point.copy(hit.point);
        this.aimCar = index;
        this.aimAt.copy(obj.worldToLocal(_point.copy(hit.point)));
        return true;
      }
    }
    return false;
  }

  /** The car whose centre lies nearest the sight line, within `SNAP_DEG` of it: hooked at its centre of mass. */
  private snapCar(cars: readonly DeformableCar[], player: number): boolean {
    let best = Infinity;
    for (let i = 0; i < cars.length; i++) {
      const car = cars[i]!;
      if (i === player || !car.group.visible || car.stored) continue;
      _step.copy(car.group.position).sub(_eye);
      const along = _step.dot(_look);
      if (along <= NEAR_CLIP_M) continue;
      const offAxis = Math.sqrt(Math.max(0, _step.lengthSq() - along * along)) / along;
      if (offAxis > SNAP_TAN || offAxis >= best) continue;
      best = offAxis;
      this.aimCar = i;
    }
    if (this.aimCar === WORLD) return false;
    const car = cars[this.aimCar]!;
    this.aimAt.copy(rigidCentre(car));
    this.view.point.copy(this.aimAt).applyQuaternion(car.group.quaternion).add(car.group.position);
    return true;
  }

  /** Where the sight line first goes under the active ground within reach of the eye, as a world point. */
  private castGround(): boolean {
    const ground = activeGround();
    const reach = TETHER_RANGE + _eye.distanceTo(_origin);
    let near = 0;
    for (let far = GROUND_STEP_M; far <= reach; far += GROUND_STEP_M) {
      if (!this.under(ground, far)) {
        near = far;
        continue;
      }
      for (let i = 0; i < BISECT_STEPS; i++) {
        const mid = (near + far) / 2;
        if (this.under(ground, mid)) far = mid;
        else near = mid;
      }
      this.under(ground, far);
      this.view.point.copy(_point);
      this.aimAt.copy(_point);
      return true;
    }
    return false;
  }

  /** Whether the sight line's point `t` m from the eye is under the ground, `_point` left on it. */
  private under(ground: Ground, t: number): boolean {
    _point.copy(_eye).addScaledVector(_look, t);
    const floor = ground.heightAt(_point.x, _point.z, _point.y);
    return floor !== NO_FLOOR && _point.y <= floor;
  }

  /** A waiting fire: the first hooks the target to the player's car; the second moves the player's end to the new target. */
  private attach(): void {
    if (this.view.state !== AIM.valid) return;
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

  /** End `end` of cable `slot` on what the aim holds. */
  private aimEnd(slot: number, end: number): void {
    this.host.tethers.setEnd(slot, end, this.aimCar, this.aimAt.x, this.aimAt.y, this.aimAt.z);
  }
}
