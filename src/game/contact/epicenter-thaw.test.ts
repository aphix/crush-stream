import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { EPICENTER,  epicenterValues, loadEpicenter } from "../deform/epicenter.ts";
import { EPICENTER_AT_LOAD } from "../deform/epicenter.test-util.ts";
import { FINE_HZ } from "../kernel/constants.ts";
import { layOnGround } from "../vehicle/car-air-points.ts";
import type { DeformableCar } from "../vehicle/car.ts";
import { FREEWHEEL, launch, makeCar, makeWorld, Probe, run } from "./crash-scenarios.test-util.ts";
import { applyDrive, idleDrive } from "../vehicle/car-drive.ts";

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
  expect(car.deform.massActive && car.deform.quietTime() > 0.35, "the wreck is not quiet").toBeTruthy();
  return car;
}

describe("given a wreck that has been frozen", () => {
  const car = wreck();
  const d = car.deform;
  const frozen = (): boolean => {
    d.frozen = true;
    return d.frozen;
  };

  describe("and something writes to its masses or restarts its contact clock", () => {
    const writerCalls = {
      translateMasses: () => d.translateMasses(0.01, 0, 0.1, 0),
      pushMass: () => d.pushMass(0, 0.01, 0),
      separateAlong: () => d.separateAlong(1, 0, 0, 0.01),
      kickCore: () => d.kickCore(1, 0, 0, 0.5),
      kickAlong: () => d.kickAlong(1, 0, 0, 0.5),
      applyImpulse: () => d.applyImpulse(0, 0, -1, 300),
      impulseAt: () => d.impulseAt(AT, IN, 5),
      kickNearest: () => d.kickNearest(AT, 1, 0, 0, 100),
      feedOverlap: () => d.feedOverlap(AT, IN, 0.05, 5),
      notifyContact: () => d.notifyContact(),
    };
    const testCases = [
      { it: "when its masses are moved as a whole, then it is thawed", writer: "translateMasses" },
      { it: "when one of its masses is pushed, then it is thawed", writer: "pushMass" },
      { it: "when its masses are separated along an axis, then it is thawed", writer: "separateAlong" },
      { it: "when its core is kicked, then it is thawed", writer: "kickCore" },
      { it: "when its masses are kicked along an axis, then it is thawed", writer: "kickAlong" },
      { it: "when an impulse is applied to its masses, then it is thawed", writer: "applyImpulse" },
      { it: "when an impulse lands at a point on it, then it is thawed", writer: "impulseAt" },
      { it: "when the mass nearest a point is kicked, then it is thawed", writer: "kickNearest" },
      { it: "when a real overlap feed reaches it, then it is thawed", writer: "feedOverlap" },
      { it: "when a contact is reported on it, then it is thawed", writer: "notifyContact" },
    ] as const;
    for (const testCase of testCases) {
      it(testCase.it, () => {
        expect(frozen()).toBeTruthy();
        writerCalls[testCase.writer]();
        expect(d.frozen).toBe(false);
      });
    }
  });

  describe("and something is called that writes nothing", () => {
    const silentCalls = {
      translateMasses: () => d.translateMasses(0, 0, 0, 0),
      separateAlong: () => d.separateAlong(1, 0, 0, 0),
      kickCore: () => d.kickCore(1, 0, 0, 0),
      applyImpulse: () => d.applyImpulse(0, 0, -1, 0),
      feedOverlap: () => d.feedOverlap(AT, IN, 0, 0),
      cutDrive: () => d.cutDrive(1 / FINE_HZ),
    };
    const testCases = [
      { it: "when its masses are moved by nothing, then it stays frozen", writer: "translateMasses" },
      { it: "when its masses are separated by nothing, then it stays frozen", writer: "separateAlong" },
      { it: "when its core is kicked with nothing, then it stays frozen", writer: "kickCore" },
      { it: "when an impulse of nothing is applied, then it stays frozen", writer: "applyImpulse" },
      { it: "when a resting contact (no overlap, no closing) is fed, then it stays frozen", writer: "feedOverlap" },
      { it: "when its drive is cut, which only scales the hubs' speed the rigid field overwrites, then it stays frozen", writer: "cutDrive" },
    ] as const;
    for (const testCase of testCases) {
      it(testCase.it, () => {
        expect(frozen()).toBeTruthy();
        silentCalls[testCase.writer]();
        expect(d.frozen).toBe(true);
      });
    }
  });

  it("when the smallest feed that counts is 0 (today), then a small resting feed (a few millimetres of overlap) thaws the wreck, the cost of a pile that feeds crush every slice", () => {
    expect(frozen()).toBeTruthy();
    const kept = EPICENTER.feedMin;
    try {
      EPICENTER.feedMin = 0;
      d.feedOverlap(AT, IN, 0.003, 0.001);
      expect(d.frozen).toBe(false);
      expect(d.crushDropped).toBe(0);
    } finally {
      EPICENTER.feedMin = kept;
    }
  });

  it("when the smallest feed that counts is 1 cm, then the same small feed is dropped and counted and the wreck stays frozen, and a real feed (over the limit) thaws it as ever", () => {
    expect(frozen()).toBeTruthy();
    const kept = EPICENTER.feedMin;
    try {
      EPICENTER.feedMin = 0.01;
      d.feedOverlap(AT, IN, 0.003, 0.001);
      expect(d.frozen).toBe(true);
      expect(d.crushDropped > 1e-5 && d.crushDropped < 0.01, `dropped ${d.crushDropped} m`).toBeTruthy();
      d.feedOverlap(AT, IN, 0.3, 8);
      expect(d.frozen).toBe(false);
    } finally {
      EPICENTER.feedMin = kept;
    }
  });
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
      expect(d.frozen, "the wreck froze").toBeTruthy();
      d.stepFrozen(1 / FINE_HZ, car.group);
      expect(d.frozenBreaches, "an untouched frozen car breached").toBe(0);
      d.masses[3]!.local.x += 0.01;
      d.stepFrozen(1 / FINE_HZ, car.group);
      expect(d.frozenBreaches, "a moved mass went unnoticed").toBe(1);
    } finally {
      loadEpicenter(saved);
    }
  });

  it("when a sleeping wreck is flagged frozen but not cached, then a wheel hub off its frame is no breach, and an awake wreck's is", () => {
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
      expect(d.frozen, "the wreck froze").toBeTruthy();
      d.frozenReady = false;
      d.masses.find((m) => m.hub)!.world.x += 0.16;
      d.stepFrozen(1 / FINE_HZ, car.group, true);
      expect(d.frozenBreaches, "a sleeper never re-derived was counted").toBe(0);
      d.stepFrozen(1 / FINE_HZ, car.group, false);
      expect(d.frozenBreaches, "an awake wreck with a mass off its frame went unnoticed").toBe(1);
    } finally {
      loadEpicenter(saved);
    }
  });

  it("when a car whose frozen centre is cached has its pose re-measured (a clamp after the cache), then the check counts a breach: the invariant the freeze rests on (a planted hub's pin must not replace its stand)", () => {
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
      expect(d.frozen && d.frozenReady, "the wreck froze with its centre cached").toBeTruthy();
      expect(d.frozenBreaches, "the run itself breached").toBe(0);
      car.syncPose(0);
      expect(d.frozenBreaches, "a clamp after the cache went unnoticed").toBe(1);
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
      expect(car.deform.frozen && car.deform.frozenReady, "the wreck froze with its centre cached").toBeTruthy();
      car.spawnFacing(0, 0, 0, 0);
      expect(car.deform.frozen, "frozen after a respawn").toBe(false);
      expect(car.deform.frozenReady, "the cached centre survived a respawn").toBe(false);
    } finally {
      loadEpicenter(saved);
    }
  });

  it("when a wreck that is frozen and asleep is given a steering input (a race gives its AI wrecks pedals), then its masses turn with its frame: none ends off where the frame puts it and no breach is counted", () => {
    const saved = epicenterValues();
    try {
      loadEpicenter(EPICENTER_AT_LOAD);
      EPICENTER.on = 1;
      EPICENTER.frozenCheck = 1;
      const car = makeCar("shape");
      launch(car, 6.2, 0, -Math.PI / 2, -50 * KPH, 0);
      layOnGround(car);
      const w = makeWorld([car], true, false, FREEWHEEL);
      run(w, [new Probe(car, car.velocity)], 6);
      const d = car.deform;
      expect(d.frozen && d.frozenReady && car.asleep, `the wreck froze (${d.frozen}) with its centre cached (${d.frozenReady}) and fell asleep (${car.asleep})`).toBeTruthy();
      for (let i = 0; i < 50; i++) {
        applyDrive(car, { ...idleDrive(), steer: 1 }, 1 / FINE_HZ);
        car.integrate(1 / FINE_HZ);
        d.stepFrozen(1 / FINE_HZ, car.group);
      }
      expect(car.asleep, "the wreck woke: the row would not tell a frame turned alone from one turned with its masses").toBeTruthy();
      expect(d.frozenBreaches, `a mass stood ${d.breachOffMax} m (${d.breachOffName}) off its frame`).toBe(0);
    } finally {
      loadEpicenter(saved);
    }
  });
});
