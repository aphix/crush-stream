import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { applyDrive, type DriveInput, idleDrive } from "./car-drive.ts";
import { layOnGround } from "./car-air-points.ts";
import { LOAD_FEEL } from "./car-load.ts";
import { DeformableCar } from "./car.ts";
import { assignClass, CLASSES, gearAt, VEHICLE_CLASS_IDS, type VehicleClassId } from "./vehicle-classes.ts";
import { DT, paint } from "./test-support.ts";
import { physicsSlice, sliceSpeed } from "../contact/sat.ts";
import { newWorld, stepWorld } from "../engine/world-step.ts";
import { DriveCam } from "../present/drive-cam.ts";
import { Ground, setGround } from "../world/ground.ts";
import { FRAME_HZ } from "../kernel/constants.ts";

const DEG = 180 / Math.PI;

/** Most the drawn body may pitch (deg) in a launch or a stop, per class: a few degrees, the tall SUV and the truck more, the monster most. */
const PITCH_MAX: Record<VehicleClassId, number> = { sedan: 3, muscle: 3, police: 3, truck: 4.5, monster: 6, hatch: 3, suv: 4 };
const ROLL_MAX = 6.5;

type Sample = { pitch: number; roll: number; speed: number };

/** A plane falling `deg` toward +z (the way the car faces): a descent for `deg` > 0, a climb for < 0. */
class Slope extends Ground {
  constructor(deg: number) {
    super();
    const e = 1e4;
    const s = Math.tan(deg / DEG);
    this.addGrid({ nu: 2, nv: 2, step: 2 * e, stepV: 2 * e, u0: -e, v0: -e, heights: new Float32Array([s * e, s * e, -s * e, -s * e]), ox: 0, oy: 0, oz: 0, reach: Infinity });
  }
}

/**
 * One car from `v0` under `input` for `seconds`, as the engine steps it, on the flat or on a `grade`° descent
 * (negative: a climb), starting seated on the road (pitched to it, its velocity along it); the drawn body's pitch (+ nose up) and roll (+ the +x side up) each frame.
 */
function drive(cls: VehicleClassId, v0: number, input: (speed: number) => Partial<DriveInput>, seconds: number, grade = 0, each?: (car: DeformableCar) => void): Sample[] {
  setGround(grade ? new Slope(grade) : null);
  const car = new DeformableCar(paint(), new THREE.Scene());
  assignClass(car, cls);
  const w = newWorld([car], null);
  car.spawnFacing(0, 0, 0, v0);
  if (grade) {
    layOnGround(car);
    car.velocity.copy(car.forward).multiplyScalar(v0);
  }
  const body = car.group.getObjectByName("classLift")!;
  const out: Sample[] = [];
  let acc = 0;
  for (let t = 0; t < seconds; t += DT) {
    acc = Math.min(0.05, acc + DT);
    while (acc > 1e-5) {
      const h = physicsSlice(acc, sliceSpeed(w.cars));
      applyDrive(car, { ...idleDrive(), ...input(car.speed) }, h);
      stepWorld(w, h);
      acc -= h;
    }
    car.updateSkin();
    each?.(car);
    out.push({ pitch: -body.rotation.x * DEG, roll: body.rotation.z * DEG, speed: car.speed });
  }
  car.dispose();
  setGround(null);
  return out;
}

/** The sample furthest from level on `axis`. */
function peak(s: Sample[], axis: "pitch" | "roll"): number {
  return s.reduce((m, x) => (Math.abs(x[axis]) > Math.abs(m) ? x[axis] : m), 0);
}

describe("given a car driven on the road, whose drawn body squats, dives and leans with the load", () => {
  for (const cls of VEHICLE_CLASS_IDS) {
    it(`when a ${cls} launches from rest at full throttle and brakes hard from 25 m/s, then its body pitches nose up over 1° and nose down over 1°, each within ${PITCH_MAX[cls]}°`, () => {
      const launch = peak(drive(cls, 0, () => ({ throttle: 1 }), 3), "pitch");
      expect(launch > 1 && launch <= PITCH_MAX[cls], `launch pitch ${launch.toFixed(2)}°`).toBeTruthy();
      const stop = peak(drive(cls, 25, () => ({ brake: 1 }), 3), "pitch");
      expect(stop < -1 && stop >= -PITCH_MAX[cls], `braking pitch ${stop.toFixed(2)}°`).toBeTruthy();
    });

    it(`when a ${cls} holds a steady left turn and then a steady right turn, then its body leans outward by the same amount each way, by over 2° and within ${ROLL_MAX}°`, () => {
      // Steer +1 swings the nose left: the +x side is the inside and rises.
      const hold = (steer: number) => drive(cls, 20, (v) => ({ throttle: v < 20 ? 0.6 : 0.1, steer }), 4);
      const left = hold(1);
      const right = hold(-1);
      const r = left[left.length - 1]!.roll;
      expect(r > 2 && peak(left, "roll") <= ROLL_MAX, `left turn rolls ${r.toFixed(2)}°`).toBeTruthy();
      expect(Math.abs(right[right.length - 1]!.roll + r), `right turn rolls ${right[right.length - 1]!.roll.toFixed(2)}°`).toBeLessThan(0.05);
    });

    it(`when a ${cls} slides under the handbrake at full lock, then its body rolls more than the same slide with no drift lean, within ${ROLL_MAX * 1.6}°`, () => {
      const run = () => Math.abs(peak(drive(cls, 15, () => ({ throttle: 0.3, steer: 1, ebrake: true }), 1), "roll"));
      const lean = LOAD_FEEL.driftLean;
      LOAD_FEEL.driftLean = 0;
      const flat = run();
      LOAD_FEEL.driftLean = lean;
      const slide = run();
      expect(slide > flat + 0.1 && slide <= ROLL_MAX * 1.6, `no lean ${flat.toFixed(2)}°, lean ${slide.toFixed(2)}°`).toBeTruthy();
    });
  }

  it("when each class drives down a 5° descent at full throttle or brakes up a 5° climb, then its body never pitches 0.5° or more against the road, and driving up a climb or braking down a descent it still pitches with the road, over 0.8° and within its class limit", () => {
    // After the first 0.8 s: the spawn onto the slope kicks the springs (the pose turns to it).
    const settled = (s: Sample[]) => s.slice(Math.round(0.8 / DT));
    for (const cls of VEHICLE_CLASS_IDS) {
      // Driving down a 5° descent squats the body nose up, against the road (the monster 4.3° off it); braking up a climb dives it, likewise.
      const squat = peak(settled(drive(cls, 25, () => ({ throttle: 1 }), 2, 5)), "pitch");
      const dive = peak(settled(drive(cls, 40, () => ({ brake: 1 }), 1.3, -5)), "pitch");
      expect(squat, `${cls} driving down 5°: ${squat.toFixed(2)}° nose up against the road`).toBeLessThan(0.5);
      expect(dive, `${cls} braking up 5°: ${dive.toFixed(2)}° nose down against the road`).toBeGreaterThan(-0.5);
      // Driving up the climb and braking down the descent lean with the road, as on the flat.
      const climb = peak(settled(drive(cls, 5, () => ({ throttle: 1 }), 2, -5)), "pitch");
      const stop = peak(settled(drive(cls, 40, () => ({ brake: 1 }), 1.3, 5)), "pitch");
      expect(climb > 0.8 && climb <= PITCH_MAX[cls], `${cls} driving up 5°: ${climb.toFixed(2)}°`).toBeTruthy();
      expect(stop < -0.8 && stop >= -PITCH_MAX[cls], `${cls} braking down 5°: ${stop.toFixed(2)}°`).toBeTruthy();
    }
  });

  it("when each class sits still for 1 s, or a sedan brakes from 20 m/s to a stop, then the body is level at rest and level once stopped", () => {
    for (const cls of VEHICLE_CLASS_IDS) {
      const rest = drive(cls, 0, () => ({}), 1);
      expect(Math.abs(peak(rest, "pitch")) + Math.abs(peak(rest, "roll")), `${cls} at rest`).toBeLessThan(0.01);
    }
    const stop = drive("sedan", 20, () => ({ brake: 1 }), 6);
    const end = stop[stop.length - 1]!;
    expect(end.speed < 0.05 && Math.abs(end.pitch) < 0.02 && Math.abs(end.roll) < 0.02, `stopped at ${end.speed.toFixed(2)} m/s, ${end.pitch.toFixed(3)}° / ${end.roll.toFixed(3)}°`).toBeTruthy();
  });
});

/** A body's squat, dive and lean build over its springs' own time: a few degrees over a few tenths of a second, not in a frame or two (a heavy truck's launch and stop read 2-5° over 0.3-0.5 s). */
const TURN_RATE_MAX = 20;
const BUILD_FRAMES_MIN = 12;
const HELD_AT_S = 1;

/** The fastest turn (deg/s) of `angles` taken from level one frame to the next, and the frames its magnitude takes to reach 90 % of what it is `HELD_AT_S` s in. */
function build(angles: readonly number[]): { rate: number; frames: number } {
  const series = [0, ...angles];
  let rate = 0;
  for (let i = 1; i < series.length; i++) rate = Math.max(rate, Math.abs(series[i]! - series[i - 1]!) * FRAME_HZ);
  const held = series[Math.round(HELD_AT_S * FRAME_HZ)]!;
  return { rate, frames: series.findIndex((a) => Math.abs(a) >= 0.9 * Math.abs(held)) };
}

describe("given a car whose throttle, brake or steering goes down at once", () => {
  for (const cls of VEHICLE_CLASS_IDS) {
    it(`when a ${cls} launches from rest at full throttle and brakes hard from 25 m/s, then its pitch never turns faster than ${TURN_RATE_MAX}°/s and takes ${BUILD_FRAMES_MIN} frames to reach 90 % of what it is ${HELD_AT_S} s in`, () => {
      const launch = build(drive(cls, 0, () => ({ throttle: 1 }), 1.5).map((s) => s.pitch));
      const stop = build(drive(cls, 25, () => ({ brake: 1 }), 1.5).map((s) => s.pitch));
      expect(launch.rate <= TURN_RATE_MAX && stop.rate <= TURN_RATE_MAX, `launch ${launch.rate.toFixed(1)}°/s, stop ${stop.rate.toFixed(1)}°/s`).toBeTruthy();
      expect(launch.frames >= BUILD_FRAMES_MIN && stop.frames >= BUILD_FRAMES_MIN, `launch built in ${launch.frames} frames, stop in ${stop.frames}`).toBeTruthy();
    });

    it(`when a ${cls} turns hard at 20 m/s, then its roll never turns faster than ${TURN_RATE_MAX}°/s and takes ${BUILD_FRAMES_MIN} frames to reach 90 % of what it is ${HELD_AT_S} s in`, () => {
      const turn = build(drive(cls, 20, (v) => ({ throttle: v < 20 ? 0.6 : 0.1, steer: 1 }), 1.5).map((s) => s.roll));
      expect(turn.rate, `roll turned ${turn.rate.toFixed(1)}°/s`).toBeLessThanOrEqual(TURN_RATE_MAX);
      expect(turn.frames, `roll built in ${turn.frames} frames`).toBeGreaterThanOrEqual(BUILD_FRAMES_MIN);
    });
  }
});

describe("given a chase camera that rides the car's drawn body, next to one that does not", () => {
  const H = 1 / FRAME_HZ;
  function rig(ride: boolean) {
    const cam = new THREE.PerspectiveCamera(56, 16 / 9, 0.1, 180);
    const drive = new DriveCam();
    drive.ride = ride;
    return { cam, drive };
  }

  /** Two rigs over one car, the second riding its body: after `seconds` with the springs at `offsets`, how the second sits against the first. */
  function against(offsets: number[], seconds: number, look?: [number, number]): { dy: number; tilt: number } {
    const car = new DeformableCar(paint(), new THREE.Scene());
    assignClass(car, "sedan");
    car.spawnFacing(0, 0, 0, 20);
    car.group.updateMatrixWorld(true);
    const [a, b] = [rig(false), rig(true)];
    const step = () => {
      for (const r of [a, b]) {
        r.drive.update(r.cam, car, "third", H, 0, 0);
        r.cam.updateMatrixWorld();
      }
    };
    for (let t = 0; t < 1; t += H) step();
    car.suspension.offset.set(offsets);
    if (look) for (const r of [a, b]) r.drive.nudge(look[0], look[1]);
    for (let t = 0; t < seconds; t += H) step();
    return { dy: b.cam.position.y - a.cam.position.y, tilt: a.cam.quaternion.angleTo(b.cam.quaternion) * DEG };
  }

  it("when the car's springs are pushed past their stops, then a squat drops the riding eye and tips it up, a dive lifts and tips it down, and a bump drops it, each by under 4 cm and 0.6°", () => {
    // Offsets well past the springs' stops (a sedan's are 6.5 cm): the bound holds for any input.
    const squat = against([0.2, 0.2, -0.2, -0.2], 2);
    expect(squat.dy < -0.02 && squat.dy > -0.04, `squat drop ${(squat.dy * 100).toFixed(2)} cm`).toBeTruthy();
    expect(squat.tilt > 0.3 && squat.tilt <= 0.6, `squat tilt ${squat.tilt.toFixed(3)}°`).toBeTruthy();
    const dive = against([-0.2, -0.2, 0.2, 0.2], 2);
    expect(dive.dy > 0.02 && dive.dy < 0.04, `dive lift ${(dive.dy * 100).toFixed(2)} cm`).toBeTruthy();
    expect(dive.tilt > 0.3 && dive.tilt <= 0.6, `dive tilt ${dive.tilt.toFixed(3)}°`).toBeTruthy();
    const bump = against([-0.065, -0.065, -0.065, -0.065], 2);
    expect(bump.dy < -0.01 && bump.dy > -0.04 && bump.tilt < 0.01, `bump ${(bump.dy * 100).toFixed(2)} cm, ${bump.tilt.toFixed(3)}°`).toBeTruthy();
  });

  it("when the player holds a look offset while the springs squat, then the ride lets go of the camera and it matches the non-riding one to within 1 mm and 0.02°", () => {
    const held = against([0.2, 0.2, -0.2, -0.2], 0.7, [100, 0]);
    expect(Math.abs(held.dy) < 0.001 && held.tilt < 0.02, `held look: ${(held.dy * 100).toFixed(3)} cm, ${held.tilt.toFixed(3)}°`).toBeTruthy();
  });
});

describe("given a car accelerating through its gears, whose drawn body kicks at each gear change", () => {
  /** The same full-throttle run with the kick at `kick` times its tuned size, the chase eye riding the body (`tilt`: its angle to a camera that does not ride, deg). */
  function run(cls: VehicleClassId, kick: number): { body: Sample[]; tilt: number[] } {
    const a = { cam: new THREE.PerspectiveCamera(56, 16 / 9, 0.1, 180), drive: new DriveCam() };
    const b = { cam: new THREE.PerspectiveCamera(56, 16 / 9, 0.1, 180), drive: new DriveCam() };
    b.drive.ride = true;
    a.drive.ride = false;
    const tilt: number[] = [];
    LOAD_FEEL.shiftKick = kick;
    try {
      const body = drive(cls, 0, () => ({ throttle: 1 }), 5, 0, (car) => {
        for (const r of [a, b]) {
          r.drive.update(r.cam, car, "third", DT, 0, 0);
          r.cam.updateMatrixWorld();
        }
        tilt.push(a.cam.quaternion.angleTo(b.cam.quaternion) * DEG);
      });
      return { body, tilt };
    } finally {
      LOAD_FEEL.shiftKick = 1;
    }
  }

  for (const cls of VEHICLE_CLASS_IDS) {
    it(`when a ${cls} launches at full throttle with the kick on and off, then the two runs are the same until the first gear change, the nose then dips within 0.6° of the other run's and rings out, and the riding eye follows`, () => {
      const off = run(cls, 0);
      const on = run(cls, 1);
      const k = CLASSES[cls];
      const first = off.body.findIndex((s, i) => i > 0 && gearAt(k, s.speed) !== gearAt(k, off.body[i - 1]!.speed));
      expect(first, `the first gear change comes at frame ${first}`).toBeGreaterThan(10);
      let before = 0;
      for (let i = 0; i < first - 10; i++) before = Math.max(before, Math.abs(on.body[i]!.pitch - off.body[i]!.pitch));
      expect(before, `the runs differ by ${before} deg before the first gear change`).toBeLessThan(1e-9);
      let dip = 0;
      let most = 0;
      let ride = 0;
      for (let i = first - 4; i < first + 36; i++) {
        const d = on.body[i]!.pitch - off.body[i]!.pitch;
        dip = Math.min(dip, d);
        most = Math.max(most, Math.abs(d));
        ride = Math.max(ride, Math.abs(on.tilt[i]! - off.tilt[i]!));
      }
      expect(dip < -0.1 && most < 0.6, `the kick's nose dip ${dip.toFixed(2)}°, its largest ${most.toFixed(2)}°`).toBeTruthy();
      expect(ride, `the riding eye's tilt differs by ${ride.toFixed(4)}°`).toBeGreaterThan(0.003);
    });
  }
});
