import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { EPICENTER,  epicenterValues, loadEpicenter } from "../deform/epicenter.ts";
import { EPICENTER_AT_LOAD } from "../deform/epicenter.test-util.ts";
import { FINE_HZ } from "../kernel/constants.ts";
import { layOnGround } from "../vehicle/car-air-points.ts";
import type { DeformableCar } from "../vehicle/car.ts";
import { FREEWHEEL, launch, makeCar, makeWorld, Probe, run } from "./crash-scenarios.test-util.ts";

/**
 * A frozen wreck (`epicenter` activation) rides its body and runs no solve, so whatever moves one of its masses or restarts its contact clock has to
 * thaw it first: the next structure step then runs the solve over what the write left. A call that writes nothing leaves it frozen: a wreck resting
 * on another is touched every slice, and thawing on each would never freeze it.
 */

const KPH = 1 / 3.6;
const AT = new THREE.Vector3(0, 0.4, 2);
const IN = new THREE.Vector3(0, 0, -1);

/** A wreck 1.5 s after a wall hit (a mass-active car with its contact window long closed). */
function wreck(): DeformableCar {
  const car = makeCar("shape");
  launch(car, 6.2, 0, -Math.PI / 2, -50 * KPH, 0);
  layOnGround(car);
  const w = makeWorld([car], true, false, FREEWHEEL);
  run(w, [new Probe(car, car.velocity)], 1.5);
  assert.ok(car.deform.massActive && car.deform.quietTime() > 0.35, "the wreck is not quiet");
  return car;
}

describe("given a wreck that has been frozen", () => {
  const car = wreck();
  const d = car.deform;
  const frozen = (): boolean => {
    d.frozen = true;
    return d.frozen;
  };

  const writers: [string, () => void][] = [
    ["translateMasses", () => d.translateMasses(0.01, 0, 0.1, 0)],
    ["pushMass", () => d.pushMass(0, 0.01, 0)],
    ["separateAlong", () => d.separateAlong(1, 0, 0, 0.01)],
    ["kickCore", () => d.kickCore(1, 0, 0, 0.5)],
    ["kickAlong", () => d.kickAlong(1, 0, 0, 0.5)],
    ["applyImpulse", () => d.applyImpulse(0, 0, -1, 300)],
    ["impulseAt", () => d.impulseAt(AT, IN, 5)],
    ["kickNearest", () => d.kickNearest(AT, 1, 0, 0, 100)],
    ["feedOverlap with a real feed", () => d.feedOverlap(AT, IN, 0.05, 5)],
    ["notifyContact", () => d.notifyContact()],
  ];
  for (const [name, call] of writers) {
    it(`when ${name} writes to it, then it is thawed`, () => {
      assert.ok(frozen());
      call();
      assert.equal(d.frozen, false);
    });
  }

  const silent: [string, () => void][] = [
    ["translateMasses by nothing", () => d.translateMasses(0, 0, 0, 0)],
    ["separateAlong by nothing", () => d.separateAlong(1, 0, 0, 0)],
    ["kickCore by nothing", () => d.kickCore(1, 0, 0, 0)],
    ["applyImpulse of nothing", () => d.applyImpulse(0, 0, -1, 0)],
    ["feedOverlap of a resting contact (no overlap, no closing)", () => d.feedOverlap(AT, IN, 0, 0)],
    ["cutDrive, which only scales the hubs' speed the rigid field overwrites", () => d.cutDrive(1 / FINE_HZ)],
  ];
  for (const [name, call] of silent) {
    it(`when ${name} is called, then it stays frozen`, () => {
      assert.ok(frozen());
      call();
      assert.equal(d.frozen, true);
    });
  }
});

describe("given the guard that checks frozen cars", () => {
  it("when a mass of a frozen car is moved by a writer that does not thaw it, then the next frozen step counts a breach, and a step with nothing written counts none", () => {
    const saved = epicenterValues();
    try {
      loadEpicenter(EPICENTER_AT_LOAD);
      EPICENTER.on = 1;
      EPICENTER.frozenCheck = 1;
      const car = makeCar("shape");
      launch(car, 6.2, 0, -Math.PI / 2, -50 * KPH, 0);
      layOnGround(car);
      const w = makeWorld([car], true, false, FREEWHEEL);
      run(w, [new Probe(car, car.velocity)], 1.5);
      const d = car.deform;
      assert.ok(d.frozen, "the wreck froze");
      d.stepFrozen(1 / FINE_HZ, car.group);
      assert.equal(d.frozenBreaches, 0, "an untouched frozen car breached");
      d.masses[3]!.local.x += 0.01;
      d.stepFrozen(1 / FINE_HZ, car.group);
      assert.equal(d.frozenBreaches, 1, "a moved mass went unnoticed");
    } finally {
      loadEpicenter(saved);
    }
  });

  it("when a car whose frozen centre is cached has its pose re-measured (followGroup: a clamp after the cache), then the check counts a breach: the invariant the freeze rests on (a planted hub's pin must not replace its stand)", () => {
    const saved = epicenterValues();
    try {
      loadEpicenter(EPICENTER_AT_LOAD);
      EPICENTER.on = 1;
      EPICENTER.frozenCheck = 1;
      const car = makeCar("shape");
      launch(car, 6.2, 0, -Math.PI / 2, -50 * KPH, 0);
      layOnGround(car);
      const w = makeWorld([car], true, false, FREEWHEEL);
      run(w, [new Probe(car, car.velocity)], 1.5);
      const d = car.deform;
      assert.ok(d.frozen && d.frozenReady, "the wreck froze with its centre cached");
      assert.equal(d.frozenBreaches, 0, "the run itself breached");
      car.syncPose(0);
      assert.equal(d.frozenBreaches, 1, "a clamp after the cache went unnoticed");
    } finally {
      loadEpicenter(saved);
    }
  });

  it("when a frozen wreck is put back on a spot (a respawn, a scene change: the rig scenes step through their own slice, which never settles a freeze), then it is not frozen", () => {
    const saved = epicenterValues();
    try {
      loadEpicenter(EPICENTER_AT_LOAD);
      EPICENTER.on = 1;
      const car = makeCar("shape");
      launch(car, 6.2, 0, -Math.PI / 2, -50 * KPH, 0);
      layOnGround(car);
      const w = makeWorld([car], true, false, FREEWHEEL);
      run(w, [new Probe(car, car.velocity)], 1.5);
      assert.ok(car.deform.frozen && car.deform.frozenReady, "the wreck froze with its centre cached");
      car.spawnFacing(0, 0, 0, 0);
      assert.equal(car.deform.frozen, false, "frozen after a respawn");
      assert.equal(car.deform.frozenReady, false, "the cached centre survived a respawn");
    } finally {
      loadEpicenter(saved);
    }
  });
});
