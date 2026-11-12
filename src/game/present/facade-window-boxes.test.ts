import * as THREE from "three";
import { afterAll, describe, expect, it } from "vitest";
import { hypot2 } from "../kernel/physics-core.js";
import { DOOR, homeFrontages, LOT_WIDTH } from "../world/openworld/openworld-facade-solids.ts";
import { layOutLots } from "../world/openworld/openworld-lots.ts";
import { buildWindowBoxGeometry } from "./facade-bay-parts.ts";
import { FacadeBays } from "./facade-bays.ts";
import { WINDOW_BOX, windowBoxPlacements } from "./facade-window-boxes.ts";

const lots = layOutLots();
const frontages = homeFrontages(lots.places.slice(0, lots.backdropStart));
const EPSILON = 1e-6;
/** The most triangles one box costs: a trough, its soil, four plants and two blooms. */
const TRIANGLES_MAX = 64;
/** Closer than this in plan (m) and this much in height (m), a box and an air-conditioning unit are on one window (both stand at their window's middle). */
const SAME_WINDOW_PLAN = 0.3;
const SAME_WINDOW_HEIGHT = 0.7;

const windows = [
  { across: -1, width: 1, sill: 4.5, storey: 1 },
  { across: 1, width: 1, sill: 4.5, storey: 1 },
  { across: 1, width: 1, sill: 7.7, storey: 2 },
  { across: 2, width: 0.4, sill: 4.5, storey: 1 },
];

describe("given the windows a style's picture shows", () => {
  it("when the boxes of a storey are placed, then each window of that storey wide enough has one on its sill, less the one an air-conditioning unit holds", () => {
    const all = windowBoxPlacements(windows, 1, null);
    expect(all.map((box) => box.across).join(",")).toBe("-1,1");
    const some = windowBoxPlacements(windows, 1, windows[1]!);
    expect(some.map((box) => box.across).join(",")).toBe("-1");
    expect(windowBoxPlacements(windows, 2, null).map((box) => box.across).join(",")).toBe("1");
    for (const box of all) {
      expect(box.up, "trough under the sill").toBeCloseTo(4.5 - WINDOW_BOX.below, 9);
      expect(box.width, "within the window").toBeCloseTo(WINDOW_BOX.share, 9);
      expect(box.depth).toBe(WINDOW_BOX.depth);
    }
  });
});

describe("given a window box's geometry", () => {
  it("when it is read, then it fits the unit cell against the wall, trough under plants, in a few triangles", () => {
    const geometry = buildWindowBoxGeometry();
    geometry.computeBoundingBox();
    const box = geometry.boundingBox!;
    expect(box.min.x).toBeGreaterThanOrEqual(-0.5 - EPSILON);
    expect(box.max.x).toBeLessThanOrEqual(0.5 + EPSILON);
    expect(box.min.y).toBeGreaterThanOrEqual(-EPSILON);
    expect(box.max.y).toBeLessThanOrEqual(1 + EPSILON);
    expect(box.min.z, "its back on the wall").toBeGreaterThanOrEqual(-EPSILON);
    expect(box.max.z).toBeLessThanOrEqual(1 + EPSILON);
    expect(geometry.getAttribute("position").count / 3).toBeLessThanOrEqual(TRIANGLES_MAX);
    expect(box.max.y - box.min.y, "plants stand over the trough").toBeGreaterThan(0.6);
  });
});

describe("given the kit made for the layout's rowhomes", () => {
  const kit = new FacadeBays(frontages);
  afterAll(() => kit.dispose());
  const boxes = kit.group.getObjectByName("facade-windowBox");
  const aircon = kit.group.getObjectByName("facade-aircon");
  if (!(boxes instanceof THREE.InstancedMesh) || !(aircon instanceof THREE.InstancedMesh)) throw new Error("the kit has no window box or aircon mesh");

  /** Each box instance's middle in the world, its height of foot (m) and its drawn width and depth (m). */
  const boxesRead = (): { x: number; z: number; foot: number; width: number; depth: number }[] => {
    const matrix = new THREE.Matrix4();
    const at = new THREE.Vector3();
    const scale = new THREE.Vector3();
    return Array.from({ length: boxes.count }, (_, index) => {
      boxes.getMatrixAt(index, matrix);
      at.setFromMatrixPosition(matrix);
      scale.setFromMatrixScale(matrix);
      return { x: at.x, z: at.z, foot: at.y, width: scale.x, depth: scale.z };
    });
  };

  it("when the kit is made, then a share of the houses has boxes, each over the doorway's head, in its lot and no deeper than a box is out of the wall", () => {
    const read = boxesRead();
    expect(read.length, "boxes").toBeGreaterThan(0);
    expect(read.length, "a share of the houses").toBeLessThan(frontages.length);
    for (const box of read) {
      expect(box.foot, "foot over the door's head and the stoop").toBeGreaterThan(DOOR.head);
      expect(box.depth).toBeLessThanOrEqual(WINDOW_BOX.depth + EPSILON);
      expect(box.width).toBeLessThan(LOT_WIDTH);
    }
  });

  it("when a box and an air-conditioning unit are read, then no box stands on the window a unit holds", () => {
    const matrix = new THREE.Matrix4();
    const units = Array.from({ length: aircon.count }, (_, index) => {
      aircon.getMatrixAt(index, matrix);
      return new THREE.Vector3().setFromMatrixPosition(matrix);
    });
    expect(units.length, "units").toBeGreaterThan(0);
    for (const box of boxesRead()) {
      for (const unit of units) {
        const sameWindow = hypot2(box.x - unit.x, box.z - unit.z) < SAME_WINDOW_PLAN && Math.abs(box.foot - unit.y) < SAME_WINDOW_HEIGHT;
        expect(sameWindow, `box at ${box.x.toFixed(1)},${box.z.toFixed(1)} over a unit`).toBe(false);
      }
    }
  });
});
