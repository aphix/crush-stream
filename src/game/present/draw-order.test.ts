import { describe, expect, it } from "vitest";
import * as THREE from "three";
import type { RenderItem } from "three";
import { DeformableCar } from "../vehicle/car.ts";
import { drawClassOf } from "../vehicle/car-materials.ts";
import type { CarStyleId } from "../vehicle/car-variants.ts";
import { PartBatch } from "../vehicle/part-batch.ts";
import { sortByDrawClass } from "./draw-order.ts";

/** The sort's keys, most significant first. */
const KEYS = ["groupOrder", "renderOrder", "drawClass", "materialId", "materialVariant", "z", "objectId"] as const;
type Key = (typeof KEYS)[number];

/** A draw whose every key is 5 but those given. */
function draw(keys: Partial<Record<Key, number>>): RenderItem {
  const k = { groupOrder: 5, renderOrder: 5, drawClass: 5, materialId: 5, materialVariant: 5, z: 5, objectId: 5, ...keys };
  const material = { id: k.materialId, userData: { drawClass: k.drawClass } } as unknown as THREE.Material;
  return { id: k.objectId, object: new THREE.Object3D(), geometry: null, material, materialVariant: k.materialVariant, groupOrder: k.groupOrder, renderOrder: k.renderOrder, z: k.z, group: null };
}

const LABELS: Record<Key, string> = {
  groupOrder: "scene group",
  renderOrder: "explicit render order",
  drawClass: "draw class (the shader program a material needs)",
  materialId: "material (older first)",
  materialVariant: "instancing (plain meshes first)",
  z: "depth (nearer first)",
  objectId: "object (older first)",
};

const precedenceCases = KEYS.map((key, rank) => ({
  it: `when two draws differ in ${LABELS[key]} and every lesser rule points the other way, then the lower one draws first`,
  key,
  later: KEYS.slice(rank + 1),
}));

describe("given two opaque draws in one frame", () => {
  for (const testCase of precedenceCases) {
    it(testCase.it, () => {
      const first = draw({ [testCase.key]: 1, ...Object.fromEntries(testCase.later.map((k) => [k, 9])) });
      const second = draw({ [testCase.key]: 9, ...Object.fromEntries(testCase.later.map((k) => [k, 1])) });
      expect(sortByDrawClass(first, second), "the lower one is not first").toBeLessThan(0);
      expect(sortByDrawClass(second, first), "the order is not symmetric").toBeGreaterThan(0);
    });
  }

  it("when the material carries no draw class, then it ranks as class 0, before every classed material", () => {
    const unset = draw({ drawClass: 0 });
    unset.material.userData = {};
    expect(sortByDrawClass(unset, draw({ drawClass: 1 }))).toBeLessThan(0);
  });
});

const fleetStyles: CarStyleId[] = ["sedan", "pickup", "hatchback", "wagon", "coupe", "police"];

/** Every opaque, plain mesh of `cars` as the render list would hold it, in scene order, then the part batch's draws: the plain kinds' instanced meshes and the one styled-kinds `SeatDraw` mesh (the seats' parts are no meshes). */
function opaqueDraws(cars: DeformableCar[]): RenderItem[] {
  const out: RenderItem[] = [];
  for (const car of cars) {
    car.group.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh || (mesh as THREE.InstancedMesh).isInstancedMesh || Array.isArray(mesh.material) || mesh.material.transparent) return;
      out.push({ id: mesh.id, object: mesh, geometry: null, material: mesh.material, materialVariant: 0, groupOrder: 0, renderOrder: mesh.renderOrder, z: 0, group: null });
    });
  }
  const batch = new PartBatch(cars.length);
  for (const mesh of batch.meshes) {
    if (Array.isArray(mesh.material)) continue;
    out.push({ id: mesh.id, object: mesh, geometry: null, material: mesh.material, materialVariant: 0, groupOrder: 0, renderOrder: mesh.renderOrder, z: 0, group: null });
  }
  batch.dispose();
  return out;
}

const runsOf = (draws: RenderItem[], keyOf: (d: RenderItem) => number): number => draws.reduce((n, d, i) => n + (i === 0 || keyOf(d) !== keyOf(draws[i - 1]!) ? 1 : 0), 0);

describe("given a field of cars painted differently", () => {
  it("when their opaque draws are sorted, then the paint, parts and trim draws each run together instead of alternating car by car", () => {
    const cars = Array.from({ length: 12 }, (_, i) => new DeformableCar({ name: `P${i}`, body: 0x202020 + i * 0x101010, accent: 0x303030 + i * 0x080808 }, new THREE.Scene(), null, fleetStyles[i % fleetStyles.length]!));
    const draws = opaqueDraws(cars);
    const idOf = (d: RenderItem): number => (d.material as THREE.Material & { id: number }).id;
    const byMaterialId = draws.slice().sort((a, b) => idOf(a) - idOf(b) || a.id - b.id);
    const byClass = draws.slice().sort(sortByDrawClass);
    const classes = new Set(draws.map((d) => drawClassOf(d.material)));
    expect(classes.has(1) && classes.has(2) && classes.has(3), `classes ${[...classes].join(",")}: paint, parts and trim all appear`).toBeTruthy();
    expect(runsOf(byClass, (d) => drawClassOf(d.material)), "a class is split").toBe(classes.size);
    expect(runsOf(byMaterialId, (d) => drawClassOf(d.material)), "by material id the classes already ran together: the test proves nothing").toBeGreaterThan(2 * classes.size);
    for (const car of cars) car.dispose();
  });
});
