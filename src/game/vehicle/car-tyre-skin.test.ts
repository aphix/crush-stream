import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { runWall } from "../contact/crash-scenarios.test-util.ts";
import type { DeformableCar } from "./car.ts";
import { LID } from "./constants.ts";
import { buildCar } from "./drawn-body.test-util.ts";
import { PART_KIND } from "./part-geometry.ts";
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

/** Owner: interior and engine shapes showed through a crushed hatch's bonnet. A corner hit folds the bonnet down onto the dash and the bay (drawn once the bonnet springs open). */
const HOOD_COVER_KPH = [55, 65, 70] as const;
/** The share of the car's width on the wall, from its left: the struck corner folds the bonnet down. */
const HOOD_COVER_OVERLAP = 0.4;
/** A body skin triangle that rests at least this high (m) is the roof over the cabin; under it are the floor and the sills a gone pane shows. */
const ROOF_REST_Y = 1.15;

/** The triangles (car frame, nine numbers each) of `mesh`, those whose rest corners (`rest`, null: all) all stand at least `minY`. */
function carTriangles(car: DeformableCar, mesh: THREE.Mesh, rest: Float32Array | null, minY: number): Float64Array {
  const toCar = new THREE.Matrix4().multiplyMatrices(car.group.matrixWorld.clone().invert(), mesh.matrixWorld);
  const positions = mesh.geometry.getAttribute("position");
  const index = mesh.geometry.index!;
  const out: number[] = [];
  const place = new THREE.Vector3();
  for (let t = 0; t < index.count; t += 3) {
    const corners = [index.getX(t), index.getX(t + 1), index.getX(t + 2)];
    if (rest && corners.some((v) => rest[v * 3 + 1]! < minY)) continue;
    for (const v of corners) {
      place.fromBufferAttribute(positions, v).applyMatrix4(toCar);
      out.push(place.x, place.y, place.z);
    }
  }
  return Float64Array.from(out);
}

/** The highest of `triangles` over plan point (x, z) among those facing up (the paint draws its front faces only), -Infinity where none is over it. */
function skinTopAt(triangles: Float64Array, x: number, z: number): number {
  let top = -Infinity;
  for (let i = 0; i < triangles.length; i += 9) {
    const [ax, ay, az, bx, by, bz, cx, cy, cz] = triangles.subarray(i, i + 9) as unknown as number[];
    if ((bz! - az!) * (cx! - ax!) - (bx! - ax!) * (cz! - az!) <= 0) continue;
    const den = (bz! - cz!) * (ax! - cx!) + (cx! - bx!) * (az! - cz!);
    const l1 = ((bz! - cz!) * (x - cx!) + (cx! - bx!) * (z - cz!)) / den;
    const l2 = ((cz! - az!) * (x - cx!) + (ax! - cx!) * (z - cz!)) / den;
    if (l1 < 0 || l2 < 0 || l1 + l2 > 1) continue;
    top = Math.max(top, l1 * ay! + l2 * by! + (1 - l1 - l2) * cy!);
  }
  return top;
}

describe(`given a hatchback driven into a wall with ${HOOD_COVER_OVERLAP * 100} % of its nose on it, at ${HOOD_COVER_KPH.join(", ")} km/h`, () => {
  for (const kph of HOOD_COVER_KPH) {
    it(`when it has come to rest after the ${kph} km/h hit, then no drawn vertex of its cabin shell or engine bay stands over the drawn bonnet or roof over it`, () => {
      const car = buildCar("hatchback", "hatch");
      runWall(kph, HOOD_COVER_OVERLAP, "front", { car });
      car.updateSkin();
      car.group.updateMatrixWorld(true);
      const hood = car["hood"] as THREE.Mesh;
      const covers = [carTriangles(car, car.body, car.deform.restSkin, ROOF_REST_Y)];
      if (!car.parts.some((p) => p.detached && p.name === LID.hood)) covers.push(carTriangles(car, hood, null, -Infinity));
      const toCar = new THREE.Matrix4();
      const place = new THREE.Vector3();
      let worst = 0;
      let where = "";
      for (const seat of car.partSeats) {
        if (seat.kind !== PART_KIND.interior && seat.kind !== PART_KIND.engineBay) continue;
        if (seat.showIf && !seat.showIf()) continue;
        toCar.multiplyMatrices(car.group.matrixWorld.clone().invert(), seat.matrixWorld);
        const positions = seat.drawn.getAttribute("position");
        for (let v = 0; v < positions.count; v++) {
          place.fromBufferAttribute(positions, v).applyMatrix4(toCar);
          const top = Math.max(...covers.map((t) => skinTopAt(t, place.x, place.z)));
          if (top === -Infinity) continue;
          const over = place.y - top;
          if (over > worst) [worst, where] = [over, `${seat.kind === PART_KIND.interior ? "cabin shell" : "engine bay"} at (${place.x.toFixed(2)}, ${place.y.toFixed(2)}, ${place.z.toFixed(2)})`];
        }
      }
      assert.equal(worst, 0, `${kph} km/h: the ${where} stands ${(worst * 1000).toFixed(1)} mm over the drawn skin over it`);
    });
  }
});
