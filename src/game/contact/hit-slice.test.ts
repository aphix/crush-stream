import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { SimPacer } from "../engine/sim-pace.ts";
import { FINE_HZ, FRAME_HZ, QUIET_HZ } from "../kernel/constants.ts";
import { stepWorld } from "../engine/world-step.ts";
import { FREEWHEEL, launch, makeWorld, tickWorld } from "./crash-scenarios.test-util.ts";
import { classCar } from "../vehicle/ejection.test-util.ts";

/**
 * Owner, 2026-10-05: a cop T-boning a sedan at speed reads as a pass-through of about 1 m. A device whose 1/240 s steps do not
 * fit the frame steps at the coarse floor (`QUIET_HZ`, `SimPacer`, adaptive): at 110 m/s closing a 1/80 s step carries a car 1.4 m, so the two cars'
 * first touch fell inside one step and the crush of each depended on where the step grid fell. The sandbox engine step
 * (`crash-scenarios.test-util.ts`) with the engine's own pacer holding each floor: a sedan drives its nose into a parked sedan's
 * right door.
 */
type Hit = { strikerNose: number; struckDoor: number; strikerThrown: boolean; struckThrown: boolean };

/** A sedan at `speed` driving its nose into the parked sedan's right door, from a start `phase` of one coarse step of travel closer, stepped by a pacer on the coarse floor or the 1/240 s one. */
function tbone(speed: number, coarse: boolean, phase: number): Hit {
  const striker = classCar("sedan");
  const struck = classCar("sedan");
  launch(struck, 0, 0, 0, 0, 0);
  launch(striker, 6 - (phase * speed) / QUIET_HZ, 0, -Math.PI / 2, -speed, 0);
  const w = makeWorld([striker, struck], false, false);
  const pace = new SimPacer();
  pace.pin = coarse;
  for (let f = 0; f < FRAME_HZ * 2.5; f++) tickWorld(w, 1 / FRAME_HZ, pace);
  const hit: Hit = {
    strikerNose: striker.deform.crushAmount,
    struckDoor: struck.deform.crushAmount,
    strikerThrown: w.ejections.some((e) => e.car === 0),
    struckThrown: w.ejections.some((e) => e.car === 1),
  };
  striker.dispose();
  struck.dispose();
  return hit;
}

const SPEEDS = [20, 30, 40];
const PHASES = [0, 0.25, 0.5, 0.75];
/** Calibration tolerance (m of crush) between the two floors: 7 % of a door's 0.67 m at 40 m/s, the residual of the coarse step's own grid outside the hit steps (measured worst 0.027 m over these twelve hits at 1/80 s; the 1/120 s step stayed within the 0.045 m it had). Unmarked, the floors were up to 0.19 m apart. */
const SAME = 0.045;
describe("given a sedan driving its nose into a parked sedan's right door at 20 to 40 m/s, from four approach phases against the step grid", () => {
  it("when the pacer steps at the coarse step instead of 1/240 s, then each car is crushed as far and the same driver is thrown, hit for hit", () => {
    const apart: string[] = [];
    for (const speed of SPEEDS) {
      for (const phase of PHASES) {
        const fine = tbone(speed, false, phase);
        const coarse = tbone(speed, true, phase);
        const d = (a: number, b: number): number => Math.abs(a - b);
        if (d(fine.strikerNose, coarse.strikerNose) > SAME || d(fine.struckDoor, coarse.struckDoor) > SAME || fine.strikerThrown !== coarse.strikerThrown || fine.struckThrown !== coarse.struckThrown) {
          apart.push(`${speed} m/s phase ${phase}: nose ${fine.strikerNose.toFixed(3)} / ${coarse.strikerNose.toFixed(3)} m, door ${fine.struckDoor.toFixed(3)} / ${coarse.struckDoor.toFixed(3)} m (1/240 s / coarse step)`);
        }
      }
    }
    assert.deepEqual(apart, []);
  });
});

/** Where in one 1/240 s slice of the approach (0.125 m at 30 m/s) the first touch falls: the striker started 0 to 120 mm further back, 10 mm apart. */
const TOUCH_MM = [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120];
/** Widest (m) the nose, and the door, may be crushed apart by where in a slice the first touch falls: the hit's centre follows the pair's patch while the faces close, its snap to the nearest mass has no step in its lateral position, and a hit armed on a corner's first aslant touch takes over the face-on one that follows (a patch 1 cm either side of 0.2 m off centre crushed the nose 0.38 m or 0.74 m; armed aslant at 10.3 m/s it crushed 0.34 m, face-on at 13.5 m/s 0.47 m). */
const TOUCH_NOSE = 0.06;
const TOUCH_DOOR = 0.1;
describe("given a sedan driving its nose into a parked sedan's right door at 30 m/s, from first touches across one 1/240 s slice of travel", () => {
  it("when the first touch falls 0 to 120 mm apart, then each car is crushed as far to within 0.06 m (nose) and 0.1 m (door) and the same driver is thrown", () => {
    const hits = TOUCH_MM.map((mm) => tbone(30, false, (mm / 1000) * (QUIET_HZ / 30)));
    const spread = (xs: number[]): number => Math.max(...xs) - Math.min(...xs);
    const nose = hits.map((h) => h.strikerNose);
    const door = hits.map((h) => h.struckDoor);
    assert.ok(spread(nose) <= TOUCH_NOSE, `nose ${nose.map((v) => v.toFixed(2)).join(" ")} m over ${TOUCH_MM.join(" ")} mm back`);
    assert.ok(spread(door) <= TOUCH_DOOR, `door ${door.map((v) => v.toFixed(2)).join(" ")} m over ${TOUCH_MM.join(" ")} mm back`);
    assert.equal(new Set(hits.map((h) => `${h.strikerThrown} ${h.struckThrown}`)).size, 1, "one driver thrown at every touch");
  });
});

/** A sedan at 56 km/h into the rigid wall, stepped at the coarse step with the contact cut to slices of `fine` s (the pacer's floor): how far its nose crumples (m). */
function wallNose(fine: number): number {
  const car = classCar("sedan");
  launch(car, 6.2, 0, -Math.PI / 2, -56 / 3.6, 0);
  const w = makeWorld([car], true, false, FREEWHEEL);
  const d = car.deform;
  const length = (): number => (d.massLocal("bumperFL").z + d.massLocal("bumperFR").z) / 2 - d.massLocal("cell").z;
  const before = length();
  w.world.fine = fine;
  for (let i = 0; i < 120; i++) {
    stepWorld(w.world, 1 / QUIET_HZ);
    car.stepBreakage(1 / QUIET_HZ);
  }
  const nose = before - length();
  car.dispose();
  return nose;
}

// A slice rate finer than the shipped fine floor: the cross-check that the crush does not depend on where the floor sits.
const FINER_HZ = 320;

describe("given a sedan driving into the rigid wall at 56 km/h in coarse steps", () => {
  it("when the hit is cut into the fine slice or into slices finer still, then the nose crumples the same to within 1 cm", () => {
    const coarse = wallNose(1 / FINE_HZ);
    const fine = wallNose(1 / FINER_HZ);
    assert.ok(Math.abs(coarse - fine) <= 0.01, `nose ${coarse.toFixed(3)} m in 1/${FINE_HZ} s slices, ${fine.toFixed(3)} m in 1/${FINER_HZ} s ones`);
  });
});
