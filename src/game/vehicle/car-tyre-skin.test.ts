import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { buildCar } from "./drawn-body.test-util.ts";
import { TyreSkin } from "./car-tyre-skin.ts";
import { tyreClearance } from "./tyre-clearance.test-util.ts";
import { CLASSES, carClass } from "./vehicle-classes.ts";

/**
 * A crushed skin's triangles stretched across a front tyre: one corner held over the tyre, every other point of the skin far away and low. The held corner stands on the tyre at
 * its own place, so the plane of each triangle it belongs to dips under the arc between it and the low points: before the hold read triangles, a pickup's tyre stood 42 mm
 * through its drawn skin (the owner's fleet crash, once the cage refit at other steps).
 */
const FRONT_RIGHT_WHEEL = 1;
const CLEARANCE_M = 0.005;
/** The wheel is read at this many turns round the axle: the drawn tyre's points sit at fixed angles, and each takes the tyre's top in turn. */
const SPIN_STEPS = 64;
/** The point held over the tyre, crushed down beside the tyre's front (m, in the car's frame, before the hold), and where the rest of the skin stands (the middle of the car's nose). */
const HELD_POINT = [0.633, 0.4, 1.497] as const;
const FAR_POINT = [0.1, 0.37, 0.9] as const;
/** The far points stand apart (m) in turn: along z so that their fan of triangles from the held point covers the tyre's top, and along x so that none is degenerate. */
const FAR_SPREAD_Z = 0.1;
const FAR_SPREAD_X = 0.013;
const FAR_SPREAD_COUNT = 7;

describe("given a pickup's skin of which one point rests over its front tyre and the rest is far and low", () => {
  it("when the skin is held off the tyres, then every drawn triangle over the tyre keeps 5 mm over its top", () => {
    const car = buildCar("pickup", "truck");
    const mesh = car["body"] as THREE.Mesh;
    const skin = new TyreSkin(car.frame, mesh, car.deform.restSkin, true);
    const lift = CLASSES[carClass(car)].lift;
    car.group.updateMatrixWorld(true);
    skin.hold(car.group, car.wheels, 0, lift, true);
    const over = skin["over"][FRONT_RIGHT_WHEEL]!;
    const held = Array.from(over).findIndex((rest) => !Number.isNaN(rest));
    assert.ok(held >= 0, "fixture: a skin point resting over the tyre");
    const toMesh = new THREE.Matrix4().multiplyMatrices(car.group.matrixWorld.clone().invert(), mesh.matrixWorld).invert();
    const positions = mesh.geometry.getAttribute("position");
    const place = new THREE.Vector3();
    for (let vertex = 0; vertex < positions.count; vertex++) {
      place.fromArray(vertex === held ? HELD_POINT : FAR_POINT);
      if (vertex !== held) place.set(place.x + FAR_SPREAD_X * (vertex % 5), place.y, place.z + FAR_SPREAD_Z * (vertex % FAR_SPREAD_COUNT));
      place.applyMatrix4(toMesh);
      positions.setXYZ(vertex, place.x, place.y, place.z);
    }
    skin.hold(car.group, car.wheels, 0, lift, true);
    const toCar = new THREE.Matrix4().multiplyMatrices(car.group.matrixWorld.clone().invert(), mesh.matrixWorld);
    const triangles: number[] = [];
    const index = mesh.geometry.index!;
    for (let corner = 0; corner < index.count; corner++) {
      place.fromBufferAttribute(positions, index.getX(corner)).applyMatrix4(toCar);
      triangles.push(place.x, place.y, place.z);
    }
    let clearance = Infinity;
    for (let step = 0; step < SPIN_STEPS; step++) {
      car.wheels[FRONT_RIGHT_WHEEL]!.rotation.x = (step * 2 * Math.PI) / SPIN_STEPS;
      clearance = Math.min(clearance, tyreClearance(car, FRONT_RIGHT_WHEEL, Float32Array.from(triangles)));
    }
    assert.ok(clearance >= CLEARANCE_M, `${(clearance * 1000).toFixed(1)} mm`);
  });
});
