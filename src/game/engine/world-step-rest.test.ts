import { afterAll, describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import { FREEWHEEL, launch, makeCar, PARKED } from "../contact/crash-scenarios.test-util.ts";
import { R_STRENGTH, ROW } from "../contact/tether.ts";
import { QUIET_HZ } from "../kernel/constants.ts";
import { applyDrive, type DriveInput } from "../vehicle/car-drive.ts";
import type { DeformableCar } from "../vehicle/car.ts";
import { INTACT_REST_S } from "../vehicle/car-rest.ts";
import { WRECK_REST_S } from "../vehicle/car.ts";
import { assignClass } from "../vehicle/vehicle-classes.ts";
import { setGround } from "../world/ground.ts";
import { WORK } from "./sim-phases.ts";
import { newWorld, settleStep, stepWorld, type World } from "./world-step.ts";

afterAll(() => setGround(null));

const H = 1 / QUIET_HZ;
/** Seconds a parked car is given to settle and sleep (it needs `INTACT_REST_S` still). */
const SETTLE_S = 3;

type Field = { cars: DeformableCar[]; w: World };

/** Cars launched at (x, z, yaw, vx, vz) on the flat ground in one world that lets cars rest (or not). */
function field(rest: boolean, placements: readonly (readonly [number, number, number, number, number])[]): Field {
  const cars = placements.map(([x, z, yaw, vx, vz]) => {
    const car = makeCar();
    assignClass(car, "sedan");
    launch(car, x, z, yaw, vx, vz);
    return car;
  });
  const w = newWorld(cars);
  w.restSleep = rest;
  return { cars, w };
}

/** One fixed step as the open world's race field runs it: every car's pedals (parked ones hold their brake), the world, the breakage. */
function step(f: Field, inputs: readonly DriveInput[] = []): void {
  for (const [i, car] of f.cars.entries()) applyDrive(car, inputs[i] ?? PARKED, H);
  stepWorld(f.w, H);
  settleStep(f.cars, H, false);
}

function run(f: Field, seconds: number, inputs: readonly DriveInput[] = [], each: () => void = () => {}): void {
  for (let i = 0; i < Math.round(seconds * QUIET_HZ); i++) {
    step(f, inputs);
    each();
  }
}

/** A parked car settled to sleep. */
function sleeping(): Field {
  const f = field(true, [[0, 0, 0, 0, 0]]);
  run(f, SETTLE_S);
  return f;
}

describe("given a car parked on flat ground, its brake held, in a world that lets cars rest", () => {
  // mutation: sed -i 's/^export const INTACT_REST_S = 1;/export const INTACT_REST_S = 1e9;/' src/game/vehicle/car-rest.ts
  it("when it has stood for 3 s, then it is asleep, and over the next second it moves not a bit and its springs, which the sleeping car skips, are not stepped", () => {
    const f = field(true, [[0, 0, 0, 0, 0]]);
    const car = f.cars[0]!;
    run(f, SETTLE_S);
    expect(car.asleep, "asleep after 3 s").toBe(true);
    const before = car.group.position.toArray();
    const rode = vi.spyOn(car.suspension, "step");
    const asleepBefore = f.w.phases.work[WORK.asleepCarSlices]!;
    run(f, 1);
    expect(rode, "the springs' step calls in the next second").toHaveBeenCalledTimes(0);
    expect(f.w.phases.work[WORK.asleepCarSlices]! - asleepBefore, "its slices counted as asleep").toBeGreaterThanOrEqual(Math.round(QUIET_HZ));
    const after = car.group.position.toArray();
    expect(after[0], "its place x").toBe(before[0]);
    expect(after[1], "its place y").toBe(before[1]);
    expect(after[2], "its place z").toBe(before[2]);
    expect(car.velocity.lengthSq() + car.angular.lengthSq(), "its speed and spin").toBe(0);
    car.dispose();
  });

  it("when the world does not let cars rest (a race, a derby, the fleet), then the same car never sleeps and its springs step every step (guard)", () => {
    const f = field(false, [[0, 0, 0, 0, 0]]);
    const car = f.cars[0]!;
    const rode = vi.spyOn(car.suspension, "step");
    run(f, SETTLE_S);
    expect(car.asleep, "asleep").toBe(false);
    expect(rode.mock.calls.length, "the springs' step calls in 3 s").toBeGreaterThanOrEqual(Math.round(SETTLE_S * QUIET_HZ));
    car.dispose();
  });

  it("when the rest time an intact car needs is read against the wrecks', then they are the same (a restored keyframe reads its rest clock against the wrecks')", () => {
    expect(INTACT_REST_S).toBe(WRECK_REST_S);
  });

  // mutation: sed -i 's/car.drove = throttle !== 0 || command !== 0 ||/car.drove = throttle !== 0 ||/' src/game/vehicle/car-drive.ts
  it("when it has slept and its steering wheel is turned, then it is awake after one step", () => {
    const f = sleeping();
    const car = f.cars[0]!;
    step(f, [{ ...PARKED, steer: 0.5 }]);
    expect(car.asleep).toBe(false);
    car.dispose();
  });

  it("when it has slept and its throttle is pressed, then it drives away: 5 m in 3 s", () => {
    const f = sleeping();
    const car = f.cars[0]!;
    run(f, 3, [{ ...PARKED, brake: 0, throttle: 1 }]);
    expect(car.group.position.distanceTo(new THREE.Vector3(0, car.group.position.y, 0)), "metres driven").toBeGreaterThan(5);
    car.dispose();
  });

  // mutation: sed -i '/^    this.wake();$/d' src/game/vehicle/car.ts
  it("when it has slept and the traffic stands it on a new spot, then it is awake at once", () => {
    const f = sleeping();
    const car = f.cars[0]!;
    expect(car.asleep, "control: asleep").toBe(true);
    car.spawnFacing(30, 30, 1, 0);
    expect(car.asleep).toBe(false);
    car.dispose();
  });
});

describe("given a parked car asleep and another car 20 m behind it", () => {
  // mutation: sed -i 's/car.sleepZ, REACH,/car.sleepZ, 0,/' src/game/vehicle/car-rest.ts
  it("when the other drives past it at 8 m/s 3 m to its side, never touching, then the sleeper is woken as it passes (a mover's top within reach)", () => {
    const f = field(true, [[0, 0, 0, 0, 0], [3, -2000, 0, 0, 0]]);
    const sleeper = f.cars[0]!;
    const mover = f.cars[1]!;
    run(f, SETTLE_S, [PARKED, PARKED]);
    expect(sleeper.asleep, "control: asleep").toBe(true);
    launch(mover, 3, -20, 0, 0, 8);
    let woke = false;
    run(f, 4, [PARKED, FREEWHEEL], () => {
      woke ||= !sleeper.asleep;
    });
    expect(woke, "woken by the pass").toBe(true);
    expect(Math.abs(mover.group.position.x - 3), "the mover drove past straight (m off its line)").toBeLessThan(0.5);
    sleeper.dispose();
    mover.dispose();
  });

  // No single sed fails this row: the hit wakes the sleeper by its velocity, by `wakePair` and by the rammer's top in reach; the row pins the end result.
  it("when the other runs into it at 6 m/s, then the sleeper is awake and driven forward by the hit", () => {
    const f = field(true, [[0, 0, 0, 0, 0], [0, -2000, 0, 0, 0]]);
    run(f, SETTLE_S, [PARKED, PARKED]);
    const sleeper = f.cars[0]!;
    const rammer = f.cars[1]!;
    expect(sleeper.asleep, "control: asleep").toBe(true);
    launch(rammer, 0, -12, 0, 0, 6);
    run(f, 3, [FREEWHEEL, FREEWHEEL]);
    expect(sleeper.asleep, "asleep after the hit").toBe(false);
    expect(sleeper.group.position.z, "pushed forward (m)").toBeGreaterThan(0.5);
    sleeper.dispose();
    rammer.dispose();
  });

  // mutation: sed -i 's/car.velocity.lengthSq() === 0 && car.angular.lengthSq() === 0 && !stirNear/!stirNear/' src/game/vehicle/car-rest.ts
  it("when a shot or a punch gives the sleeper a speed of 1 m/s, then it is awake and rolls on", () => {
    const f = sleeping();
    const car = f.cars[0]!;
    car.velocity.z += 1;
    run(f, 1, [FREEWHEEL]);
    expect(car.asleep, "awake").toBe(false);
    expect(car.group.position.z, "rolled on (m)").toBeGreaterThan(0.3);
    car.dispose();
  });
});

describe("given the same hit on a parked car that never slept and on one that did", () => {
  // No single sed fails this row: the hit wakes the sleeper by its velocity, by `wakePair` and by the rammer's top in reach; the row pins the end result.
  it("when a car runs into each at 8 m/s, then the struck car's speed 0.4 s after the hit is within 2 % of the never-slept one's", () => {
    const struckSpeed = (rest: boolean): number => {
      const f = field(rest, [[0, 0, 0, 0, 0], [0, -2000, 0, 0, 0]]);
      run(f, SETTLE_S, [PARKED, PARKED]);
      expect(f.cars[0]!.asleep, `control: asleep ${rest}`).toBe(rest);
      launch(f.cars[1]!, 0, -9, 0, 0, 8);
      run(f, 0.4 + 9 / 8 - 0.1, [FREEWHEEL, FREEWHEEL]);
      const speed = f.cars[0]!.velocity.z;
      for (const car of f.cars) car.dispose();
      return speed;
    };
    const awake = struckSpeed(false);
    const slept = struckSpeed(true);
    expect(awake, "the struck car moves").toBeGreaterThan(1);
    expect(Math.abs(slept - awake) / awake, `speeds ${slept} and ${awake}`).toBeLessThan(0.02);
  });
});

describe("given a parked car asleep with a cable tied to another car", () => {
  // mutation: sed -i 's/car.velocity.lengthSq() === 0 && car.angular.lengthSq() === 0 && !stirNear/!stirNear/' src/game/vehicle/car-rest.ts && sed -i '/^  if (car.asleep) car.wake();/d' src/game/contact/tether.ts (with `if (!a.moving && !b.moving) return;` of `wakePair` in src/game/engine/world-step.ts also made `return;`)
  it("when that car drives away and the cable draws taut, then the hooked parked car is pulled after it", () => {
    const f = field(true, [[0, 0, Math.PI / 2, 0, 0], [8, 0, Math.PI / 2, 0, 0]]);
    run(f, SETTLE_S, [PARKED, PARKED]);
    const parked = f.cars[0]!;
    expect(parked.asleep, "control: asleep").toBe(true);
    const slot = f.w.tethers.open();
    for (const [end, car] of [0, 1].entries()) {
      const centre = f.cars[car]!.frame.centre;
      f.w.tethers.setEnd(slot, end, car, centre.x, centre.y, centre.z);
    }
    f.w.tethers.fit(slot, f.cars);
    f.w.tethers.rows[slot * ROW + R_STRENGTH] = 1e12;
    f.cars[1]!.velocity.set(10, 0, 0);
    run(f, 2, [FREEWHEEL, FREEWHEEL]);
    expect(parked.asleep, "awake").toBe(false);
    expect(parked.group.position.x, "drawn along the cable (m)").toBeGreaterThan(3);
    for (const car of f.cars) car.dispose();
  });
});

describe("given a car with weight borne on its roof by a car above it", () => {
  const NO_CHANGE = new THREE.Vector3();

  // mutation: sed -i '/^    if (under !== undefined && under.asleep && !under.deform.massActive) under.wake();/d' src/game/vehicle/car-surfaces.ts
  it("when the car is asleep and the car above bears weight on it, then it wakes at once: its skipped step would never take that weight", () => {
    const f = field(true, [[0, 0, 0, 0, 0]]);
    const car = f.cars[0]!;
    run(f, SETTLE_S);
    expect(car.asleep, "control: asleep").toBe(true);
    f.w.surfaces.bear(0, NO_CHANGE, NO_CHANGE, 1, H);
    expect(car.asleep, "awake").toBe(false);
    car.dispose();
  });

  // mutation: sed -i 's/ || car.surfaces?.isBorne(car.slot) === true//' src/game/vehicle/car-rest.ts
  it("when the weight borne on a still car is waiting over 10 s of slices, then it does not fall asleep for 3 s, and does once the weight is taken", () => {
    const f = field(true, [[0, 0, 0, 0, 0]]);
    const car = f.cars[0]!;
    step(f);
    f.w.surfaces.bear(0, NO_CHANGE, NO_CHANGE, 1, 10);
    run(f, SETTLE_S);
    expect(car.asleep, "awake under a waiting load").toBe(false);
    run(f, 10);
    expect(car.asleep, "asleep once the load is taken").toBe(true);
    car.dispose();
  });
});
