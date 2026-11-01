import * as THREE from "three";
import { GRAVITY } from "../kernel/constants.ts";
import { detCos, detSin, hypot2 } from "../kernel/physics-core.js";
import { SLOTS } from "../present/ragdoll-config.ts";
import { colliderSolids, type Solid } from "../present/ragdoll-solids.ts";
import { DummyMesh } from "../present/ragdoll-mesh.ts";
import type { RagdollSystem } from "../present/engine-ragdoll.ts";
import { SHOWCASE_PROPS, ShowcaseArt, THROWN_KINDS, THROWN_PER_KIND } from "../present/showcase-art.ts";
import type { DeformableCar } from "../vehicle/car.ts";
import { DISC_GROUND } from "../world/ground.ts";
import { propColliders, solidsOf, type PropCollider } from "../world/placements.ts";
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
   * Number key `digit` (the row's or the pad's): 1 to 7 throw `THROWN_KINDS`' props in order (the cone, crate, tyre stack, hay bale,
   * the muscle car's bumper, the monster truck's wheel, a car's wheel), 8 a man and 9 a woman, each at what is under the cursor at
   * (`x`, `y`, client px; NaN: the view's middle); 0 clears everything thrown. Whether anything flew.
   */
  key(digit: number, x: number, y: number): boolean {
    if (digit === 0) {
      this.clear();
      return true;
    }
    const n = digit - 1;
    return n < THROWN_KINDS.length ? this.throwProp(n, x, y) : this.throwFigure(n - THROWN_KINDS.length, x, y);
  }

  /**
   * Prop `kind` (`THROWN_KINDS`), its kind's oldest, flies at what is under the cursor (`aimThrow`): through the dummies' world, as a
   * car-knocked prop does. Whether it flew (not while Rapier loads, nor at the sky).
   */
  throwProp(kind: number, x: number, y: number): boolean {
    if (kind < 0 || kind >= THROWN_KINDS.length || !this.aimThrow(x, y)) return false;
    const index = kind * THROWN_PER_KIND + this.next[kind]!;
    if (!this.ragdolls.throwProp(index, _at, _v)) return false;
    this.next[kind] = (this.next[kind]! + 1) % THROWN_PER_KIND;
    return true;
  }

  /** Figure `which` of the set (0 the man, 1 the woman) is thrown at what is under the cursor as a new dummy (`ShowcaseWalks.throwFigure`). Whether he flew. */
  throwFigure(which: number, x: number, y: number): boolean {
    return (which === 0 || which === 1) && this.aimThrow(x, y) && this.walks.throwFigure(which, _at, _v) >= 0;
  }

  /** Every thrown prop is back under the floor, every thrown dummy gone, and the next throw of each kind is the first again. */
  clear(): void {
    this.next.fill(0);
    this.ragdolls.clearProps();
    this.walks.clearThrown();
  }

  /**
   * Into `_at` where a throw at client point (`x`, `y`) leaves (`THROW_AHEAD` m out along the cursor's ray from the eye) and into `_v` its velocity: at
   * `THROW_MPS` level, lobbed to land on what the ray meets first, a figure, a car or a piece of the set, else the floor. False at the sky.
   */
  private aimThrow(x: number, y: number): boolean {
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

  /** Everyone stands on his mark, every thrown prop is back under the floor and no dummy is thrown. The dummies' world holds the set's props and what stands in it: the gallery's solids and the cars, and room for `SLOTS` dummies (the pool builds them as throws fill it). */
  reset(): void {
    this.walks.reset();
    this.next.fill(0);
    this.ragdolls.setCapacity(SLOTS);
    this.ragdolls.setSolids(DISC_GROUND, this.solids(), SHOWCASE_PROPS, this.art.props);
  }

  /** What a dummy or a thrown prop meets in the set, as a car meets it: the gallery's solid prefabs and each parked car's plan box over its height. */
  private solids(): Solid[] {
    const cars = this.cars.map((car, k): PropCollider => {
      const [left, right, rear, front] = car.cage.fields.planBox;
      const yaw = car.group.rotation.y;
      const across = (left! + right!) / 2;
      const ahead = (rear! + front!) / 2;
      const hx = (right! - left!) / 2;
      const hz = (front! - rear!) / 2;
      return {
        index: SHOWCASE_PROPS.length + k,
        prefab: null,
        body: "solid",
        x: car.group.position.x + across * detCos(yaw) + ahead * detSin(yaw),
        z: car.group.position.z - across * detSin(yaw) + ahead * detCos(yaw),
        yaw,
        kind: "box",
        r: hypot2(hx, hz),
        hx,
        hz,
        mass: 0,
        base: 0,
        top: car.style.dims.height,
        ends: 3,
      };
    });
    return colliderSolids(solidsOf([], [...propColliders(SHOWCASE_PROPS), ...cars]), []);
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
