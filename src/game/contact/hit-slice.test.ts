import { describe, expect, it } from "vitest";
import { SimPacer } from "../engine/sim-pace.ts";
import { FINE_HZ, FRAME_HZ, QUIET_HZ } from "../kernel/constants.ts";
import { stepWorld } from "../engine/world-step.ts";
import type { VehicleClassId } from "../vehicle/vehicle-classes.ts";
import { FREEWHEEL, launch, makeWorld, tickWorld } from "./crash-scenarios.test-util.ts";
import { classCar } from "../vehicle/ejection.test-util.ts";
import * as THREE from "three";
import { barReach } from "../deform/deform-rig.ts";
import { PUSH_BAR_REACH } from "../vehicle/car-materials.ts";
import type { DeformableCar } from "../vehicle/car.ts";
import { resolveCarPair } from "./pair-contact.ts";
import { satCars } from "./sat.ts";

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
    expect(apart).toHaveLength(0);
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
    expect(spread(nose), `nose ${nose.map((v) => v.toFixed(2)).join(" ")} m over ${TOUCH_MM.join(" ")} mm back`).toBeLessThanOrEqual(TOUCH_NOSE);
    expect(spread(door), `door ${door.map((v) => v.toFixed(2)).join(" ")} m over ${TOUCH_MM.join(" ")} mm back`).toBeLessThanOrEqual(TOUCH_DOOR);
    expect(new Set(hits.map((h) => `${h.strikerThrown} ${h.struckThrown}`)).size, "one driver thrown at every touch").toBe(1);
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
    expect(Math.abs(coarse - fine), `nose ${coarse.toFixed(3)} m in 1/${FINE_HZ} s slices, ${fine.toFixed(3)} m in 1/${FINER_HZ} s ones`).toBeLessThanOrEqual(0.01);
  });
});

/** How far (m) a nose's first touch is read ahead of the overlap in the second case: the travel of a 1/240 s slice at 30 m/s. */
const SLICE_LOOK_M = 30 / FINE_HZ;
/** How far (mm) into the contact the patch is followed: past the outlines' outermost half step, where the other cage's nodes first read a depth. */
const ENTRY_MM = 60;
/** The widest (m) the patch's centre may move between two readings 1 mm apart of the nose's closing, in its first `ENTRY_MM`: a node enters with the depth it has, from nothing (read at the gate of the drawn triangles' box, the door's nodes at the nose's edge entered with 0.02 m at once: 0.021 m at no look, 0.112 m at a slice's; now 0.009 m and 0.002 m). */
const PATCH_STEP = 0.015;
describe("given a sedan's nose closing on a parked sedan's right door, read 1 mm at a time from the first touch", () => {
  const testCases = [
    { it: "when the pair's patch is read 0.000 m ahead of the overlap, then its centre moves under 0.015 m between neighbouring millimetres of the first 60 mm", look: 0 },
    { it: "when the pair's patch is read 0.125 m ahead of the overlap, then its centre moves under 0.015 m between neighbouring millimetres of the first 60 mm", look: SLICE_LOOK_M },
  ];
  for (const testCase of testCases) {
    it(testCase.it, (t) => {
      const { look } = testCase;
      const struck = classCar("sedan");
      const striker = classCar("sedan");
      launch(struck, 0, 0, 0, 0, 0);
      const n = new THREE.Vector3();
      const p = new THREE.Vector3();
      const last = new THREE.Vector3();
      let first = -1;
      let worst = 0;
      let worstAt = 0;
      for (let mm = 0; mm <= 800 && (first < 0 || mm < first + ENTRY_MM); mm++) {
        launch(striker, 3.4 - mm / 1000, 0, -Math.PI / 2, 0, 0);
        if (satCars(striker, struck, n, p, look) === null) continue;
        if (first < 0) first = mm;
        else if (last.distanceTo(p) > worst) {
          worst = last.distanceTo(p);
          worstAt = mm - first;
        }
        last.copy(p);
      }
      striker.dispose();
      struck.dispose();
      t.annotate(`first touch at ${first} mm, the largest step ${worst.toFixed(4)} m at ${worstAt} mm in`);
      expect(first, "the sweep never met the contact").toBeGreaterThan(0);
      expect(worst, `the patch's centre moved ${worst.toFixed(4)} m in 1 mm of closing, ${worstAt} mm into the contact`).toBeLessThanOrEqual(PATCH_STEP);
    });
  }
});

/** Both cars' speed (m/s) in a tap, and the closing speeds (m/s) the striker catches the other at: a cop's first touch on a runner is a tap, not a crash. A cruiser's push bar folds back as its bumper crushes, so its outline backs off from the other car by that fold as well (the contact reads it, `crushedSoFar`). */
const TAP_CRUISE = 28;
const TAPS = [3, 4.4];

/** The slices in which the pair contact reports a hit while a `striker` at `closing` m/s faster than a sedan ahead of it, both on the road, taps its tail. */
function tapSlices(striker: VehicleClassId, closing: number): number {
  const s = classCar(striker);
  const struck = classCar("sedan");
  launch(struck, 0, 0, Math.PI / 2, TAP_CRUISE, 0);
  launch(s, -6, 0, Math.PI / 2, TAP_CRUISE + closing, 0);
  const w = makeWorld([s, struck], false, false, null);
  let slices = 0;
  w.world.pairHit = () => void slices++;
  for (let f = 0; f < FRAME_HZ * 1.5; f++) tickWorld(w);
  s.dispose();
  struck.dispose();
  return slices;
}

describe("given a car tapping the tail of a sedan 3 and 4.4 m/s slower than itself", () => {
  for (const closing of TAPS) {
    for (const striker of ["sedan", "police"] as const) {
      it(`when a ${striker} taps it at ${closing} m/s, then the pair contact reports the hit`, (t) => {
        const slices = tapSlices(striker, closing);
        t.annotate(`${striker} at ${closing} m/s: ${slices} slices of pair contact`);
        expect(slices, `the pair contact never reported the ${striker}'s tap`).toBeGreaterThan(0);
      });
    }
  }
});

/** The speed (m/s) a cruiser drives into a parked sedan's tail to fold its push bar, and how far (m) the fold has to be before the faces below are asked. */
const FOLD_MPS = 8;
const FOLDED_M = 0.05;
/** The closing (m/s) of the second hit, armed by hand on a face that is not the cruiser's nose, and how far (m) off the cruiser the sedan stands from where the contact first reads it: more than a flank's own crush, less than the bar's fold. */
const SECOND_HIT_MPS = 15;
const OFF_M = 0.07;
const _n = new THREE.Vector3();
const _p = new THREE.Vector3();

/** A cruiser whose push bar folded in a crash into the tail of a sedan, then still: where that left it. */
function foldedCruiser(): DeformableCar {
  const cruiser = classCar("police");
  const other = classCar("sedan");
  launch(other, 0, 0, Math.PI / 2, 0, 0);
  launch(cruiser, -6, 0, Math.PI / 2, FOLD_MPS, 0);
  const w = makeWorld([cruiser, other], false, false, null);
  for (let f = 0; f < FRAME_HZ * 1.5; f++) tickWorld(w);
  other.dispose();
  for (const m of cruiser.deform.masses) m.vel.set(0, 0, 0);
  cruiser.velocity.set(0, 0, 0);
  cruiser.angular.set(0, 0, 0);
  cruiser.refreshBasis();
  return cruiser;
}

/** A sedan at rest with its nose toward `cruiser`, `OFF_M` further off its `side` (a unit vector in the plan) than the cages' contact first reads it. */
function sedanOff(cruiser: DeformableCar, side: THREE.Vector3): DeformableCar {
  const sedan = classCar("sedan");
  const yaw = Math.atan2(-side.x, -side.z);
  const at = (d: number): void => launch(sedan, cruiser.group.position.x + side.x * d, cruiser.group.position.z + side.z * d, yaw, 0, 0);
  let near = 1;
  let far = 4;
  for (let i = 0; i < 30; i++) {
    const mid = (near + far) / 2;
    at(mid);
    if (satCars(sedan, cruiser, _n, _p) === null) far = mid;
    else near = mid;
  }
  at(far + OFF_M);
  return sedan;
}

describe("given a cruiser whose push bar folded in an earlier crash, and a sedan standing 7 cm off the cages' contact", () => {
  for (const face of ["flank", "tail"] as const) {
    it(`when the sedan's hit lands on the cruiser's ${face}, then no pair contact reaches the 7 cm: the bar is on the nose only`, (t) => {
      const cruiser = foldedCruiser();
      const crush = Math.max(cruiser.deform.massRest("bumperFL").z - cruiser.deform.massLocal("bumperFL").z, cruiser.deform.massRest("bumperFR").z - cruiser.deform.massLocal("bumperFR").z);
      const folded = PUSH_BAR_REACH - barReach(PUSH_BAR_REACH, crush);
      expect(folded, `the bar has folded ${folded.toFixed(3)} m, the bumper crushed ${crush.toFixed(3)} m: the set-up is no folded cruiser`).toBeGreaterThanOrEqual(FOLDED_M);
      const side = face === "flank" ? cruiser.rightFlat.clone() : cruiser.fwdFlat.clone().negate();
      const sedan = sedanOff(cruiser, side);
      expect(satCars(sedan, cruiser, _n, _p), "the sedan stands in contact").toBe(null);
      expect(satCars(sedan, cruiser, _n, _p, folded), "the sedan stands further off than the bar's fold").not.toBe(null);
      const point = new THREE.Vector3(cruiser.group.position.x + side.x * 0.8, cruiser.group.position.y + 0.5, cruiser.group.position.z + side.z * 0.8);
      const inward = side.clone().negate();
      expect(cruiser.applyImpact(point, inward, SECOND_HIT_MPS, SECOND_HIT_MPS), `the ${face} hit was refused`).toBe(true);
      cruiser.deform.beginSlice(1 / FINE_HZ);
      sedan.deform.beginSlice(1 / FINE_HZ);
      const hit = resolveCarPair(sedan, cruiser, 1 / FINE_HZ);
      t.annotate(`${face}: bar folded ${folded.toFixed(3)} m, flank stroke ${(cruiser.deform.hitStroke() * cruiser.deform.strokeUsed()).toFixed(3)} m, pair contact ${hit === null ? "none" : "held"}`);
      expect(hit, `the pair contact reached across ${OFF_M} m to a ${face} the bar is not on`).toBe(null);
      cruiser.dispose();
      sedan.dispose();
    });
  }
});
