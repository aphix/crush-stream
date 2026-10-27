import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { setGround } from "../world/ground.ts";
import { ENERGY_ROUNDING, fly, type Launch } from "./derby-containment.test-util.ts";

/**
 * A derby car's mechanical energy (½v² and spin about its rigid centre, plus g·y of it, J/kg) never exceeds what its drive has given it. The
 * owner's two traces had a boosting monster meet the 45° plane beside a ramp: the first at 27.5 m/s on the east ramp's side, 379 J/kg
 * before it and 803 after 0.26 s (the drive gave about 50 of the 424), peak 36.8 m, over the wall; the second at 20.1 m/s on the south
 * ramp's side, climbing 5.4 m in 0.5 s. The same reading over every ramp's side wedges from the far side is `derby-containment-wedge.test.ts`'s.
 */
const TRACES: readonly Launch[] = [
  { label: "the first trace: the east ramp's side at 27.5 m/s", x: 26, z: 3.1, yaw: 2.84, speed: 27.5, seconds: 2 },
  { label: "the second trace: the south ramp's side at 20.1 m/s", x: 12.7, z: -21.1, yaw: -2.27, speed: 20.1, seconds: 2 },
];

describe("given a monster driven flat out (throttle and boost) at the 45° plane beside a derby ramp", () => {
  afterEach(() => setGround(null));

  for (const trace of TRACES) {
    it(`when it is replayed from ${trace.label}, then it never holds more energy than its drive gave it`, (t) => {
      const f = fly("monster", trace);
      t.diagnostic(`${trace.label}: at most ${f.excess.toFixed(1)} J/kg over the drive's ${f.excessDrive.toFixed(0)} (at ${f.excessAt.toFixed(2)} s)`);
      assert.ok(f.excess <= ENERGY_ROUNDING, `${f.excess.toFixed(0)} J/kg over what the drive gave it, ${f.excessAt.toFixed(2)} s in (drive ${f.excessDrive.toFixed(0)} J/kg)`);
    });
  }
});
