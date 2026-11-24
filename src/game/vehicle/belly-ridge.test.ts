import { describe, expect } from "vitest";
import { todoRow } from "../kernel/todo-row.test-util.ts";
import * as THREE from "three";
import { DeformableCar } from "./car.ts";
import { SAMPLE, sampleAt } from "./car-cage.ts";
import { paint } from "./test-support.ts";
import { makeWorld, tickWorld } from "../contact/crash-scenarios.test-util.ts";
import { SEGS } from "./car-air-body.ts";

/** Seconds the upper car falls and settles on the roof under it. */
const SETTLE_S = 2;
/** The upper car starts this far (m) over the roof's settled origin height, turned across the lower car. */
const DROP_HEIGHT = 1.6;
/** Where along the lower car (m from its middle) the upper car is set down: its mid and keel lines come over the roof's crown and edges. */
const OFFSETS = [-1.1, -1, -0.9, -0.8, -0.2, 0.2, 0.3, 0.4, 1.1] as const;
/** How far (m) a belly line may stand into the roof under it once settled: the sim's own softness, a millimetre or two. */
const INTO_ROOF_MAX = 0.002;
/** Samples along each belly line. */
const ALONG = 20;
const HZ = 240;

/** Height (m) of `under`'s cage top at its frame's (x, z). */
function topAt(under: DeformableCar, x: number, z: number): number {
  SAMPLE[0] = x;
  SAMPLE[1] = z;
  sampleAt(under.cage.fields.top, under.cage.style);
  return SAMPLE[2]!;
}

/** Whether belly line `s` of `SEGS` is a mid line: not the keel's own (both ends on x = 0) and not a rocker's (an end at the belly's outermost |x|). */
function midLine(belly: readonly (readonly number[])[], s: number): boolean {
  let rocker = 0;
  for (const p of belly) rocker = Math.max(rocker, Math.abs(p[0]!));
  const xa = belly[SEGS[s]!]![0]!;
  const xb = belly[SEGS[s + 1]!]![0]!;
  return (xa !== 0 || xb !== 0) && Math.abs(xa) < rocker && Math.abs(xb) < rocker;
}

/** The most (m) any mid line of `upper`'s belly stands below the top of `under` along its length. */
function deepestRidgedLine(upper: DeformableCar, under: DeformableCar): number {
  const frame = upper.frame;
  const points = frame.belly.map(([x, y, z]) => upper.group.localToWorld(new THREE.Vector3(x, y, z)));
  const at = new THREE.Vector3();
  let deepest = 0;
  for (let s = 0; s < SEGS.length; s += 2) {
    if (!midLine(frame.belly, s) || frame.bellyAbsent[SEGS[s]!] === 1 || frame.bellyAbsent[SEGS[s + 1]!] === 1) continue;
    for (let k = 0; k <= ALONG; k++) {
      at.lerpVectors(points[SEGS[s]!]!, points[SEGS[s + 1]!]!, k / ALONG);
      const local = under.group.worldToLocal(at);
      const top = topAt(under, local.x, local.z);
      if (Number.isFinite(top)) deepest = Math.max(deepest, top - local.y);
    }
  }
  return deepest;
}

/** The most (m) a mid belly line of a sedan stands into the roof of another once settled, for each of `offsets` (m along the lower car) it is set down across it in turn: the lower roof keeps what the earlier drops did to it. */
function settledDepths(offsets: readonly number[]): number[] {
  const under = new DeformableCar(paint(), new THREE.Scene());
  under.spawnFacing(0, 0, 0, 0);
  const upper = new DeformableCar(paint(), new THREE.Scene());
  upper.spawnFacing(40, 0, 0, 0);
  upper.parked = true;
  under.parked = true;
  const w = makeWorld([under, upper], false, false);
  for (let f = 0; f < HZ; f++) tickWorld(w, 1 / HZ);
  return offsets.map((offset) => {
    under.refitCage();
    upper.spawnFacing(under.group.position.x, under.group.position.z + offset, Math.PI / 2, 0);
    upper.parked = true;
    upper.group.position.y = under.group.position.y + DROP_HEIGHT;
    upper.velocity.set(0, 0, 0);
    upper.angular.set(0, 0, 0);
    upper.airborne = true;
    upper.group.updateMatrixWorld(true);
    for (let f = 0; f < SETTLE_S * HZ; f++) tickWorld(w, 1 / HZ);
    upper.group.updateMatrixWorld(true);
    under.group.updateMatrixWorld(true);
    return deepestRidgedLine(upper, under);
  });
}

describe("given a sedan set down across another sedan's roof at different places along it", () => {
  // Only the pan's lines (0.35 m square under the cabin) rest on a top's ridge between their points (`ridgeCross`). Resting the mid rows' lines and the
  // keel's crossings on it too (8c29fc177, from 416bc87fe) made this row green and was taken out again: a column of stacked cars then rests on its two rear
  // mid-row lines and settles alternately at about 1° of pitch either way, and the Police column's crush spread went from 6.9 mm to 10.97 mm against its 9 mm bar.
  todoRow(
    "when it has settled, then no line of its belly, mid rows included, stands more than 2 mm into the roof beneath it",
    "the mid rows stand 11 mm into the roof: only the pan's lines rest on the ridge; resting the mid rows on it took the Police column's crush spread to 10.97 mm against 9",
    () => {
      const depths = settledDepths(OFFSETS);
      const into = OFFSETS.flatMap((offset, k) => (depths[k]! > INTO_ROOF_MAX ? [`${offset} m: ${(depths[k]! * 1000).toFixed(1)} mm`] : []));
      expect(into.length, `belly lines into the roof: ${into.join(" | ")}`).toBe(0);
    },
  );

  // A second cause, measured at -0.6 m after the drops from -1.2 m with the mid rows ridged (8c29fc177): the deepest sample is mid-line (sample 2 of 20, 4.5 cm
  // from the line's end A), not at a line's end. Along the whole line the cage's top stands 37-147 mm over it while `ridgeCross` finds no rise (-Infinity from A
  // to B and from A to every sample: no point between reads the roof's patch), A's rise -79 mm (clear of the surface the sim reads) and B's +37 mm: the sim's
  // roof surface and the cage's top disagree there by over 10 cm.
  todoRow(
    "when it is set down at -0.6 m after the drops from -1.2 m, then no line of its belly stands more than 2 mm into the roof",
    "151 mm (100 mm in a sweep of 25 places and 147 mm after the six drops before it with the mid rows ridged): the roof surface the sim reads stands over 10 cm under the cage's top there, which `ridgeCross` cannot see (no sample between A and B is on the roof's patch): another cause than the ridge",
    () => {
      const depths = settledDepths([-1.2, -1.1, -1, -0.9, -0.8, -0.7, -0.6]);
      expect(depths[depths.length - 1]!, `${(depths[depths.length - 1]! * 1000).toFixed(0)} mm into the roof at -0.6 m`).toBeLessThanOrEqual(INTO_ROOF_MAX);
    },
  );
});
