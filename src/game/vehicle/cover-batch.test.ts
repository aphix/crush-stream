import { describe, expect, test } from "vitest";
import * as THREE from "three";
import { DETAIL_LEVELS } from "../present/car-detail.ts";
import { CAR_STYLE_IDS } from "./car-variants.ts";
import { CoverBatch } from "./cover-batch.ts";
import { assertSameNumbers, stageBatch } from "./test-support.ts";

/** The batch's matrices are float32: a part a hundred metres out is stored within 1e-4 m. */
const FLOAT32_SLACK = 1e-4;
const NEAR = 10;
const MID = (DETAIL_LEVELS[0]!.mid + DETAIL_LEVELS[0]!.far) / 2;
const FAR = DETAIL_LEVELS[0]!.far + 25;
/** The parts that close a car's openings: both doors, the hood and the boot lid. */
const CLOSERS = 4;
const PANES = 6;

/** Cars stand broadside. */
const stage = (capacity = 4) => stageBatch(() => new CoverBatch(capacity), (b, cars) => b.sync(cars), Math.PI / 2);

/** A part a lane draws this frame: its source geometry and where the lane's skinning puts the part's first vertex in the world. */
type Shown = { source: THREE.BufferGeometry; first: THREE.Vector3 };

/** What a lane draws this frame, read through three's own skinning of the lane mesh. */
function shown(batch: CoverBatch, lane: "paint" | "glass"): Shown[] {
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

describe("given an intact car broadside to the camera, whose far-cut parts are drawn by a shared batch", () => {
  for (const style of CAR_STYLE_IDS) {
    test(`when a ${style} stands ${FAR} m away (the far cut), then both doors, the hood over its engine bay, the boot lid over its boot and all six panes are still drawn, by the cover batch`, () => {
      const { batch, car, draw } = stage();
      const probe = car(FAR, style);
      draw([probe]);
      expect(probe.body.layers.isEnabled(0), "the control: the body draws").toBe(true);
      expect(probe.apertureParts.filter((d) => d.layers.isEnabled(0)).length, "the control: the far cut took the doors and lids").toBe(0);
      expect(`${probe["hood"].layers.isEnabled(0)} ${probe["trunk"].layers.isEnabled(0)}`, "the control: the far cut took the hood and the boot lid").toBe("false false");
      const painted = shown(batch, "paint");
      const glass = shown(batch, "glass");
      for (const door of probe.apertureParts) expect(drawnSomehow(door, painted), `a ${style} door or lid is a hole`).toBeTruthy();
      expect(drawnSomehow(probe["hood"], painted), `the ${style}'s engine bay is open: its hood is not drawn`).toBeTruthy();
      expect(drawnSomehow(probe["trunk"], painted), `the ${style}'s boot is open: its lid is not drawn`).toBeTruthy();
      for (const pane of probe.glassPanes) expect(drawnSomehow(pane.mesh, glass), `the ${style}'s ${pane.name} pane is a hole`).toBeTruthy();
      expect(`${painted.length} ${glass.length}`).toBe(`${CLOSERS} ${PANES}`);
    });
  }

  test(`when it stands ${MID} m away (the mid cut), then its panes draw through the batch and its doors as their own meshes`, () => {
    const { batch, car, draw } = stage();
    const probe = car(MID);
    draw([probe]);
    const glass = shown(batch, "glass");
    expect(probe.glassPanes.filter((g) => g.mesh.layers.isEnabled(0)).length, "the control: the mid cut took the panes").toBe(0);
    for (const door of probe.apertureParts) expect(drawnSomehow(door, []), "a door or lid drawn by its own mesh").toBeTruthy();
    for (const pane of probe.glassPanes) expect(drawnSomehow(pane.mesh, glass), `the ${pane.name} pane is a hole`).toBeTruthy();
    expect(`${shown(batch, "paint").length} ${glass.length}`).toBe(`0 ${PANES}`);
  });

  test(`when it stands ${NEAR} m away, or comes back there from the far cut, then the batch draws nothing of it`, () => {
    const { batch, car, draw } = stage();
    const probe = car(FAR);
    draw([probe]);
    probe.group.position.z = NEAR;
    draw([probe]);
    expect(`${shown(batch, "paint").length} ${shown(batch, "glass").length}`).toBe("0 0");
    expect(`${batch["paint"].mesh.visible} ${batch["glass"].mesh.visible}`, "a lane covering nothing draws nothing").toBe("false false");
    const collapsed = new THREE.Matrix4().makeScale(0, 0, 0);
    for (const c of batch["paint"]["covers"]) expect(c.bone.matrixWorld.equals(collapsed), "a part no car draws there collapses to a point").toBeTruthy();
    for (const door of probe.apertureParts) expect(drawnSomehow(door, []), "its doors and lids draw themselves").toBeTruthy();
  });
});

describe("given a far-cut car that has lost parts, drawn by a shared batch", () => {
  test("when its left door is torn off, then the batch covers neither that door nor the pane it carries: the hole is real", () => {
    const { batch, car, draw } = stage();
    const probe = car(FAR);
    draw([probe]);
    const door = probe["parts"].find((p) => p.name === "doorL")!;
    probe["detachPart"](door, 10);
    draw([probe]);
    const painted = shown(batch, "paint");
    const glass = shown(batch, "glass");
    expect(`${painted.length} ${glass.length}`).toBe(`${CLOSERS - 1} ${PANES - 1}`);
    const sidePane = probe.glassPanes.find((g) => g.name === "doorL")!;
    expect(!glass.some((c) => c.source === sidePane.mesh.geometry), "the torn door's pane is not covered").toBe(true);
    let flying = 0;
    door.object.traverse((o) => void ((o as THREE.Mesh).isMesh && o.layers.isEnabled(0) && flying++));
    expect(flying, "the torn door draws itself in the world").toBeGreaterThanOrEqual(1);
  });

  test("when a pane is shattered, then the batch leaves its opening open", () => {
    const { batch, car, draw } = stage();
    const probe = car(FAR);
    probe.hitGlass("quarterL");
    probe.hitGlass("quarterL");
    draw([probe]);
    const quarter = probe.glassPanes.find((g) => g.name === "quarterL")!;
    expect(quarter.state, "the control").toBe("shattered");
    const glass = shown(batch, "glass");
    expect(glass.length).toBe(PANES - 1);
    expect(!glass.some((c) => c.source === quarter.mesh.geometry)).toBe(true);
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
    expect(drawnSomehow(pane, shown(batch, "glass")), "the cover's first vertex is the moved one, where it stands").toBeTruthy();
  });
});

describe("given a shared batch of far-cut parts with room for one car", () => {
  test("when three fields of three far cars come and go, then every car is covered whole and the old fields' parts leave", () => {
    const { batch, car, draw } = stage(1);
    for (let field = 0; field < 3; field++) {
      const cars = [car(FAR), car(FAR + 5), car(FAR + 10)];
      draw(cars);
      const painted = shown(batch, "paint");
      const glass = shown(batch, "glass");
      for (const c of cars) {
        for (const door of c.apertureParts) expect(drawnSomehow(door, painted), `field ${field}: a door or lid is a hole`).toBeTruthy();
        for (const pane of c.glassPanes) expect(drawnSomehow(pane.mesh, glass), `field ${field}: a pane is a hole`).toBeTruthy();
      }
      expect(`${painted.length} ${glass.length}`).toBe(`${3 * CLOSERS} ${3 * PANES}`);
      for (const c of cars) c.dispose();
    }
  });
});

describe("given a far car whose parts a shared batch draws in two lanes (paint and glass)", () => {
  test("when their buffers are read, then every one keeps three's static usage hint (a dynamic one may sit in host memory the GPU reads every frame)", () => {
    const { batch, car, draw } = stage();
    draw([car(FAR)]);
    const dynamic: string[] = [];
    for (const lane of ["paint", "glass"] as const) {
      const geo = batch[lane].mesh.geometry;
      expect(geo.drawRange.count, `the control: the ${lane} lane holds the car`).toBeGreaterThan(3);
      for (const [name, a] of [...Object.entries(geo.attributes), ["index", geo.index!] as const]) if ((a as THREE.BufferAttribute).usage !== THREE.StaticDrawUsage) dynamic.push(`${lane}.${name}`);
    }
    expect(dynamic.join(",")).toBe("");
  });
});
