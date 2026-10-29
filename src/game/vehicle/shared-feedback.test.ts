import { describe, it } from "vitest";
import assert from "node:assert/strict";
import * as THREE from "three";
import { DeformableCar } from "./car.ts";
import { CAR_STYLE_IDS } from "./car-variants.ts";
import { paint } from "./test-support.ts";

// Its own file (one process per file): the cars here are the process's first, so no cache built elsewhere hides a call.
describe("given every body style's car built in a fresh process", () => {
  it("when it is built, then no part of it grows a fresh array through three's shared Vector3.toArray (that sends its stores megamorphic for every per-frame caller)", () => {
    const toArray = THREE.Vector3.prototype.toArray;
    const fresh = new Set<string>();
    let typed = 0;
    THREE.Vector3.prototype.toArray = function (this: THREE.Vector3, ...args: Parameters<typeof toArray>) {
      if (ArrayBuffer.isView(args[0])) typed++;
      else fresh.add((new Error().stack ?? "").split("\n")[2]?.trim() ?? "?");
      return toArray.apply(this, args);
    } as typeof toArray;
    try {
      for (const id of CAR_STYLE_IDS) new DeformableCar(paint(), new THREE.Scene(), null, id);
    } finally {
      THREE.Vector3.prototype.toArray = toArray;
    }
    assert.ok(typed > 0, "the control: the build stores through Vector3.toArray into typed arrays");
    assert.equal([...fresh].join("\n"), "", "Vector3.toArray calls growing a fresh array");
  });
});
