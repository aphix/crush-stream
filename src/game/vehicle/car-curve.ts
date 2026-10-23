import * as THREE from "three";
import { detAtan2, detCos, detSin, hypot3 } from "../kernel/physics-core.js";

/**
 * A curved edge from `from` to `to` whose middle stands `bow` metres off its chord toward `toward` (only `toward`'s part
 * square to the chord counts; a negative `bow` bulges the other way). It is a quadratic Bézier, so both ends are exact,
 * the middle sits exactly `bow` off the chord and the tangent turns one way, evenly enough to sample by turn.
 */
export type Bow = {
  readonly from: readonly [number, number, number];
  readonly to: readonly [number, number, number];
  readonly bow: number;
  readonly toward: readonly [number, number, number];
};

const _chord = new THREE.Vector3();
const _side = new THREE.Vector3();

/** The bow's middle control point into `out`: the chord's midpoint plus 2 `bow` square to the chord toward `toward`. */
function bowControl(b: Bow, out: THREE.Vector3): THREE.Vector3 {
  _chord.set(b.to[0] - b.from[0], b.to[1] - b.from[1], b.to[2] - b.from[2]);
  const length = hypot3(_chord.x, _chord.y, _chord.z);
  _chord.multiplyScalar(1 / length);
  _side.set(b.toward[0], b.toward[1], b.toward[2]).addScaledVector(_chord, -(b.toward[0] * _chord.x + b.toward[1] * _chord.y + b.toward[2] * _chord.z));
  const sideLength = hypot3(_side.x, _side.y, _side.z);
  const lift = sideLength === 0 ? 0 : (2 * b.bow) / sideLength;
  return out.set((b.from[0] + b.to[0]) / 2 + _side.x * lift, (b.from[1] + b.to[1]) / 2 + _side.y * lift, (b.from[2] + b.to[2]) / 2 + _side.z * lift);
}

const _control = new THREE.Vector3();

/** The bow's point at `t` (0 at `from`, 1 at `to`) into `out`. */
export function bowPointAt(b: Bow, t: number, out: THREE.Vector3): THREE.Vector3 {
  const c = bowControl(b, _control);
  const s = 1 - t;
  return out.set(
    s * s * b.from[0] + 2 * s * t * c.x + t * t * b.to[0],
    s * s * b.from[1] + 2 * s * t * c.y + t * t * b.to[1],
    s * s * b.from[2] + 2 * s * t * c.z + t * t * b.to[2],
  );
}

const _start = new THREE.Vector3();
const _end = new THREE.Vector3();
const _across = new THREE.Vector3();

/**
 * The bow's sample parameters, ends included, where its tangent has turned in equal steps of at most `maxTurn` radians:
 * the fewest samples that keep every chord within that turn, spent where the edge bends. Exact, not searched: a quadratic's
 * tangent is a straight blend of its two control legs, so the parameter for each turn solves in closed form. Two parts that
 * share an edge take the same parameters, so their vertices meet on the curve instead of between each other's chords.
 */
export function bowTurnSteps(b: Bow, maxTurn: number): Float64Array {
  const c = bowControl(b, _control);
  _start.set(c.x - b.from[0], c.y - b.from[1], c.z - b.from[2]);
  _end.set(b.to[0] - c.x, b.to[1] - c.y, b.to[2] - c.z);
  const startLength = hypot3(_start.x, _start.y, _start.z);
  const endAlong = _end.dot(_start) / startLength;
  _across.copy(_end).addScaledVector(_start, -endAlong / startLength);
  const endAcross = hypot3(_across.x, _across.y, _across.z);
  const turn = detAtan2(endAcross, endAlong);
  const steps = Math.max(1, Math.ceil(turn / maxTurn));
  const ts = new Float64Array(steps + 1);
  ts[steps] = 1;
  for (let k = 1; k < steps; k++) {
    const angle = (turn * k) / steps;
    const ux = detCos(angle);
    const uy = detSin(angle);
    // In the plane (start leg, across): start leg = (startLength, 0), end leg = (endAlong, endAcross); t where the blend points along u.
    const startCross = startLength * uy;
    const endCross = endAlong * uy - endAcross * ux;
    ts[k] = startCross / (startCross - endCross);
  }
  return ts;
}
