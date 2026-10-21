import * as THREE from "three";
import { makeWheelGeometry } from "./car-materials.ts";
import type { DeformableCar } from "./car.ts";

/**
 * How far a drawn tyre stands under the drawn skin over it (docs/UNIFIED_CONTACT.md's drawn body, not the cage): for the upper half of
 * the wheel's own mesh, the height (m) of the highest drawn triangle over each point's plan position, less the point's height; the
 * least of them. Negative: the tyre stands through the hood or fender. A point with no drawn skin over it, or only skin lower than the
 * axle (the nose crushed away, a belly), has nothing to stand through and counts for nothing.
 */
const TYRE_POINTS = makeWheelGeometry().getAttribute("position");
const AXLE_NEAR = 0.45;

const _m = new THREE.Matrix4();
const _v = new THREE.Vector3();

/** The highest triangle of `tris` over plan point (x, z), NaN if none. */
function skinTop(tris: Float32Array, x: number, z: number): number {
  let best = NaN;
  for (let t = 0; t < tris.length; t += 9) {
    const ax = tris[t]!;
    const az = tris[t + 2]!;
    const bx = tris[t + 3]!;
    const bz = tris[t + 5]!;
    const cx = tris[t + 6]!;
    const cz = tris[t + 8]!;
    const den = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz);
    if (Math.abs(den) < 1e-12) continue;
    const l1 = ((bz - cz) * (x - cx) + (cx - bx) * (z - cz)) / den;
    const l2 = ((cz - az) * (x - cx) + (ax - cx) * (z - cz)) / den;
    const l3 = 1 - l1 - l2;
    if (l1 < -1e-6 || l2 < -1e-6 || l3 < -1e-6) continue;
    const y = l1 * tris[t + 1]! + l2 * tris[t + 4]! + l3 * tris[t + 7]!;
    if (!(best >= y)) best = y;
  }
  return best;
}

/** The least clearance (m) over wheel `wheel` (`frame.wheels` order) of `car`, whose car-local drawn triangles are `tris` (`drawnTriangles`). Infinity when no point has a hood over it. */
export function tyreClearance(car: DeformableCar, wheel: number, tris: Float32Array): number {
  const w = car.wheels[wheel]!;
  w.updateMatrixWorld(true);
  _m.multiplyMatrices(car.group.matrixWorld.clone().invert(), w.matrixWorld);
  const hub = _v.setFromMatrixPosition(_m).clone();
  const near: number[] = [];
  for (let t = 0; t < tris.length; t += 9) {
    const x = Math.min(tris[t]!, tris[t + 3]!, tris[t + 6]!);
    const z = Math.min(tris[t + 2]!, tris[t + 5]!, tris[t + 8]!);
    const x1 = Math.max(tris[t]!, tris[t + 3]!, tris[t + 6]!);
    const z1 = Math.max(tris[t + 2]!, tris[t + 5]!, tris[t + 8]!);
    if (x1 < hub.x - AXLE_NEAR || x > hub.x + AXLE_NEAR || z1 < hub.z - AXLE_NEAR || z > hub.z + AXLE_NEAR) continue;
    for (let k = 0; k < 9; k++) near.push(tris[t + k]!);
  }
  const local = Float32Array.from(near);
  let least = Infinity;
  for (let i = 0; i < TYRE_POINTS.count; i++) {
    _v.fromBufferAttribute(TYRE_POINTS, i).applyMatrix4(_m);
    if (_v.y < hub.y) continue;
    const top = skinTop(local, _v.x, _v.z);
    if (!(top >= hub.y)) continue;
    least = Math.min(least, top - _v.y);
  }
  return least;
}

/** The tyre's half width across its axle and its radius, in the wheel mesh's own frame. */
const TYRE_HALF_WIDTH = Math.max(...Array.from({ length: TYRE_POINTS.count }, (_, i) => Math.abs(TYRE_POINTS.getX(i))));
const TYRE_RADIUS = Math.max(...Array.from({ length: TYRE_POINTS.count }, (_, i) => Math.hypot(TYRE_POINTS.getY(i), TYRE_POINTS.getZ(i))));
const _s = new THREE.Vector3();

/**
 * How deep (m) the drawn sill of `car` stands inside the tyre of wheel `wheel`: the body skin below the rig's `archTop`, between the axles and beyond
 * the arch plant (`archPlant` of a hub), the rocker and the arch's rear lip. 0 when none of it is inside.
 */
export function sillInTyre(car: DeformableCar, wheel: number): number {
  const d = car.deform;
  const rest = d["restPos"];
  const { archTop, archPlant } = car.frame.rig;
  const hubs = d.masses.filter((m) => m.hub);
  const front = Math.max(...hubs.map((m) => m.rest.z));
  const back = Math.min(...hubs.map((m) => m.rest.z));
  const w = car.wheels[wheel]!;
  w.updateMatrixWorld(true);
  car.body.updateMatrixWorld(true);
  _m.copy(w.matrixWorld).invert().multiply(car.body.matrixWorld);
  const scale = w.getWorldScale(_s).x;
  const pos = car.body.geometry.getAttribute("position");
  let deepest = 0;
  for (let i = 0; i < pos.count; i++) {
    const rx = rest[i * 3]!;
    const rz = rest[i * 3 + 2]!;
    if (rest[i * 3 + 1]! >= archTop || rz >= front || rz <= back || hubs.some((m) => Math.hypot(rx - m.rest.x, rz - m.rest.z) <= archPlant)) continue;
    _v.fromBufferAttribute(pos, i).applyMatrix4(_m);
    const across = Math.abs(_v.x);
    const out = Math.hypot(_v.y, _v.z);
    if (across >= TYRE_HALF_WIDTH || out >= TYRE_RADIUS) continue;
    deepest = Math.max(deepest, Math.min(TYRE_RADIUS - out, TYRE_HALF_WIDTH - across) * scale);
  }
  return deepest;
}
