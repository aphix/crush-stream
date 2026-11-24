import { describe, expect, it } from "vitest";
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

describe("given a sedan set down across another sedan's roof at different places along it", () => {
  it("when it has settled, then no line of its belly, mid rows included, stands more than 2 mm into the roof beneath it", () => {
    const under = new DeformableCar(paint(), new THREE.Scene());
    under.spawnFacing(0, 0, 0, 0);
    const upper = new DeformableCar(paint(), new THREE.Scene());
    upper.spawnFacing(40, 0, 0, 0);
    upper.parked = true;
    under.parked = true;
    const w = makeWorld([under, upper], false, false);
    for (let f = 0; f < HZ; f++) tickWorld(w, 1 / HZ);
    const into: string[] = [];
    for (const offset of OFFSETS) {
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
      const deepest = deepestRidgedLine(upper, under);
      if (deepest > INTO_ROOF_MAX) into.push(`${offset} m: ${(deepest * 1000).toFixed(1)} mm`);
    }
    expect(into.length, `belly lines into the roof: ${into.join(" | ")}`).toBe(0);
  });
});
