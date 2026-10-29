import { describe, test } from "vitest";
import assert from "node:assert/strict";
import * as THREE from "three";
import { DETAIL_LEVELS } from "../present/car-detail.ts";
import { makeWheelGeometry, RUBBER, treadNormalMap, WHEEL_DESIGNS, type WheelDesign } from "./car-materials.ts";
import { DeformableCar } from "./car.ts";
import { assertSameNumbers, paint, stageBatch } from "./test-support.ts";
import { STYLE_WHEELS, WheelBatch } from "./wheel-batch.ts";
import { CAR_STYLE_IDS, CAR_STYLES, type CarStyleId } from "./car-variants.ts";
import { PLATFORM_TYRE } from "../kernel/rig-spec.ts";
import { detCos, detSin } from "../kernel/physics-core.js";

/** The instance matrix is float32: a wheel's position of a few hundred metres is stored within 1e-4 m. */
const FLOAT32_SLACK = 1e-4;
const FAR_BEYOND = DETAIL_LEVELS[0]!.far;

/** The full-wheel draw of a style's rim design. */
const nearOf = (batch: WheelBatch, id: CarStyleId) => batch.meshes[WHEEL_DESIGNS.indexOf(STYLE_WHEELS[id].design)]!;
const farOf = (batch: WheelBatch) => batch.meshes.at(-2)!;

/** The renderer is a shadow pass that records whether the prisms are visible inside it. */
function stage() {
  const seen: boolean[] = [];
  const renderer = { shadowMap: { render: () => void seen.push(shadow.visible) } };
  const s = stageBatch((detail) => new WheelBatch(16, (car) => detail.isFar(car)), (b, cars) => b.sync(cars, renderer));
  const shadow = s.batch.meshes.at(-1)!;
  return { ...s, renderer, seen, shadow };
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
    // The one wheel mesh is the platform tyre: the drawn matrix is the wheel group's, scaled to the style's own tyre.
    const { r, halfW } = cars[1]!.frame.rig.tyre;
    const expected = cars[1]!.wheels[0]!.matrixWorld.clone().scale(new THREE.Vector3(halfW / PLATFORM_TYRE.halfW, r / PLATFORM_TYRE.r, r / PLATFORM_TYRE.r));
    assertSameNumbers(matrix.elements, expected.elements, "the far wheel stands where the car's wheel group does, at the car's tyre size", FLOAT32_SLACK);
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

/** The rim each reference car shows: sedan and SUV split ten-spoke (both silver, the SUV's on a larger rim), hatch and police five-spoke, muscle slotted mag, pickup six-spoke steel, monster beadlock. */
const REFERENCE_RIMS: Readonly<Record<CarStyleId, WheelDesign>> = {
  sedan: "split10",
  hatchback: "five",
  wagon: "split10l",
  coupe: "mag5",
  pickup: "six",
  police: "five",
  monster: "beadlock",
};

/** Vertex red (linear) under which a tone is dark: between the dark disc's and the alloy's. */
const DARK_RED = 0.2;
/** Angles sampled round each circle, 1 degree apart. */
const RING_SAMPLES = 360;
/** Radius (m) between a mag's slot windows' outer end and its lip, where its dish must show no dark all round. */
const DISH_RADII = [0.178] as const;
/** Radius (m) sampled across a mag's slot windows, outside its hub cap. */
const WINDOW_RADIUS = 0.11;
/** Barycentric slack: a sample on an edge every layer shares (all are 16-sided) must not fall out of both triangles by rounding. */
const EDGE_TOL = 1e-9;
/** The SUV reference's rim lip over its tyre's crown (side view: .74 against the tyre's height, .80 against its own); the road rim's is .675. */
const SUV_RIM_LIP = 0.75;

/** The +x face of `g` as seen from outside: whether the outermost +x-facing triangle over (y, z) is dark; throws where none covers it. */
function outwardFaceDark(g: THREE.BufferGeometry): (y: number, z: number) => boolean {
  const flat = g.toNonIndexed();
  const [pos, nrm, col] = [flat.getAttribute("position"), flat.getAttribute("normal"), flat.getAttribute("color")];
  const faces: { yz: [number, number, number, number, number, number]; x: number; dark: boolean }[] = [];
  for (let t = 0; t < pos.count; t += 3) {
    if (nrm.getX(t) <= 0.9) continue;
    faces.push({ yz: [pos.getY(t), pos.getZ(t), pos.getY(t + 1), pos.getZ(t + 1), pos.getY(t + 2), pos.getZ(t + 2)], x: pos.getX(t), dark: col.getX(t) < DARK_RED });
  }
  return (y, z) => {
    let top: (typeof faces)[number] | null = null;
    for (const f of faces) {
      const [y0, z0, y1, z1, y2, z2] = f.yz;
      const det = (z1 - z2) * (y0 - y2) + (y2 - y1) * (z0 - z2);
      if (det === 0) continue;
      const l0 = ((z1 - z2) * (y - y2) + (y2 - y1) * (z - z2)) / det;
      const l1 = ((z2 - z0) * (y - y2) + (y0 - y2) * (z - z2)) / det;
      if (l0 >= -EDGE_TOL && l1 >= -EDGE_TOL && l0 + l1 <= 1 + EDGE_TOL && (!top || f.x > top.x)) top = f;
    }
    assert.ok(top, `no +x face over y ${y.toFixed(3)} z ${z.toFixed(3)}`);
    return top.dark;
  };
}

describe("given the reference cars' rim designs", () => {
  for (const id of CAR_STYLE_IDS) {
    test(`when a ${id} alone is drawn, then its four wheels are all in its reference design's draw and no other wheel draw holds any`, () => {
      const { batch } = drawnAlone(id);
      const counts = batch.meshes.slice(0, WHEEL_DESIGNS.length).map((m, k) => `${WHEEL_DESIGNS[k]}:${m.count}`);
      assert.equal(counts.filter((c) => !c.endsWith(":0")).join(), `${REFERENCE_RIMS[id]}:4`);
    });
  }

  test("when the designs' wheel geometries are compared, then each is its own shape and the SUV's split ten-spoke is the sedan's silver", () => {
    const { batch } = stage();
    const shapes = batch.meshes.slice(0, WHEEL_DESIGNS.length).map((m) => {
      const p = m.geometry.getAttribute("position");
      let sum = 0;
      for (let i = 0; i < p.count; i++) sum += Math.abs(p.getX(i)) + Math.abs(p.getY(i)) * 3 + Math.abs(p.getZ(i)) * 7;
      return `${p.count}/${sum.toFixed(3)}`;
    });
    assert.equal(new Set(shapes).size, WHEEL_DESIGNS.length, shapes.join(" "));
    assert.ok(STYLE_WHEELS.wagon.tint.getHex() === STYLE_WHEELS.sedan.tint.getHex(), `SUV rim ${STYLE_WHEELS.wagon.tint.getHexString()} against the sedan's silver`);
  });

  test("when the monster's rims are drawn, then they are the reference's dark gunmetal: their tint takes the alloy under a third of its light", () => {
    /** The most of the alloy's linear light the monster's tint keeps (its side plate's rims read ~0x3a-0x64 against the alloy's 0xc9). */
    const GUNMETAL_SHARE = 1 / 3;
    const { r, g, b } = STYLE_WHEELS.monster.tint;
    assert.ok(Math.max(r, g, b) < GUNMETAL_SHARE, `monster rim tint ${STYLE_WHEELS.monster.tint.getHexString()}`);
  });

  test("when the SUV's rim is built, then its lip reaches the reference's share of the tyre and its tyre's bead sits inside the lip, the sedan's rim unchanged", () => {
    const rubber = new THREE.Color(RUBBER[0]).toArray().map(Math.fround);
    const reach = (design: WheelDesign): [number, number] => {
      const g = makeWheelGeometry(design);
      const [pos, col] = [g.getAttribute("position"), g.getAttribute("color")];
      let [lip, bead] = [0, Infinity];
      for (let i = 0; i < pos.count; i++) {
        const r = Math.hypot(pos.getY(i), pos.getZ(i));
        if (col.getX(i) === rubber[0] && col.getY(i) === rubber[1] && col.getZ(i) === rubber[2]) bead = Math.min(bead, r);
        else lip = Math.max(lip, r);
      }
      return [lip / PLATFORM_TYRE.r, bead];
    };
    const [[suvLip, suvBead], [sedanLip]] = [reach("split10l"), reach("split10")];
    assert.ok(suvLip >= SUV_RIM_LIP && suvBead < suvLip * PLATFORM_TYRE.r, `SUV lip ${suvLip.toFixed(3)} of the crown, bead ${suvBead.toFixed(4)} m`);
    assert.ok(Math.abs(sedanLip - 0.216 / PLATFORM_TYRE.r) < 1e-6, `sedan lip ${sedanLip.toFixed(4)} of the crown`);
  });

  test("when the monster's beadlock is built, then its whole rim stands inboard of its tyre's bead and its dish shades as a bowl, tilting toward the axle at its edge", () => {
    const rubber = new THREE.Color(RUBBER[0]).toArray().map(Math.fround);
    const g = makeWheelGeometry("beadlock");
    const [pos, col, nrm] = [g.getAttribute("position"), g.getAttribute("color"), g.getAttribute("normal")];
    let [rimOut, beadR, beadX, dishX, dishTilt] = [0, Infinity, 0, Infinity, 0];
    for (let i = 0; i < pos.count; i++) {
      const [x, r] = [Math.abs(pos.getX(i)), Math.hypot(pos.getY(i), pos.getZ(i))];
      if (col.getX(i) === rubber[0] && col.getY(i) === rubber[1] && col.getZ(i) === rubber[2]) {
        if (r < beadR - 1e-6) [beadR, beadX] = [r, x];
      } else [rimOut, dishX] = [Math.max(rimOut, x), Math.min(dishX, x)];
    }
    // The dish is the face nearest the hub plane (its windows 1 mm proud of it); the hub's stub ends far outboard of both.
    for (let i = 0; i < pos.count; i++) if (Math.abs(Math.abs(pos.getX(i)) - dishX) < 0.002) dishTilt = Math.max(dishTilt, Math.acos(Math.min(1, Math.abs(nrm.getX(i)))));
    assert.ok(rimOut < beadX, `the rim reaches x ${rimOut.toFixed(4)}, the tyre's bead stands at ${beadX.toFixed(4)}`);
    assert.ok(dishTilt > 0.45, `the dish's normals tilt at most ${dishTilt.toFixed(3)} rad`);
  });

  test("when the coupe's slotted mag is built, then its outward face is solid all round between its windows and its lip, and dark only in five windows inside", () => {
    const dark = outwardFaceDark(makeWheelGeometry("mag5"));
    const round = (r: number) => Array.from({ length: RING_SAMPLES }, (_, k) => dark(r * detCos((2 * Math.PI * k) / RING_SAMPLES), r * detSin((2 * Math.PI * k) / RING_SAMPLES)));
    for (const r of DISH_RADII) assert.equal(round(r).filter(Boolean).length, 0, `dark samples round r ${r}`);
    const windows = round(WINDOW_RADIUS);
    const runs = windows.filter((d, k) => d && !windows[(k + 1) % RING_SAMPLES]).length;
    assert.equal(runs, 5, `${windows.filter(Boolean).length} of ${RING_SAMPLES} samples dark round r ${WINDOW_RADIUS}`);
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
