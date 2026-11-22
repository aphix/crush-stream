import * as THREE from "three";

const _sphere = new THREE.Sphere();
const _sphereHitAt = new THREE.Vector3();
const _ray = new THREE.Ray();
const _inverse = new THREE.Matrix4();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const _at = new THREE.Vector3();
const _world = new THREE.Vector3();
/** What a mesh that is not a plain one (`plainMesh`) hands back: three's own raycast, kept between shots. */
const _theirs: THREE.Intersection[] = [];

/**
 * The hit `Raycaster.intersectObjects(roots, true)` sorts first, kept as it is found: the nearest, the first found of equals. A plain mesh's
 * triangles are read from its arrays as `Mesh.raycast` reads them through its getters, which box each double they return when not inlined
 * (about 270 KB a car shot), and no hit object is made; any other object is asked by its own `raycast`.
 */
export class RayNearest {
  /** The object hit (null: none), the world point and its distance along the ray (m). */
  object: THREE.Object3D | null = null;
  readonly point = new THREE.Vector3();
  distance = Infinity;

  /** The nearest hit of `raycaster` on `roots` and all of their descendants. */
  find(raycaster: THREE.Raycaster, roots: readonly THREE.Object3D[]): void {
    this.object = null;
    this.distance = Infinity;
    for (let at = 0; at < roots.length; at++) this.visit(roots[at]!, raycaster);
  }

  /** Lets the hit object go (it holds a mesh) until the next `find`. */
  release(): void {
    this.object = null;
  }

  private visit(object: THREE.Object3D, raycaster: THREE.Raycaster): void {
    if (object.layers.test(raycaster.layers)) {
      if (plainMesh(object)) this.mesh(object, raycaster);
      else if (this.theirs(object, raycaster)) return;
    }
    const children = object.children;
    for (let at = 0; at < children.length; at++) this.visit(children[at]!, raycaster);
  }

  /** `object.raycast` into a kept list, its nearest kept; true when it asks that its children not be tested (three's `raycast` returning false). */
  private theirs(object: THREE.Object3D, raycaster: THREE.Raycaster): boolean {
    _theirs.length = 0;
    const answer: unknown = object.raycast(raycaster, _theirs);
    const stop = answer === false;
    for (let at = 0; at < _theirs.length; at++) this.offer(_theirs[at]!.object, _theirs[at]!.point, _theirs[at]!.distance);
    _theirs.length = 0;
    return stop;
  }

  /** `Mesh.raycast` on a plain mesh: its world bounding sphere, its local bounding box, then each triangle it draws. */
  private mesh(mesh: THREE.Mesh, raycaster: THREE.Raycaster): void {
    const geometry = mesh.geometry;
    const material = mesh.material;
    if (material === undefined) return;
    if (geometry.boundingSphere === null) geometry.computeBoundingSphere();
    _sphere.copy(geometry.boundingSphere!).applyMatrix4(mesh.matrixWorld);
    _ray.copy(raycaster.ray).recast(raycaster.near);
    if (!_sphere.containsPoint(_ray.origin)) {
      if (_ray.intersectSphere(_sphere, _sphereHitAt) === null) return;
      if (_ray.origin.distanceToSquared(_sphereHitAt) > (raycaster.far - raycaster.near) ** 2) return;
    }
    _inverse.copy(mesh.matrixWorld).invert();
    _ray.copy(raycaster.ray).applyMatrix4(_inverse);
    if (geometry.boundingBox !== null && !_ray.intersectsBox(geometry.boundingBox)) return;
    const index = geometry.index;
    const drawRange = geometry.drawRange;
    const count = index !== null ? index.count : geometry.getAttribute("position").count;
    if (!Array.isArray(material)) {
      this.triangles(mesh, material, raycaster, Math.max(0, drawRange.start), Math.min(count, drawRange.start + drawRange.count));
      return;
    }
    const groups = geometry.groups;
    for (let at = 0; at < groups.length; at++) {
      const group = groups[at]!;
      const start = Math.max(group.start, drawRange.start);
      const end = Math.min(count, Math.min(group.start + group.count, drawRange.start + drawRange.count));
      this.triangles(mesh, material[group.materialIndex ?? 0]!, raycaster, start, end);
    }
  }

  /** The triangles from vertex `start` (of the index when the geometry has one) up to `end`, each as `checkIntersection` tests it. */
  private triangles(mesh: THREE.Mesh, material: THREE.Material, raycaster: THREE.Raycaster, start: number, end: number): void {
    const geometry = mesh.geometry;
    const position = geometry.getAttribute("position");
    const points = position.array;
    const size = position.itemSize;
    const index = geometry.index === null ? null : geometry.index.array;
    const back = material.side === THREE.BackSide;
    const cull = material.side === THREE.FrontSide;
    for (let j = start; j < end; j += 3) {
      const a = (index === null ? j : index[j]!) * size;
      const b = (index === null ? j + 1 : index[j + 1]!) * size;
      const c = (index === null ? j + 2 : index[j + 2]!) * size;
      _a.set(points[a]!, points[a + 1]!, points[a + 2]!);
      _b.set(points[b]!, points[b + 1]!, points[b + 2]!);
      _c.set(points[c]!, points[c + 1]!, points[c + 2]!);
      const hit = back ? _ray.intersectTriangle(_c, _b, _a, true, _at) : _ray.intersectTriangle(_a, _b, _c, cull, _at);
      if (hit === null) continue;
      _world.copy(_at).applyMatrix4(mesh.matrixWorld);
      const distance = raycaster.ray.origin.distanceTo(_world);
      if (distance < raycaster.near || distance > raycaster.far) continue;
      this.offer(mesh, _world, distance);
    }
  }

  private offer(object: THREE.Object3D, point: THREE.Vector3, distance: number): void {
    if (distance >= this.distance) return;
    this.object = object;
    this.point.copy(point);
    this.distance = distance;
  }
}

/**
 * A mesh `RayNearest` reads raw: three's own `Mesh` raycast and vertex read (not an instanced or skinned mesh's), plain float positions,
 * no morph targets in play and a plain index, so each triangle reads as `getVertexPosition` would read it.
 */
function plainMesh(object: THREE.Object3D): object is THREE.Mesh {
  if (!(object instanceof THREE.Mesh) || object.raycast !== THREE.Mesh.prototype.raycast || object.getVertexPosition !== THREE.Mesh.prototype.getVertexPosition) return false;
  const geometry: THREE.BufferGeometry = object.geometry;
  const position = geometry.attributes.position;
  if (!(position instanceof THREE.BufferAttribute) || position.normalized || !(position.array instanceof Float32Array)) return false;
  if (geometry.morphAttributes.position !== undefined && object.morphTargetInfluences !== undefined) return false;
  return geometry.index === null || !geometry.index.normalized;
}
