import * as THREE from "three";
import { GRAVITY } from "../kernel/constants.ts";
import { hypot2 } from "../kernel/physics-core.js";
import { DummyMesh } from "../present/ragdoll-mesh.ts";
import type { RagdollSystem } from "../present/engine-ragdoll.ts";
import { SHOWCASE_THROWN, ShowcaseArt, THROWN_KINDS, THROWN_PER_KIND } from "../present/showcase-art.ts";
import type { DeformableCar } from "../vehicle/car.ts";
import { DISC_GROUND } from "../world/ground.ts";
import { ShowcaseWalks } from "./showcase-walks.ts";

/** The screen box the pointer's client coordinates are read in (the canvas's `getBoundingClientRect`). */
type Rect = { readonly left: number; readonly top: number; readonly width: number; readonly height: number };

/** A number key's prop leaves this fast (m/s, its level speed toward the point under the cursor), from this far (m) out along the cursor's ray from the eye. */
const THROW_MPS = 15;
const THROW_AHEAD = 1;
/** A standing figure's middle over his mark (m) and how far (m) round it his body reaches: a thrown prop flying within it, this frame or the next, finds him in the ragdoll world. */
const FIGURE_MIDDLE = 0.9;
const FIGURE_REACH = 0.9;

const _ndc = new THREE.Vector2();
const _facing = new THREE.Vector3();
const _at = new THREE.Vector3();
const _to = new THREE.Vector3();
const _v = new THREE.Vector3();
const _mark = new THREE.Vector3();
const FLOOR = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

/**
 * The showcase's runtime (`#scene=showcase`, reachable by link only): its set (`ShowcaseArt`), its people and its cars, the
 * press that knocks a figure over, and the number keys that throw a knockable prop at the point under the cursor. A press on a
 * standing figure hands him to `knock` (the ragdoll world takes him, as it takes a guard a car runs down) and the set lets him go;
 * a press elsewhere still turns the camera. A thrown prop is the scene's own (`SHOWCASE_THROWN`) and flies as a car-knocked one
 * does; a figure it is about to reach steps into the ragdoll world to meet it. A reset stands everyone up again.
 */
export class Showcase {
  readonly art = new ShowcaseArt();
  /** The set's cars (`art.carOf`), built on first entering the scene: drawn, never stepped. */
  readonly cars: DeformableCar[] = [];
  private readonly camera: THREE.Camera;
  private readonly rect: () => Rect;
  private readonly walks: ShowcaseWalks;
  private readonly ragdolls: RagdollSystem;
  private readonly ray = new THREE.Raycaster();
  /** Per kind (`THROWN_KINDS`), the one of its `THROWN_PER_KIND` its key throws next: the oldest. */
  private readonly next = new Uint8Array(THROWN_KINDS.length);

  constructor(camera: THREE.Camera, rect: () => Rect, ragdolls: RagdollSystem) {
    this.camera = camera;
    this.rect = rect;
    this.ragdolls = ragdolls;
    this.walks = new ShowcaseWalks(this.art, ragdolls);
  }

  down(x: number, y: number): boolean {
    this.aim(x, y);
    const away = this.ragdolls.pickMesh;
    const hit = this.ray.intersectObjects([this.art.people.group, away], true).find((h) => h.object instanceof DummyMesh && (h.object !== away || this.walks.isAway(h.instanceId ?? -1)));
    if (hit?.instanceId === undefined) return false;
    this.camera.getWorldDirection(_facing);
    if (hit.object === away) this.walks.knockAgain(hit.instanceId, hit.point, _facing);
    else this.walks.knock(hit.instanceId, hit.point, _facing);
    return true;
  }

  /**
   * Number key `kind` (`THROWN_KINDS`: 0 the cone, 1 the crate, 2 the tyre stack, 3 the hay bale) throws that prop, its kind's oldest,
   * at what is under the cursor at (`x`, `y`, client px; NaN: the view's middle): the first figure, car or piece of the set the
   * cursor's ray meets, else the floor. It leaves `THROW_AHEAD` m out along that ray at `THROW_MPS` level, lobbed to land there.
   * Whether it flew (not while Rapier loads, nor at the sky).
   */
  throwProp(kind: number, x: number, y: number): boolean {
    if (kind < 0 || kind >= THROWN_KINDS.length) return false;
    this.aim(x, y);
    const ray = this.ray.ray;
    const hit = this.ray.intersectObjects([this.art.group, this.ragdolls.pickMesh, ...this.cars.map((c) => c.group)], true)[0];
    if (hit) _to.copy(hit.point);
    else if (ray.intersectPlane(FLOOR, _to) === null) return false;
    _at.copy(ray.origin).addScaledVector(ray.direction, THROW_AHEAD);
    _v.subVectors(_to, _at);
    const t = hypot2(_v.x, _v.z) / THROW_MPS;
    if (t === 0) return false;
    // Level at THROW_MPS and up by half its fall over that time: it is at the point when it gets there.
    _v.multiplyScalar(1 / t);
    _v.y += (GRAVITY * t) / 2;
    const index = kind * THROWN_PER_KIND + this.next[kind]!;
    if (!this.ragdolls.throwProp(index, _at, _v)) return false;
    this.next[kind] = (this.next[kind]! + 1) % THROWN_PER_KIND;
    return true;
  }

  /** One frame before the ragdoll world steps: a figure a thrown prop is about to reach steps into it; the figures away get up and walk home. */
  step(wallDt: number): void {
    for (let figure = 0; figure < this.art.slots; figure++) {
      if (!this.walks.onSet(figure)) continue;
      this.art.markOf(figure, _mark).y += FIGURE_MIDDLE;
      if (this.ragdolls.flyingPropNear(_mark, FIGURE_REACH, 2 * wallDt)) this.walks.stepIn(figure);
    }
    this.walks.step(wallDt);
  }

  /** Everyone stands on his mark, and every thrown prop is back under the floor, the set's props the dummies' world holds. */
  reset(): void {
    this.walks.reset();
    this.next.fill(0);
    this.ragdolls.setSolids(DISC_GROUND, [], SHOWCASE_THROWN, this.art.thrown);
  }

  move(): void {}

  up(): void {}

  dispose(): void {
    this.art.dispose();
  }

  /** The ray from the eye through client point (`x`, `y`); NaN: the view's middle. */
  private aim(x: number, y: number): void {
    const r = this.rect();
    if (Number.isNaN(x) || Number.isNaN(y)) _ndc.set(0, 0);
    else _ndc.set(((x - r.left) / r.width) * 2 - 1, -((y - r.top) / r.height) * 2 + 1);
    this.ray.setFromCamera(_ndc, this.camera);
  }
}
