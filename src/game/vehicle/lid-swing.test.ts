import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { runWall } from "../contact/crash-scenarios.test-util.ts";
import { FINE_HZ } from "../kernel/constants.ts";
import { DeformableCar } from "./car.ts";
import type { CarStyleId } from "./car-variants.ts";
import { LID } from "./constants.ts";
import { paint } from "./test-support.ts";

/**
 * The trunk lid, hatch, liftgate and drop gate swing on the doors' hinge model (docs/DOOR_RIG.md, "Lids"): a rear hit past the
 * latch's threshold springs it, it swings on its weight, struts and the car's surge, re-latches when shut under its slam limit,
 * and tears off at its stop, on a slam, or under a hit once open.
 */

const H = 1 / FINE_HZ;
const LIDS: readonly CarStyleId[] = ["sedan", "hatchback", "wagon", "pickup"];

function parked(id: CarStyleId): DeformableCar {
  const car = new DeformableCar(paint(), new THREE.Scene(), null, id);
  car.spawnFacing(0, 0, 0, 0);
  return car;
}

/** `seconds` of free swing; `az` the car's forward acceleration (m/s²). */
function swing(car: DeformableCar, seconds: number, az = 0): void {
  for (let t = 0; t < seconds - 1e-9; t += H) {
    car.velocity.addScaledVector(car.fwdFlat, az * H);
    car.swingHinges(H);
  }
}

/** The closing (or opening) rate (rad/s) at which the lid carries `share` × `energy` (J). */
const rateFor = (car: DeformableCar, share: number, energy: number): number => Math.sqrt((2 * share * energy) / car.lidHinge().spec.inertia);

describe("given a rear hit on a car with its lid shut", () => {
  for (const id of LIDS) {
    it(`when a ${id} backs into a wall at 14 km/h, then its lid stays latched; at 30 km/h its latch springs and the lid stays on`, (t) => {
      const soft = parked(id);
      runWall(14, 1, "rear", { car: soft });
      const hard = parked(id);
      runWall(30, 1, "rear", { car: hard });
      t.diagnostic(`${id}: 14 km/h hinge ${soft.lidAngle().toFixed(3)} rad, 30 km/h ${hard.lidAngle().toFixed(3)} rad`);
      assert.ok(soft.lidHinge().latched, `${id} lid sprang at 14 km/h`);
      assert.ok(!hard.lidHinge().latched && !hard.lidOff(), `${id} lid at 30 km/h: latched ${hard.lidHinge().latched}, off ${hard.lidOff()}`);
    });
  }
});

describe("given an unlatched lid on a parked car", () => {
  it("when a pickup's tailgate is sprung, then it drops rearward onto its cables, level (90°), and never swings under", () => {
    const car = parked("pickup");
    const s = car.lidHinge().spec;
    // Where a 30 km/h rear hit springs it (`lidAngle` above): a gate barely off upright is held by its hinges' friction.
    car.setLidOpen(0.15);
    let most = 0;
    for (let k = 0; k < 2 * FINE_HZ; k++) {
      car.swingHinges(H);
      most = Math.max(most, car.lidHinge().theta);
    }
    const h = car.lidHinge();
    assert.ok(Math.abs(s.stop - Math.PI / 2) < 1e-9, `stop ${s.stop}`);
    assert.equal(h.theta, s.stop);
    assert.ok(most <= s.stop, `swung to ${most}`);
    assert.ok(h.load > 0 && h.load < s.tearJ && !car.lidOff(), `cables took ${h.load} J`);
  });

  for (const id of ["wagon", "hatchback"] as const) {
    it(`when a ${id}'s top-hinged gate is let go, then its gas struts lift it up to its stop and hold it there`, () => {
      const car = parked(id);
      car.setLidOpen(0.02);
      swing(car, 3);
      assert.equal(car.lidHinge().theta, car.lidHinge().spec.stop);
      assert.ok(!car.lidOff());
    });
  }

  it("when a sedan's lid is let go, then its torsion bars lift it to its stop, a hard launch swings it down off the stop, and coasting lets it rise back", () => {
    const car = parked("sedan");
    const h = car.lidHinge();
    car.setLidOpen(0.05);
    swing(car, 2);
    assert.equal(h.theta, h.spec.stop);
    swing(car, 0.5, 8);
    const launched = h.theta;
    swing(car, 2);
    assert.ok(launched < h.spec.stop - 0.1 && !h.latched, `launch left it at ${launched}`);
    assert.equal(h.theta, h.spec.stop);
  });
});

describe("given an open lid pushed shut or flung onto its stop", () => {
  it("when a solid pushes it shut at 0.9× its slam limit, then it latches; at 1.1×, then it is wrenched off", () => {
    const soft = parked("sedan");
    soft.setLidOpen(1);
    soft.shutLid(0, rateFor(soft, 0.9, soft.lidHinge().spec.slamJ));
    const hard = parked("sedan");
    hard.setLidOpen(1);
    hard.shutLid(0, rateFor(hard, 1.1, hard.lidHinge().spec.slamJ));
    assert.ok(soft.lidHinge().latched && !soft.lidOff() && soft.lidAngle() === 0);
    assert.ok(hard.lidOff() && hard.hasLoosePart());
  });

  it("when it is flung onto its stop at 0.8× its hinge limit, then it holds; at 1.25×, then it tears off", () => {
    const fling = (share: number): DeformableCar => {
      const car = parked("sedan");
      car.setLidOpen(0.4);
      car.lidHinge().omega = rateFor(car, share, car.lidHinge().spec.tearJ);
      swing(car, 0.5);
      return car;
    };
    const soft = fling(0.8);
    assert.ok(!soft.lidOff() && soft.lidHinge().theta === soft.lidHinge().spec.stop, `load ${soft.lidHinge().load}`);
    assert.ok(fling(1.25).lidOff());
  });
});

describe("given a rear hit on a car whose lid is already open", () => {
  it("when a sedan backs into a wall at 40 km/h and then 24 km/h, then the first springs the lid open and the second tears it off as a loose part", (t) => {
    const car = parked("sedan");
    runWall(40, 1, "rear", { car });
    const open = !car.lidHinge().latched && !car.lidOff();
    const r = runWall(24, 1, "rear", { car });
    t.diagnostic(`after the second hit: hinge ${r.hinge[LID.trunk]?.toFixed(3)}, detached ${r.detached.join(",")}, stop load ${car.lidHinge().load.toFixed(1)} J, ebs ${car.deform.hitSpeedValue.toFixed(2)}`);
    assert.ok(open, "the first hit left the lid shut or tore it off");
    assert.ok(car.lidOff() && r.detached.includes(LID.trunk) && car.hasLoosePart());
  });
});
