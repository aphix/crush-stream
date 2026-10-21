import assert from "node:assert/strict";
import { describe, test } from "node:test";
import * as THREE from "three";
import { CarDetail, DETAIL_LEVELS } from "../present/car-detail.ts";
import { treadNormalMap, WHEEL_DESIGNS, type WheelDesign } from "./car-materials.ts";
import { DeformableCar } from "./car.ts";
import { assertSameNumbers, paint } from "./test-support.ts";
import { STYLE_WHEELS, WheelBatch } from "./wheel-batch.ts";
import { CAR_STYLE_IDS, CAR_STYLES, type CarStyleId } from "./car-variants.ts";
import { PLATFORM_TYRE } from "../kernel/rig-spec.ts";

/** The instance matrix is float32: a wheel's position of a few hundred metres is stored within 1e-4 m. */
const FLOAT32_SLACK = 1e-4;
const FAR_BEYOND = DETAIL_LEVELS[0]!.far;

/** The full-wheel draw of a style's rim design. */
const nearOf = (batch: WheelBatch, id: CarStyleId) => batch.meshes[WHEEL_DESIGNS.indexOf(STYLE_WHEELS[id].design)]!;
const farOf = (batch: WheelBatch) => batch.meshes.at(-2)!;

/** A 50 degree lens at the origin looking down +z; cars stand on the axis at the given distance; the renderer is a shadow pass that records whether the prisms are visible inside it. */
function stage() {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(50, 2, 0.1, 900);
  camera.lookAt(0, 0, 1);
  camera.updateMatrixWorld(true);
  const detail = new CarDetail();
  const batch = new WheelBatch(16, (car) => detail.isFar(car));
  const shadow = batch.meshes.at(-1)!;
  const seen: boolean[] = [];
  const renderer = { shadowMap: { render: () => void seen.push(shadow.visible) } };
  const car = (at: number) => {
    const made = new DeformableCar(paint(), scene, null, "sedan");
    made.spawn(0, at, 0);
    made.group.updateMatrixWorld(true);
    return made;
  };
  const draw = (cars: DeformableCar[]) => {
    detail.update(cars, camera, null, null);
    for (const c of cars) c.group.updateMatrixWorld(true);
    batch.sync(cars, renderer);
  };
  return { batch, car, draw, renderer, seen, shadow };
}

const triangles = (mesh: THREE.Mesh): number => mesh.geometry.index!.count / 3;
const passRuns = (renderer: { shadowMap: { render: THREE.WebGLShadowMap["render"] } }) => renderer.shadowMap.render([], new THREE.Scene(), new THREE.PerspectiveCamera());

describe("given the wheel batch and cars at two distances from the camera", () => {
  test("when a car is inside the farthest rung's distance and another beyond it, then the near car's four wheels take its design's full wheel and the far car's four the far wheel", () => {
    const { batch, car, draw } = stage();
    const cars = [car(10), car(FAR_BEYOND + 20)];
    draw(cars);
    const full = nearOf(batch, "sedan");
    const far = farOf(batch);
    assert.equal(full.count, 4);
    assert.equal(far.count, 4);
    const matrix = new THREE.Matrix4();
    far.getMatrixAt(0, matrix);
    assertSameNumbers(matrix.elements, cars[1]!.wheels[0]!.matrixWorld.elements, "the far wheel stands where the car's wheel group does", FLOAT32_SLACK);
  });

  test("when the far car comes back inside the distance, then all eight wheels are full wheels", () => {
    const { batch, car, draw } = stage();
    const cars = [car(10), car(FAR_BEYOND + 20)];
    draw(cars);
    cars[1]!.group.position.z = 12;
    draw(cars);
    assert.equal(nearOf(batch, "sedan").count, 8);
    assert.equal(farOf(batch).count, 0);
  });

  test("when every design's full wheel is compared with the far wheel, then the far wheel has at most a fifth of its triangles and the same attributes", () => {
    const { batch } = stage();
    const far = farOf(batch);
    for (const full of batch.meshes.slice(0, WHEEL_DESIGNS.length)) {
      assert.ok(triangles(far) * 5 <= triangles(full), `${triangles(far)} of ${triangles(full)}`);
      assert.equal(Object.keys(far.geometry.attributes).sort().join(), Object.keys(full.geometry.attributes).sort().join());
    }
  });

  test("when the batch is built, then every wheel draw's material uses the one shared tread normal map", () => {
    const { batch } = stage();
    for (const mesh of batch.meshes.slice(0, -1)) assert.equal((mesh.material as THREE.MeshStandardMaterial).normalMap, treadNormalMap());
  });
});

describe("given the wheel batch synced for a renderer's shadow pass", () => {
  test("when the shadow pass runs, then the prisms are shown during it and hidden before and after, and the wheel draws cast nothing", () => {
    const { batch, car, draw, renderer, seen, shadow } = stage();
    draw([car(10)]);
    assert.equal(shadow.visible, false, "hidden while the main pass builds its list");
    passRuns(renderer);
    assert.equal(seen.length, 1);
    assert.equal(seen[0], true, "visible inside the pass");
    assert.equal(shadow.visible, false, "hidden again once the pass is done");
    assert.equal(shadow.castShadow, true);
    assert.equal(batch.meshes.slice(0, -1).some((m) => m.castShadow), false);
  });

  test("when a near car and a far car are drawn, then one prism stands at each of the eight wheels and each prism is at most a tenth of a full wheel's triangles", () => {
    const { batch, car, draw, shadow } = stage();
    draw([car(10), car(FAR_BEYOND + 20)]);
    assert.equal(shadow.count, 8);
    for (const full of batch.meshes.slice(0, WHEEL_DESIGNS.length)) assert.ok(triangles(shadow) * 10 <= triangles(full), `${triangles(shadow)} of ${triangles(full)}`);
  });

  test("when the batch is synced twice, then the shadow pass is wrapped once", () => {
    const { car, draw, renderer, seen } = stage();
    const cars = [car(10)];
    draw(cars);
    draw(cars);
    passRuns(renderer);
    assert.equal(seen.length, 1);
  });

  test("when the batch is disposed, then the renderer's own shadow pass is back", () => {
    const { batch, car, draw, renderer, seen } = stage();
    draw([car(10)]);
    batch.dispose();
    passRuns(renderer);
    assert.equal(seen[0], false);
  });
});

/** One car of style `id` alone in a batch that draws everything full, synced once. */
function drawnAlone(id: CarStyleId) {
  const batch = new WheelBatch(4, () => false);
  const car = new DeformableCar(paint(), new THREE.Scene(), null, id);
  car.group.updateMatrixWorld(true);
  const sync = () => {
    car.group.updateMatrixWorld(true);
    batch.sync([car], { shadowMap: { render: () => {} } });
  };
  sync();
  return { batch, car, sync, mesh: nearOf(batch, id) };
}

describe("given every body style's tyre (its dims' wheel), drawn by the one platform-sized wheel mesh", () => {
  for (const id of CAR_STYLE_IDS) {
    test(`when a ${id} is drawn, then its wheels are drawn at its tyre's width and radius`, () => {
      const { mesh } = drawnAlone(id);
      const m = new THREE.Matrix4();
      mesh.getMatrixAt(0, m);
      const across = new THREE.Vector3().setFromMatrixColumn(m, 0).length();
      const round = new THREE.Vector3().setFromMatrixColumn(m, 1).length();
      const { wheel } = CAR_STYLES[id].dims;
      assertSameNumbers([across, round], [wheel.width / (2 * PLATFORM_TYRE.halfW), wheel.radius / PLATFORM_TYRE.r], `${id} drawn tyre scale (width, radius)`, FLOAT32_SLACK);
    });
  }
});

/** The rim each reference car shows: sedan and SUV split ten-spoke (the SUV's dark), hatch and police five-spoke, muscle slotted mag, pickup six-spoke steel, monster beadlock. */
const REFERENCE_RIMS: Readonly<Record<CarStyleId, WheelDesign>> = {
  sedan: "split10",
  hatchback: "five",
  wagon: "split10",
  coupe: "mag5",
  pickup: "six",
  police: "five",
  monster: "beadlock",
};

describe("given the reference cars' rim designs", () => {
  for (const id of CAR_STYLE_IDS) {
    test(`when a ${id} alone is drawn, then its four wheels are all in its reference design's draw and no other wheel draw holds any`, () => {
      const { batch } = drawnAlone(id);
      const counts = batch.meshes.slice(0, WHEEL_DESIGNS.length).map((m, k) => `${WHEEL_DESIGNS[k]}:${m.count}`);
      assert.equal(counts.filter((c) => !c.endsWith(":0")).join(), `${REFERENCE_RIMS[id]}:4`);
    });
  }

  test("when the designs' wheel geometries are compared, then each is its own shape and the SUV's split ten-spoke is tinted darker than the sedan's", () => {
    const { batch } = stage();
    const shapes = batch.meshes.slice(0, WHEEL_DESIGNS.length).map((m) => {
      const p = m.geometry.getAttribute("position");
      let sum = 0;
      for (let i = 0; i < p.count; i++) sum += Math.abs(p.getX(i)) + Math.abs(p.getY(i)) * 3 + Math.abs(p.getZ(i)) * 7;
      return `${p.count}/${sum.toFixed(3)}`;
    });
    assert.equal(new Set(shapes).size, WHEEL_DESIGNS.length, shapes.join(" "));
    assert.ok(STYLE_WHEELS.wagon.tint.getHSL({ h: 0, s: 0, l: 0 }).l < 0.5 * STYLE_WHEELS.sedan.tint.getHSL({ h: 0, s: 0, l: 0 }).l, "SUV rim dark");
  });
});

/** The instance's squash (`WheelLane`): hub-frame down y and z, flatten over crown radius, bulge in mesh units. */
function squashAt(mesh: THREE.InstancedMesh, k: number): [number, number, number, number] {
  const a = mesh.geometry.getAttribute("tyreLoad");
  return [a.getX(k), a.getY(k), a.getZ(k), a.getW(k)];
}

describe("given a car standing on its wheels, its tyres loaded with its class's rest weight", () => {
  test("when the wheels turn through a full revolution, then each wheel's loaded foot points at the body's down in the world at every angle", () => {
    const { car, sync, mesh } = drawnAlone("sedan");
    car.group.rotation.set(0.2, 0.9, -0.15);
    const down = new THREE.Vector3();
    const foot = new THREE.Vector3();
    const m = new THREE.Matrix4();
    for (const spin of [0, 0.7, 2, 3.1, 4.5, 5.9]) {
      for (const w of car.wheels) w.rotation.x = spin;
      sync();
      down.set(0, -1, 0).transformDirection(car.group.matrixWorld);
      for (let k = 0; k < 4; k++) {
        const [y, z] = squashAt(mesh, k);
        mesh.getMatrixAt(k, m);
        foot.set(0, y, z).transformDirection(m);
        assertSameNumbers(foot.toArray(), down.toArray(), `wheel ${k} foot at spin ${spin}`, 1e-5);
      }
    }
  });

  test("when a sedan is drawn, then its foot is 1.2-1.8 cm flattened over a 0.17-0.20 m patch with a 0.8-1.5 cm sidewall bulge", () => {
    const { car, mesh } = drawnAlone("sedan");
    const { r, halfW } = car.frame.rig.tyre;
    const [, , flat, bulge] = squashAt(mesh, 0);
    const patch = 2 * r * Math.sqrt((1 + flat) ** 2 - 1);
    const reading = `flatten ${(flat * r).toFixed(4)} m, patch ${patch.toFixed(3)} m, bulge ${((bulge * halfW) / PLATFORM_TYRE.halfW).toFixed(4)} m`;
    assert.ok(flat * r >= 0.012 && flat * r <= 0.018, reading);
    assert.ok(patch >= 0.17 && patch <= 0.2, reading);
    assert.ok((bulge * halfW) / PLATFORM_TYRE.halfW >= 0.008 && (bulge * halfW) / PLATFORM_TYRE.halfW <= 0.015, reading);
  });

  test("when a sedan, a pickup and a monster are drawn, then the heavier class's tyre is flattened further", () => {
    const flattened = (["sedan", "pickup", "monster"] as const).map((id) => {
      const { car, mesh } = drawnAlone(id);
      return squashAt(mesh, 0)[2] * car.frame.rig.tyre.r * car.wheels[0]!.scale.y;
    });
    assert.ok(flattened[0]! < flattened[1]! && flattened[1]! < flattened[2]!, flattened.map((f) => f.toFixed(4)).join(" < "));
  });

  test("when a wheel leaves the ground, then its tyre is drawn round and the others stay loaded", () => {
    const { car, sync, mesh } = drawnAlone("sedan");
    car.wheelsDown = 0b1101;
    sync();
    assert.equal([0, 1, 2, 3].map((k) => (squashAt(mesh, k)[2] > 0 ? "loaded" : "round")).join(), "loaded,round,loaded,loaded");
  });
});
