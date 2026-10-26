import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { runField } from "./derby-field.test-util.ts";
import type { DeformableCar } from "../vehicle/car.ts";

function torn(car: DeformableCar): string[] {
  const { parts } = car.snapshot();
  assert.ok(Array.isArray(parts), "the car's snapshot lists no parts");
  return parts.filter((p: { detached: boolean }) => p.detached).map((p: { name: string }) => p.name);
}

describe("given the derby harness (`runField`) running a two-car heat, seed 1", () => {
  it("when the cars meet in their opening hits, then parts tear off within the first 10 s, as the engine's slice steps each car's breakage (`settleStep`)", () => {
    let cars: DeformableCar[] = [];
    let tornAt = -1;
    runField(2, 1, undefined, {
      step: (c, t) => {
        cars = c;
        if (tornAt < 0 && t < 10 && c.some((car) => torn(car).length > 0)) tornAt = t;
      },
    });
    assert.ok(tornAt >= 0, `no part tore in 10 s; torn at the end: ${JSON.stringify(cars.map(torn))}`);
  });
});
