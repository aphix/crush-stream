import assert from "node:assert/strict";
import { describe, test } from "node:test";
import * as THREE from "three";
import { DeformableCar } from "../vehicle/car.ts";
import { roofAt } from "../vehicle/car-mesh.ts";
import { CAR_STYLE_IDS, CAR_STYLES } from "../vehicle/car-variants.ts";
import { driverSeat } from "../vehicle/interior.ts";
import { PART_KIND, partGeometry } from "../vehicle/part-geometry.ts";
import { paint } from "../vehicle/test-support.ts";
import { driverLook } from "./driver-look.ts";
import { JOINTS, PARTS } from "./ragdoll-body.ts";
import { SeatedDrivers } from "./seated-drivers.ts";

/** A seated thigh rests on the cushion: the hip joint stands its half-thickness (`PARTS` 0.075) over the top, give or take the foam. */
const SIT_HIGH = { min: 0.05, max: 0.1 } as const;
/** How far (m) a hand may miss its grip on the rim, and the head must stay under the roof line. */
const GRIP_MISS = 0.01;
const HEAD_ROOM = 0.02;

type Style = (typeof CAR_STYLES)[keyof typeof CAR_STYLES];
const seatedCars = new Map<string, { car: DeformableCar; drivers: SeatedDrivers; toCabin: THREE.Matrix4 }>();

/** A car of `style` at rest with its driver drawn seated, and the map from the world into its cabin (car space, class lift off). */
function seated(style: Style) {
  let s = seatedCars.get(style.id);
  if (!s) {
    const car = new DeformableCar(paint(), new THREE.Scene(), null, style.id);
    car.spawn(0, 0, 0);
    car.group.updateMatrixWorld(true);
    const drivers = new SeatedDrivers();
    drivers.sync([car], (c) => driverLook(1, c));
    s = { car, drivers, toCabin: car.interior.matrixWorld.clone().invert() };
    seatedCars.set(style.id, s);
  }
  return s;
}

/** Standing point `rest` carried by part `k` of the drawn seated driver (car space). */
function carried(style: Style, k: number, rest: THREE.Vector3): THREE.Vector3 {
  const s = seated(style);
  return s.drivers.mesh.partPoint(0, k, rest, new THREE.Vector3()).applyMatrix4(s.toCabin);
}
const joint = (j: number) => new THREE.Vector3(JOINTS[j]![2], JOINTS[j]![3], JOINTS[j]![4]);

/** The drawn driver's seat of a car of `id`, as a mesh where the car stands it (car space at rest). */
function drawnSeat(id: (typeof CAR_STYLE_IDS)[number]): THREE.Mesh {
  const s = seated(CAR_STYLES[id]);
  const mesh = new THREE.Mesh(partGeometry(PART_KIND.seatFront), new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
  mesh.matrixAutoUpdate = false;
  mesh.matrix.copy(s.toCabin).multiply(s.car.partSeats[PART_KIND.seatFront]!.matrixWorld);
  mesh.matrixWorld.copy(mesh.matrix);
  return mesh;
}

describe("given every style's seated driver", () => {
  for (const id of CAR_STYLE_IDS) {
    const style = CAR_STYLES[id];

    test(`when the ${id}'s driver sits, then his hips rest on the drawn cushion over its H-point`, () => {
      const hip = carried(style, 6, joint(5)).add(carried(style, 8, joint(7))).multiplyScalar(0.5);
      const ray = new THREE.Raycaster(hip.clone().setY(hip.y + 0.3), new THREE.Vector3(0, -1, 0));
      const hit = ray.intersectObject(drawnSeat(id))[0];
      assert.ok(hit, `no cushion under the ${id}'s hips at ${hip.toArray().join()}`);
      const high = hip.y - hit.point.y;
      assert.ok(high >= SIT_HIGH.min && high <= SIT_HIGH.max, `hips ${high.toFixed(3)} m over the cushion`);
      assert.ok(hip.distanceTo(driverSeat(style).hip) < 1e-3, "hips on the seat's H-point");
    });

    test(`when the ${id}'s driver sits, then both hands hold the wheel's grips and his head clears the roof`, () => {
      const seat = driverSeat(style);
      for (const [side, fore, elbow] of [[0, 3, 2], [1, 5, 4]] as const) {
        const grip = carried(style, fore, joint(elbow).sub(new THREE.Vector3(0, 0.35, 0)));
        assert.ok(grip.distanceTo(seat.grips[side]) < GRIP_MISS, `hand ${side} misses its grip by ${grip.distanceTo(seat.grips[side]).toFixed(3)} m`);
      }
      const head = carried(style, 1, new THREE.Vector3(...PARTS[1]!.c).setY(PARTS[1]!.c[1] + PARTS[1]!.h[1]));
      assert.ok(head.y <= roofAt(head.z, style).y - HEAD_ROOM, `crown ${head.y.toFixed(3)} under a roof at ${roofAt(head.z, style).y.toFixed(3)}`);
    });
  }
});

describe("given the seated drivers' batch and one car", () => {
  test("when its driver is in, then one slot is drawn; thrown, or past the far cut, then none", () => {
    const car = new DeformableCar(paint(), new THREE.Scene(), null, "sedan");
    car.spawn(0, 0, 0);
    car.group.updateMatrixWorld(true);
    const drivers = new SeatedDrivers();
    const look = (car: number) => driverLook(1, car);
    drivers.sync([car], look);
    assert.equal(drivers.mesh.count, 1);
    car.driverOut = "windshield";
    drivers.sync([car], look);
    assert.equal(drivers.mesh.count, 0, "the thrown driver is the ragdoll now");
    car.driverOut = null;
    car.partSeats[PART_KIND.seatFront]!.layers.disable(0);
    drivers.sync([car], look);
    assert.equal(drivers.mesh.count, 0, "cut with the cabin");
    drivers.dispose();
  });
});
