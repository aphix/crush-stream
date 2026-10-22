import assert from "node:assert/strict";
import { describe, test } from "node:test";
import * as THREE from "three";
import { CarDetail, DETAIL_LEVELS } from "../present/car-detail.ts";
import { DeformableCar } from "./car.ts";
import { CAR_STYLE_IDS, type CarStyleId } from "./car-variants.ts";
import { CoverBatch } from "./cover-batch.ts";
import { assertSameNumbers, paint } from "./test-support.ts";

/** The batch's matrices are float32: a part a hundred metres out is stored within 1e-4 m. */
const FLOAT32_SLACK = 1e-4;
const NEAR = 10;
const MID = (DETAIL_LEVELS[0]!.mid + DETAIL_LEVELS[0]!.far) / 2;
const FAR = DETAIL_LEVELS[0]!.far + 25;
const DOORS = 2;
const PANES = 6;

/** A 50 degree lens at the origin looking down +z; cars stand on the axis at the given distance, broadside. */
function stage(capacity = 4) {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(50, 2, 0.1, 900);
  camera.lookAt(0, 0, 1);
  camera.updateMatrixWorld(true);
  const detail = new CarDetail();
  const batch = new CoverBatch(capacity);
  const car = (at: number, style: CarStyleId = "sedan") => {
    const made = new DeformableCar(paint(), scene, null, style);
    made.spawn(0, at, 0);
    made.group.rotation.y = Math.PI / 2;
    made.group.updateMatrixWorld(true);
    return made;
  };
  const draw = (cars: DeformableCar[]) => {
    detail.update(cars, camera, null, null);
    for (const c of cars) c.group.updateMatrixWorld(true);
    batch.sync(cars);
  };
  return { batch, car, draw };
}

/** A part a lane draws this frame: its source geometry and where the lane's skinning puts the part's first vertex in the world. */
type Shown = { source: THREE.BufferGeometry; first: THREE.Vector3 };

/** What a lane draws this frame, read through three's own skinning of the lane mesh. */
function shown(batch: CoverBatch, lane: "doors" | "glass"): Shown[] {
  const l = batch[lane];
  if (!l.mesh.visible) return [];
  l.mesh.skeleton.update();
  return l["covers"].filter((c) => c.seen === l["frame"]).map((c) => ({ source: c.source, first: l.mesh.getVertexPosition(c.vertexStart, new THREE.Vector3()) }));
}

/** Whether the camera draws `part`: its own mesh on layer 0 under no hidden ancestor, or a cover of its geometry where it stands. */
function drawnSomehow(part: THREE.Mesh, covers: readonly Shown[]): boolean {
  if (part.layers.isEnabled(0)) {
    for (let p: THREE.Object3D | null = part; p; p = p.parent) if (!p.visible) return false;
    return true;
  }
  const cover = covers.find((c) => c.source === part.geometry);
  if (cover === undefined) return false;
  const first = new THREE.Vector3().fromBufferAttribute(part.geometry.attributes.position as THREE.BufferAttribute, 0).applyMatrix4(part.matrixWorld);
  assertSameNumbers(cover.first.toArray(), first.toArray(), "the cover stands where the part does", FLOAT32_SLACK);
  return true;
}

describe("given the cover batch and an intact car broadside to the camera", () => {
  for (const style of CAR_STYLE_IDS) {
    test(`when a ${style} stands ${FAR} m away (the far cut), then both doors and all six panes are still drawn, by the cover batch`, () => {
      const { batch, car, draw } = stage();
      const probe = car(FAR, style);
      draw([probe]);
      assert.equal(probe.body.layers.isEnabled(0), true, "the control: the body draws");
      assert.equal(probe.apertureParts.filter((d) => d.layers.isEnabled(0)).length, 0, "the control: the far cut took the doors");
      const doors = shown(batch, "doors");
      const glass = shown(batch, "glass");
      for (const door of probe.apertureParts) assert.ok(drawnSomehow(door, doors), `a ${style} door is a hole`);
      for (const pane of probe.glassPanes) assert.ok(drawnSomehow(pane.mesh, glass), `the ${style}'s ${pane.name} pane is a hole`);
      assert.equal(`${doors.length} ${glass.length}`, `${DOORS} ${PANES}`);
    });
  }

  test(`when it stands ${MID} m away (the mid cut), then its panes draw through the batch and its doors as their own meshes`, () => {
    const { batch, car, draw } = stage();
    const probe = car(MID);
    draw([probe]);
    const glass = shown(batch, "glass");
    assert.equal(probe.glassPanes.filter((g) => g.mesh.layers.isEnabled(0)).length, 0, "the control: the mid cut took the panes");
    for (const door of probe.apertureParts) assert.ok(drawnSomehow(door, []), "a door drawn by its own mesh");
    for (const pane of probe.glassPanes) assert.ok(drawnSomehow(pane.mesh, glass), `the ${pane.name} pane is a hole`);
    assert.equal(`${shown(batch, "doors").length} ${glass.length}`, `0 ${PANES}`);
  });

  test(`when it stands ${NEAR} m away, or comes back there from the far cut, then the batch draws nothing of it`, () => {
    const { batch, car, draw } = stage();
    const probe = car(FAR);
    draw([probe]);
    probe.group.position.z = NEAR;
    draw([probe]);
    assert.equal(`${shown(batch, "doors").length} ${shown(batch, "glass").length}`, "0 0");
    assert.equal(`${batch["doors"].mesh.visible} ${batch["glass"].mesh.visible}`, "false false", "a lane covering nothing draws nothing");
    const collapsed = new THREE.Matrix4().makeScale(0, 0, 0);
    for (const c of batch["doors"]["covers"]) assert.ok(c.bone.matrixWorld.equals(collapsed), "a part no car draws there collapses to a point");
    for (const door of probe.apertureParts) assert.ok(drawnSomehow(door, []), "its door draws itself");
  });
});

describe("given the cover batch and a far-cut car that has lost parts", () => {
  test("when its left door is torn off, then the batch covers neither that door nor the pane it carries: the hole is real", () => {
    const { batch, car, draw } = stage();
    const probe = car(FAR);
    draw([probe]);
    const door = probe["parts"].find((p) => p.name === "doorL")!;
    probe["detachPart"](door, 10);
    draw([probe]);
    const doors = shown(batch, "doors");
    const glass = shown(batch, "glass");
    assert.equal(`${doors.length} ${glass.length}`, `${DOORS - 1} ${PANES - 1}`);
    const sidePane = probe.glassPanes.find((g) => g.name === "doorL")!;
    assert.ok(!glass.some((c) => c.source === sidePane.mesh.geometry), "the torn door's pane is not covered");
    let flying = 0;
    door.object.traverse((o) => void ((o as THREE.Mesh).isMesh && o.layers.isEnabled(0) && flying++));
    assert.ok(flying >= 1, "the torn door draws itself in the world");
  });

  test("when a pane is shattered, then the batch leaves its opening open", () => {
    const { batch, car, draw } = stage();
    const probe = car(FAR);
    probe.hitGlass("quarterL");
    probe.hitGlass("quarterL");
    draw([probe]);
    const quarter = probe.glassPanes.find((g) => g.name === "quarterL")!;
    assert.equal(quarter.state, "shattered", "the control");
    const glass = shown(batch, "glass");
    assert.equal(glass.length, PANES - 1);
    assert.ok(!glass.some((c) => c.source === quarter.mesh.geometry));
  });

  test("when a pane's skin moves (a wreck's crushed windshield), then the batch draws the moved shape", () => {
    const { batch, car, draw } = stage();
    const probe = car(FAR);
    draw([probe]);
    const pane = probe.glassPanes.find((g) => g.name === "windshield")!.mesh;
    const pos = pane.geometry.attributes.position!;
    pos.setY(0, pos.getY(0) - 0.2);
    pos.needsUpdate = true;
    draw([probe]);
    assert.ok(drawnSomehow(pane, shown(batch, "glass")), "the cover's first vertex is the moved one, where it stands");
  });
});

describe("given a cover batch with room for one car", () => {
  test("when three fields of three far cars come and go, then every car is covered whole and the old fields' parts leave", () => {
    const { batch, car, draw } = stage(1);
    for (let field = 0; field < 3; field++) {
      const cars = [car(FAR), car(FAR + 5), car(FAR + 10)];
      draw(cars);
      const doors = shown(batch, "doors");
      const glass = shown(batch, "glass");
      for (const c of cars) {
        for (const door of c.apertureParts) assert.ok(drawnSomehow(door, doors), `field ${field}: a door is a hole`);
        for (const pane of c.glassPanes) assert.ok(drawnSomehow(pane.mesh, glass), `field ${field}: a pane is a hole`);
      }
      assert.equal(`${doors.length} ${glass.length}`, `${3 * DOORS} ${3 * PANES}`);
      for (const c of cars) c.dispose();
    }
  });
});

describe("given the cover batch's lanes holding a far car", () => {
  test("when their buffers are read, then every one keeps three's static usage hint (a dynamic one may sit in host memory the GPU reads every frame)", () => {
    const { batch, car, draw } = stage();
    draw([car(FAR)]);
    const dynamic: string[] = [];
    for (const lane of ["doors", "glass"] as const) {
      const geo = batch[lane].mesh.geometry;
      assert.ok(geo.drawRange.count > 3, `the control: the ${lane} lane holds the car`);
      for (const [name, a] of [...Object.entries(geo.attributes), ["index", geo.index!] as const]) if ((a as THREE.BufferAttribute).usage !== THREE.StaticDrawUsage) dynamic.push(`${lane}.${name}`);
    }
    assert.equal(dynamic.join(","), "");
  });
});
