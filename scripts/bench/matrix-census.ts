/**
 * The three.js matrix census (`BENCH_MATRIX=1`, bench `--matrix`): over the measured window, every `Object3D.updateMatrix` (the compose that `updateWorldMatrix` and `updateMatrixWorld` run on every
 * auto-updating node, three has no dirty check) counted by depth and whether it was a REPEAT: the node's position, quaternion and scale are the very bits of its last compose, so the matrix it
 * writes is the one it already holds (a dedupable call, exactly). Depths: 0 the scene (composed by every `updateWorldMatrix(true)`), 1 a car's group (directly under the scene), 2 and 3+ parts,
 * wheels and meshes below. Also the outermost `Box3.expandByObject` / `setFromObject` calls and the nodes they walked. Wrapped on the prototypes: a run for counts, never for ms.
 */
import * as THREE from "three";

export interface MatrixCensus {
  depth: { calls: number; repeats: number }[];
  boxCalls: number;
  boxNodes: number;
}

const DEPTHS = 4;
/** Per node, the position, quaternion and scale (10 numbers) of its last compose. */
const last = new WeakMap<THREE.Object3D, Float64Array>();

function nodes(o: THREE.Object3D): number {
  let n = 1;
  for (const child of o.children) n += nodes(child);
  return n;
}

export function startMatrixCensus(): MatrixCensus {
  const c: MatrixCensus = { depth: Array.from({ length: DEPTHS }, () => ({ calls: 0, repeats: 0 })), boxCalls: 0, boxNodes: 0 };
  const compose = THREE.Object3D.prototype.updateMatrix;
  THREE.Object3D.prototype.updateMatrix = function (this: THREE.Object3D): void {
    let d = 0;
    for (let p = this.parent; p !== null; p = p.parent) d++;
    const bucket = c.depth[Math.min(d, DEPTHS - 1)]!;
    bucket.calls++;
    let l = last.get(this);
    if (l === undefined) {
      l = new Float64Array(10).fill(NaN);
      last.set(this, l);
    }
    const p = this.position;
    const q = this.quaternion;
    const s = this.scale;
    if (l[0] === p.x && l[1] === p.y && l[2] === p.z && l[3] === q.x && l[4] === q.y && l[5] === q.z && l[6] === q.w && l[7] === s.x && l[8] === s.y && l[9] === s.z) bucket.repeats++;
    else l.set([p.x, p.y, p.z, q.x, q.y, q.z, q.w, s.x, s.y, s.z]);
    compose.call(this);
  };
  // `expandByObject` recurses through itself: count the outermost call and the nodes under it.
  let inside = 0;
  const expand = THREE.Box3.prototype.expandByObject;
  THREE.Box3.prototype.expandByObject = function (this: THREE.Box3, object: THREE.Object3D, precise?: boolean): THREE.Box3 {
    if (inside++ === 0) {
      c.boxCalls++;
      c.boxNodes += nodes(object);
    }
    try {
      return expand.call(this, object, precise);
    } finally {
      inside--;
    }
  };
  return c;
}
