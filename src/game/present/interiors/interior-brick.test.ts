import { createHash } from "node:crypto";
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { brick } from "./interior-brick.ts";

const digest = (array: ArrayLike<number> & { buffer: ArrayBufferLike; byteOffset: number; byteLength: number }): string => createHash("sha1").update(Buffer.from(array.buffer, array.byteOffset, array.byteLength)).digest("hex");
/** A corner's coordinates weighted by where they stand in the array: moved, scaled or swapped corners all read differently. */
const weighted = (position: ArrayLike<number>): number => Array.from(position).reduce((sum, value, at) => sum + value * (at + 1), 0);
const SIZES: readonly (readonly [number, number, number, number, number, number])[] = [
  [1, 2, 3, 4, 5, 6],
  [0.5, 0.25, 2, -1, 0, 3],
];

describe("given a brick and a BoxGeometry of the same size and place", () => {
  // mutation: sed -i 's/TEMPLATE_POSITION\[at + 2\]! \* d + z/TEMPLATE_POSITION[at + 2]! * d + y/' src/game/present/interiors/interior-brick.ts
  it("when their corners, normals and triangles are read, then they are the same box", () => {
    for (const [w, h, d, x, y, z] of SIZES) {
      const expected = new THREE.BoxGeometry(w, h, d).translate(x, y, z);
      const got = brick(w, h, d, x, y, z);
      expect(weighted(got.getAttribute("position").array), `${w}x${h}x${d} at ${x}, ${y}, ${z}`).toBeCloseTo(weighted(expected.getAttribute("position").array), 3);
      expect(digest(got.getAttribute("normal").array as Float32Array), "normals").toBe(digest(expected.getAttribute("normal").array as Float32Array));
      expect(digest(got.index!.array as Uint16Array), "triangles").toBe(digest(expected.index!.array as Uint16Array));
    }
  });

  // mutation: sed -i 's/TEMPLATE_NORMAL.slice()/TEMPLATE_NORMAL/' src/game/present/interiors/interior-brick.ts
  it("when a brick is turned in place, then no other brick's normals turn with it", () => {
    const first = brick(1, 1, 1, 0, 0, 0);
    const second = brick(1, 1, 1, 0, 0, 0);
    const before = digest(second.getAttribute("normal").array as Float32Array);
    first.rotateY(1);
    expect(digest(second.getAttribute("normal").array as Float32Array), "the second brick's normals").toBe(before);
  });
});
