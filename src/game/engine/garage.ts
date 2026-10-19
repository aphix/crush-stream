import * as THREE from "three";
import type { DeformableCar } from "../vehicle/car.ts";
import { GarageArt, GARAGE } from "../present/garage-art.ts";
import { PUFF_STEP, type SprayBitmap } from "../present/spray.ts";
import { SPRAY_PALETTE } from "../match/look-data.ts";
import type { PlayerLooks, SprayTarget } from "./player-looks.ts";
import type { SprayTool } from "../hud/hud-store.ts";

/** The screen box the pointer's client coordinates are read in (the canvas's `getBoundingClientRect`). */
type Rect = { readonly left: number; readonly top: number; readonly width: number; readonly height: number };
type PointerMove = { readonly clientX: number; readonly clientY: number; getCoalescedEvents?(): readonly { readonly clientX: number; readonly clientY: number }[] };

/** The can's radius range (m), and what it starts at. */
export const SPRAY_RADIUS = { min: 0.02, max: 0.3, start: 0.06 } as const;

const _ndc = new THREE.Vector2();
const _p = new THREE.Vector3();
const _n = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _m = new THREE.Matrix4();
const _nm = new THREE.Matrix3();

/**
 * The garage's runtime: its set (`GarageArt`) and the spray can. With the can on, a press on what the panel edits (`editing`: the
 * car or the driver) sprays it (the camera's drag never starts) and a drag keeps spraying along the stroke; a press elsewhere,
 * the other one included, still turns the camera. Mouse and touch alike (pointer events, through the camera's `take`).
 */
export class Garage {
  readonly art = new GarageArt();
  readonly tool: SprayTool = { on: false, radius: SPRAY_RADIUS.start, colour: SPRAY_PALETTE[4]! };
  private readonly camera: THREE.Camera;
  private readonly rect: () => Rect;
  private readonly car: () => DeformableCar | undefined;
  private readonly looks: PlayerLooks;
  private readonly onSprayed: (target: SprayTarget) => void;
  private readonly ray = new THREE.Raycaster();
  /** What the panel edits (`EngineGarage.frameGarage`): the only thing the can paints. A ray passes through the other one. */
  editing: SprayTarget = "car";
  /** The stroke's target while the pointer is down, its ink (`SprayBitmap.inkOf` of the can's colour) and the last point sprayed (world). */
  private target: SprayTarget | null = null;
  private ink = 0;
  private readonly last = new THREE.Vector3();

  constructor(camera: THREE.Camera, rect: () => Rect, car: () => DeformableCar | undefined, looks: PlayerLooks, onSprayed: (target: SprayTarget) => void) {
    this.camera = camera;
    this.rect = rect;
    this.car = car;
    this.looks = looks;
    this.onSprayed = onSprayed;
  }

  down(x: number, y: number): boolean {
    if (!this.tool.on) return false;
    this.target = this.puff(x, y, true) ? this.editing : null;
    return this.target !== null;
  }

  move(e: PointerMove): void {
    if (this.target === null) return;
    const samples = e.getCoalescedEvents?.() ?? [];
    for (const s of samples.length > 0 ? samples : [e]) this.puff(s.clientX, s.clientY, false);
  }

  up(): void {
    if (this.target === null) return;
    this.looks.save(this.target);
    this.onSprayed(this.target);
    this.target = null;
  }

  /**
   * Spray `editing` at client (x, y), if it is under the point (the other target never stops the ray), with puffs filled in from
   * the last point (but on a stroke's `first`) so a fast drag leaves a line, not dots. Whether it sprayed.
   */
  private puff(x: number, y: number, first: boolean): boolean {
    const r = this.rect();
    _ndc.set(((x - r.left) / r.width) * 2 - 1, -((y - r.top) / r.height) * 2 + 1);
    this.ray.setFromCamera(_ndc, this.camera);
    const car = this.car();
    const m = car?.lookMeshes();
    const target = this.editing;
    const meshes: THREE.Object3D[] = target === "person" ? [this.art.dummy] : m ? [m.body, m.hood, m.trunk, ...m.doors] : [];
    const hit = this.ray.intersectObjects(meshes, false)[0];
    if (!hit?.face) return false;
    const bitmap = this.looks.sprayOf(target);
    const from = first ? hit.point : this.last;
    if (first) this.ink = bitmap.inkOf(this.tool.colour);
    const steps = Math.max(1, Math.ceil(from.distanceTo(hit.point) / (this.tool.radius * PUFF_STEP)));
    for (let k = 1; k <= steps; k++) {
      _p.lerpVectors(from, hit.point, k / steps);
      this.restPoint(hit, car, bitmap);
    }
    this.last.copy(hit.point);
    if (target === "person") this.art.dummy.spray(0, bitmap);
    return true;
  }

  /**
   * One puff at world point `_p` on what `hit` met (the driver, else `car`), its normal taken from the hit's face, both moved
   * into the thing's rest frame.
   */
  private restPoint(hit: THREE.Intersection, car: DeformableCar | undefined, bitmap: SprayBitmap): void {
    _n.copy(hit.face!.normal);
    if (hit.object === this.art.dummy) {
      this.art.dummy.getMatrixAt(hit.instanceId!, _m);
      _n.applyMatrix3(_nm.getNormalMatrix(_m));
      _p.sub(GARAGE.person);
    } else if (car) {
      _n.transformDirection(hit.object.matrixWorld).applyQuaternion(car.group.getWorldQuaternion(_q).invert());
      car.group.worldToLocal(_p);
    }
    bitmap.spray(_p, _n, this.tool.radius, this.ink, Math.random);
  }

  dispose(): void {
    this.art.dispose();
  }
}
