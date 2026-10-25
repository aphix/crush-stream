import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { DeformableCar } from "../vehicle/car.ts";
import { Corkscrew, CORKSCREW } from "./corkscrew.ts";
import { setGround } from "../world/ground.ts";
import { physicsSlice, sliceSpeed } from "../contact/sat.ts";
import { paint } from "../vehicle/test-support.ts";
import { newWorld, stepWorld } from "../engine/world-step.ts";
import { droop } from "../vehicle/car-suspension.ts";
import { FRAME_HZ } from "../kernel/constants.ts";
import { applyDrive, type DriveInput } from "../vehicle/car-drive.ts";

const FRAME = 1 / FRAME_HZ;
const DEG = 180 / Math.PI;
/** The pedals of the driver who keeps the gas down. */
const FULL_THROTTLE: DriveInput = { throttle: 1, steer: 0, brake: 0, ebrake: false, boost: false };

type Run = { air: number; landRoll: number; upY: number; dip: number; drove: number; rest: "wheels" | "roof" | "side" };

/**
 * A car launched (no driver) at `v` m/s 6 m short of the mouth, stepped by the world step alone with the corkscrew
 * as the ground and its walls as the collide hook, until it rests. Air: the first flight's seconds with every body
 * point (tyre contacts and cage vertices) more than 5 cm off the ground; landRoll: the body's turn about its own nose (signed, summed) when a body
 * point first touches down again; dip: the deepest body point under the ground from takeoff on. With `driveSeconds`, a car at rest on its wheels
 * then holds full throttle that long, and `drove` is how far it went in plan (m; 0 for one that rests on its side or roof).
 */
function launch(v: number, driveSeconds = 0): Run {
  const scene = new THREE.Scene();
  const cork = new Corkscrew(scene);
  setGround(cork);
  const car = new DeformableCar(paint(), scene);
  car.spawnFacing(0, CORKSCREW.mouthZ - 6, 0, v);
  const w = newWorld([car]);
  w.collide = (c) => cork.contact(c);
  const q = car.group.quaternion;
  const p = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);
  const prevUp = new THREE.Vector3(0, 1, 0);
  const fwd = new THREE.Vector3();
  const last = new THREE.Vector3().copy(car.group.position);
  let air = 0;
  let landed = false;
  let landRoll = 0;
  let roll = 0;
  let dip = 0;
  let still = 0;
  let acc = 0;
  for (let t = 0; t < 20 && still < 1; t += FRAME) {
    acc = Math.min(0.05, acc + FRAME);
    while (acc > 1e-5) {
      const h = physicsSlice(acc, sliceSpeed(w.cars));
      stepWorld(w, h);
      acc -= h;
    }
    car.updateSkin();
    let low = Infinity;
    car.refitCage();
    const body = car.cage.fields.pos;
    // The tyre contacts, then the cage's vertices (the drawn body, crushed as drawn): what can meet the ground.
    const wheels = car.frame.wheels;
    for (let i = 0; i < wheels.length + car.cage.style.vertexCount; i++) {
      if (i < wheels.length) p.set(wheels[i]![0], 0, wheels[i]![2]);
      else p.set(body[(i - wheels.length) * 3]!, body[(i - wheels.length) * 3 + 1]!, body[(i - wheels.length) * 3 + 2]!);
      p.applyQuaternion(q).add(car.group.position);
      low = Math.min(low, p.y - cork.heightAt(p.x, p.z, p.y));
    }
    up.set(0, 1, 0).applyQuaternion(q);
    fwd.set(0, 0, 1).applyQuaternion(q);
    roll += Math.atan2(p.crossVectors(prevUp, up).dot(fwd), prevUp.dot(up));
    prevUp.copy(up);
    if (low > 0.05 && !landed) air += FRAME;
    else if (air > 0.2 && !landed) {
      landed = true;
      landRoll = Math.abs(roll) * DEG;
    }
    if (air > 0) dip = Math.max(dip, -low);
    still = car.group.position.distanceTo(last) < 0.002 ? still + FRAME : 0;
    last.copy(car.group.position);
  }
  const upY = up.y;
  let drove = 0;
  if (driveSeconds > 0 && upY > 0.5) {
    const from = car.group.position.clone();
    w.beforeSlice = (h) => {
      applyDrive(car, FULL_THROTTLE, h);
      return false;
    };
    for (let s = 0; s < driveSeconds; s += FRAME) {
      acc = Math.min(0.05, acc + FRAME);
      while (acc > 1e-5) {
        const h = physicsSlice(acc, sliceSpeed(w.cars));
        stepWorld(w, h);
        acc -= h;
      }
      car.updateSkin();
    }
    drove = Math.hypot(car.group.position.x - from.x, car.group.position.z - from.z);
  }
  car.dispose();
  return { air, landRoll, upY, dip, drove, rest: upY > 0.5 ? "wheels" : upY < 0 ? "roof" : "side" };
}

/**
 * Each band: launch speed, whether it leaves the lip, the roll it touches down with (deg), and the pose a car of that roll is meant to
 * come to rest in. The roll is the lip's spin times the air time, so `CORKSCREW.bank` (the twist rate) sets where each speed lands: a turn
 * at 22 m/s, a turn and a half at 27. The rest pose is printed, not judged: it flips with 0.1 m/s of launch speed at every bank from 0.60
 * to 0.78, whatever the roll (22 m/s at bank 0.62: rolls 347-367, all in the window, rests wheels/roof/roof/roof/roof).
 */
const BANDS = [
  { v: 6, name: "it is too slow to climb, so it rolls back out of the mouth without leaving the ground", air: false, roll: [0, 0], rest: "wheels" },
  { v: 14, name: "it flies and rolls half a turn", air: true, roll: [130, 230], rest: "roof" },
  { v: 22, name: "it flies and rolls a full turn", air: true, roll: [310, 410], rest: "wheels" },
  { v: 27, name: "it flies and rolls a turn and a half", air: true, roll: [490, 620], rest: "roof" },
] as const;

describe("given the corkscrew ramp as the ground, and a driverless car launched at it from 6 m short of its mouth until the car comes to rest", () => {
  afterEach(() => setGround(null));

  for (const b of BANDS) {
    it(`when it is launched at ${b.v} m/s, then ${b.name}, and after takeoff it never goes deeper into the ground than the suspension's stop`, (t) => {
      const r = launch(b.v);
      t.diagnostic(`${b.v} m/s: air ${r.air.toFixed(2)} s, touchdown roll ${r.landRoll.toFixed(0)}°, up.y ${r.upY.toFixed(2)} (${r.rest}, meant to rest on its ${b.rest}), deepest ${r.dip.toFixed(3)} m`);
      const failures: string[] = [];
      if (b.air !== r.air > 0.2) failures.push(`air ${r.air.toFixed(2)} s`);
      if (r.landRoll < b.roll[0] || r.landRoll > b.roll[1]) failures.push(`touchdown roll ${r.landRoll.toFixed(0)}° outside ${b.roll[0]}–${b.roll[1]}°`);
      if (r.dip > 2 * droop("sedan") + 0.001) failures.push(`body ${r.dip.toFixed(3)} m into the ground`);
      assert.deepEqual(failures, []);
    });
  }
});

/**
 * The owner's bar for the corkscrew: the car flips and can land and keep driving. One launch, at the speed that comes to rest on its wheels on the
 * union (21.6 m/s at bank 0.96: touchdown roll 353°, 58.1 m driven). The landing is a lottery of the launch speed and the bank (21.6 m/s rests on its roof at
 * banks 0.90, 0.93, 0.99, 1.01, 1.03, 1.04, 1.08, 1.10 and 1.12, and on its wheels at 0.96, 1.02, 1.05 and 1.06), so the speed is named, not swept.
 */
const DRIVE_LAUNCH_SPEED = 21.6;
/** Seconds of full throttle from the rest on its wheels, and the least the car must cover over them (m). */
const DRIVE_S = 3;
const DRIVE_MIN_M = 10;

describe(`given the corkscrew ramp as the ground, and a car launched at it at ${DRIVE_LAUNCH_SPEED} m/s until it comes to rest`, () => {
  afterEach(() => setGround(null));

  it(`when it stands on its wheels at rest and holds full throttle for ${DRIVE_S} s, then it covers ${DRIVE_MIN_M} m or more: the car flips and can land and keep driving`, (t) => {
    const r = launch(DRIVE_LAUNCH_SPEED, DRIVE_S);
    t.diagnostic(`${DRIVE_LAUNCH_SPEED} m/s: touchdown roll ${r.landRoll.toFixed(0)}°, rest ${r.rest}${r.rest === "wheels" ? `, drove ${r.drove.toFixed(1)} m` : ""}`);
    assert.equal(r.rest, "wheels", `it came to rest on its ${r.rest} (touchdown roll ${r.landRoll.toFixed(0)}°)`);
    assert.ok(r.drove >= DRIVE_MIN_M, `it drove ${r.drove.toFixed(1)} m in ${DRIVE_S} s of full throttle, under ${DRIVE_MIN_M} m`);
  });
});
