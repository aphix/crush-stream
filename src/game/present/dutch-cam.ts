import * as THREE from "three";
import type { DeformableCar } from "../vehicle/car.ts";
import { PartSeat } from "../vehicle/part-geometry.ts";
import { CINE } from "./spectate-cam.ts";

export const DUTCH = {
  /** Seconds per mount before cutting to another; after `min` s it cuts early (checked every `check` s) to a mount seeing more rivals. */
  every: 3.5,
  min: 1.2,
  check: 0.4,
  /** Roll (rad) off level, leaning away from the body; the eye hangs `out` m outboard of the body, aimed `splay` rad outward. */
  roll: 0.3,
  out: 0.32,
  splay: 0.07,
  fov: 66,
  /** Rivals further than this (m) don't count as in view. */
  range: 90,
};

/** The mounts: each wheel well (`frame.wheels` order), hanging outboard of the drawn tyre and body over the tyre's top, looking forward (even) or back (odd). */
const MOUNTS = 8;
/** How far (m) the lens's sight lines are checked against its own car's displaced parts: past the car's length, short of the next car. */
const OWN_PART_REACH = 12;
const _a = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _ray = new THREE.Ray();
const _local = new THREE.Ray();
const _ta = new THREE.Vector3();
const _tb = new THREE.Vector3();
const _tc = new THREE.Vector3();
const _hit = new THREE.Vector3();

/** `o` or a descendant draws a triangle on `ray` (world, unit direction) within `far` m. Matrices as they stand. */
function rayHitsDrawn(o: THREE.Object3D, ray: THREE.Ray, far: number): boolean {
  if (!o.visible) return false;
  const g = o instanceof PartSeat ? o.drawn : o instanceof THREE.Mesh ? (o.geometry as THREE.BufferGeometry) : null;
  // A seat with nothing drawn yet carries an empty geometry.
  const pos = g?.getAttribute("position");
  if (g && pos) {
    _local.copy(ray).applyMatrix4(_m.copy(o.matrixWorld).invert());
    const idx = g.index;
    const n = idx ? idx.count : pos.count;
    for (let k = 0; k < n; k += 3) {
      _ta.fromBufferAttribute(pos, idx ? idx.getX(k) : k);
      _tb.fromBufferAttribute(pos, idx ? idx.getX(k + 1) : k + 1);
      _tc.fromBufferAttribute(pos, idx ? idx.getX(k + 2) : k + 2);
      if (_local.intersectTriangle(_ta, _tb, _tc, false, _hit) && _hit.applyMatrix4(o.matrixWorld).distanceTo(ray.origin) <= far) return true;
    }
  }
  for (let i = 0; i < o.children.length; i++) if (rayHitsDrawn(o.children[i]!, ray, far)) return true;
  return false;
}

/**
 * Dutch-angle cam on a wheel well. About every `DUTCH.every` s it cuts to another of the eight mounts (four wells ×
 * forward / back): the one with the most rivals in its frustum, the first after the current one among ties, as long
 * as it sees as many as this one. Sooner (after `DUTCH.min` s) when another mount sees more, and at once when its own
 * car's open door or hanging panel stands in front of the lens (`clear`).
 */
export class DutchCam {
  mount = 0;
  private age = 0;
  private wait = 0;
  private car: DeformableCar | null = null;
  private readonly probe = new THREE.PerspectiveCamera();
  private readonly frustum = new THREE.Frustum();
  private readonly sphere = new THREE.Sphere(new THREE.Vector3(), 1.6);
  /** The car's displaced parts (`displacedParts`), gathered for the mount being judged. */
  private readonly own: THREE.Object3D[] = [];
  private owned = 0;
  /** Seconds to the next look at whether the lens is covered. */
  private peek = 0;

  /** Re-choose on the next `update`, starting the search after `mount` (replays: same seed, same cuts). */
  reset(mount = this.mount): void {
    this.mount = mount % MOUNTS;
    this.car = null;
  }

  /** `camera` on mount `j` of `car`: aimed along the body, splayed outward and a touch down, then rolled. */
  place(camera: THREE.PerspectiveCamera, car: DeformableCar, j: number): void {
    const w = car.wheels[j >> 1]!;
    const [wx, wy, wz] = car.frame.wheels[j >> 1]!;
    const { r, halfW } = car.frame.rig.tyre;
    const dz = j & 1 ? -1 : 1;
    // The drawn tyre is the stock one scaled by the class (`assignClass`), its hub lifted by the radius it gained.
    const x = Math.sign(wx) * (Math.max(car.frame.half.x, Math.abs(wx) + halfW * w.scale.x) + DUTCH.out);
    const y = wy + r * (2 * w.scale.y - 1);
    car.group.localToWorld(camera.position.set(x, y, wz));
    camera.lookAt(car.group.localToWorld(_a.set(x + Math.sign(x) * 10 * DUTCH.splay, y - 0.5, wz + dz * 10)));
    camera.rotateZ(Math.sign(x) * dz * DUTCH.roll);
  }

  /** Gather `car`'s displaced parts, their matrices brought up to date. */
  private gather(car: DeformableCar): void {
    this.owned = car.displacedParts(this.own, 0);
    for (let i = 0; i < this.owned; i++) this.own[i]!.updateWorldMatrix(true, true);
  }

  /** The straight line from `from` to (x, y, z) (world) passes one of the gathered parts within `OWN_PART_REACH`. */
  private blocked(from: THREE.Vector3, x: number, y: number, z: number): boolean {
    if (this.owned === 0) return false;
    _ray.origin.copy(from);
    const far = Math.min(OWN_PART_REACH, _ray.direction.set(x - from.x, y - from.y, z - from.z).length());
    _ray.direction.normalize();
    // ponytail: every triangle of every displaced part per line; a bounds test first if a wreck's torn parts make a cut cost.
    for (let i = 0; i < this.owned; i++) if (rayHitsDrawn(this.own[i]!, _ray, far)) return true;
    return false;
  }

  /**
   * Mount `j`'s view is not covered by its own car's displaced parts (an open or torn door, a hanging panel, a lid): its lines to
   * the frame's centre and to the car's flank at the end it looks toward (the subject) are clear of them.
   */
  clear(car: DeformableCar, j: number): boolean {
    this.gather(car);
    if (this.owned === 0) return true;
    const c = this.probe;
    this.place(c, car, j);
    c.getWorldDirection(_a);
    const e = c.position;
    if (this.blocked(e, e.x + _a.x * 10, e.y + _a.y * 10, e.z + _a.z * 10)) return false;
    car.group.worldToLocal(_a.copy(e));
    car.group.localToWorld(_a.set(Math.sign(_a.x) * car.frame.half.x, _a.y, (j & 1 ? -1 : 1) * car.frame.half.z));
    return !this.blocked(e, _a.x, _a.y, _a.z);
  }

  /** Rivals (not `car`, not vaporized) in mount `j`'s view within `DUTCH.range` and not behind its own car's displaced parts; `lens` gives the aspect. */
  seen(car: DeformableCar, rivals: readonly DeformableCar[], j: number, lens: THREE.PerspectiveCamera): number {
    const c = this.probe;
    c.fov = DUTCH.fov;
    c.aspect = lens.aspect;
    c.near = lens.near;
    c.far = DUTCH.range;
    c.updateProjectionMatrix();
    this.place(c, car, j);
    c.updateMatrixWorld();
    this.frustum.setFromProjectionMatrix(_m.multiplyMatrices(c.projectionMatrix, c.matrixWorldInverse));
    this.gather(car);
    let n = 0;
    for (const r of rivals) {
      if (r === car || r.vaporized || !r.group.visible) continue;
      const s = this.sphere.center.copy(r.group.position);
      s.y += CINE.aimUp;
      if (this.frustum.intersectsSphere(this.sphere) && !this.blocked(c.position, s.x, s.y, s.z)) n++;
    }
    return n;
  }

  /** Cut when due (or for a new car, or a covered lens), then put `camera` on the mount. */
  update(camera: THREE.PerspectiveCamera, car: DeformableCar, rivals: () => readonly DeformableCar[], dt: number): void {
    this.age += dt;
    this.wait -= dt;
    this.peek -= dt;
    if (this.car !== car) {
      this.car = car;
      this.choose(car, rivals(), camera);
    } else if (this.age >= DUTCH.min && this.wait <= 0) {
      this.wait = DUTCH.check;
      const all = rivals();
      // Due: to a mount seeing as many rivals as this one; before that only to one seeing more.
      this.choose(car, all, camera, this.seen(car, all, this.mount, camera) + (this.age >= DUTCH.every ? 0 : 1));
    }
    if (this.peek <= 0) {
      this.peek = DUTCH.check;
      if (!this.clear(car, this.mount)) this.choose(car, rivals(), camera);
    }
    this.place(camera, car, this.mount);
    if (camera.fov !== DUTCH.fov) {
      camera.fov = DUTCH.fov;
      camera.updateProjectionMatrix();
    }
  }

  /**
   * Cut to the clear mount (`clear`, not the current one) with the most rivals in view, the first after the current one
   * among ties, if it sees at least `need` of them. No clear mount: no cut.
   */
  choose(car: DeformableCar, rivals: readonly DeformableCar[], lens: THREE.PerspectiveCamera, need = 0): void {
    let best = -1;
    let pick = this.mount;
    for (let d = 1; d < MOUNTS; d++) {
      const j = (this.mount + d) % MOUNTS;
      if (!this.clear(car, j)) continue;
      const n = this.seen(car, rivals, j, lens);
      if (n > best) {
        best = n;
        pick = j;
      }
    }
    if (best < 0 || best < need) return;
    this.mount = pick;
    this.age = 0;
  }
}
