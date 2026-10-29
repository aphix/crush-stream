import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { runWall } from "../contact/crash-scenarios.test-util.ts";
import { DeformableCar } from "./car.ts";
import { CONTOUR_SMOOTHING, SMOOTHING_TIER } from "./normal-smooth.ts";
import { paint } from "./test-support.ts";

/** The mean of the angles (degrees) between the two vertex normals of every edge of the body. */
function meanEdgeAngle(car: DeformableCar): number {
  const g = car.body.geometry;
  const index = g.index!.array;
  const nor = g.getAttribute("normal").array;
  let sum = 0;
  let edges = 0;
  for (let t = 0; t < index.length; t += 3) {
    for (let k = 0; k < 3; k++) {
      const a = index[t + k]!;
      const b = index[t + ((k + 1) % 3)]!;
      const dot = nor[a * 3]! * nor[b * 3]! + nor[a * 3 + 1]! * nor[b * 3 + 1]! + nor[a * 3 + 2]! * nor[b * 3 + 2]!;
      sum += (Math.acos(Math.min(1, Math.max(-1, dot))) * 180) / Math.PI;
      edges++;
    }
  }
  return sum / edges;
}

function crashedSedan(): DeformableCar {
  const car = new DeformableCar(paint(), new THREE.Scene(), null, "sedan");
  car.deform.setMode("shape");
  runWall(64, 1, "front", { car });
  car.flushDeferredSkin();
  car.updateSkin();
  return car;
}

describe("given a crashed sedan whose drawn normals follow the FX tier and the engine's LoD verdict", () => {
  CONTOUR_SMOOTHING.value = 1;

  it("when the tier does not draw the finish, then its normals are the sim's own, and the tier going up smooths them on the next skin", () => {
    SMOOTHING_TIER.value = 0;
    const car = crashedSedan();
    const plain = meanEdgeAngle(car);
    SMOOTHING_TIER.value = 1;
    car.updateSkin();
    car.flushDeferredSkin();
    expect(meanEdgeAngle(car), `${meanEdgeAngle(car).toFixed(2)} against ${plain.toFixed(2)} degrees`).toBeLessThan(plain * 0.95);
  });

  it("when the car is far from the camera, then it keeps the sim's normals, and coming near smooths it once", () => {
    SMOOTHING_TIER.value = 1;
    const car = new DeformableCar(paint(), new THREE.Scene(), null, "sedan");
    car.setNearView(false);
    car.deform.setMode("shape");
    runWall(64, 1, "front", { car });
    car.flushDeferredSkin();
    car.updateSkin();
    const far = meanEdgeAngle(car);
    car.setNearView(true);
    car.updateSkin();
    car.flushDeferredSkin();
    expect(meanEdgeAngle(car), `near ${meanEdgeAngle(car).toFixed(2)} against far ${far.toFixed(2)} degrees`).toBeLessThan(far * 0.95);
  });
});
