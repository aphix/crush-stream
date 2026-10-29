import { describe, it } from "vitest";
import assert from "node:assert/strict";
import * as THREE from "three";
import { DeformableCar } from "./car.ts";
import { SAMPLE, sampleAt } from "./car-cage.ts";
import { paint } from "./test-support.ts";
import { makeWorld, tickWorld } from "../contact/crash-scenarios.test-util.ts";
import { FACE_TOP, faceStrength } from "../deform/load-crush.ts";

/** Gap (m) between the upper car's lowest belly row and the roof under it, dropped from rest. */
const BELLY_GAP = 0.02;
/** How far (m) the sim's roof may stand off the law's: the energy the car gives is the energy the roof takes, up to the tyres' springs and the roof's skin share. */
const LAW_BAR_M = 0.01;
const DROP_RUN_S = 3;
/** The lower car stands on its springs this long (s) before the upper is set down, so the gap is the one the upper falls. */
const REST_S = 1;
/** Where the upper car waits (m along x) while the lower settles: clear of it. */
const UPPER_AWAY_M = 40;
const LAW_STEPS = 2000;

/** Height (m) of `upper`'s origin over `under`'s at which its lowest belly row meets the roof under it (the roof is not flat: the keel is not the lowest row). */
function bellyLanding(under: DeformableCar, upper: DeformableCar): number {
  under.refitCage();
  let most = -Infinity;
  for (const [i, [x, y, z]] of upper.frame.belly.entries()) {
    if (upper.frame.bellyAbsent[i] === 1) continue;
    SAMPLE[0] = x;
    SAMPLE[1] = z;
    sampleAt(under.cage.fields.top, under.cage.style);
    if (Number.isFinite(SAMPLE[2]!)) most = Math.max(most, SAMPLE[2]! - y);
  }
  return most;
}

/** The crush (m) at which a rigid car of the roof's own weight, released `BELLY_GAP` over it, has given its fall to the roof: `gap + x = ∫ strength dx` (car weights times metres). */
function lawCrush(): number {
  let work = 0;
  const h = 0.45 / LAW_STEPS;
  for (let i = 1; i <= LAW_STEPS; i++) {
    const x = i * h;
    work += h * faceStrength(FACE_TOP, x - 0.5 * h);
    if (work > BELLY_GAP + x) return x;
  }
  return Infinity;
}

/** One sedan set `BELLY_GAP` over another's settled roof by its belly rows and dropped, simulated at `hz`: the lower roof's crush (m) after `DROP_RUN_S`. */
function roofUnderOneCar(hz: number): number {
  const under = new DeformableCar(paint(), new THREE.Scene());
  under.spawnFacing(0, 0, 0, 0);
  const upper = new DeformableCar(paint(), new THREE.Scene());
  upper.spawnFacing(UPPER_AWAY_M, 0, 0, 0);
  upper.parked = true;
  under.parked = true;
  const w = makeWorld([under, upper], false, false);
  for (let f = 0; f < REST_S * hz; f++) tickWorld(w, 1 / hz);
  upper.group.position.set(under.group.position.x, under.group.position.y + bellyLanding(under, upper) + BELLY_GAP, under.group.position.z);
  upper.group.quaternion.copy(under.group.quaternion);
  upper.velocity.set(0, 0, 0);
  upper.angular.set(0, 0, 0);
  upper.airborne = true;
  upper.group.updateMatrixWorld(true);
  for (let f = 0; f < DROP_RUN_S * hz; f++) tickWorld(w, 1 / hz);
  return under.roofRestY - under.deform.massLocal("roof").y;
}

describe("given one car dropped by its belly onto another car's roof", () => {
  it("when it falls 2 cm onto the roof at 60, 144 and 240 Hz, then the roof under it crushes as the roof's strength law gives for a car released that high, not more", () => {
    const law = lawCrush();
    assert.ok(law > 0.05 && law < 0.15, `the control: the law's peak crush for a 2 cm drop, ${law.toFixed(4)} m`);
    for (const hz of [60, 144, 240]) {
      const sink = roofUnderOneCar(hz);
      assert.ok(Math.abs(sink - law) < LAW_BAR_M, `at ${hz} Hz the roof crushed ${sink.toFixed(4)} m, the law ${law.toFixed(4)} m`);
    }
  });
});
