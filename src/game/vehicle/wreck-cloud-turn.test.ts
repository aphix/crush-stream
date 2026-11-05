import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { FRAME_HZ } from "../kernel/constants.ts";
import { makeWorld, tickWorld } from "../contact/crash-scenarios.test-util.ts";
import { buildCar } from "./drawn-body.test-util.ts";
import type { CarStyleId } from "./car-variants.ts";
import type { VehicleClassId } from "./vehicle-classes.ts";
import type { DeformableCar } from "./car.ts";

/**
 * A wreck's masses stand where its rigid frame puts them: the shape goals reshape the cloud, they do not turn it against the frame. A
 * wreck dropped on its flank or its roof turns every cluster past the 0.85 rad the fit clamps to about the world's axes, so the goals of
 * a body that was only turned pulled its cloud back toward upright (measured on the drops below with the clamp about the world's axes:
 * the cloud 13-16.5 degrees off its frame, 0.075-0.127 rad in one tick). The clamp is now about the cloud's own turn.
 */
const DROP_SECONDS = 4;
/** The largest turn (rad) of the masses' cloud against the frame between two ticks of a settling wreck: 0.004 measured, 0.075-0.127 with the clamp about the world's axes. */
const TICK_TURN_MAX = 0.05;
/** The largest turn (degrees) of the cloud against the frame: 1.5 measured (the roof landing), 13.0-16.5 with the clamp about the world's axes. */
const CLOUD_TURN_MAX_DEG = 5;
/** Attitudes (roll about the car's length, radians) a car is dropped in. */
const ATTITUDE = { roof: Math.PI, left: Math.PI / 2 } as const;
const NOSE_HIT_M = 2.05;

const DROPS = [
  { style: "sedan", cls: "sedan", attitude: "left", height: 0.5 },
  { style: "pickup", cls: "truck", attitude: "left", height: 0.5 },
  { style: "sedan", cls: "monster", attitude: "left", height: 2 },
  { style: "pickup", cls: "truck", attitude: "roof", height: 2 },
] as const satisfies readonly { style: CarStyleId; cls: VehicleClassId; attitude: keyof typeof ATTITUDE; height: number }[];

/** The angle (rad) the masses' cloud (hubs left out) stands turned against the car's frame: Kabsch fit of the world cloud to its rest, then the frame's turn taken off. */
function cloudTurnAgainstFrame(car: DeformableCar): number {
  const ms = car.deform.masses.filter((m) => !m.hub);
  const rest = new THREE.Vector3();
  const world = new THREE.Vector3();
  let total = 0;
  for (const m of ms) {
    rest.addScaledVector(m.rest, m.mass);
    world.addScaledVector(m.world, m.mass);
    total += m.mass;
  }
  rest.divideScalar(total);
  world.divideScalar(total);
  const A = new THREE.Matrix3().set(0, 0, 0, 0, 0, 0, 0, 0, 0);
  const a = A.elements;
  for (const m of ms) {
    const p = [m.world.x - world.x, m.world.y - world.y, m.world.z - world.z];
    const q = [m.rest.x - rest.x, m.rest.y - rest.y, m.rest.z - rest.z];
    for (let r = 0; r < 3; r++) for (let k = 0; k < 3; k++) a[k * 3 + r]! += m.mass * p[r]! * q[k]!;
  }
  const R = A.clone();
  for (let it = 0; it < 40; it++) {
    const inverseTransposed = R.clone().invert().transpose();
    for (let i = 0; i < 9; i++) R.elements[i] = 0.5 * (R.elements[i]! + inverseTransposed.elements[i]!);
  }
  const cloud = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().setFromMatrix3(R));
  const against = car.group.quaternion.clone().invert().multiply(cloud);
  return 2 * Math.acos(Math.min(1, Math.abs(against.w)));
}

describe("given a car struck at the nose, dropped onto its flank or its roof and left to lie for 4 s", () => {
  for (const { style, cls, attitude, height } of DROPS) {
    it(`when a ${cls} lies on its ${attitude} from ${height} m, then its masses' cloud never turns more than ${CLOUD_TURN_MAX_DEG} degrees against its frame, nor ${TICK_TURN_MAX} rad between two ticks`, (t) => {
      const car = buildCar(style, cls);
      car.spawnFacing(0, 0, 0, 0);
      car.updateSkin();
      car.applyImpact(car.group.position.clone().addScaledVector(car.forward, NOSE_HIT_M), car.forward.clone().negate(), 0.5, 0.5);
      car.group.rotation.set(0, 0, ATTITUDE[attitude], "YXZ");
      car.group.updateMatrixWorld(true);
      car.group.position.y += height - new THREE.Box3().setFromObject(car.group).min.y;
      car.group.updateMatrixWorld(true);
      for (const m of car.deform.masses) m.world.copy(m.local).applyMatrix4(car.group.matrixWorld);
      car.airborne = true;
      car.parked = true;
      const world = makeWorld([car], false, false);
      let turnMax = 0;
      let tickMax = 0;
      let before = NaN;
      for (let f = 0; f < DROP_SECONDS * FRAME_HZ; f++) {
        tickWorld(world, 1 / FRAME_HZ);
        const turn = cloudTurnAgainstFrame(car);
        if (f > 0) tickMax = Math.max(tickMax, Math.abs(turn - before));
        turnMax = Math.max(turnMax, turn);
        before = turn;
      }
      const deg = (turnMax * 180) / Math.PI;
      t.annotate(`${cls} on its ${attitude} from ${height} m: cloud turn ${deg.toFixed(1)} degrees, ${tickMax.toFixed(3)} rad in one tick`);
      expect(deg, `${cls} on its ${attitude}: the cloud turned ${deg.toFixed(1)} degrees against its frame`).toBeLessThan(CLOUD_TURN_MAX_DEG);
      expect(tickMax, `${cls} on its ${attitude}: the cloud turned ${tickMax.toFixed(3)} rad against its frame in one tick`).toBeLessThan(TICK_TURN_MAX);
    });
  }
});
