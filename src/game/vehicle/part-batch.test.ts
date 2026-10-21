import assert from "node:assert/strict";
import { after, describe, test } from "node:test";
import * as THREE from "three";
import { CarDetail, DETAIL_LEVELS } from "../present/car-detail.ts";
import { DeformableCar } from "./car.ts";
import { BUMPER_F } from "./constants.ts";
import { INSTANCE_MIRROR_VARIANT_ATTRIBUTE, MIRROR_VARIANT_ATTRIBUTE } from "./car-materials.ts";
import { CAR_STYLES } from "./car-variants.ts";
import { applyDents, DENT_MIN_DV, recordDent } from "./loose-dent.ts";
import { PartBatch } from "./part-batch.ts";
import { PART_KIND, PART_KINDS, partGeometry } from "./part-geometry.ts";
import { assertSameNumbers, paint } from "./test-support.ts";

/** The instance matrix is float32: a seat's position of a few hundred metres is stored within 1e-4 m. */
const FLOAT32_SLACK = 1e-4;
const FAR_BEYOND = DETAIL_LEVELS[0]!.far;
const CARS = 3;
/** The car-space shove a torn part leaves with; any value, the rows read where the part's meshes are, not where it flies. */
const SHOVE = new THREE.Vector3(1.2, 0.6, 0);
/** A unit direction skimming the grille's top corner, off every axis so one grille vertex is furthest against it (the dent's contact). */
const GRILLE_NORMAL = new THREE.Vector3(0.05, -1, -0.02).normalize();
/** A bounce well over the dent threshold, so it is recorded at its full depth (m/s). */
const HARD_BOUNCE = 3 * DENT_MIN_DV;
/** loose-dent's reach (m), which it keeps private: skin within this of the contact moves. */
const DENT_REACH = 0.26;

/** A 50 degree lens at the origin looking down +z; cars stand on the axis at the given distance. */
function stage(capacity = 16) {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(50, 2, 0.1, 900);
  camera.lookAt(0, 0, 1);
  camera.updateMatrixWorld(true);
  const detail = new CarDetail();
  const batch = new PartBatch(capacity);
  const car = (at: number) => {
    const made = new DeformableCar(paint(), scene, null, "sedan");
    made.spawn(0, at, 0);
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

const looseMeshes = (seat: THREE.Object3D): THREE.Mesh[] => seat.children.filter((c): c is THREE.Mesh => c instanceof THREE.Mesh);

const positions = (g: THREE.BufferGeometry): ArrayLike<number> => g.getAttribute("position").array;

describe("given the part batch and a few cars near the camera", () => {
  test("when the cars are synced, then every kind has one instance per car and the parts cost seven draws whatever the car count", () => {
    for (const n of [1, CARS]) {
      const { batch, car, draw } = stage();
      draw(Array.from({ length: n }, () => car(10)));
      assert.equal(batch.meshes.length, PART_KINDS.length);
      for (const kind of PART_KINDS) assert.equal(batch.meshes[kind]!.count, n, `kind ${kind} with ${n} cars`);
      assert.equal(batch.meshes.filter((m) => m.count > 0).length, PART_KINDS.length, `${n} cars draw seven meshes`);
    }
  });

  test("when a car is synced, then its mirror's instance stands where the seat does", () => {
    const { batch, car, draw } = stage();
    const only = car(10);
    draw([only]);
    const matrix = new THREE.Matrix4();
    batch.meshes[PART_KIND.mirrorR]!.getMatrixAt(0, matrix);
    assertSameNumbers(matrix.elements, only.partSeats[PART_KIND.mirrorR]!.matrixWorld.elements, "the mirror instance is the seat's world matrix", FLOAT32_SLACK);
  });

  test("when every kind's mesh is read, then it draws the kind's one shared geometry; a mirror's draws its own, every style's mirror with the platform's first", () => {
    const { batch } = stage();
    for (const kind of PART_KINDS) {
      const mesh = batch.meshes[kind]!;
      if (kind !== PART_KIND.mirrorL && kind !== PART_KIND.mirrorR) {
        assert.equal(mesh.geometry, partGeometry(kind), `kind ${kind} (same object, not equal copies)`);
        continue;
      }
      const platform = positions(partGeometry(kind));
      assertSameNumbers(Array.from(positions(mesh.geometry)).slice(0, platform.length), platform, `kind ${kind}: the platform mirror leads its geometry`);
      assert.equal(mesh.geometry.getAttribute(MIRROR_VARIANT_ATTRIBUTE).getX(0), 0, `kind ${kind}: as variant 0`);
    }
  });
});

describe("given the part batch and a car whose style has its own mirror", () => {
  // Set before the first batch or car reads the fleet's mirror variants; nothing else in this file builds a wagon.
  const wagon = CAR_STYLES.wagon;
  const door = wagon.door;
  wagon.door = { ...door, mirror: { cap: "rounded", finish: "body" } };
  after(() => {
    wagon.door = door;
  });

  test("when it is synced beside a platform-mirror car, then its instance carries its variant and door paint, and the batch's geometry holds its mirror under that variant", () => {
    const { batch, car, draw } = stage();
    const own = new DeformableCar({ ...paint(), body: 0x336699 }, new THREE.Scene(), null, "wagon");
    own.spawn(0, 10, 0);
    draw([car(10), own]);
    const mesh = batch.meshes[PART_KIND.mirrorR]!;
    const seat = own.partSeats[PART_KIND.mirrorR]!;
    const variants = mesh.geometry.getAttribute(INSTANCE_MIRROR_VARIANT_ATTRIBUTE);
    assert.ok(mesh.count === 2 && variants.getX(0) === 0 && seat.variant > 0 && variants.getX(1) === seat.variant, `variants ${variants.getX(0)}, ${variants.getX(1)} of ${seat.variant}`);
    const tint = new THREE.Color();
    mesh.getColorAt(1, tint);
    assert.equal(tint.getHex(), 0x336699, "the instance colour is its door's paint");
    const tagged = mesh.geometry.getAttribute(MIRROR_VARIANT_ATTRIBUTE);
    const at = positions(mesh.geometry);
    const batched = Array.from({ length: tagged.count }, (_, i) => i)
      .filter((i) => tagged.getX(i) === seat.variant)
      .flatMap((i) => [at[i * 3]!, at[i * 3 + 1]!, at[i * 3 + 2]!]);
    assertSameNumbers(batched, Array.from(positions(seat.drawn)), "its variant's vertices are its drawn mirror's");
  });
});

describe("given the part batch and a car whose right mirror snaps off", () => {
  test("when the mirror is torn, then its seat grows a mesh of its own geometry and leaves the mirror batch", () => {
    const { batch, car, draw } = stage();
    const cars = Array.from({ length: CARS }, () => car(10));
    const mirror = cars[0]!.partSeats[PART_KIND.mirrorR]!;
    draw(cars);
    cars[0]!.breakMirror(1, SHOVE);
    draw(cars);
    const own = looseMeshes(mirror);
    assert.equal(own.length, 1, "one loose mesh under the seat");
    assert.notEqual(own[0]!.geometry, partGeometry(PART_KIND.mirrorR), "a clone, so the shared geometry is never disposed with the loose part");
    assert.equal(batch.meshes[PART_KIND.mirrorR]!.count, CARS - 1);
    assert.equal(batch.meshes[PART_KIND.mirrorL]!.count, CARS, "the left mirror stays");
  });

  test("when the torn mirror's car is beyond the far cut, then the seat is back on the camera's layer and so is its mesh", () => {
    const { car, draw } = stage();
    const cars = [car(FAR_BEYOND + 20), car(10), car(10)];
    const mirror = cars[0]!.partSeats[PART_KIND.mirrorR]!;
    draw(cars);
    assert.equal(mirror.layers.isEnabled(0), false, "the control: the far cut took the seat off the camera");
    cars[0]!.breakMirror(1, SHOVE);
    draw(cars);
    assert.equal(mirror.layers.isEnabled(0), true, "the torn seat shows on every camera");
    assert.equal(looseMeshes(mirror)[0]!.layers.isEnabled(0), true, "its mesh too");
  });

  test("when the car is reset and synced, then the seat is back in the batch, keeps its mesh off the seat, and the car's dispose frees that mesh", () => {
    const { batch, car, draw } = stage();
    const cars = Array.from({ length: CARS }, () => car(10));
    const mirror = cars[0]!.partSeats[PART_KIND.mirrorR]!;
    draw(cars);
    cars[0]!.breakMirror(1, SHOVE);
    draw(cars);
    const own = looseMeshes(mirror)[0]!;
    let freed = 0;
    const onFreed = () => void freed++;
    own.geometry.addEventListener("dispose", onFreed);
    cars[0]!.resetVisual();
    draw(cars);
    assert.equal(mirror.loose, false);
    assert.equal(looseMeshes(mirror).length, 0);
    assert.equal(batch.meshes[PART_KIND.mirrorR]!.count, CARS);
    assert.equal(freed, 0, "a re-attached seat keeps its mesh, dents and all, for the next tear");
    cars[0]!.dispose();
    // The mirror seat is reached twice (its own part and its door's), as the old mesh was; three's dispose is idempotent.
    assert.ok(freed >= 1, `the car's dispose frees it while it is off the seat (${freed} dispose events)`);
  });
});

describe("given the part batch and a car that loses a door or its front bumper", () => {
  test("when the right door is torn, then its lining and mirror are loose and leave their batches, the left ones stay", () => {
    const { batch, car, draw } = stage();
    const cars = Array.from({ length: CARS }, () => car(10));
    draw(cars);
    cars[0]!["detachPart"](cars[0]!["doorParts"][1]!, 0, SHOVE);
    draw(cars);
    for (const kind of [PART_KIND.liningR, PART_KIND.mirrorR]) {
      assert.equal(cars[0]!.partSeats[kind]!.loose, true, `kind ${kind} loose`);
      assert.equal(batch.meshes[kind]!.count, CARS - 1, `kind ${kind} left the batch`);
    }
    for (const kind of [PART_KIND.liningL, PART_KIND.mirrorL]) {
      assert.equal(cars[0]!.partSeats[kind]!.loose, false, `kind ${kind} fast`);
      assert.equal(batch.meshes[kind]!.count, CARS, `kind ${kind} stays`);
    }
  });

  test("when the front bumper is torn, then its grille is loose and leaves the batch, the tail trim stays", () => {
    const { batch, car, draw } = stage();
    const cars = Array.from({ length: CARS }, () => car(10));
    draw(cars);
    cars[0]!["detachPart"](cars[0]!["parts"].find((p) => p.name === BUMPER_F)!, 0, SHOVE);
    draw(cars);
    assert.equal(cars[0]!.partSeats[PART_KIND.grille]!.loose, true);
    assert.equal(batch.meshes[PART_KIND.grille]!.count, CARS - 1);
    assert.equal(cars[0]!.partSeats[PART_KIND.tailTrim]!.loose, false);
    assert.equal(batch.meshes[PART_KIND.tailTrim]!.count, CARS);
  });

  test("when the torn bumper is dented at its grille, then only the grille's own mesh moves, within the dent's reach of the contact", () => {
    const { car } = stage();
    const only = car(10);
    const bumper = only["parts"].find((p) => p.name === BUMPER_F)!;
    only["detachPart"](bumper, 0, SHOVE);
    const seat = only.partSeats[PART_KIND.grille]!;
    const shared = positions(partGeometry(PART_KIND.grille));
    const sharedBefore = Float32Array.from(shared);
    // The dent's normal is read in the part's frame; an upright part makes it the one above.
    bumper.object.quaternion.identity();
    recordDent(bumper.dent, bumper.object, GRILLE_NORMAL.clone().multiplyScalar(HARD_BOUNCE));
    applyDents(bumper.dent, bumper.object);
    const dented = positions(looseMeshes(seat)[0]!.geometry);
    const inBumperFrame = (a: ArrayLike<number>, i: number): THREE.Vector3 => new THREE.Vector3(a[i]!, a[i + 1]!, a[i + 2]!).add(seat.position);
    let contact = inBumperFrame(shared, 0);
    for (let i = 3; i < shared.length; i += 3) {
      const v = inBumperFrame(shared, i);
      if (v.dot(GRILLE_NORMAL) < contact.dot(GRILLE_NORMAL)) contact = v;
    }
    let moved = 0;
    for (let i = 0; i < shared.length; i += 3) {
      if (dented[i] === shared[i] && dented[i + 1] === shared[i + 1] && dented[i + 2] === shared[i + 2]) continue;
      moved++;
      const reach = inBumperFrame(shared, i).distanceTo(contact);
      assert.ok(reach < DENT_REACH, `vertex ${i / 3} moved from ${reach.toFixed(3)} m off the contact`);
    }
    assert.ok(moved > 0, "the dent moved nothing on the grille's mesh");
    assertSameNumbers(shared, sharedBefore, "the shared grille positions");
  });
});

describe("given the part batch and a car the distance detail cuts", () => {
  test("when one of three cars is beyond the far distance, then each kind draws the other two only; when it comes back, all three", () => {
    const { batch, car, draw } = stage();
    const cars = [car(10), car(10), car(FAR_BEYOND + 20)];
    draw(cars);
    for (const kind of PART_KINDS) assert.equal(batch.meshes[kind]!.count, CARS - 1, `kind ${kind} while cut`);
    cars[2]!.group.position.z = 12;
    draw(cars);
    for (const kind of PART_KINDS) assert.equal(batch.meshes[kind]!.count, CARS, `kind ${kind} restored`);
  });

  test("when a car is hidden, then its seats draw nothing; when shown again, they do", () => {
    const { batch, car, draw } = stage();
    const cars = [car(10), car(10)];
    cars[1]!.group.visible = false;
    draw(cars);
    for (const kind of PART_KINDS) assert.equal(batch.meshes[kind]!.count, 1, `kind ${kind} while hidden`);
    cars[1]!.group.visible = true;
    draw(cars);
    for (const kind of PART_KINDS) assert.equal(batch.meshes[kind]!.count, 2, `kind ${kind} shown`);
  });
});

describe("given a part batch smaller than the cars it is asked to draw", () => {
  test("when more cars than the capacity are synced, then every kind stops at the capacity", () => {
    const capacity = CARS - 1;
    const { batch, car, draw } = stage(capacity);
    draw(Array.from({ length: CARS }, () => car(10)));
    for (const kind of PART_KINDS) {
      const mesh = batch.meshes[kind]!;
      assert.equal(mesh.count, capacity, `kind ${kind}`);
      assert.equal(mesh.instanceMatrix.count, capacity, "the matrix buffer is the capacity's size, nothing grew");
    }
  });
});

describe("given the part batch is disposed", () => {
  test("when it is disposed, then each mesh is released and the shared geometries are not", () => {
    const { batch, car, draw } = stage();
    draw([car(10)]);
    let meshesFreed = 0;
    let geometriesFreed = 0;
    const onMesh = () => void meshesFreed++;
    const onGeometry = () => void geometriesFreed++;
    for (const mesh of batch.meshes) mesh.addEventListener("dispose", onMesh);
    for (const kind of PART_KINDS) partGeometry(kind).addEventListener("dispose", onGeometry);
    try {
      batch.dispose();
    } finally {
      for (const kind of PART_KINDS) partGeometry(kind).removeEventListener("dispose", onGeometry);
    }
    assert.equal(meshesFreed, PART_KINDS.length);
    assert.equal(geometriesFreed, 0, "the geometry is shared by every car, so the batch never frees it");
    for (const kind of PART_KINDS) assert.ok(partGeometry(kind).getAttribute("position").array.length > 0, `kind ${kind} keeps its positions`);
  });
});
