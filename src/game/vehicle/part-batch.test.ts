import assert from "node:assert/strict";
import { after, describe, test } from "node:test";
import * as THREE from "three";
import { CarDetail, DETAIL_LEVELS } from "../present/car-detail.ts";
import { DeformableCar } from "./car.ts";
import { BUMPER_F } from "./constants.ts";
import { CAR_STYLES, CAR_STYLE_IDS, type CarStyleId } from "./car-variants.ts";
import { applyDents, DENT_MIN_DV, recordDent } from "./loose-dent.ts";
import { PartBatch } from "./part-batch.ts";
import { drawnDoorCard } from "./car-door-mesh.ts";
import { cageInterior } from "./interior-geometry.ts";
import { PART_KIND, PART_KINDS, PART_PER_CAR, partGeometry, type PartKind } from "./part-geometry.ts";
import { partBatchGeometries } from "./part-variants.ts";
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
/** Seats of a kind one car at rest draws: its `PART_PER_CAR`, and none of the bay or the crash bars (hood and bumpers on), nor a lifted truck's undercarriage (a sedan has none). */
const atRest = (kind: number): number => (kind === PART_KIND.engineBay || kind === PART_KIND.crashBar || kind === PART_KIND.ladderFrame || kind === PART_KIND.axle ? 0 : PART_PER_CAR[kind]!);
/** The kinds a style may draw its own way: `PartBatch.styled` draws them, their variants lying in `styled.variants` in this order. */
const STYLED: readonly PartKind[] = [PART_KIND.mirrorL, PART_KIND.mirrorR, PART_KIND.grille, PART_KIND.tailTrim];

/** Where styled `kind`'s variants lie in `PartBatch.styled.variants` ([first, end)): after those of the styled kinds before it, the platform part first. */
function variantRange(kind: PartKind): [number, number] {
  let first = 0;
  for (const k of STYLED) {
    const end = first + partBatchGeometries(k)!.length;
    if (k === kind) return [first, end];
    first = end;
  }
  throw new Error(`kind ${kind} is not drawn by the styled draw`);
}

/** The rows of `batch.styled` drawing one of styled `kind`'s variants, in pack order. */
function rowsOf(batch: PartBatch, kind: PartKind): number[] {
  const [first, end] = variantRange(kind);
  const rows: number[] = [];
  for (let row = 0; row < batch.styled.count; row++) {
    const variant = batch.styled.variantAt(row);
    if (variant >= first && variant < end) rows.push(row);
  }
  return rows;
}

/** A 50 degree lens at the origin looking down +z; cars stand on the axis at the given distance. */
function stage(capacity = 16) {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(50, 2, 0.1, 900);
  camera.lookAt(0, 0, 1);
  camera.updateMatrixWorld(true);
  const detail = new CarDetail();
  const batch = new PartBatch(capacity);
  const car = (at: number, style: CarStyleId = "sedan") => {
    const made = new DeformableCar(paint(), scene, null, style);
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
  test("when the cars are synced, then every kind shown at rest has its seats per car, the bay and crash bars none, and the parts cost one draw per shown plain kind plus one for all the styled kinds, whatever the car count", () => {
    for (const n of [1, CARS]) {
      const { batch, car, draw } = stage();
      draw(Array.from({ length: n }, () => car(10)));
      assert.equal(batch.kinds.length, PART_KINDS.length);
      for (const kind of PART_KINDS) assert.equal(batch.drawn(kind), n * atRest(kind), `kind ${kind} with ${n} cars`);
      assert.equal(PART_KINDS.filter((k) => batch.drawn(k) > 0).length, PART_KINDS.filter((k) => atRest(k) > 0).length, `${n} cars draw ten kinds`);
      // Old: one mesh per styled variant drawn, so ten for ten kinds of one style; the four styled kinds are now the one `SeatDraw`: six plain meshes plus it.
      const draws = batch.kinds.filter((m) => m !== null && m.count > 0).length + (batch.styled.triangles > 0 ? 1 : 0);
      assert.equal(draws, PART_KINDS.filter((k) => atRest(k) > 0 && !STYLED.includes(k)).length + 1, `${n} cars of one style draw seven meshes`);
    }
  });

  test("when undamaged cars are synced, then their shadows are one instanced caster per style, holding each car's rest caster where the car stands, and a car beyond the far cut still casts", () => {
    const { batch, car, draw } = stage();
    const cars = [car(10), car(20), car(FAR_BEYOND + 20)];
    draw(cars);
    const sedan = batch.casters.find((m) => m.name === "shadow-caster-sedan")!;
    assert.equal(sedan.count, cars.length, "one instance per undamaged sedan");
    assert.ok(sedan.geometry === cars[0]!.restCaster, "the batch draws the sedan's rest caster");
    assert.ok(sedan.castShadow, "the batch casts");
    assert.equal(batch.casters.filter((m) => m.count > 0).length, 1, "one caster draw for a field of one style");
    const m = new THREE.Matrix4();
    sedan.getMatrixAt(1, m);
    assertSameNumbers(m.elements, cars[1]!.group.matrixWorld.elements, "the second sedan's caster instance", FLOAT32_SLACK);
  });

  test("when a car is synced, then its mirror's row stands where the seat does", () => {
    const { batch, car, draw } = stage();
    const only = car(10);
    draw([only]);
    const matrix = new THREE.Matrix4();
    const seat = only.partSeats[PART_KIND.mirrorR]!;
    const rows = rowsOf(batch, PART_KIND.mirrorR);
    assert.equal(rows.length, 1, "one mirror row");
    assert.equal(batch.styled.variantAt(rows[0]!), variantRange(PART_KIND.mirrorR)[0] + seat.variant, "the row draws the seat's variant");
    batch.styled.matrixAt(rows[0]!, matrix);
    assertSameNumbers(matrix.elements, seat.matrixWorld.elements, "the mirror row is the seat's world matrix", FLOAT32_SLACK);
  });

  test("when every kind's draws are read, then it draws the kind's one shared geometry (a door card's: the one inside every door skin), or, for a kind a style draws its own way (mirrors, grille, tail trim), has no draw of its own and its variants in the one styled draw start with the platform part", () => {
    const { batch } = stage();
    for (const kind of PART_KINDS) {
      const mesh = batch.kinds[kind];
      if (!STYLED.includes(kind)) {
        const card = kind === PART_KIND.liningL ? -1 : kind === PART_KIND.liningR ? 1 : 0;
        // Identity, never a deep compare: a geometry holds big typed arrays.
        assert.ok(mesh !== null && mesh.geometry === (card !== 0 ? drawnDoorCard(card) : partGeometry(kind)), `kind ${kind} draws one shape once (same object, not equal copies)`);
        continue;
      }
      assert.ok(mesh === null, `kind ${kind}: the styled draw holds it, no draw of its own`);
      const [first, end] = variantRange(kind);
      assert.ok(end - first > 1, `kind ${kind}: a variant per own shape`);
      assertSameNumbers(positions(batch.styled.variants[first]!), positions(partGeometry(kind)), `kind ${kind}: the platform part is its variant 0`);
    }
    assert.equal(batch.styled.variants.length, variantRange(STYLED[STYLED.length - 1]!)[1], "the styled draw holds every styled kind's variants and no more");
  });
});

describe("given the part batch and one car of each style", () => {
  const tris = (g: THREE.BufferGeometry): number => (g.index ? g.index.count : g.getAttribute("position").count) / 3;

  // Runs while the wagon's own mirror (set when the describe below registers, put back after its rows) is on, as the fleet table was built with it.
  test("when one car of each style is synced, then its styled parts bill only their own triangles, not the fleet's variants", () => {
    for (const id of CAR_STYLE_IDS) {
      const { batch, car, draw } = stage(1);
      const only = car(10, id);
      draw([only]);
      let expected = 0;
      for (const kind of STYLED) {
        const n = batch.drawn(kind);
        const rows = rowsOf(batch, kind);
        const own = tris(only.partSeats[kind]!.drawn);
        assert.ok(n <= 1, `${id} kind ${kind}: ${n} seats drawn for one car`);
        assert.equal(rows.length, n, `${id} kind ${kind}: a row per seat drawn`);
        for (const row of rows) assert.equal(tris(batch.styled.variants[batch.styled.variantAt(row)]!), own, `${id} kind ${kind}: the seat bills its own variant's triangles`);
        expected += n * own;
      }
      assert.equal(batch.styled.triangles, expected, `${id}: the styled draw bills ${batch.styled.triangles} triangles for ${expected} of its own`);
      batch.dispose();
    }
  });
});

describe("given the part batch and a car whose style has its own mirror", () => {
  // Set before the first batch or car reads the fleet's mirror variants; the per-style row above builds a wagon too, and runs while this mirror is set.
  const wagon = CAR_STYLES.wagon;
  const door = wagon.door;
  wagon.door = { ...door, mirror: { cap: "rounded", finish: "body" } };
  after(() => {
    wagon.door = door;
  });

  test("when it is synced beside a platform-mirror car, then its mirror draws in its own variant, painted its door's colour, and that draw's geometry is its mirror", () => {
    const { batch, draw } = stage();
    // Every real style carries its own mirror now: the neighbour is a hatchback stripped of its own for its build, so it draws the platform's.
    const hatch = CAR_STYLES.hatchback;
    const hatchDoor = hatch.door;
    hatch.door = { ...hatchDoor, mirror: undefined };
    let plain: DeformableCar;
    try {
      plain = new DeformableCar(paint(), new THREE.Scene(), null, "hatchback");
    } finally {
      hatch.door = hatchDoor;
    }
    plain.spawn(0, 10, 0);
    const own = new DeformableCar({ ...paint(), body: 0x336699 }, new THREE.Scene(), null, "wagon");
    own.spawn(0, 10, 0);
    draw([plain, own]);
    const seat = own.partSeats[PART_KIND.mirrorR]!;
    const rows = rowsOf(batch, PART_KIND.mirrorR);
    const { styled } = batch;
    assert.ok(seat.variant > 0, `the control: the wagon's mirror is variant ${seat.variant}`);
    assert.equal(batch.drawn(PART_KIND.mirrorR), 2, "both cars' mirrors draw");
    assert.equal(rows.length, 2, "one row each");
    assert.equal(styled.variantAt(rows[0]!), variantRange(PART_KIND.mirrorR)[0], "the platform-mirror neighbour draws as variant 0, alone");
    assert.equal(styled.variantAt(rows[1]!), variantRange(PART_KIND.mirrorR)[0] + seat.variant, "the wagon's mirror draws in its own variant, alone");
    assert.equal(styled.colorAt(rows[1]!, new THREE.Color()).getHex(), 0x336699, "the seat colour is its door's paint");
    assertSameNumbers(positions(styled.variants[styled.variantAt(rows[1]!)]!), positions(seat.drawn), "its variant's vertices are its drawn mirror's");
  });

  test("when the cage interior is built, then its steering wheel is on the car's left (+x), the driver's side", () => {
    const attr = cageInterior().getAttribute("position");
    let count = 0;
    let sumX = 0;
    // Only the wheel torus lies here: the dash is at |x| 0.41, the seats and their backs are lower or further back.
    for (let i = 0; i < attr.count; i++) {
      const x = attr.getX(i);
      const y = attr.getY(i);
      const z = attr.getZ(i);
      if (Math.abs(x) < 0.38 && y > 0.55 && y < 0.8 && z > 0.2 && z < 0.5) {
        count++;
        sumX += x;
      }
    }
    assert.ok(count > 0, "the wheel's vertices were found");
    assert.ok(sumX / count > 0.15, `the wheel's mean car-local x is ${(sumX / count).toFixed(2)}`);
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
    assert.equal(batch.drawn(PART_KIND.mirrorR), CARS - 1);
    assert.equal(batch.drawn(PART_KIND.mirrorL), CARS, "the left mirror stays");
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
    assert.equal(batch.drawn(PART_KIND.mirrorR), CARS);
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
      assert.equal(batch.drawn(kind), CARS - 1, `kind ${kind} left the batch`);
    }
    for (const kind of [PART_KIND.liningL, PART_KIND.mirrorL]) {
      assert.equal(cars[0]!.partSeats[kind]!.loose, false, `kind ${kind} fast`);
      assert.equal(batch.drawn(kind), CARS, `kind ${kind} stays`);
    }
  });

  test("when the front bumper is torn, then its grille is loose and leaves the batch, the tail trim stays", () => {
    const { batch, car, draw } = stage();
    const cars = Array.from({ length: CARS }, () => car(10));
    draw(cars);
    cars[0]!["detachPart"](cars[0]!["parts"].find((p) => p.name === BUMPER_F)!, 0, SHOVE);
    draw(cars);
    assert.equal(cars[0]!.partSeats[PART_KIND.grille]!.loose, true);
    assert.equal(batch.drawn(PART_KIND.grille), CARS - 1);
    assert.equal(cars[0]!.partSeats[PART_KIND.tailTrim]!.loose, false);
    assert.equal(batch.drawn(PART_KIND.tailTrim), CARS);
  });

  test("when the torn bumper is dented at its grille, then only the grille's own mesh moves, within the dent's reach of the contact", () => {
    const { car } = stage();
    // The cop's bumper carries no seam cover, so its grille is the top the dent meets from above.
    const only = car(10, "police");
    const bumper = only["parts"].find((p) => p.name === BUMPER_F)!;
    only["detachPart"](bumper, 0, SHOVE);
    const seat = only.partSeats[PART_KIND.grille]!;
    const shared = positions(seat.drawn);
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
    for (const kind of PART_KINDS) assert.equal(batch.drawn(kind), (CARS - 1) * atRest(kind), `kind ${kind} while cut`);
    cars[2]!.group.position.z = 12;
    draw(cars);
    for (const kind of PART_KINDS) assert.equal(batch.drawn(kind), CARS * atRest(kind), `kind ${kind} restored`);
  });

  test("when a car is hidden, then its seats draw nothing; when shown again, they do", () => {
    const { batch, car, draw } = stage();
    const cars = [car(10), car(10)];
    cars[1]!.group.visible = false;
    draw(cars);
    for (const kind of PART_KINDS) assert.equal(batch.drawn(kind), atRest(kind), `kind ${kind} while hidden`);
    cars[1]!.group.visible = true;
    draw(cars);
    for (const kind of PART_KINDS) assert.equal(batch.drawn(kind), 2 * atRest(kind), `kind ${kind} shown`);
  });
});

describe("given a part batch smaller than the cars it is asked to draw", () => {
  test("when more cars than the capacity are synced, then every kind stops at the capacity", () => {
    const capacity = CARS - 1;
    const { batch, car, draw } = stage(capacity);
    draw(Array.from({ length: CARS }, () => car(10)));
    for (const kind of PART_KINDS) {
      assert.equal(batch.drawn(kind), capacity * atRest(kind), `kind ${kind}`);
      const mesh = batch.kinds[kind];
      if (mesh) assert.equal(mesh.instanceMatrix.count, capacity * PART_PER_CAR[kind]!, `kind ${kind}: the matrix buffer is the capacity's size, nothing grew`);
    }
    assert.equal(batch.styled.capacity, STYLED.reduce<number>((n, kind) => n + capacity * PART_PER_CAR[kind]!, 0), "the styled draw's seat room is the capacity's size, nothing grew");
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
    const instanced = batch.meshes.filter((m): m is THREE.InstancedMesh => (m as THREE.InstancedMesh).isInstancedMesh);
    assert.equal(instanced.length, PART_KINDS.length - STYLED.length, "the control: every plain kind has its instanced mesh");
    for (const mesh of instanced) mesh.addEventListener("dispose", onMesh);
    // The styled draw is a plain Mesh with no dispose event: what it frees is its own geometry and material.
    batch.styled.mesh.geometry.addEventListener("dispose", onMesh);
    (batch.styled.mesh.material as THREE.Material).addEventListener("dispose", onMesh);
    for (const kind of PART_KINDS) partGeometry(kind).addEventListener("dispose", onGeometry);
    try {
      batch.dispose();
    } finally {
      for (const kind of PART_KINDS) partGeometry(kind).removeEventListener("dispose", onGeometry);
    }
    assert.equal(meshesFreed, instanced.length + 2, "every instanced mesh, and the styled draw's geometry and material");
    assert.equal(geometriesFreed, 0, "the geometry is shared by every car, so the batch never frees it");
    for (const kind of PART_KINDS) assert.ok(partGeometry(kind).getAttribute("position").array.length > 0, `kind ${kind} keeps its positions`);
  });
});
