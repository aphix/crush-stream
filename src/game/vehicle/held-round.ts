import type * as THREE from "three";
import { computeNormalsFast } from "../deform/fast-normals.ts";
import { smoothNormals } from "./normal-smooth.ts";

/**
 * Draws round a shell a tyre hold re-lifted on a frame its skin was not written. The hold recomputed the normals flat only near what it
 * lifted; the rest are the rounded ones of the last written frame, and rounding is not idempotent: rounding the rounded normals again
 * moved them by up to 0.70 of a unit normal on a sedan tapped at 10 km/h, 1.14 after five times. So the shell's raw normals are
 * computed whole first and rounded once, as a written frame's are.
 */
export function roundHeld(geometry: THREE.BufferGeometry, rest: ArrayLike<number>, strength: number, restNormals: Float32Array | null): void {
  computeNormalsFast(geometry);
  smoothNormals(geometry, rest, strength, restNormals);
}
