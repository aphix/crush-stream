import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { DeformableCar } from "../vehicle/car.ts";
import type { CarStyleId } from "../vehicle/car-variants.ts";
import { PART_SLOTS } from "../vehicle/part-state.ts";
import { assignClass, STYLE_CLASS } from "../vehicle/vehicle-classes.ts";
import { paint } from "../vehicle/test-support.ts";
import { PREFABS } from "../world/catalog.ts";
import { PREFAB } from "../world/constants.ts";
import { frontBumper, lyingWheel } from "./prefabs-car.ts";

/**
 * The car parts the showcase throws (the muscle car's front bumper, the monster truck's wheel, a car's wheel) are the parts of those cars:
 * the same mass a torn one strikes a figure with (`looseKg`) and the same size as its drawn geometry and its popped disk.
 */

/** A drawn wheel stands this share (the tyre's shoulders past its nominal crown and width) over its popped disk. */
const DRAWN_OVER = 0.03;

/** A car of `style` standing still, in its style's own class. */
function carOf(style: CarStyleId): DeformableCar {
  const car = new DeformableCar(paint(), new THREE.Scene(), null, style);
  assignClass(car, STYLE_CLASS[style]);
  return car;
}

/** The popped front-left wheel of a `style` car: its mass (kg) as a loose body, and its disk's width and diameter (m). */
function poppedWheel(style: CarStyleId): { kg: number; width: number; diameter: number } {
  const car = carOf(style);
  car["dropWheel"](0, "hubFL");
  const { half } = car["looseWheels"][0]!.shape;
  return { kg: car.looseKg(PART_SLOTS), width: 2 * half.x, diameter: 2 * half.y };
}

const sizeOf = (parts: { geometry: THREE.BufferGeometry }[]): THREE.Vector3 => {
  const geometry = parts[0]!.geometry;
  geometry.computeBoundingBox();
  return geometry.boundingBox!.getSize(new THREE.Vector3());
};

describe("given the car parts the showcase throws", () => {
  it("when the muscle car's front bumper is weighed as a torn part, then the thrown bumper weighs the same", () => {
    const car = carOf("coupe");
    const bumper = car["parts"].findIndex((p) => p.name === "bumperF");
    expect(PREFABS[PREFAB.muscleBumper].mass).toBe(car.looseKg(bumper));
  });

  const wheels = [
    { it: "when the monster truck's wheel pops off, then the thrown one weighs what it does and is as wide and as tall", style: "monster", prefab: PREFAB.monsterWheel },
    { it: "when a car's wheel pops off, then the thrown one weighs what it does and is as wide and as tall", style: "sedan", prefab: PREFAB.carWheel },
  ] as const;
  for (const testCase of wheels) {
    it(testCase.it, () => {
      const popped = poppedWheel(testCase.style);
      const [w, h] = PREFABS[testCase.prefab].size;
      expect(PREFABS[testCase.prefab].mass, `${popped.kg.toFixed(1)} kg popped`).toBeCloseTo(popped.kg, 0);
      expect(w, `${popped.diameter.toFixed(3)} m across`).toBeCloseTo(popped.diameter, 2);
      expect(h, `${popped.width.toFixed(3)} m wide`).toBeCloseTo(popped.width, 2);
    });
  }

  it("when the bumper and the wheels are drawn, then each is as big as its prefab says, to the tyre's shoulders and stands on its base", () => {
    const drawn = [
      { prefab: PREFAB.muscleBumper, parts: frontBumper("coupe") },
      { prefab: PREFAB.monsterWheel, parts: lyingWheel("monster") },
      { prefab: PREFAB.carWheel, parts: lyingWheel("sedan") },
    ];
    for (const { prefab, parts } of drawn) {
      const size = sizeOf(parts);
      const [w, h, d] = PREFABS[prefab].size;
      for (const [axis, drawnSize, specSize] of [["x", size.x, w], ["y", size.y, h], ["z", size.z, d]] as const) expect(Math.abs(drawnSize / specSize - 1), `${prefab} drawn ${size.toArray().map((v) => v.toFixed(3))} against ${w} x ${h} x ${d} along ${axis}`).toBeLessThan(DRAWN_OVER);
      expect(parts[0]!.geometry.boundingBox!.min.y, `${prefab} stands on its base`).toBeCloseTo(0, 3);
    }
  });

  it("when the muscle car's bumper is the thrown one, then it is the coupe's own front bumper geometry", () => {
    const own = ownBumperSize();
    const size = sizeOf(frontBumper("coupe"));
    expect(size.toArray().join()).toBe(own.toArray().join());
  });
});

function ownBumperSize(): THREE.Vector3 {
  const geometry = new DeformableCar(paint(), new THREE.Scene(), null, "coupe")["bumperMeshes"][0]!.geometry;
  geometry.computeBoundingBox();
  return geometry.boundingBox!.getSize(new THREE.Vector3());
}
