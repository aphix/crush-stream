import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { SMALL_PART_SEAT } from "./constants.ts";
import { buildCar, drawnGeometry } from "./drawn-body.test-util.ts";
import { drawnDoorCard } from "./car-door-mesh.ts";
import { applyCarFinish, finishedMaterials } from "./car-finish.ts";
import { coplanarOverlaps, GAP_M, type Item } from "./coplanar.test-util.ts";
import { PART_KIND, PartSeat } from "./part-geometry.ts";
import { CAR_STYLE_IDS, CAR_STYLES } from "./car-variants.ts";
import type { DeformableCar } from "./car.ts";
import { STYLE_CLASS } from "./vehicle-classes.ts";

/** Seen overlap (cm²) a pair may keep: a shut line's sliver where two shells meet tangent (the largest left, 10 cm², is the police push bar's junction). The flickers found were 295 cm² and up. */
const MAX_OVERLAP_CM2 = 20;

/** What the car draws opaque, in its own frame: the exterior shells and small parts to test, the interior and undercarriage as `hides` (they hide what lies behind them, as the cabin hides the body's inner faces). */
function drawnItems(car: DeformableCar): Item[] {
  car.flushDeferredSkin();
  car.updateSkin();
  car.group.updateMatrixWorld(true);
  const inverse = car.group.matrixWorld.clone().invert();
  const look = car.lookMeshes();
  const names = new Map<THREE.Object3D, string>([
    [look.body, "body"],
    [look.hood, "hood"],
    [look.trunk, "trunk"],
  ]);
  for (let i = 0; i < look.doors.length; i++) names.set(look.doors[i]!, `door${i}`);
  for (let i = 0; i < look.bumpers.length; i++) names.set(look.bumpers[i]!, `bumper${i}`);
  const kindNames = Object.fromEntries(Object.entries(PART_KIND).map(([name, kind]) => [kind, name]));
  const items: Item[] = [];
  const v = new THREE.Vector3();
  const m = new THREE.Matrix4();
  car.group.traverse((o) => {
    // The part batch draws a seat's door card as `drawnDoorCard` (inside every style's door skin), not as the seat's platform box.
    const card = o instanceof PartSeat && (o.kind === PART_KIND.liningL || o.kind === PART_KIND.liningR);
    const geometry = card ? drawnDoorCard(o.kind === PART_KIND.liningL ? -1 : 1) : drawnGeometry(o);
    if (geometry === null) return;
    const hides = o instanceof PartSeat && o.name !== SMALL_PART_SEAT;
    if (o instanceof THREE.Mesh && (o.material as THREE.Material).side === THREE.DoubleSide) return;
    for (let p: THREE.Object3D | null = o; p; p = p.parent) if (p.name === "deform-rig" || !p.visible) return;
    const pos = geometry.getAttribute("position");
    const index = geometry.index;
    const n = index ? index.count : pos.count;
    const tris = new Float64Array(n * 3);
    m.multiplyMatrices(inverse, o.matrixWorld);
    const order = m.determinant() < 0 ? [0, 2, 1] : [0, 1, 2];
    for (let k = 0; k < n; k += 3) {
      for (let c = 0; c < 3; c++) {
        const at = k + order[c]!;
        v.fromBufferAttribute(pos, index ? index.getX(at) : at).applyMatrix4(m);
        tris.set([v.x, v.y, v.z], (k + c) * 3);
      }
    }
    items.push({ name: names.get(o) ?? (o instanceof PartSeat ? `part:${kindNames[o.kind]}` : `mesh:${o.parent?.name ?? ""}`), tris, self: look.bumpers.includes(o as THREE.Mesh), hides });
  });
  return items;
}

/** One unit quad as a flat item at height `z`, facing up or down. */
function quad(name: string, z: number, up: boolean): Item {
  const [a, b, c, d] = [[0, 0, z], [1, 0, z], [1, 1, z], [0, 1, z]];
  return { name, tris: Float64Array.from((up ? [a, b, c, a, c, d] : [a, c, b, a, d, c]).flat()) };
}

describe("given the exterior a car draws", () => {
  it("when quads share a plane, then the finder reports their overlap, and not a quad 2 mm over, one facing away or one a wall hides", () => {
    const found = coplanarOverlaps([quad("a", 0, true), quad("b", 0.0001, true), quad("c", 0.002, true), quad("d", 0, false)]);
    expect([...found.keys()], "a and b fight, over c").toEqual([]);
    const open = coplanarOverlaps([quad("a", 0, true), quad("b", 0.0001, true), quad("d", 0, false)]);
    expect([...open.keys()], "with nothing over them, a and b fight").toEqual(["a|b"]);
    expect(open.get("a|b")!, "a unit quad is 10000 cm²").toBeCloseTo(10000, 0);
  });

  for (const id of CAR_STYLE_IDS) {
    it(`when ${id}'s parts lie over its body, then no two of its faces facing one way stand within ${GAP_M * 1000} mm of a plane over ${MAX_OVERLAP_CM2} cm², seen, in a bumper's own inlays or in a door card`, () => {
      const items = drawnItems(buildCar(id, STYLE_CLASS[id]));
      const over = (found: Map<string, number>, keep: (pair: string) => boolean) =>
        [...found.entries()].filter(([pair, cm2]) => cm2 > MAX_OVERLAP_CM2 && keep(pair)).map(([pair, cm2]) => `${pair} ${cm2.toFixed(0)} cm²`);
      const seen = over(coplanarOverlaps(items, MAX_OVERLAP_CM2), () => true);
      // A bumper's inlay is hidden under a tailgate's overhang from every ray the finder sends, yet hangs, tears off and flies with the bumper: its own layers count unseen too. So do the door cards, whose inner side an open door shows.
      const own = (pair: string) => (pair.split("|")[0] === pair.split("|")[1] && pair.startsWith("bumper")) || pair.includes("lining");
      const unseen = over(coplanarOverlaps(items, MAX_OVERLAP_CM2, false), own);
      expect({ seen, unseen }).toEqual({ seen: [], unseen: [] });
    });
  }

  it("when the finish is on, then a chrome bumper wears no rubber grain and a body-trim one does", () => {
    const chrome = CAR_STYLE_IDS.filter((id) => CAR_STYLES[id].bumpers.front.trim === "chrome" || CAR_STYLES[id].bumpers.rear.trim === "chrome");
    expect(chrome.length, "the muscle and the truck have chrome bumpers").toBeGreaterThanOrEqual(2);
    const grained: string[] = [];
    for (const id of chrome) {
      const car = buildCar(id, STYLE_CLASS[id]);
      applyCarFinish(car.group, true);
      const finished = finishedMaterials(car.group);
      const bumpers = car.lookMeshes().bumpers;
      for (let i = 0; i < bumpers.length; i++) if ([CAR_STYLES[id].bumpers.front, CAR_STYLES[id].bumpers.rear][i]!.trim === "chrome" && finished.has(bumpers[i]!.material as THREE.Material)) grained.push(`${id} bumper ${i}`);
    }
    expect(grained).toEqual([]);
    const sedan = buildCar("sedan", STYLE_CLASS.sedan);
    applyCarFinish(sedan.group, true);
    expect(finishedMaterials(sedan.group).has(sedan.lookMeshes().bumpers[0]!.material as THREE.Material), "a body-trim bumper keeps its grain").toBeTruthy();
  });
});
