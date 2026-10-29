import { describe, expect, it } from "vitest";
import { launch, makeCar } from "../contact/crash-scenarios.test-util.ts";
import { applyDrive, type DriveInput } from "../vehicle/car-drive.ts";
import type { DeformableCar } from "../vehicle/car.ts";
import { QUIET_HZ, SLICES_PER_STEP } from "../kernel/constants.ts";
import { CONTACT_REACH, LONE_MARGIN, newWorld, stepWorld, type World } from "./world-step.ts";
import { ajar, COARSE, dispose, FINE, parkedPair, run } from "./world-step-lone.test-util.ts";

const FRAME_DIGITS = 9;

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
    expect(cut.length, `${cut.length} steps cut for the crash`).toBeGreaterThan(3);
    for (const r of cut) {
      expect(r.carSlices, `a step of ${r.slices} slices stepped ${r.carSlices} car-slices`).toBe(2 * r.slices + 2);
      expect(r.loners, "the lone cars are 2 and 3 and nobody else").toBe(0b1100);
    }
    for (const r of rows.filter((x) => x.slices === 1)) {
      expect(r.loners, "an uncut step has no lone car (every car's one slice is the step)").toBe(0);
      expect(r.carSlices).toBe(4);
    }
    dispose(cars);
  });

  it("when the scene does not let lone cars run (a derby, a harness), then every car takes every slice and no car is lone", () => {
    const { cars, w } = headOnField(false);
    const rows = run(w, 120, COARSE);
    const cut = rows.filter((r) => r.slices > 1);
    expect(cut.length).toBeGreaterThan(3);
    for (const r of cut) {
      expect(r.carSlices).toBe(4 * r.slices);
      expect(r.loners).toBe(0);
    }
    dispose(cars);
  });
});

describe("given two cars alone, 300 m apart", () => {
  it("when one has a hit about to land (as the course marks a car driving hard at a wall), then the step is cut to the fine slices, that car takes all of them and the other, alone, takes one", () => {
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
      expect(r.slices).toBe(SLICES_PER_STEP);
      expect(r.loners).toBe(0b10);
      expect(r.carSlices).toBe(SLICES_PER_STEP + 1);
    }
    dispose([a, b]);
  });

  it("when one's crush runs on, then it is no lone car: it stays in the step's slices", () => {
    const [a, b] = parkedPair();
    const far = makeCar("shape");
    launch(far, 0, 0, 0, 0, 30);
    const w = newWorld([a!, b!, far]);
    w.fine = FINE;
    w.lone = true;
    const rows = run(w, 5, COARSE);
    expect(rows.every((r) => r.slices === SLICES_PER_STEP && r.loners === 0b100), "the parked pair holds the step cut and the far car is alone").toBeTruthy();
    far.deform.crushing = true;
    const crushing = run(w, 1, COARSE);
    expect(crushing[0]!.loners & 0b100, "a car whose crush runs on stays in its slices").toBe(0);
    dispose([a!, b!, far]);
  });

  it("when one's body touches something hard, so its contact rate asks 480 Hz, then it is no lone car and the step takes the slices that rate asks for", () => {
    const [a, b] = parkedPair();
    const far = makeCar("shape");
    launch(far, 0, 0, 0, 0, 30);
    const w = newWorld([a!, b!, far]);
    w.fine = FINE;
    w.lone = true;
    far.hardTouch = true;
    const rows = run(w, 1, COARSE);
    expect(rows[0]!.loners & 0b100, "a car whose body touches stays in its slices").toBe(0);
    expect(rows[0]!.slices).toBeGreaterThan(1);
    dispose([a!, b!, far]);
  });

  it("when one car is a sleeping wreck and another drives past it 7.5 m off (inside the wake reach, outside the contact reach), then neither is lone: the mover's top may wake it", () => {
    const [a, b] = parkedPair();
    const sleeper = makeCar("shape");
    const mover = makeCar("shape");
    launch(sleeper, 0, 0, 0, 0, 0);
    launch(mover, 7.5, 0, 0, 0, 10);
    sleeper.asleep = true;
    expect(7.5, "outside the contact reach, so only the wake reach holds them").toBeGreaterThan(CONTACT_REACH + LONE_MARGIN + 10 / QUIET_HZ);
    const w = newWorld([a!, b!, sleeper, mover]);
    w.fine = FINE;
    w.lone = true;
    const rows = run(w, 1, COARSE);
    expect(rows[0]!.loners & 0b1100, "neither the sleeper nor the car near it is lone").toBe(0);
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
    ajar(mover);
    ajar(parked);
    const far = parkedPair();
    const w = newWorld([mover, parked, ...far]);
    w.fine = FINE;
    w.lone = true;
    const rows = run(w, 1, COARSE);
    dispose([mover, parked, ...far]);
    return rows[0]!.loners & 0b11;
  }

  it("when it starts 5 cm outside the reach its travel over the step, the contact reach and the margin make, then both cars are lone; 5 cm inside it, neither is", () => {
    expect(firstMask(REACH_AT_60 + 0.05)).toBe(0b11);
    expect(firstMask(REACH_AT_60 - 0.05)).toBe(0);
  });

  /** A hit at 150 m/s on a parked car: the mover starts `offset` m outside the reach its 150 m/s make (negative: inside it). The sliced run is the reference (no car lone). */
  const finalPose = (lone: boolean, offset: number): { x: number; px: number; crashed: boolean; trail: number } => {
    const mover = makeCar("shape");
    const parked = makeCar("shape");
    launch(mover, -(CONTACT_REACH + LONE_MARGIN + 150 / QUIET_HZ + offset), 0, Math.PI / 2, 150, 0);
    launch(parked, 0, 0, Math.PI / 2, 0, 0);
    ajar(mover);
    ajar(parked);
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
      expect(lone.crashed && sliced.crashed, "the hit crashed both cars in both runs").toBeTruthy();
      expect(lone.trail, `the mover's centre got ${lone.trail.toFixed(2)} m past the parked car's`).toBeLessThan(0);
      expect(Math.abs(lone.x - sliced.x), `mover ${lone.x.toFixed(3)} against ${sliced.x.toFixed(3)} m`).toBeLessThan(0.05);
      expect(Math.abs(lone.px - sliced.px), `parked car ${lone.px.toFixed(3)} against ${sliced.px.toFixed(3)} m`).toBeLessThan(0.05);
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
    expect(rows.every((r) => r.slices === SLICES_PER_STEP), "every step was cut").toBeTruthy();
    expect(rows.every((r) => (r.loners & 1) === (lone ? 1 : 0)), "the car was lone in every step of the lone run and in none of the other").toBe(true);
    const out = { x: car.group.position.x, z: car.group.position.z, speed: car.velocity.length(), yaw: car.group.rotation.y };
    dispose([car, ...far]);
    return out;
  }

  it("when it runs one slice a step against three, then it ends 5 s later within 0.15 m of where the sliced car does, at the same speed within 0.1 m/s and the same heading within 0.01 rad", () => {
    const sliced = drive(false);
    const lone = drive(true);
    expect(Math.hypot(sliced.x, sliced.z), "the car drove").toBeGreaterThan(100);
    expect(Math.hypot(lone.x - sliced.x, lone.z - sliced.z), `${Math.hypot(lone.x - sliced.x, lone.z - sliced.z).toFixed(3)} m apart`).toBeLessThan(0.15);
    expect(Math.abs(lone.speed - sliced.speed), `${lone.speed.toFixed(3)} against ${sliced.speed.toFixed(3)} m/s`).toBeLessThan(0.1);
    expect(Math.abs(lone.yaw - sliced.yaw), `${lone.yaw.toFixed(4)} against ${sliced.yaw.toFixed(4)} rad`).toBeLessThan(0.01);
  });
});

/** Every car's pose and velocity as text: equal for two runs only when they agree to the last bit. */
function stateOf(cars: readonly DeformableCar[]): string {
  return cars
    .map((c) => [c.group.position.x, c.group.position.y, c.group.position.z, c.velocity.x, c.velocity.y, c.velocity.z, c.group.quaternion.w].map((v) => v.toFixed(FRAME_DIGITS)).join(","))
    .join(";");
}

describe("given a field run live with lone cars, its recorded schedule and lone masks", () => {
  it("when the same field is run again on the recorded schedule and lone masks, then it ends bit for bit where the live run did; with the masks dropped it does not", () => {
    const record: { shape: number; loners: number }[] = [];
    const first = headOnField(true);
    for (let s = 0; s < 120; s++) {
      stepWorld(first.w, COARSE);
      record.push({ shape: first.w.shape, loners: first.w.loners });
    }
    expect(record.some((r) => r.loners !== 0 && r.shape > 0), "the record holds steps with lone cars in them").toBeTruthy();
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
    expect(replay(true)).toBe(want);
    expect(replay(false), "the lone masks change nothing: the row cannot tell a replay that drops them").not.toBe(want);
    dispose(first.cars);
  });
});
