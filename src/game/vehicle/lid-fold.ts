import type { HingeSpec } from "./hinge-spec.ts";

/**
 * A lid's crash fold: sheet metal keeps its length, so the length a crush takes off the lid's chord buckles it out of its plane into a V
 * whose apex stands on the crease line. The drawn lid and the cage's lid both read these.
 */

/** Floats per panel in `CageSource.panelCrease`: the rest car z of the lid's hinge edge, its crease line and its free edge. */
export const CREASE_STRIDE = 3;
const CREASE_REAR = 0;
export const CREASE_LINE = 1;
const CREASE_FRONT = 2;

/** Crush length (m) over which the ridge rises to its full height: the square root's slope at 0 would stand it 2 cm high on a millimetre. */
const RIDGE_ONSET_M = 0.02;

/** How high (m) the lid of `spec` stands at its crease line once its crush `hingeT` has buckled its fold's share of the length the crush took off its chord; 0 for a lid that does not fold. */
export function ridgeHeight(spec: HingeSpec, hingeT: number): number {
  const fold = spec.fold;
  if (fold === undefined) return 0;
  const buckled = fold.share * fold.range * hingeT;
  if (buckled <= 0) return 0;
  const chord = spec.length - buckled;
  const onset = Math.min(1, buckled / RIDGE_ONSET_M);
  return 0.5 * Math.sqrt(spec.length * spec.length - chord * chord) * onset * onset * (3 - 2 * onset);
}

/** `spec`'s lid, seated at car z `originZ`: into `out` at `at`, the car z of its hinge edge, its crease line and its free edge (a lid with no fold: three zeros). */
export function creaseStations(spec: HingeSpec, originZ: number, out: Float64Array, at: number): void {
  const fold = spec.fold;
  if (fold === undefined) {
    out.fill(0, at, at + CREASE_STRIDE);
    return;
  }
  const rear = originZ + spec.pz;
  const front = rear + spec.length * spec.uz;
  out[at + CREASE_REAR] = rear;
  out[at + CREASE_LINE] = rear + fold.crease * (front - rear);
  out[at + CREASE_FRONT] = front;
}

/** Whether the panel whose stations are at `at` folds (its free edge stands past its hinge edge); a panel with no fold has three zeros. */
export function folds(stations: ArrayLike<number>, at: number): boolean {
  return stations[at + CREASE_FRONT]! > stations[at + CREASE_REAR]!;
}

/** 1 on the crease line, falling straight to 0 at the hinge edge and at the free edge; 0 outside them and for a lid with no fold (its stations all 0). */
export function ridgeAt(z: number, stations: ArrayLike<number>, at: number): number {
  const rear = stations[at + CREASE_REAR]!;
  const crease = stations[at + CREASE_LINE]!;
  const front = stations[at + CREASE_FRONT]!;
  if (z <= rear || z >= front) return 0;
  return z < crease ? (z - rear) / (crease - rear) : (front - z) / (front - crease);
}

/** The lid's drawn vertices (`position`, x y z each, its rest in `rest`, seated at car z `originZ`) raised into the ridge `height` tall. */
export function raiseRidge(position: Float32Array, rest: ArrayLike<number>, originZ: number, stations: ArrayLike<number>, height: number): void {
  for (let i = 1, z = 2; i < position.length; i += 3, z += 3) position[i] = position[i]! + height * ridgeAt(rest[z]! + originZ, stations, 0);
}
