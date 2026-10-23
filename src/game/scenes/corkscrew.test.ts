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

const FRAME = 1 / FRAME_HZ;
const DEG = 180 / Math.PI;

type Run = { air: number; landRoll: number; upY: number; dip: number; rest: "wheels" | "roof" | "side" };

/**
 * A car launched (no driver) at `v` m/s 6 m short of the mouth, stepped by the world step alone with the corkscrew
 * as the ground and its walls as the collide hook, until it rests. Air: the first flight's seconds with every body
 * point (tyre contacts and cage vertices) more than 5 cm off the ground; landRoll: the body's turn about its own nose (signed, summed) when a body
 * point first touches down again; dip: the deepest body point under the ground from takeoff on.
 */
function launch(v: number): Run {
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
  car.dispose();
  return { air, landRoll, upY, dip, rest: upY > 0.5 ? "wheels" : upY < 0 ? "roof" : "side" };
}

/**
 * Each band: launch speed, whether it leaves the lip, the roll it touches down with (deg), how it rests. The roll is the lip's spin
 * times the air time, so `CORKSCREW.bank` (the twist rate) sets where each speed lands: a turn at 22 m/s, a turn and a half at 27.
 */
const BANDS = [
  { v: 6, name: "it is too slow to climb, so it rolls back out of the mouth without leaving the ground", air: false, roll: [0, 0], rest: "wheels" },
  { v: 14, name: "it flies, rolls half a turn and lands on its roof", air: true, roll: [130, 230], rest: "roof" },
  { v: 22, name: "it flies, rolls a full turn and lands back on its wheels", air: true, roll: [310, 410], rest: "wheels" },
  { v: 27, name: "it flies, rolls a turn and a half and lands on its roof", air: true, roll: [490, 620], rest: "roof" },
] as const;

describe("given the corkscrew ramp as the ground, and a driverless car launched at it from 6 m short of its mouth until the car comes to rest", () => {
  afterEach(() => setGround(null));

  for (const b of BANDS) {
    it(`when it is launched at ${b.v} m/s, then ${b.name}, and after takeoff it never goes deeper into the ground than the suspension's stop`, (t) => {
      const r = launch(b.v);
      t.diagnostic(`${b.v} m/s: air ${r.air.toFixed(2)} s, touchdown roll ${r.landRoll.toFixed(0)}°, up.y ${r.upY.toFixed(2)} (${r.rest}), deepest ${r.dip.toFixed(3)} m`);
      const failures: string[] = [];
      if (b.air !== r.air > 0.2) failures.push(`air ${r.air.toFixed(2)} s`);
      if (r.landRoll < b.roll[0] || r.landRoll > b.roll[1]) failures.push(`touchdown roll ${r.landRoll.toFixed(0)}° outside ${b.roll[0]}–${b.roll[1]}°`);
      if (r.rest !== b.rest) failures.push(`rests on its ${r.rest} (up.y ${r.upY.toFixed(2)})`);
      if (r.dip > 2 * droop("sedan") + 0.001) failures.push(`body ${r.dip.toFixed(3)} m into the ground`);
      assert.deepEqual(failures, []);
    });
  }
});
