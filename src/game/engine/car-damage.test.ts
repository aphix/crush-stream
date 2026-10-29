import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { DeformableCar } from "../vehicle/car.ts";
import { PART_STATE, LOOSE_STATE_MAX } from "../vehicle/part-state.ts";
import { assertSameDigest } from "../vehicle/test-support.ts";
import { FINE_HZ } from "../kernel/constants.ts";
import { fleetStyle } from "../scenes/fleet.ts";
import { makeCarFrame } from "../net/codec.ts";
import { carLayout } from "../net/car-pose.ts";
import { CarDamage, FinalDamage } from "./car-damage.ts";
import { stubBrowser } from "./engine-headless.test-util.ts";

stubBrowser();

/** The crumple dress the engine's `dressCar` gives a respawned car, which is not the dress the damaged car had (the held reset's `place` re-dresses it). */
const ENGINE_DRESS = { squash: 1.7, buckle: 0.6, mode: "shape" as const };
/** Where a held reset puts the car, at rest. */
const PLACE = { x: 40, z: -12, yaw: 0.8, y: 3 };

/** A car with a crushed nose, a roof dent and (by the second impact) a part torn off: the same car every call. */
function damagedCar(scene: THREE.Scene): DeformableCar {
  const car = new DeformableCar({ body: 0x808080, accent: 0, name: "kept" }, scene, null, fleetStyle(0));
  car.spawnFacing(0, 0, 0, 0);
  car.deform.squash = 1.1;
  car.deform.buckle = 0.3;
  car.applyImpact(new THREE.Vector3(0, 0.5, 2.2), new THREE.Vector3(0, 0, -1), 22, 18);
  for (let i = 0; i < 90; i++) car.step(1 / FINE_HZ);
  car.applyImpact(new THREE.Vector3(1, 0.6, -2), new THREE.Vector3(-1, 0, 0.3).normalize(), 25, 20);
  for (let i = 0; i < 90; i++) car.step(1 / FINE_HZ);
  car.updateSkin();
  return car;
}

/** `RaceField.place` as the held reset runs it: a respawn that keeps what is torn off, on the spot, then the engine's dress. */
function place(car: DeformableCar): void {
  car.spawnFacing(PLACE.x, PLACE.z, PLACE.yaw, 0, true);
  car.group.position.y = PLACE.y;
  car.deform.squash = ENGINE_DRESS.squash;
  car.deform.buckle = ENGINE_DRESS.buckle;
  car.deform.setMode(ENGINE_DRESS.mode);
}

/**
 * `RaceField.placeKeeping` as it was before `CarDamage` took it over, kept whole as the reference the new path is held to: the damage and the crumple settings are read
 * before the respawn, and put back after it.
 */
function placeKeepingBefore(car: DeformableCar): void {
  const f = makeCarFrame(carLayout(car));
  car.deform.readNetState(f.deform);
  car.readPartNetState(f.parts);
  const { crashed } = car;
  const { squash, buckle, mode } = car.deform;
  place(car);
  car.crashed = crashed;
  if ((f.deform.flags & 1) !== 0) car.deform.armMasses(car.group, car.velocity, car.angular);
  car.writeNetState(f.deform, f.parts);
  car.deform.squash = squash;
  car.deform.buckle = buckle;
  car.deform.setMode(mode);
}

function placeKeepingNow(car: DeformableCar): void {
  const kept = new CarDamage();
  kept.read(car);
  place(car);
  kept.lay(car);
}

/** Everything the car carries that a respawn, a replay or a draw could read: pose, crumple settings, the net state, the solver and parts' state, the loose bodies, the skin. */
function fullState(car: DeformableCar) {
  const f = makeCarFrame(carLayout(car));
  car.deform.readNetState(f.deform);
  car.readPartNetState(f.parts);
  const solver = new Float64Array(car.solverSize());
  car.solverState(solver, false);
  const part = new Float64Array(PART_STATE);
  car.partState(part, false);
  const loose = new Float64Array(LOOSE_STATE_MAX);
  const looseN = car.looseState(loose, false);
  return {
    pose: [...car.group.position.toArray(), ...car.group.quaternion.toArray(), car.yaw, car.pitch, car.roll],
    crashed: car.crashed,
    settings: [car.deform.squash, car.deform.buckle, car.deform.mode],
    deform: f.deform,
    parts: f.parts,
    solver: [...solver],
    partState: [...part],
    loose: [...loose.subarray(0, looseN)],
    skin: [...(car.lookMeshes().body.geometry.getAttribute("position").array as Float32Array)],
  };
}

describe("given a damaged car put back on the road keeping its damage (a held reset, a campaign round's carry)", () => {
  const scene = new THREE.Scene();
  const before = damagedCar(scene);
  const now = damagedCar(scene);

  it("when the two cars are made the same way, then their full state is identical (the control)", () => {
    expect(before.crashed, "a wreck").toBe(true);
    expect(before.hasLoosePart(), "with a part torn off").toBeTruthy();
    assertSameDigest(fullState(before), fullState(now), "twins");
  });

  it("when one takes the path as it was and the other the CarDamage path, then every number of their state is identical", () => {
    placeKeepingBefore(before);
    placeKeepingNow(now);
    assertSameDigest(fullState(before), fullState(now), "after the held reset");
  });

  it("when the state after is compared with the engine's dress, then the car kept the crumple settings it had (the respawn's re-dress did not stand)", () => {
    expect(now.deform.squash).toBe(1.1);
    expect(now.deform.buckle).toBe(0.3);
    expect(now.deform.squash, "the control: the dress differs from the car's own").not.toBe(ENGINE_DRESS.squash);
  });
});

describe("given a racer that crosses the finish line dented and is hit again after it", () => {
  it("when the race ends and its final damage is read, then it is the car as it crossed the line, not as it stood at the end", () => {
    const scene = new THREE.Scene();
    const car = damagedCar(scene);
    const final = new FinalDamage();
    final.finish(0, car);
    const atLine = Float32Array.from(car.lookMeshes().body.geometry.getAttribute("position").array);
    car.applyImpact(new THREE.Vector3(-1, 0.6, 0), new THREE.Vector3(1, 0, 0), 25, 20);
    for (let i = 0; i < 90; i++) car.step(1 / FINE_HZ);
    car.updateSkin();
    final.take([car], 1);
    const shown = new DeformableCar({ body: 0x808080, accent: 0, name: "podium" }, scene, null, fleetStyle(0));
    shown.spawnFacing(0, 0, 0, 0);
    final.of(0)!.drawOn(shown);
    const drawn = shown.lookMeshes().body.geometry.getAttribute("position").array;
    const atEnd = car.lookMeshes().body.geometry.getAttribute("position").array;
    let fromLine = 0;
    let dentAfter = 0;
    for (let k = 0; k < drawn.length; k++) {
      fromLine = Math.max(fromLine, Math.abs(drawn[k]! - atLine[k]!));
      dentAfter = Math.max(dentAfter, Math.abs(atEnd[k]! - atLine[k]!));
    }
    expect(dentAfter, `the control: the hit after the line dents it ${dentAfter.toFixed(3)} m`).toBeGreaterThan(0.01);
    expect(fromLine, `the podium's car is ${fromLine.toFixed(4)} m from the car at the line`).toBeLessThan(1e-6);
  });
});
