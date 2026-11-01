import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { ROW_TEXELS } from "./dummy-rig.ts";
import { DummyMesh } from "./ragdoll-mesh.ts";
import { SLOTS } from "./ragdoll-config.ts";
import { flatSystem } from "./ragdoll-throws.test-util.ts";

/** Floats in one slot's row of the bone texture (RGBA a texel). */
const ROW_FLOATS = ROW_TEXELS * 4;
const ORIGIN = new THREE.Vector3();
const TURN = new THREE.Quaternion();

describe("given a dummy mesh of 32 slots with dummies out in slots 0 and 2", () => {
  const passes = ["onBeforeShadow", "onBeforeRender"] as const;

  for (const pass of passes) {
    it(`when the ${pass} hook runs, then the bone texture's next upload is the rows of slots 0 to 2, a range a row, not the 32 rows`, () => {
      const mesh = new DummyMesh(SLOTS);
      mesh.pose(0, 0, ORIGIN, TURN);
      mesh.pose(2, 0, ORIGIN, TURN);
      const ranges = mesh["dolls"].updateRanges;
      Reflect.apply(mesh[pass], mesh, []);
      expect(ranges.length, "ranges").toBe(3);
      expect(ranges.map((r) => r.start / ROW_FLOATS).join(), "the rows they start at").toBe("0,1,2");
      expect(ranges.every((r) => r.count === ROW_FLOATS), "each is one row long").toBe(true);
    });
  }

  it("when the last dummy is hidden, then the next upload is not narrowed to rows no one draws", () => {
    const mesh = new DummyMesh(SLOTS);
    mesh.pose(1, 0, ORIGIN, TURN);
    mesh.hide(1);
    Reflect.apply(mesh.onBeforeRender, mesh, []);
    expect(mesh["dolls"].updateRanges.length, "ranges: a whole upload, if one is due").toBe(0);
  });
});

describe("given a pool with the purse of one dummy out", () => {
  it("when the purses are posed, then the next upload of their instance matrices is the pieces the draw takes, not the 32 sets'", async () => {
    const sys = await flatSystem();
    const purses = sys["purses"]!;
    purses.launch(1, -1, ORIGIN, new THREE.Vector3(0, 0, 6), 7);
    purses.pose(0.5);
    const matrices = purses.mesh.instanceMatrix;
    expect(matrices.updateRanges.length, "ranges").toBe(1);
    expect(matrices.updateRanges[0]!.start, "from the first instance").toBe(0);
    expect(matrices.updateRanges[0]!.count, "the floats of the drawn instances").toBe(purses.mesh.count * 16);
    expect(purses.mesh.count * 16, "of all the pool's").toBeLessThan(matrices.array.length);
    sys.dispose();
  });
});
