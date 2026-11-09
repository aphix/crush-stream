import { afterEach, describe, expect, it } from "vitest";
import { firstMismatch } from "../kernel/compare-arrays.test-util.ts";
import { carState } from "../vehicle/car-state.test-util.ts";
import { makeCar, pooled } from "../vehicle/ground-probe.test-util.ts";
import { setGround } from "../world/ground.ts";
import { DERBY_ARENA } from "./constants.ts";
import { bodyRadius, carOfClass, fly, flyOn, sideWedgeLaunches, wallCases } from "./derby-containment.test-util.ts";

// The side wedges are derby-containment-wedge.test.ts, run beside this file.
wallCases();

const { radius } = DERBY_ARENA;
/** How far (m) the group origin stands off the inner face in the two poses below: well under the half-height the drawn body of a car on its nose or tail hangs off the origin. */
const ORIGIN_OFF_FACE = 0.1;
const STOOD_ON_ITS_NOSE = Math.PI / 2;
const FACING_THE_WALL = Math.PI / 2;

/** A truck at rest facing the wall, tipped onto its nose (`tilt` +) or its tail (`tilt` -), its group origin at plan (`radius + offFace`, 0): the drawn body (the end the containment rows read) hangs off the origin along the radius. */
function truckOnItsEnd(offFace: number, tilt: number): ReturnType<typeof carOfClass> {
  const car = carOfClass("truck", radius + offFace, 0, FACING_THE_WALL, 0);
  car.group.rotation.set(tilt, FACING_THE_WALL, 0, "YXZ");
  car.group.updateMatrixWorld(true);
  return car;
}

describe("given a truck stood on its nose or tail at the arena wall, its drawn body hanging off its group origin along the radius", () => {
  it("when a truck on its end has its origin inside the inner face and its body outside it, then it ends outside", () => {
    const [nose, tail] = [truckOnItsEnd(-ORIGIN_OFF_FACE, STOOD_ON_ITS_NOSE), truckOnItsEnd(-ORIGIN_OFF_FACE, -STOOD_ON_ITS_NOSE)];
    const outer = bodyRadius(nose) > bodyRadius(tail) ? nose : tail;
    expect(outer.group.position.x, `the origin stands at ${outer.group.position.x.toFixed(2)} m, inside the inner face at ${radius} m`).toBeLessThan(radius);
    expect(bodyRadius(outer), `the body rests at ${bodyRadius(outer).toFixed(2)} m, which the row reads as outside the inner face at ${radius} m`).toBeGreaterThanOrEqual(radius);
  });

  it("when the same truck has its origin outside the inner face and its body inside it, then it ends inside", () => {
    const [nose, tail] = [truckOnItsEnd(ORIGIN_OFF_FACE, STOOD_ON_ITS_NOSE), truckOnItsEnd(ORIGIN_OFF_FACE, -STOOD_ON_ITS_NOSE)];
    const inner = bodyRadius(nose) < bodyRadius(tail) ? nose : tail;
    expect(inner.group.position.x, `the origin stands at ${inner.group.position.x.toFixed(2)} m, outside the inner face at ${radius} m`).toBeGreaterThanOrEqual(radius);
    expect(bodyRadius(inner), `the body rests at ${bodyRadius(inner).toFixed(2)} m, which the row reads as inside the inner face at ${radius} m`).toBeLessThan(radius);
  });
});

describe("given a class's one car that has flown launch after launch, and a car built fresh for the same launch", () => {
  afterEach(() => setGround(null));

  for (const cls of ["sedan", "monster"] as const) {
    // mutation: sed -i 's/^    this.wheelSpin.fill(0);$/    \/\/ wheelSpin kept/' src/game/vehicle/car.ts  (the reused car keeps its wheels' spin: the fresh-vs-reused row)
    it(`when the ${cls} flies a side-wedge launch on the reused car and on a fresh one, then the flights and the cars' final states are identical bit for bit`, () => {
      const launches = sideWedgeLaunches();
      const [earlier, compared] = [launches[0]!, launches[7]!];
      fly(cls, earlier);
      const reusedFlight = fly(cls, compared);
      const reusedState = carState(pooled(cls));
      const freshCar = makeCar(cls);
      const freshFlight = flyOn(freshCar, cls, compared);
      const freshState = carState(freshCar);
      expect(reusedFlight.maxRadius, "how far the reused car's body got").toBeGreaterThan(0);
      expect(reusedState.length, "numbers in the reused car's state").toBeGreaterThan(1000);
      expect(firstMismatch(Object.values(reusedFlight), Object.values(freshFlight)), "first differing flight number").toBeUndefined();
      expect(firstMismatch(reusedState, freshState), "first differing state number").toBeUndefined();
    });
  }
});
