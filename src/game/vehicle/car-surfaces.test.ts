import { describe, expect, it } from "vitest";
import { firstMismatch } from "../kernel/compare-arrays.test-util.ts";
import { P_STRIDE } from "../world/surfaces.ts";
import { CarSurfaces } from "./car-surfaces.ts";
import { carInState } from "./drawn-body.test-util.ts";

describe("given a crushed car whose own cage fields are refitted in place", () => {
  it("when its hood opens after a refit nobody told the surfaces of, then its roof patch is the one a fresh sync reads", () => {
    const car = carInState("loaded", "sedan", "sedan");
    car.group.updateMatrixWorld(true);
    const stale = new CarSurfaces();
    stale.sync(0, car);
    const fields = car.cage.fields;
    const before = fields.heightMax;

    for (const part of car["parts"]) if (part.hinge === "cowl") part.hingeT = 1;
    car.deform["loadDirty"][0] = 1;
    car.deform.bakeSkin();
    // The rigid step's `loadPoints` fits the cage first and discards the answer.
    expect(car.refitCage(), "fixture: the refit must change the fields").toBe(true);
    expect(car.cage.fields, "fixture: an own cage is refitted in place").toBe(fields);
    expect(fields.heightMax, "fixture: the open hood must raise the height bound").toBeGreaterThan(before);

    stale.sync(0, car);
    const fresh = new CarSurfaces();
    fresh.sync(0, car);
    const a = stale.p.subarray(0, P_STRIDE);
    const b = fresh.p.subarray(0, P_STRIDE);
    const k = a.findIndex((v, j) => !Object.is(v, b[j]));
    expect(k, `the roof patch differs from a fresh sync's at parameter ${k}: ${a[k]} vs ${b[k]}`).toBe(-1);
  });
});

describe("given a car with a point in another car's top, closing at a crash's speed", () => {
  it("when the slice ends, then the surfaces report the two cars met and the stepping car rests on nothing", () => {
    const a = carInState("loaded", "sedan", "sedan");
    const b = carInState("loaded", "sedan", "sedan");
    a.slot = 0;
    b.slot = 1;
    const surfaces = new CarSurfaces();
    surfaces.cars = [a, b];
    surfaces.sync(0, a);
    surfaces.sync(1, b);
    const met: [number, number][] = [];
    surfaces.met = (x, y) => void met.push([x, y]);
    surfaces.begin(a);
    surfaces.strike(1);
    surfaces.commit();
    expect(met, "the strike was not reported as a meeting").toHaveLength(1);
    expect(firstMismatch(met[0], [0, 1]), "the meeting's cars").toBeUndefined();
    expect(a.restsOn, "a car it struck at a crash's speed is not what it rests on").toBe(null);
  });
});
