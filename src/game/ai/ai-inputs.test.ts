import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { idleDrive, type DriveInput } from "../vehicle/car-drive.ts";
import { DeformableCar } from "../vehicle/car.ts";
import { FEEL } from "../vehicle/drive-input.ts";
import { fleetStyle } from "../scenes/fleet.ts";
import { classStats, carClass } from "../vehicle/vehicle-classes.ts";
import { snapshotAiCar } from "../match/derby.ts";
import { setGround } from "../world/ground.ts";
import { Track } from "../world/track.ts";
import { TRACKS } from "../world/tracks/index.ts";
import { blankAiCar, type AiCar } from "./derby-ai.ts";
import { applyAiDrive } from "./input-fade.ts";
import { RaceBrain, copyDrive } from "./race-ai.ts";
import { Pedals } from "./pedals.ts";
import { DT } from "../vehicle/test-support.ts";

const oval = new Track(TRACKS[0]);
const RACE = { next: 1, lap: 0 };
const START_S = 40;

/** A car on the oval's centre line `s` m along, `off` m to its left, doing `v` m/s along the road. */
function onRoad(id: number, s: number, off: number, v: number, alive = true): AiCar {
  const p = oval.pointAt(s, { x: 0, y: 0, z: 0, tx: 0, tz: 1, half: 0 });
  return { ...blankAiCar(id), x: p.x + off * p.tz, z: p.z - off * p.tx, yaw: Math.atan2(p.tx, p.tz), vx: p.tx * v, vz: p.tz * v, alive };
}

describe("given 16 racers on the oval planning for 2 s", () => {
  it("when each steps every 1/240 s, then each plans about 12 times a second, and no step holds the whole field's plans: they are spread over the steps", () => {
    const brain = new RaceBrain(oval, 16);
    const cars = Array.from({ length: 16 }, (_, i) => onRoad(i, START_S + 6 * i, 0, 20));
    const plans = new Int32Array(16);
    let crowded = 0;
    const replan = brain["replan"].bind(brain) as (i: number, ...rest: unknown[]) => void;
    let this_step = 0;
    brain["replan"] = (i: number, ...rest: unknown[]) => {
      plans[i]!++;
      this_step++;
      return replan(i, ...rest);
    };
    const STEPS = 2 / DT;
    for (let k = 0; k < STEPS; k++) {
      this_step = 0;
      for (const c of cars) brain.think(c, cars, RACE, DT);
      if (k > 0) crowded = Math.max(crowded, this_step);
    }
    for (const [i, n] of plans.entries()) expect(n >= 22 && n <= 26, `car ${i} planned ${n} times in 2 s`).toBeTruthy();
    expect(crowded, `${crowded} of 16 cars planned in one step`).toBeLessThanOrEqual(5);
  });
});

describe("given a driver's hands (`Pedals`) asked for a target that wobbles across a brake line", () => {
  it("when the car's speed over its target wobbles 0.7 to 1.3 m/s for 3 s after an overspeed, then the brake latch changes once and the boost button, asked for every other step, changes at most once a second", () => {
    const hands = new Pedals();
    let flips = 0;
    let was = hands.latch(0, 2, 1.5, 0);
    let pressed = 0;
    let wasBoost = false;
    for (let k = 0; k < 3 / DT; k++) {
      const on = hands.latch(0, k % 2 === 0 ? 0.7 : 1.3, 1.5, 0);
      if (on !== was) flips++;
      was = on;
      const boost = hands.holdBoost(0, k % 2 === 0, DT, false);
      if (boost !== wasBoost) pressed++;
      wasBoost = boost;
    }
    expect(flips, "the brake stays on through the wobble: it is latched until the car is under its target").toBe(0);
    expect(pressed, `the boost button changed ${pressed} times in 3 s`).toBeLessThanOrEqual(6);
  });

  it("when the throttle, brake and wheel are flipped between their extremes every step at 240, 80 and 60 Hz, then no pedal moves faster than its slew and the wheel no faster than a pad player's", () => {
    for (const hz of [240, 80, 60]) {
      const dt = 1 / hz;
      const hands = new Pedals();
      const was = idleDrive();
      hands.shape(0, was, dt);
      let worstPedal = 0;
      let worstWheel = 0;
      for (let k = 0; k < hz; k++) {
        const hold = k < hz / 2;
        const out: DriveInput = { ...idleDrive(), throttle: hold || k % 2 === 0 ? 1 : 0, brake: hold || k % 2 === 0 ? 0 : 1, steer: hold || k % 2 === 0 ? 1 : -1 };
        hands.shape(0, out, dt);
        worstPedal = Math.max(worstPedal, Math.abs(out.throttle - was.throttle), Math.abs(out.brake - was.brake));
        worstWheel = Math.max(worstWheel, Math.abs(out.steer - was.steer));
        copyDrive(out, was);
      }
      expect(worstPedal, `${hz} Hz: a pedal moved ${worstPedal.toFixed(4)} in a step`).toBeLessThanOrEqual(10 * dt + 1e-9);
      expect(worstWheel, `${hz} Hz: the wheel moved ${worstWheel.toFixed(4)} in a step`).toBeLessThanOrEqual(FEEL.steerPad * dt + 1e-9);
    }
  });
});

/** A real sedan at `speed` m/s on the oval's back straight driven by a racer brain (think, guard, the AI drive) past `others`: the lowest speed and the closest lateral approach while abreast of a car in `others`. */
function drivePast(others: readonly AiCar[], extra = 0): { slowest: number; closest: number; passed: boolean; side: number } {
  setGround(oval.ground());
  const car = new DeformableCar({ body: 0x808080, accent: 0x404040, name: "racer" }, new THREE.Scene(), null, fleetStyle(0));
  const p = oval.pointAt(START_S, { x: 0, y: 0, z: 0, tx: 0, tz: 1, half: 0 });
  car.spawnFacing(p.x, p.z, Math.atan2(p.tx, p.tz), 30);
  const brain = new RaceBrain(oval, 2 + extra);
  brain.setClass(0, classStats(carClass(car)));
  const snaps = [blankAiCar(0), ...others];
  const held = idleDrive();
  let slowest = Infinity;
  let closest = Infinity;
  let passed = false;
  let side = 0;
  for (let k = 0; k < 8 / DT; k++) {
    snapshotAiCar(snaps[0]!, 0, car, true);
    copyDrive(brain.think(snaps[0]!, snaps, RACE, DT), held);
    applyAiDrive(car, brain.guard(snaps[0]!, snaps, held, DT), DT);
    car.integrate(DT);
    const me = snaps[0]!;
    const wreck = snaps[1]!;
    const along = (wreck.x - me.x) * Math.sin(me.yaw) + (wreck.z - me.z) * Math.cos(me.yaw);
    const lateral = (wreck.x - me.x) * Math.cos(me.yaw) - (wreck.z - me.z) * Math.sin(me.yaw);
    slowest = Math.min(slowest, Math.hypot(me.vx, me.vz));
    if (Math.abs(along) < 4.6) {
      closest = Math.min(closest, Math.abs(lateral));
      side = Math.sign(-lateral);
    }
    if (along < -8) passed = true;
  }
  setGround(null);
  return { slowest, closest, passed, side };
}

describe("given a racer at 30 m/s on the oval's back straight with a dead-engine wreck on its line 50 m ahead", () => {
  it("when it comes up on the wreck, then it passes it with a car's width to spare on one side and never drops below 15 m/s", (t) => {
    const wreck = onRoad(1, START_S + 50, 0, 0, false);
    const r = drivePast([wreck]);
    t.annotate(`slowest ${r.slowest.toFixed(1)} m/s, closest ${r.closest.toFixed(2)} m, side ${r.side}`);
    expect(r.passed, "it never got past the wreck").toBeTruthy();
    expect(r.closest, `it passed ${r.closest.toFixed(2)} m from the wreck`).toBeGreaterThan(3);
    expect(r.slowest, `it slowed to ${r.slowest.toFixed(1)} m/s`).toBeGreaterThanOrEqual(15);
  });
});

describe("given a racer at 30 m/s on the oval's back straight with a dead police car on its line 50 m ahead (a car past the racers and traffic)", () => {
  it("when it comes up on the cop, then it passes it with a car's width to spare and never drops below 15 m/s", () => {
    const cop = onRoad(1, START_S + 50, 0, 0, false);
    const r = drivePast([cop], -1);
    expect(r.passed, "it never got past the dead cop").toBeTruthy();
    expect(r.closest, `it passed ${r.closest.toFixed(2)} m from the cop`).toBeGreaterThan(3);
    expect(r.slowest, `it slowed to ${r.slowest.toFixed(1)} m/s`).toBeGreaterThanOrEqual(15);
  });
});

describe("given two racers 8 m apart on one line, coming up on a stopped wreck 40 m ahead of the leader", () => {
  it("when both plan the pass, then they take different sides of it", () => {
    const brain = new RaceBrain(oval, 3);
    const cars = [onRoad(0, START_S + 8, 0, 25), onRoad(1, START_S, 0, 25), onRoad(2, START_S + 48, 0, 0, false)];
    for (let k = 0; k < 2 / DT; k++) for (const c of cars.slice(0, 2)) brain.think(c, cars, RACE, DT);
    const lanes = [brain["lane"][0]!, brain["lane"][1]!];
    expect(Math.abs(lanes[0]!) > 1 && Math.abs(lanes[1]!) > 1 && lanes[0]! * lanes[1]! < 0, `lanes ${lanes[0]!.toFixed(2)} and ${lanes[1]!.toFixed(2)} m`).toBeTruthy();
  });
});
