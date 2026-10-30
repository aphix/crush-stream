import * as THREE from "three";
import type { DeformableCar } from "./car.ts";

/** Edges shorter than this (m) are not measured: a ratio over a sliver is noise. */
const MIN_EDGE_M = 0.02;

/** Every skin mesh of the car (indexed triangles with a position buffer), in traversal order. */
function skinMeshes(car: DeformableCar): THREE.Mesh[] {
  const out: THREE.Mesh[] = [];
  car.group.traverse((o) => {
    if (o instanceof THREE.Mesh && o.geometry.getIndex() && o.geometry.getAttribute("position")) out.push(o);
  });
  return out;
}

/** Each skin mesh's positions as they stand now: take them on the intact car, then measure a crash against them. */
export function snapshotRest(car: DeformableCar): Map<THREE.Mesh, Float32Array> {
  return new Map(skinMeshes(car).map((m) => [m, Float32Array.from(m.geometry.getAttribute("position").array as Float32Array)]));
}

/** The longest drawn triangle edge of `geometry` over the same edge in `reference` (edges of at least `MIN_EDGE_M` there). */
function worstEdgeRatio(geometry: THREE.BufferGeometry, reference: ArrayLike<number>): number {
  const pos = geometry.getAttribute("position").array as Float32Array;
  const index = geometry.getIndex()!.array;
  let worst = 0;
  for (let t = 0; t < index.length; t++) {
    const a = index[t]! * 3;
    const b = index[t - (t % 3) + ((t + 1) % 3)]! * 3;
    const was = Math.hypot(reference[a]! - reference[b]!, reference[a + 1]! - reference[b + 1]!, reference[a + 2]! - reference[b + 2]!);
    if (was < MIN_EDGE_M) continue;
    worst = Math.max(worst, Math.hypot(pos[a]! - pos[b]!, pos[a + 1]! - pos[b + 1]!, pos[a + 2]! - pos[b + 2]!) / was);
  }
  return worst;
}

/** How many times longer than at rest the car's worst drawn skin edge is, over every visible skin mesh in `rest` (`snapshotRest`). */
export function worstSkinStretch(car: DeformableCar, rest: Map<THREE.Mesh, Float32Array>): number {
  let worst = 0;
  for (const [mesh, positions] of rest) if (mesh.visible) worst = Math.max(worst, worstEdgeRatio(mesh.geometry, positions));
  return worst;
}

/** How many times longer than the crush wrote it the body's worst drawn edge is: what the tyre hold did to the skin the sim made. */
export function worstHoldStretch(car: DeformableCar): number {
  const written = car["bodyTyres"]!["written"];
  return worstEdgeRatio(car.body.geometry, written);
}

/** How far (m) over a tyre's top the hold may stand a point it lifts: its gap (car-tyre-skin.ts `TYRE_GAP`, the most it asks) and a rounding slack. */
const HOLD_GAP_M = 0.05 + 0.005;

/** The highest top (m, the body mesh's y) of the standing tyres of `car`, plus the hold's gap. */
function tyresTop(car: DeformableCar): number {
  const toMesh = car.body.matrixWorld.clone().invert();
  const { r, halfW } = car.frame.rig.tyre;
  let top = -Infinity;
  for (let w = 0; w < car.wheels.length; w++) {
    if (car["looseWheels"][w]!.loose) continue;
    const e = toMesh.clone().multiply(car.wheels[w]!.matrixWorld).elements;
    top = Math.max(top, e[13]! + Math.abs(e[1]!) * halfW + Math.hypot(e[0]!, e[2]!) * r + HOLD_GAP_M);
  }
  return top;
}

/**
 * How far (m) the tyre hold lifts the car's worst body point past what it may, over the skin as the crush wrote it: back up to where it rested or to the
 * top of the tyres plus the hold's gap, and its neighbours after it at 1 m/m of written skin (car-tyre-skin.ts `LEVEL_SLOPE`). Past that the hold
 * carried a lift no tyre and no rest shape asked for, and the skin stands off the car.
 */
export function worstHoldOverRest(car: DeformableCar): { over: number; at: string } {
  car.group.updateMatrixWorld(true);
  const hold = car["bodyTyres"]!;
  const [written, rest, weld] = [hold["written"], hold["rest"], hold["edges"].weld];
  const { start, to, rep } = hold["neighbours"];
  const top = tyresTop(car);
  const may = new Float64Array(rep.length);
  const queue: number[] = [];
  for (let p = 0; p < may.length; p++) {
    const y = rep[p]! * 3 + 1;
    may[p] = Math.max(0, Math.max(rest[y]!, top) - written[y]!);
    if (may[p]! > 0) queue.push(p);
  }
  while (queue.length > 0) {
    const p = queue.pop()!;
    const a = rep[p]! * 3;
    for (let e = start[p]!; e < start[p + 1]!; e++) {
      const q = to[e]!;
      const b = rep[q]! * 3;
      const carried = may[p]! - Math.hypot(written[a]! - written[b]!, written[a + 1]! - written[b + 1]!, written[a + 2]! - written[b + 2]!);
      if (carried <= may[q]!) continue;
      may[q] = carried;
      queue.push(q);
    }
  }
  const drawn = car.body.geometry.getAttribute("position").array as Float32Array;
  let worst = { over: 0, at: "" };
  for (let v = 0; v < weld.length; v++) {
    const y = drawn[v * 3 + 1]!;
    const over = y - written[v * 3 + 1]! - may[weld[v]!]!;
    if (over > worst.over) worst = { over, at: `vertex ${v} drawn at (${drawn[v * 3]!.toFixed(2)}, ${y.toFixed(2)}, ${drawn[v * 3 + 2]!.toFixed(2)}), written at ${written[v * 3 + 1]!.toFixed(2)}, rested at ${rest[v * 3 + 1]!.toFixed(2)}` };
  }
  return worst;
}
