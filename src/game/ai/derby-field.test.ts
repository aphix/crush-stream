import { describe, it } from "vitest";
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
    runField(2, 1, {
      step: (c, t) => {
        cars = c;
        if (tornAt < 0 && t < 10 && c.some((car) => torn(car).length > 0)) tornAt = t;
      },
    });
    assert.ok(tornAt >= 0, `no part tore in 10 s; torn at the end: ${JSON.stringify(cars.map(torn))}`);
  });
});

describe("given the derby harness (`runField`) running a four-car heat, seed 1, with the engine's ejection watch", () => {
  it("when a hit throws a driver out, then from that step his car never takes the AI's input or a pedal, and the rules count it out", () => {
    const thrownAt = new Map<number, number>();
    const drivenAfter: string[] = [];
    const ruledIn: string[] = [];
    const f = runField(4, 1, {
      drive: (i, t) => {
        if (thrownAt.has(i)) drivenAfter.push(`c${i} at ${t.toFixed(2)}`);
      },
      step: (cars, t, _h, running) => {
        for (const [i, c] of cars.entries()) {
          if (c.driverOut === null) continue;
          // The step that throws him ran the AI's pedals before the hit: from the next one on, nobody's.
          const pedals = thrownAt.has(i) && (c.drive.throttle !== 0 || c.drive.brake !== 0 || c.drive.steer !== 0);
          if (!thrownAt.has(i)) thrownAt.set(i, t);
          if (running(i) || pedals) ruledIn.push(`c${i} at ${t.toFixed(2)}: running ${running(i)}, throttle ${c.drive.throttle}, steer ${c.drive.steer}`);
        }
      },
    });
    assert.ok(f.thrown.length > 0, "a driver was thrown out in the heat");
    assert.deepEqual(drivenAfter, [], "the AI drove a car with nobody in it");
    assert.deepEqual(ruledIn, [], "a thrown driver's car ran on");
  });
});
