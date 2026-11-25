import * as THREE from "three";
import type { DeformableCar } from "../vehicle/car.ts";
import { hitAim, type LaterHits } from "../present/engine-cine.ts";
import { aimSink, hitFoot, hitSource, type HitSource } from "../present/hit-foot.ts";
import type { Sight } from "../present/spectate-cam.ts";

/** What the reel's crash cam asks of the clip's hits that is not their place: which are wall hits, and how far under its aim the point the row judges sits. */

const _foot = new THREE.Vector3();
const _source: HitSource = { wall: false, under: 0 };

/** The source of a hit by `car` (undefined: one the clip does not carry), a wall hit or not, the car as it stands now over `sight`'s road. */
export function sourceOf(sight: Sight, car: DeformableCar | undefined, wall: boolean): HitSource {
  if (!car) {
    _source.wall = wall;
    _source.under = 0;
    return _source;
  }
  const { x, y, z } = car.group.position;
  return hitSource(_source, sight, x, y, z, wall);
}

/** The lowest point the reel may judge a hit at (x, z) recorded at height `y` by `car`: a scratch vector, valid until the next call. */
export function footOf(sight: Sight, x: number, y: number, z: number, car: DeformableCar | undefined, wall: boolean): THREE.Vector3 {
  return hitFoot(_foot, x, y, z, sight, sourceOf(sight, car, wall));
}

/** Later impact `to` takes everything impact `from` holds but its window. */
export function copyLater(l: LaterHits, to: number, from: number): void {
  l.from[to] = l.from[from]!;
  l.until[to] = l.until[from]!;
  l.at[to]!.copy(l.at[from]!);
  l.sink[to] = l.sink[from]!;
  l.thrown[to] = l.thrown[from]!;
  l.y[to] = l.y[from]!;
  l.a[to] = l.a[from]!;
  l.b[to] = l.b[from]!;
}

/** Later impact `k` as the clip's cars `a` (`car`) and `b` (-1: a wall) record it at (x, y, z): a thrown driver's point is where he leaves, a crash's is its aim, with the depth of its judged point under it. */
export function noteLater(l: LaterHits, k: number, x: number, y: number, z: number, thrown: boolean, a: number, b: number, sight: Sight, car: DeformableCar | undefined): void {
  l.thrown[k] = thrown ? 1 : 0;
  l.y[k] = y;
  l.a[k] = a;
  l.b[k] = b;
  if (thrown) l.at[k]!.set(x, y, z);
  else hitAim(l.at[k]!, x, y, z, sight);
  l.sink[k] = thrown ? 0 : aimSink(l.at[k]!, footOf(sight, x, y, z, car, b < 0));
}

/** Later impact `k`'s sink read again from its car as it stands now, as the held cam begins to look at it: a first crash can leave a wreck lower than it drove. */
export function rereadSink(l: LaterHits, k: number, sight: Sight, car: DeformableCar | undefined): void {
  const at = l.at[k]!;
  l.sink[k] = aimSink(at, footOf(sight, at.x, l.y[k]!, at.z, car, l.b[k]! < 0));
}
