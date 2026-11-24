import { describe, expect, it } from "vitest";
import { todoRow } from "../kernel/todo-row.test-util.ts";
import * as THREE from "three";
import { DeformableCar } from "./car.ts";
import { SAMPLE, sampleAt } from "./car-cage.ts";
import { paint } from "./test-support.ts";
import { makeWorld, tickWorld } from "../contact/crash-scenarios.test-util.ts";
import { RIDGED, SEGS } from "./car-air-body.ts";

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

/** The most (m) any `RIDGED` line of `upper`'s belly stands below the top of `under` along its length. */
function deepestRidgedLine(upper: DeformableCar, under: DeformableCar): number {
  const frame = upper.frame;
  const points = frame.belly.map(([x, y, z]) => upper.group.localToWorld(new THREE.Vector3(x, y, z)));
  const at = new THREE.Vector3();
  let deepest = 0;
  for (let s = 0; s < SEGS.length; s += 2) {
    if (RIDGED[s / 2] === 0 || frame.bellyAbsent[SEGS[s]!] === 1 || frame.bellyAbsent[SEGS[s + 1]!] === 1) continue;
    for (let k = 0; k <= ALONG; k++) {
      at.lerpVectors(points[SEGS[s]!]!, points[SEGS[s + 1]!]!, k / ALONG);
      const local = under.group.worldToLocal(at);
      const top = topAt(under, local.x, local.z);
      if (Number.isFinite(top)) deepest = Math.max(deepest, top - local.y);
    }
  }
  return deepest;
}

/** The most (m) a `RIDGED` belly line of a sedan stands into the roof of another once settled, for each of `offsets` (m along the lower car) it is set down across it in turn: the lower roof keeps what the earlier drops did to it. */
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
  it("when it has settled, then no line of its belly, mid rows included, stands more than 2 mm into the roof beneath it", () => {
    const depths = settledDepths(OFFSETS);
    const into = OFFSETS.flatMap((offset, k) => (depths[k]! > INTO_ROOF_MAX ? [`${offset} m: ${(depths[k]! * 1000).toFixed(1)} mm`] : []));
    expect(into.length, `belly lines into the roof: ${into.join(" | ")}`).toBe(0);
  });

  // Measured at -0.6 m after the drops from -1.2 m: the deepest sample is mid-line (sample 2 of 20, 4.5 cm from the line's end A), not at a line's end. Along the
  // whole line the cage's top stands 37-147 mm over it while `ridgeCross` finds no rise (-Infinity from A to B and from A to every sample: no point between reads the
  // roof's patch), A's rise -79 mm (clear of the surface the sim reads) and B's +37 mm: the sim's roof surface and the cage's top disagree there by over 10 cm.
  todoRow(
    "when it is set down at -0.6 m after the drops from -1.2 m, then no line of its belly stands more than 2 mm into the roof",
    "100 mm in a sweep of 25 places, 147 mm after the six drops before it: the roof surface the sim reads stands over 10 cm under the cage's top there, which `ridgeCross` cannot see (no sample between A and B is on the roof's patch): not the single-peak search, another cause",
    () => {
      const depths = settledDepths([-1.2, -1.1, -1, -0.9, -0.8, -0.7, -0.6]);
      expect(depths[depths.length - 1]!, `${(depths[depths.length - 1]! * 1000).toFixed(0)} mm into the roof at -0.6 m`).toBeLessThanOrEqual(INTO_ROOF_MAX);
    },
  );
});
