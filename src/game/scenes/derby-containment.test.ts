import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { DERBY_ARENA } from "./constants.ts";
import { bodyRadius, carOfClass, containmentCases } from "./derby-containment.test-util.ts";

containmentCases(4);

const { radius } = DERBY_ARENA;
/** How far (m) the group origin stands off the inner face in the two poses below: well under the half-height the drawn body of a car on its nose or tail hangs off the origin. */
const ORIGIN_OFF_FACE = 0.1;
const STOOD_ON_ITS_NOSE = Math.PI / 2;
const FACING_THE_WALL = Math.PI / 2;

/** A truck at rest facing the wall, tipped onto its nose (`tilt` +) or its tail (`tilt` -), its group origin at plan (`radius + offFace`, 0): the drawn body (the end `containmentCases` reads) hangs off the origin along the radius. */
function truckOnItsEnd(offFace: number, tilt: number): ReturnType<typeof carOfClass> {
  const car = carOfClass("truck", radius + offFace, 0, FACING_THE_WALL, 0);
  car.group.rotation.set(tilt, FACING_THE_WALL, 0, "YXZ");
  car.group.updateMatrixWorld(true);
  return car;
}

describe("given the end the containment rows read (where the car's drawn body rests, not its group origin)", () => {
  it("when a truck on its end has its origin inside the inner face and its body outside it, then it ends outside", () => {
    const [nose, tail] = [truckOnItsEnd(-ORIGIN_OFF_FACE, STOOD_ON_ITS_NOSE), truckOnItsEnd(-ORIGIN_OFF_FACE, -STOOD_ON_ITS_NOSE)];
    const outer = bodyRadius(nose) > bodyRadius(tail) ? nose : tail;
    assert.ok(outer.group.position.x < radius, `the origin stands at ${outer.group.position.x.toFixed(2)} m, inside the inner face at ${radius} m`);
    assert.ok(bodyRadius(outer) >= radius, `the body rests at ${bodyRadius(outer).toFixed(2)} m, which the row reads as outside the inner face at ${radius} m`);
  });

  it("when the same truck has its origin outside the inner face and its body inside it, then it ends inside", () => {
    const [nose, tail] = [truckOnItsEnd(ORIGIN_OFF_FACE, STOOD_ON_ITS_NOSE), truckOnItsEnd(ORIGIN_OFF_FACE, -STOOD_ON_ITS_NOSE)];
    const inner = bodyRadius(nose) < bodyRadius(tail) ? nose : tail;
    assert.ok(inner.group.position.x >= radius, `the origin stands at ${inner.group.position.x.toFixed(2)} m, outside the inner face at ${radius} m`);
    assert.ok(bodyRadius(inner) < radius, `the body rests at ${bodyRadius(inner).toFixed(2)} m, which the row reads as inside the inner face at ${radius} m`);
  });
});
