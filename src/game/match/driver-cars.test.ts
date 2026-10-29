import { describe, expect, it } from "vitest";
import { DRIVER_CARS } from "./types.ts";
import { CAR_STYLE_IDS } from "../vehicle/car-variants.ts";
import { CLASSES, STYLE_CLASS, VEHICLE_CLASS_IDS } from "../vehicle/vehicle-classes.ts";
import { must } from "../kernel/must.test-util.ts";

describe("given the one list of car types every car choice reads (the settings picker, the race setup, the share link)", () => {
  it("when it is read, then every vehicle class is offered, labelled as the class is", () => {
    for (const cls of VEHICLE_CLASS_IDS) {
      const car = DRIVER_CARS.find((c) => c.id === cls);
      must(car, `${cls} is missing`);
      expect(car.label).toBe(CLASSES[cls].label);
      expect(car.cls).toBe(cls);
    }
  });

  it("when it is read, then every body style that exists is the body of some offered car, so no hatchback or wagon is left out", () => {
    const offered = new Set(DRIVER_CARS.map((c) => c.style));
    expect(CAR_STYLE_IDS.filter((style) => !offered.has(style))).toHaveLength(0);
  });

  it("when it is read, then each car's id is unique and its class is the one its body drives as, unless it is a class's own body", () => {
    expect(new Set(DRIVER_CARS.map((c) => c.id)).size).toBe(DRIVER_CARS.length);
    for (const c of DRIVER_CARS) {
      expect(c.cls === STYLE_CLASS[c.style] || CLASSES[c.cls].style === c.style, `${c.id}: ${c.cls} on ${c.style}`).toBeTruthy();
    }
  });
});
