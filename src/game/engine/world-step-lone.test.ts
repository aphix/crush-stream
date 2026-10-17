import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { launch, makeCar } from "../contact/crash-scenarios.test-util.ts";
import { applyDrive, type DriveInput } from "../vehicle/car-drive.ts";
import type { DeformableCar } from "../vehicle/car.ts";
import { FINE_HZ, QUIET_HZ, SLICES_PER_STEP } from "../kernel/constants.ts";
import { WORK } from "./sim-phases.ts";
import { CONTACT_REACH, LONE_MARGIN, newWorld, stepWorld, type World } from "./world-step.ts";

/** The pacer's coarse step and its 1/240 s floor (s): the step a phone runs, and the slice a step in contact is cut to. */
const COARSE = 1 / QUIET_HZ;
const FINE = 1 / FINE_HZ;
const FRAME_DIGITS = 9;

/** Car-slices the world has stepped so far (live, wreck and sleeping cars alike). */
function carSlices(w: World): number {
  const work = w.phases.work;
  return work[WORK.liveCarSlices]! + work[WORK.wreckCarSlices]! + work[WORK.asleepCarSlices]!;
}

/** Two cars parked 3 m apart side by side, far off: in each other's reach, so every step of the world is cut to its fine slices whatever else is in it. */
function parkedPair(): DeformableCar[] {
  const a = makeCar("shape");
  const b = makeCar("shape");
  launch(a, 2000, 0, 0, 0, 0);
  launch(b, 2003, 0, 0, 0, 0);
  return [a, b];
}

function dispose(cars: readonly DeformableCar[]): void {
  for (const car of cars) car.dispose();
}

/** One step's account: its slice count, the lone mask and the car-slices it stepped. */
interface Row {
  slices: number;
  loners: number;
  carSlices: number;
}

/** `steps` steps of `dt` of `w`, `before` run ahead of each. */
function run(w: World, steps: number, dt: number, before: (step: number) => void = () => {}): Row[] {
  const rows: Row[] = [];
  for (let s = 0; s < steps; s++) {
    before(s);
    const n0 = carSlices(w);
    stepWorld(w, dt);
    rows.push({ slices: w.shape + 1, loners: w.loners, carSlices: carSlices(w) - n0 });
  }
  return rows;
}

/** A head-on pair (cars 0 and 1) and two cars alone far from everything (2 and 3), driving on at speed. */
function headOnField(lone: boolean): { cars: DeformableCar[]; w: World } {
  const cars = [makeCar("shape"), makeCar("shape"), makeCar("shape"), makeCar("shape")];
  launch(cars[0]!, -6, 0, Math.PI / 2, 15, 0);
  launch(cars[1]!, 6, 0, -Math.PI / 2, -15, 0);
  launch(cars[2]!, 0, 300, 0, 0, 25);
  launch(cars[3]!, 200, -300, Math.PI, 0, -20);
  const w = newWorld(cars);
  w.fine = FINE;
  w.lone = lone;
  return { cars, w };
}

describe("given a head-on pair and two cars alone, 300 m off, stepped at the pacer's coarse step with the 1/240 s floor set", () => {
  it("when the scene lets lone cars run, then each step cut for the pair steps its two cars in every slice and each lone car in one, and the lone mask is exactly the two lone cars", () => {
    const { cars, w } = headOnField(true);
    const rows = run(w, 120, COARSE);
    const cut = rows.filter((r) => r.slices > 1);
    assert.ok(cut.length > 3, `${cut.length} steps cut for the crash`);
    for (const r of cut) {
      assert.equal(r.carSlices, 2 * r.slices + 2, `a step of ${r.slices} slices stepped ${r.carSlices} car-slices`);
      assert.equal(r.loners, 0b1100, "the lone cars are 2 and 3 and nobody else");
    }
    for (const r of rows.filter((x) => x.slices === 1)) {
      assert.equal(r.loners, 0, "an uncut step has no lone car (every car's one slice is the step)");
      assert.equal(r.carSlices, 4);
    }
    dispose(cars);
  });

  it("when the scene does not let lone cars run (a derby, a harness), then every car takes every slice and no car is lone", () => {
    const { cars, w } = headOnField(false);
    const rows = run(w, 120, COARSE);
    const cut = rows.filter((r) => r.slices > 1);
    assert.ok(cut.length > 3);
    for (const r of cut) {
      assert.equal(r.carSlices, 4 * r.slices);
      assert.equal(r.loners, 0);
    }
    dispose(cars);
  });
});

describe("given two cars alone, 300 m apart", () => {
  it("when one has a hit about to land (`nearHit`, as the course marks a car driving hard at a wall), then the step is cut to the fine slices, that car takes all of them and the other, alone, takes one", () => {
    const a = makeCar("shape");
    const b = makeCar("shape");
    launch(a, 0, 0, 0, 0, 30);
    launch(b, 300, 0, 0, 0, 30);
    const w = newWorld([a, b]);
    w.fine = FINE;
    w.lone = true;
    const rows = run(w, 10, COARSE, () => {
      a.nearHit = true;
    });
    for (const r of rows) {
      assert.equal(r.slices, SLICES_PER_STEP);
      assert.equal(r.loners, 0b10);
      assert.equal(r.carSlices, SLICES_PER_STEP + 1);
    }
    dispose([a, b]);
  });

  it("when one's crush runs on (`deform.crushing`), then it is no lone car: it stays in the step's slices", () => {
    const [a, b] = parkedPair();
    const far = makeCar("shape");
    launch(far, 0, 0, 0, 0, 30);
    const w = newWorld([a!, b!, far]);
    w.fine = FINE;
    w.lone = true;
    const rows = run(w, 5, COARSE);
    assert.ok(rows.every((r) => r.slices === SLICES_PER_STEP && r.loners === 0b100), "the parked pair holds the step cut and the far car is alone");
    far.deform.crushing = true;
    const crushing = run(w, 1, COARSE);
    assert.equal(crushing[0]!.loners & 0b100, 0, "a car whose crush runs on stays in its slices");
    dispose([a!, b!, far]);
  });

  it("when one's body touches something (`hardTouch`, so `contactHz` asks 480 Hz), then it is no lone car and the step takes the slices that rate asks for", () => {
    const [a, b] = parkedPair();
    const far = makeCar("shape");
    launch(far, 0, 0, 0, 0, 30);
    const w = newWorld([a!, b!, far]);
    w.fine = FINE;
    w.lone = true;
    far.hardTouch = true;
    const rows = run(w, 1, COARSE);
    assert.equal(rows[0]!.loners & 0b100, 0, "a car whose body touches stays in its slices");
    assert.ok(rows[0]!.slices > 1);
    dispose([a!, b!, far]);
  });

  it("when one car is a sleeping wreck and another drives past it 7.5 m off (inside the wake reach, outside the contact reach), then neither is lone: the mover's top may wake it", () => {
    const [a, b] = parkedPair();
    const sleeper = makeCar("shape");
    const mover = makeCar("shape");
    launch(sleeper, 0, 0, 0, 0, 0);
    launch(mover, 7.5, 0, 0, 0, 10);
    sleeper.asleep = true;
    assert.ok(7.5 > CONTACT_REACH + LONE_MARGIN + 10 / QUIET_HZ, "outside the contact reach, so only the wake reach holds them");
    const w = newWorld([a!, b!, sleeper, mover]);
    w.fine = FINE;
    w.lone = true;
    const rows = run(w, 1, COARSE);
    assert.equal(rows[0]!.loners & 0b1100, 0, "neither the sleeper nor the car near it is lone");
    dispose([a!, b!, sleeper, mover]);
  });
});

/** Plan distance (m) at which a lone car's test calls a car 60 m/s from a parked one in reach of it: the contact reach, the margin and the 60 m/s of a 1/80 s step. */
const REACH_AT_60 = CONTACT_REACH + LONE_MARGIN + 60 / QUIET_HZ;

describe("given a car at 60 m/s and a parked one ahead of it on the same line, the world's steps cut by a pair parked far off", () => {
  /** The pair's lone mask in the first step, with the car starting `gap` m behind the parked one. */
  function firstMask(gap: number): number {
    const mover = makeCar("shape");
    const parked = makeCar("shape");
    launch(mover, -gap, 0, Math.PI / 2, 60, 0);
    launch(parked, 0, 0, Math.PI / 2, 0, 0);
    const far = parkedPair();
    const w = newWorld([mover, parked, ...far]);
    w.fine = FINE;
    w.lone = true;
    const rows = run(w, 1, COARSE);
    dispose([mover, parked, ...far]);
    return rows[0]!.loners & 0b11;
  }

  it("when it starts 5 cm outside the reach its travel over the step, the contact reach and the margin make, then both cars are lone; 5 cm inside it, neither is", () => {
    assert.equal(firstMask(REACH_AT_60 + 0.05), 0b11);
    assert.equal(firstMask(REACH_AT_60 - 0.05), 0);
  });

  /** A hit at 150 m/s on a parked car: the mover starts `offset` m outside the reach its 150 m/s make (negative: inside it). The sliced run is the reference (no car lone). */
  const finalPose = (lone: boolean, offset: number): { x: number; px: number; crashed: boolean; trail: number } => {
    const mover = makeCar("shape");
    const parked = makeCar("shape");
    launch(mover, -(CONTACT_REACH + LONE_MARGIN + 150 / QUIET_HZ + offset), 0, Math.PI / 2, 150, 0);
    launch(parked, 0, 0, Math.PI / 2, 0, 0);
    const far = parkedPair();
    const w = newWorld([mover, parked, ...far]);
    w.fine = FINE;
    w.lone = lone;
    let trail = -Infinity;
    run(w, 120, COARSE, () => {
      trail = Math.max(trail, mover.group.position.x - parked.group.position.x);
    });
    const out = { x: mover.group.position.x, px: parked.group.position.x, crashed: mover.crashed && parked.crashed, trail };
    dispose([mover, parked, ...far]);
    return out;
  };

  for (const [where, offset] of [["outside", 0.05], ["inside", -0.05]] as const) {
    it(`when it is driven at the parked car at 150 m/s from 5 cm ${where} that reach (a hit 1.9 m a step), then it is stopped by the parked car as without lone cars: it never passes the parked car's centre, and its pose agrees with the sliced run's to 5 cm`, () => {
      const sliced = finalPose(false, offset);
      const lone = finalPose(true, offset);
      assert.ok(lone.crashed && sliced.crashed, "the hit crashed both cars in both runs");
      assert.ok(lone.trail < 0, `the mover's centre got ${lone.trail.toFixed(2)} m past the parked car's`);
      assert.ok(Math.abs(lone.x - sliced.x) < 0.05, `mover ${lone.x.toFixed(3)} against ${sliced.x.toFixed(3)} m`);
      assert.ok(Math.abs(lone.px - sliced.px) < 0.05, `parked car ${lone.px.toFixed(3)} against ${sliced.px.toFixed(3)} m`);
    });
  }
});

describe("given a car driven for 5 s at the pacer's coarse step in a world whose steps are all cut by a pair parked far off", () => {
  /** The car's pose after 5 s of throttle and a sinusoidal steer, as a lone car or sliced. */
  function drive(lone: boolean): { x: number; z: number; speed: number; yaw: number } {
    const car = makeCar("shape");
    launch(car, 0, 0, 0, 0, 20);
    const far = parkedPair();
    const w = newWorld([car, ...far]);
    w.fine = FINE;
    w.lone = lone;
    const input: DriveInput = { throttle: 1, steer: 0, brake: 0, ebrake: false, boost: false };
    const rows = run(w, Math.round(5 * QUIET_HZ), COARSE, (s) => {
      input.steer = 0.4 * Math.sin((s * COARSE * 2 * Math.PI) / 2.5);
      applyDrive(car, input, COARSE);
    });
    assert.ok(rows.every((r) => r.slices === SLICES_PER_STEP), "every step was cut");
    assert.equal(rows.every((r) => (r.loners & 1) === (lone ? 1 : 0)), true, "the car was lone in every step of the lone run and in none of the other");
    const out = { x: car.group.position.x, z: car.group.position.z, speed: car.velocity.length(), yaw: car.group.rotation.y };
    dispose([car, ...far]);
    return out;
  }

  it("when it runs one slice a step against three, then it ends 5 s later within 0.15 m of where the sliced car does, at the same speed within 0.1 m/s and the same heading within 0.01 rad", () => {
    const sliced = drive(false);
    const lone = drive(true);
    assert.ok(Math.hypot(sliced.x, sliced.z) > 100, "the car drove");
    assert.ok(Math.hypot(lone.x - sliced.x, lone.z - sliced.z) < 0.15, `${Math.hypot(lone.x - sliced.x, lone.z - sliced.z).toFixed(3)} m apart`);
    assert.ok(Math.abs(lone.speed - sliced.speed) < 0.1, `${lone.speed.toFixed(3)} against ${sliced.speed.toFixed(3)} m/s`);
    assert.ok(Math.abs(lone.yaw - sliced.yaw) < 0.01, `${lone.yaw.toFixed(4)} against ${sliced.yaw.toFixed(4)} rad`);
  });
});

/** Every car's pose and velocity as text: equal for two runs only when they agree to the last bit. */
function stateOf(cars: readonly DeformableCar[]): string {
  return cars
    .map((c) => [c.group.position.x, c.group.position.y, c.group.position.z, c.velocity.x, c.velocity.y, c.velocity.z, c.group.quaternion.w].map((v) => v.toFixed(FRAME_DIGITS)).join(","))
    .join(";");
}

describe("given a field run live with lone cars, its recorded schedule and lone masks", () => {
  it("when the same field is run again on the record (`plan`, `planLoners`), then it ends bit for bit where the live run did; with the masks dropped it does not", () => {
    const record: { shape: number; loners: number }[] = [];
    const first = headOnField(true);
    for (let s = 0; s < 120; s++) {
      stepWorld(first.w, COARSE);
      record.push({ shape: first.w.shape, loners: first.w.loners });
    }
    assert.ok(record.some((r) => r.loners !== 0 && r.shape > 0), "the record holds steps with lone cars in them");
    const replay = (masks: boolean): string => {
      const field = headOnField(false);
      for (const r of record) {
        field.w.plan = r.shape;
        field.w.planLoners = masks ? r.loners : 0;
        stepWorld(field.w, COARSE);
      }
      const out = stateOf(field.cars);
      dispose(field.cars);
      return out;
    };
    const want = stateOf(first.cars);
    assert.equal(replay(true), want);
    assert.notEqual(replay(false), want, "the lone masks change nothing: the row cannot tell a replay that drops them");
    dispose(first.cars);
  });
});
