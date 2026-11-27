import * as THREE from "three";

/** Fewer instances than this are not worth a proxy. */
export const PROXY_MIN_INSTANCES = 96;
/** Instances this far (m) outside the shadow box's sides are kept, so a box that moved less than half of it needs no rebuild. */
const SLACK = 10;
/** Two planes of an orthographic frustum face opposite ways; a perspective one's sides never do this squarely. */
const OPPOSED = -0.999;
/** A shadow plane whose normal moved more than this (sum of components) since the build forces a rebuild: far instances shift by distance times it. */
const NORMAL_DRIFT = 0.004;
const SIDES = 4;
const PLANE_FLOATS = 4;
const MATRIX_FLOATS = 16;
const COLOUR_FLOATS = 3;

type AnyFrustum = THREE.Frustum | THREE.FrustumArray;

function isOrthographic(frustum: AnyFrustum): frustum is THREE.Frustum {
  if (!("planes" in frustum)) return false;
  const planes = frustum.planes;
  const a = planes[0]!.normal;
  const b = planes[1]!.normal;
  const c = planes[2]!.normal;
  const d = planes[3]!.normal;
  return a.x * b.x + a.y * b.y + a.z * b.z < OPPOSED && c.x * d.x + c.y * d.y + c.z * d.z < OPPOSED;
}

/**
 * The sun's shadow pass drew every instance of a city-wide mesh whatever the shadow box held. The proxy is the shadow pass's copy of `source`:
 * only the instances whose reach touches the box's four sides (three's own frustum test sees one sphere round all of them), rebuilt when the box or the instances move.
 * The source is skipped by orthographic frustums and the proxy by every other, so the main pass and the picture are unchanged.
 */
export class ShadowProxy {
  readonly mesh: THREE.InstancedMesh;
  private readonly source: THREE.InstancedMesh;
  /** How far (m, before the instance's scale) the geometry reaches from its origin. */
  private readonly reach: number;
  private readonly planes = new Float64Array(SIDES * PLANE_FLOATS);
  private built = false;
  private version = -1;
  private sourceCount = -1;
  private kept = 0;
  /** The upload ranges handed to three, reused so a rebuild allocates nothing. */
  private readonly matrixRange = { start: 0, count: 0 };
  private readonly colourRange = { start: 0, count: 0 };

  constructor(source: THREE.InstancedMesh) {
    this.source = source;
    const geometry = source.geometry;
    if (geometry.boundingSphere === null) geometry.computeBoundingSphere();
    const sphere = geometry.boundingSphere!;
    this.reach = sphere.center.length() + sphere.radius;
    const capacity = source.instanceMatrix.count;
    const proxy = new THREE.InstancedMesh(geometry, source.material, capacity);
    proxy.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    if (source.instanceColor !== null) {
      proxy.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(capacity * COLOUR_FLOATS), COLOUR_FLOATS);
      proxy.instanceColor.setUsage(THREE.DynamicDrawUsage);
    }
    proxy.count = 0;
    proxy.castShadow = true;
    proxy.customDepthMaterial = source.customDepthMaterial;
    // The proxy's instances are a moving subset: a ray would meet stale copies of what the source already answers.
    proxy.raycast = () => {};
    proxy.matrixAutoUpdate = false;
    proxy.matrixWorldAutoUpdate = false;
    proxy.intersectsFrustum = (frustum) => isOrthographic(frustum) && this.intersects(frustum);
    source.intersectsFrustum = (frustum) => !isOrthographic(frustum) && frustum.intersectsObject(source);
    this.mesh = proxy;
  }

  /** Whether the proxy draws into the pass `frustum` makes: an orthographic one with an instance in reach; its draw count is set here, before three uploads the instances. */
  private intersects(frustum: THREE.Frustum): boolean {
    if (this.stale(frustum)) this.rebuild(frustum);
    this.mesh.count = this.kept;
    return this.kept > 0;
  }

  private stale(frustum: THREE.Frustum): boolean {
    if (!this.built || this.source.instanceMatrix.version !== this.version || this.source.count !== this.sourceCount) return true;
    for (let side = 0; side < SIDES; side++) {
      const plane = frustum.planes[side]!;
      const at = side * PLANE_FLOATS;
      const drift = Math.abs(plane.normal.x - this.planes[at]!) + Math.abs(plane.normal.y - this.planes[at + 1]!) + Math.abs(plane.normal.z - this.planes[at + 2]!);
      if (drift > NORMAL_DRIFT || Math.abs(plane.constant - this.planes[at + 3]!) > SLACK / 2) return true;
    }
    return false;
  }

  private rebuild(frustum: THREE.Frustum): void {
    const { source, planes, reach } = this;
    for (let side = 0; side < SIDES; side++) {
      const plane = frustum.planes[side]!;
      const at = side * PLANE_FLOATS;
      planes[at] = plane.normal.x;
      planes[at + 1] = plane.normal.y;
      planes[at + 2] = plane.normal.z;
      planes[at + 3] = plane.constant;
    }
    const from = source.instanceMatrix.array as Float32Array;
    const to = this.mesh.instanceMatrix.array as Float32Array;
    const colourFrom = source.instanceColor?.array as Float32Array | undefined;
    const colourTo = this.mesh.instanceColor?.array as Float32Array | undefined;
    const count = source.count;
    let kept = 0;
    for (let instance = 0; instance < count; instance++) {
      const o = instance * MATRIX_FLOATS;
      const scale = Math.sqrt(from[o]! ** 2 + from[o + 1]! ** 2 + from[o + 2]! ** 2 + from[o + 4]! ** 2 + from[o + 5]! ** 2 + from[o + 6]! ** 2 + from[o + 8]! ** 2 + from[o + 9]! ** 2 + from[o + 10]! ** 2);
      const slack = scale * reach + SLACK;
      const x = from[o + 12]!;
      const y = from[o + 13]!;
      const z = from[o + 14]!;
      let inside = true;
      for (let side = 0; side < SIDES && inside; side++) {
        const at = side * PLANE_FLOATS;
        inside = planes[at]! * x + planes[at + 1]! * y + planes[at + 2]! * z + planes[at + 3]! >= -slack;
      }
      if (!inside) continue;
      for (let k = 0; k < MATRIX_FLOATS; k++) to[kept * MATRIX_FLOATS + k] = from[o + k]!;
      if (colourFrom !== undefined && colourTo !== undefined) for (let k = 0; k < COLOUR_FLOATS; k++) colourTo[kept * COLOUR_FLOATS + k] = colourFrom[instance * COLOUR_FLOATS + k]!;
      kept++;
    }
    this.kept = kept;
    this.built = true;
    this.version = source.instanceMatrix.version;
    this.sourceCount = count;
    if (kept === 0) return;
    this.matrixRange.count = kept * MATRIX_FLOATS;
    this.mesh.instanceMatrix.updateRanges.length = 0;
    this.mesh.instanceMatrix.updateRanges[0] = this.matrixRange;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor === null) return;
    this.colourRange.count = kept * COLOUR_FLOATS;
    this.mesh.instanceColor.updateRanges.length = 0;
    this.mesh.instanceColor.updateRanges[0] = this.colourRange;
    this.mesh.instanceColor.needsUpdate = true;
  }
}
