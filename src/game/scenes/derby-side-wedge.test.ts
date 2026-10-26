import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { applyDrive } from "../vehicle/car-drive.ts";
import { energyOf } from "../vehicle/energy.test-util.ts";
import { physicsSlice, sliceSpeed } from "../contact/sat.ts";
import { stepWorld } from "../engine/world-step.ts";
import { FRAME_HZ } from "../kernel/constants.ts";
import { arenaWorld, leaveArena } from "./derby-arena.test-util.ts";
import { carOfClass, FLAT_OUT, sideWedgeLaunches, type Launch } from "./derby-containment.test-util.ts";

/**
 * A derby car's mechanical energy (½v² and spin about its rigid centre, plus g·y of it, J/kg) never exceeds what its drive has given it: the engine and the boost give it energy in
 * `applyDrive` (measured round that call, so a retuned boost moves nothing here), and nothing the arena's ground does gives it more. The
 * owner's two traces had a boosting monster meet the 45° plane beside a ramp: the first at 27.5 m/s on the east ramp's side, 379 J/kg
 * before it and 803 after 0.26 s (the drive gave about 50 of the 424), peak 36.8 m, over the wall; the second at 20.1 m/s on the south
 * ramp's side, climbing 5.4 m in 0.5 s. The rigid tyre rows' straight-up push kept the speed it lifted the body on: a lift the engine did
 * not pay for.
 */
const FRAME = 1 / FRAME_HZ;
/** The most (J/kg) the car may hold over what the drive gave it: the worst of the 24 launches holds 29 (as it meets the wall: the push-out of its drawn body), the two traces 3.7 and 5.5; the free lift held hundreds. */
const ENERGY_ROUNDING = 40;
/** The owner's two traces, as the poses their cars were in the frame before the wedge (class monster, full throttle and boost). */
const TRACES: readonly Launch[] = [
  { label: "the first trace: the east ramp's side at 27.5 m/s", x: 26, z: 3.1, yaw: 2.84, speed: 27.5, seconds: 2 },
  { label: "the second trace: the south ramp's side at 20.1 m/s", x: 12.7, z: -21.1, yaw: -2.27, speed: 20.1, seconds: 2 },
];

/** The most (J/kg) a monster driven flat out from `launch` ever holds over the energy the drive has given it, and when (s). */
function worstExcess(launch: Launch): { excess: number; at: number; drive: number } {
  const car = carOfClass("monster", launch.x, launch.z, launch.yaw, launch.speed);
  const { world } = arenaWorld([car]);
  const start = energyOf(car);
  let drive = 0;
  let acc = 0;
  let worst = { excess: -Infinity, at: 0, drive: 0 };
  for (let t = 0; t < launch.seconds; t += FRAME) {
    acc = Math.min(0.05, acc + FRAME);
    while (acc > 1e-5) {
      const h = physicsSlice(acc, sliceSpeed(world.cars));
      const before = energyOf(car);
      applyDrive(car, FLAT_OUT, h);
      drive += energyOf(car) - before;
      stepWorld(world, h);
      car.stepBreakage(h);
      const excess = energyOf(car) - start - drive;
      if (excess > worst.excess) worst = { excess, at: t, drive };
      acc -= h;
    }
    car.updateSkin();
  }
  return worst;
}

describe("given a monster driven flat out (throttle and boost) at the 45° plane beside a derby ramp", () => {
  afterEach(leaveArena);

  for (const trace of TRACES) {
    it(`when it is replayed from ${trace.label}, then it never holds more energy than its drive gave it`, (t) => {
      const w = worstExcess(trace);
      t.diagnostic(`${trace.label}: at most ${w.excess.toFixed(1)} J/kg over the drive's ${w.drive.toFixed(0)} (at ${w.at.toFixed(2)} s)`);
      assert.ok(w.excess <= ENERGY_ROUNDING, `${w.excess.toFixed(0)} J/kg over what the drive gave it, ${w.at.toFixed(2)} s in (drive ${w.drive.toFixed(0)} J/kg)`);
    });
  }

  it("when it meets each ramp's two sides from the far side of the arena, square and slanted, then it never holds more energy than its drive gave it", (t) => {
    const failures: string[] = [];
    let worst = -Infinity;
    for (const launch of sideWedgeLaunches()) {
      const w = worstExcess(launch);
      worst = Math.max(worst, w.excess);
      if (w.excess > ENERGY_ROUNDING) failures.push(`${launch.label}: ${w.excess.toFixed(0)} J/kg over the drive's ${w.drive.toFixed(0)}, ${w.at.toFixed(2)} s in`);
    }
    t.diagnostic(`the worst of ${sideWedgeLaunches().length} launches holds ${worst.toFixed(1)} J/kg over its drive`);
    assert.deepEqual(failures, []);
  });
});
