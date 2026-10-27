import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { DeformableCar } from "./car.ts";
import { freshGeometry, ownGeometry, STYLE_PRODUCTS, type StyleProduct } from "./car-templates.ts";
import { CAR_STYLE_IDS, CAR_STYLES, type CarStyleId } from "./car-variants.ts";
import { assertSameDigest, assertSameNumbers, paint } from "./test-support.ts";

function bytesOf(array: ArrayBufferView): Uint8Array {
  return new Uint8Array(array.buffer, array.byteOffset, array.byteLength);
}

function boundsOf(geometry: THREE.BufferGeometry): number[] {
  const { boundingBox: box, boundingSphere: sphere } = geometry;
  return [...(box === null ? [] : [...box.min.toArray(), ...box.max.toArray()]), ...(sphere === null ? [] : [...sphere.center.toArray(), sphere.radius])];
}

/** Every attribute's bytes, usage and item size, the index, groups, draw range, bounds, name and `userData`: the whole of what a build leaves. */
function assertSameGeometry(actual: THREE.BufferGeometry, expected: THREE.BufferGeometry, label: string): void {
  assert.equal(Object.keys(actual.attributes).sort().join(), Object.keys(expected.attributes).sort().join(), `${label}: attribute names`);
  for (const [name, want] of Object.entries(expected.attributes)) {
    const got = actual.getAttribute(name);
    assert.ok(got instanceof THREE.BufferAttribute && want instanceof THREE.BufferAttribute, `${label}: ${name} is a plain attribute`);
    assert.equal(got.itemSize, want.itemSize, `${label}: ${name} item size`);
    assert.equal(got.normalized, want.normalized, `${label}: ${name} normalized`);
    assert.equal(got.usage, want.usage, `${label}: ${name} usage`);
    assert.equal(got.array.constructor, want.array.constructor, `${label}: ${name} array type`);
    assertSameNumbers(bytesOf(got.array), bytesOf(want.array), `${label}: ${name} bytes`);
  }
  assert.equal(actual.index === null, expected.index === null, `${label}: indexed`);
  if (actual.index !== null && expected.index !== null) {
    assert.equal(actual.index.array.constructor, expected.index.array.constructor, `${label}: index type`);
    assertSameNumbers(bytesOf(actual.index.array), bytesOf(expected.index.array), `${label}: index bytes`);
  }
  assert.equal(actual.groups.length, expected.groups.length, `${label}: group count`);
  for (const [i, want] of expected.groups.entries()) {
    assertSameNumbers([actual.groups[i]!.start, actual.groups[i]!.count, actual.groups[i]!.materialIndex ?? -1], [want.start, want.count, want.materialIndex ?? -1], `${label}: group ${i}`);
  }
  assertSameNumbers([actual.drawRange.start, actual.drawRange.count], [expected.drawRange.start, expected.drawRange.count], `${label}: draw range`);
  assert.equal((actual.boundingBox === null) + "," + (actual.boundingSphere === null), (expected.boundingBox === null) + "," + (expected.boundingSphere === null), `${label}: which bounds are computed`);
  assertSameNumbers(boundsOf(actual), boundsOf(expected), `${label}: bounds`);
  assert.equal(actual.name, expected.name, `${label}: name`);
  assertSameDigest(actual.userData, expected.userData, `${label}: userData`);
}

/** Writes over everything a car may write on its geometry, and what a careless one could reach: arrays, index, groups, bounds and every nested `userData` value. */
function scribbleOver(geometry: THREE.BufferGeometry): void {
  for (const attribute of Object.values(geometry.attributes)) bytesOf(attribute.array).fill(0xff);
  if (geometry.index !== null) bytesOf(geometry.index.array).fill(0);
  geometry.addGroup(0, 1, 7);
  geometry.setDrawRange(5, 5);
  geometry.boundingBox?.makeEmpty();
  if (geometry.boundingSphere !== null) geometry.boundingSphere.radius = -1;
  geometry.name = "scribbled";
  scribbleUserData(geometry.userData);
}

function scribbleUserData(value: unknown): void {
  if (ArrayBuffer.isView(value)) bytesOf(value).fill(0xff);
  else if (Array.isArray(value)) value.push(-1);
  else if (value !== null && typeof value === "object") {
    for (const nested of Object.values(value)) scribbleUserData(nested);
    Object.assign(value, { scribbled: true });
  }
}

const styleProductCases = CAR_STYLE_IDS.flatMap((styleId) => STYLE_PRODUCTS.map((product) => ({ styleId, product })));

describe("given a style's geometry built once and copied for each car", () => {
  for (const testCase of styleProductCases) {
    it(`when a car takes the ${testCase.styleId}'s ${testCase.product}, then every array, group, bound and userData value equals a fresh build`, () => {
      const style = CAR_STYLES[testCase.styleId];
      const own = ownGeometry(style, testCase.product);
      assertSameGeometry(own, freshGeometry(style, testCase.product), `${testCase.styleId} ${testCase.product}`);
    });

    it(`when one car writes over its ${testCase.styleId} ${testCase.product}, then the next car's copy, and the copy after it, are still as a fresh build`, () => {
      const style = CAR_STYLES[testCase.styleId];
      const fresh = freshGeometry(style, testCase.product);
      const writer = ownGeometry(style, testCase.product);
      const reader = ownGeometry(style, testCase.product);
      assert.notEqual(writer.getAttribute("position").array, reader.getAttribute("position").array, "the two cars share no position array");
      scribbleOver(writer);
      assertSameGeometry(reader, fresh, `${testCase.styleId} ${testCase.product} beside a scribbled copy`);
      assertSameGeometry(ownGeometry(style, testCase.product), fresh, `${testCase.styleId} ${testCase.product} taken after a scribbled copy`);
    });
  }
});

/** The product each of a car's skinned meshes is built as: the body, the lids, the doors, the six panes and the two bumpers. */
function carProducts(car: DeformableCar): { product: StyleProduct; mesh: THREE.Mesh }[] {
  const { body, hood, trunk, doors, glass, bumpers } = car.lookMeshes();
  return [
    { product: "body", mesh: body },
    { product: "hood", mesh: hood },
    { product: "trunkLid", mesh: trunk },
    { product: "doorLeft", mesh: doors[0]! },
    { product: "doorRight", mesh: doors[1]! },
    { product: "windshield", mesh: glass[0]! },
    { product: "rearGlass", mesh: glass[1]! },
    { product: "doorGlassLeft", mesh: glass[2]! },
    { product: "doorGlassRight", mesh: glass[3]! },
    { product: "quarterGlassLeft", mesh: glass[4]! },
    { product: "quarterGlassRight", mesh: glass[5]! },
    { product: "bumperFront", mesh: bumpers[0]! },
    { product: "bumperRear", mesh: bumpers[1]! },
  ];
}

const cars = new Map<CarStyleId, [DeformableCar, DeformableCar]>();

function carsOf(styleId: CarStyleId): [DeformableCar, DeformableCar] {
  const scene = new THREE.Scene();
  const pair: [DeformableCar, DeformableCar] = [new DeformableCar(paint(), scene, null, styleId), new DeformableCar(paint(), scene, null, styleId)];
  cars.set(styleId, pair);
  return pair;
}

describe("given two cars built of one style", () => {
  for (const styleId of CAR_STYLE_IDS) {
    it(`when each ${styleId} mesh is compared with its style's product, then both cars drew the same bytes the builder makes`, () => {
      const [first, second] = carsOf(styleId);
      for (const car of [first, second]) {
        for (const { product, mesh } of carProducts(car)) {
          const fresh = freshGeometry(CAR_STYLES[styleId], product);
          assertSameNumbers(bytesOf(mesh.geometry.getAttribute("position").array), bytesOf(fresh.getAttribute("position").array), `${styleId} ${product} positions`);
          assertSameNumbers(bytesOf(mesh.geometry.index!.array), bytesOf(fresh.index!.array), `${styleId} ${product} index`);
        }
      }
    });

    it(`when the first ${styleId} car's skin geometry is written over, then the second car's positions, normals, index and userData are untouched`, () => {
      const [first, second] = cars.get(styleId) ?? carsOf(styleId);
      const written = carProducts(first);
      const read = carProducts(second);
      const before = read.map(({ mesh }) => ({ parts: [...Object.values(mesh.geometry.attributes).map((a) => bytesOf(a.array).slice()), bytesOf(mesh.geometry.index!.array).slice()], userData: JSON.stringify(mesh.geometry.userData) }));
      for (const [k, { product, mesh }] of written.entries()) {
        assert.notEqual(mesh.geometry, read[k]!.mesh.geometry, `${product}: one geometry per car`);
        scribbleOver(mesh.geometry);
      }
      for (const [k, { product, mesh }] of read.entries()) {
        const now = [...Object.values(mesh.geometry.attributes).map((a) => bytesOf(a.array)), bytesOf(mesh.geometry.index!.array)];
        for (const [part, bytes] of before[k]!.parts.entries()) assertSameNumbers(now[part]!, bytes, `${styleId} ${product} part ${part} after the other car was written over`);
        assert.equal(JSON.stringify(mesh.geometry.userData), before[k]!.userData, `${styleId} ${product} userData after the other car was written over`);
      }
    });

    it(`when the first ${styleId} car is disposed, then the second car's geometries are not and a third car still takes a copy`, () => {
      const [first, second] = carsOf(styleId);
      let disposed = 0;
      for (const { mesh } of carProducts(second)) mesh.geometry.addEventListener("dispose", () => disposed++);
      first.dispose();
      assert.equal(disposed, 0, "the second car's geometries stay live");
      const third = new DeformableCar(paint(), new THREE.Scene(), null, styleId);
      assert.equal(carProducts(third).length, STYLE_PRODUCTS.length - 1, "the third car has its meshes");
      third.dispose();
      second.dispose();
    });
  }
});

/** Every mesh and line a car holds, in scene order: the body, lids, doors, panes, trims, bumpers, the light bar and the hull overlay. */
function geometriesOf(car: DeformableCar): THREE.BufferGeometry[] {
  const found: THREE.BufferGeometry[] = [];
  car.group.traverse((object) => {
    if (object instanceof THREE.Mesh || object instanceof THREE.LineSegments) found.push(object.geometry);
  });
  return found;
}

describe("given a car of each style built with its style's templates retired and a second built from the templates the first made", () => {
  for (const styleId of CAR_STYLE_IDS) {
    it(`when every geometry of the two ${styleId} cars is compared, then each equals its twin in attributes, index, groups, draw range, bounds and userData`, () => {
      const style = CAR_STYLES[styleId];
      style.door = { ...style.door };
      const cold = new DeformableCar({ name: "cold", body: 0x808080, accent: 0x404040 }, new THREE.Scene(), null, styleId);
      const warm = new DeformableCar({ name: "warm", body: 0xc5c8ce, accent: 0x9aa0a8 }, new THREE.Scene(), null, styleId);
      const [coldGeometries, warmGeometries] = [geometriesOf(cold), geometriesOf(warm)];
      assert.equal(warmGeometries.length, coldGeometries.length, `${styleId}: geometries held`);
      assert.ok(coldGeometries.length >= STYLE_PRODUCTS.length, `${styleId}: the cars hold their geometries (${coldGeometries.length})`);
      for (const [k, geometry] of coldGeometries.entries()) assertSameGeometry(warmGeometries[k]!, geometry, `${styleId} geometry ${k}`);
      cold.dispose();
      warm.dispose();
    });
  }
});

describe("given a style whose door field is replaced after its templates were built", () => {
  it("when a car takes the door again, then it follows the new field and not the old template", () => {
    const style = { ...CAR_STYLES.sedan };
    const before = ownGeometry(style, "doorLeft");
    style.door = { ...style.door, halfHeight: style.door.halfHeight + 0.05 };
    const after = ownGeometry(style, "doorLeft");
    assertSameGeometry(after, freshGeometry(style, "doorLeft"), "the replaced door");
    assert.notEqual(bytesOf(after.getAttribute("position").array).join(), bytesOf(before.getAttribute("position").array).join(), "the taller door is a different skin");
  });
});
