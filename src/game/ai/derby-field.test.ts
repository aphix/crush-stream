import { describe, expect, it } from "vitest";
import { runField } from "./derby-field.test-util.ts";
import type { DeformableCar } from "../vehicle/car.ts";
import { must } from "../kernel/must.test-util.ts";

function torn(car: DeformableCar): string[] {
  const { parts } = car.snapshot();
  must(Array.isArray(parts), "the car's snapshot lists no parts");
  return parts.filter((p: { detached: boolean }) => p.detached).map((p: { name: string }) => p.name);
}

describe("given a derby heat of two cars played from seed 1", () => {
  it("when the cars meet in their opening hits, then parts tear off within the first 10 s, as the engine steps each car's breakage", () => {
    let cars: DeformableCar[] = [];
    let tornAt = -1;
    runField(2, 1, {
      step: (c, t) => {
        cars = c;
        if (tornAt < 0 && t < 10 && c.some((car) => torn(car).length > 0)) tornAt = t;
      },
    });
    expect(tornAt, `no part tore in 10 s; torn at the end: ${JSON.stringify(cars.map(torn))}`).toBeGreaterThanOrEqual(0);
  });
});
