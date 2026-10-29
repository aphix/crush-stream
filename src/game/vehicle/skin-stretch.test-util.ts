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
