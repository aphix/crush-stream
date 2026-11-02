import type * as THREE from "three";
import { computeNormalsFast } from "../deform/fast-normals.ts";

/** A trim's points each tied to the body vertex nearest it at rest: `vertex` (index) and `offset` (xyz, car frame) from that vertex to the point. */
export interface SkinRide {
  readonly vertex: Int32Array;
  readonly offset: Float32Array;
}

/** Ties each point of `rest` (in a frame seated at car-frame `origin`) to the nearest vertex of `skinRest`. Build-time only: one pass over every pair. */
export function bindToSkin(rest: Float32Array, origin: THREE.Vector3, skinRest: Float32Array): SkinRide {
  const count = rest.length / 3;
  const vertex = new Int32Array(count);
  const offset = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const [x, y, z] = [rest[i * 3]! + origin.x, rest[i * 3 + 1]! + origin.y, rest[i * 3 + 2]! + origin.z];
    let best = 0;
    let bestD = Infinity;
    for (let v = 0; v < skinRest.length; v += 3) {
      const d = (skinRest[v]! - x) ** 2 + (skinRest[v + 1]! - y) ** 2 + (skinRest[v + 2]! - z) ** 2;
      if (d < bestD) {
        bestD = d;
        best = v;
      }
    }
    vertex[i] = best / 3;
    offset[i * 3] = x - skinRest[best]!;
    offset[i * 3 + 1] = y - skinRest[best + 1]!;
    offset[i * 3 + 2] = z - skinRest[best + 2]!;
  }
  return { vertex, offset };
}

/** Writes `geometry`'s points (its frame seated at car-frame `origin`) where the body's drawn vertices `skin` have carried the ones they ride. */
export function rideSkin(geometry: THREE.BufferGeometry, ride: SkinRide, skin: Float32Array, origin: THREE.Vector3): void {
  const attr = geometry.getAttribute("position") as THREE.BufferAttribute;
  const arr = attr.array as Float32Array;
  const { vertex, offset } = ride;
  for (let i = 0, r = 0; i < vertex.length; i++, r += 3) {
    const v = vertex[i]! * 3;
    arr[r] = skin[v]! + offset[r]! - origin.x;
    arr[r + 1] = skin[v + 1]! + offset[r + 1]! - origin.y;
    arr[r + 2] = skin[v + 2]! + offset[r + 2]! - origin.z;
  }
  attr.needsUpdate = true;
  computeNormalsFast(geometry);
}
