import { createHash } from "node:crypto";
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import type { Piece } from "../prefab-pieces.ts";
import { brick } from "./interior-brick.ts";
import { NO_SLOT, PackedMesh } from "./interior-pack.ts";

/** A brick is this many vertices (twelve triangles' corners). */
const BRICK_VERTICES = 36;
const STREAM_FLOATS = 3;
const YAW = 0.7;
const PLACE = { x: 5, z: -3 };

const material = new THREE.MeshBasicMaterial();
const pieceAt = (x: number, hex: number): Piece => [brick(1, 2, 3, x, 1, 0), hex];
const packed = (startVertices = 8 * BRICK_VERTICES): PackedMesh => new PackedMesh("test", material, startVertices);
const drawn = (mesh: PackedMesh, name: "position" | "normal" | "color"): string => {
  const array = mesh.mesh.geometry.getAttribute(name).array as Float32Array;
  const floats = array.subarray(0, mesh.vertices * STREAM_FLOATS);
  return createHash("sha1").update(Buffer.from(floats.buffer, floats.byteOffset, floats.byteLength)).digest("hex");
};
/** Every stream's digest, one string, of what the mesh draws. */
const drawnAll = (mesh: PackedMesh): string => [drawn(mesh, "position"), drawn(mesh, "normal"), drawn(mesh, "color")].join();

describe("given a packed mesh with three builds in it", () => {
  // mutation: sed -i 's/this.slotStart\[other\] = this.slotStart\[other\]! - count;/void count;/' src/game/present/interiors/interior-pack.ts (the slots after a hole keep their old starts)
  it("when the middle one is taken out, a fourth is built and the third is taken out, then what is drawn is the first and the fourth as if packed alone", () => {
    const mesh = packed();
    const first = mesh.add([pieceAt(0, 0xff0000)], 0, 0, 0);
    const middle = mesh.add([pieceAt(3, 0x00ff00)], 0, 0, 0);
    const third = mesh.add([pieceAt(6, 0x0000ff)], 0, 0, 0);
    expect(mesh.vertices, "three builds").toBe(3 * BRICK_VERTICES);
    mesh.remove(middle);
    expect(mesh.vertices, "after the middle").toBe(2 * BRICK_VERTICES);
    mesh.add([pieceAt(9, 0xffff00)], 0, 0, 0);
    mesh.remove(third);
    const alone = packed();
    alone.add([pieceAt(0, 0xff0000)], 0, 0, 0);
    alone.add([pieceAt(9, 0xffff00)], 0, 0, 0);
    expect(drawnAll(mesh), "what is left").toBe(drawnAll(alone));
    mesh.remove(first);
    expect(mesh.vertices, "one left").toBe(BRICK_VERTICES);
    expect(mesh.mesh.visible, "drawn with one in it").toBe(true);
  });

  // mutation: sed -i 's/.copyWithin(start \* STREAM_FLOATS, after \* STREAM_FLOATS, this.used \* STREAM_FLOATS)/.copyWithin(0, 0, 0)/' src/game/present/interiors/interior-pack.ts (a hole is left open)
  it("when the first is taken out, then the ones after it move down and a build into the space reads as the last", () => {
    const mesh = packed();
    const first = mesh.add([pieceAt(0, 0xff0000)], 0, 0, 0);
    mesh.add([pieceAt(3, 0x00ff00)], 0, 0, 0);
    mesh.remove(first);
    mesh.add([pieceAt(6, 0x0000ff)], 0, 0, 0);
    const fresh = packed();
    fresh.add([pieceAt(3, 0x00ff00)], 0, 0, 0);
    fresh.add([pieceAt(6, 0x0000ff)], 0, 0, 0);
    expect(drawnAll(mesh)).toBe(drawnAll(fresh));
  });

  // mutation: sed -i 's/    this.send(start, moved);/    this.send(start, 0);/' src/game/present/interiors/interior-pack.ts (the moved vertices are never sent to the card)
  it("when the first is taken out after the card has what was packed, then the vertices that moved are the ones to send", () => {
    const mesh = packed();
    const first = mesh.add([pieceAt(0, 0xff0000)], 0, 0, 0);
    mesh.add([pieceAt(3, 0x00ff00)], 0, 0, 0);
    mesh.add([pieceAt(6, 0x0000ff)], 0, 0, 0);
    const position = mesh.mesh.geometry.getAttribute("position") as THREE.BufferAttribute;
    position.clearUpdateRanges();
    mesh.remove(first);
    expect(position.updateRanges.length, "one range").toBe(1);
    expect(position.updateRanges[0]!.start, "from the hole").toBe(0);
    expect(position.updateRanges[0]!.count, "the two that moved").toBe(2 * BRICK_VERTICES * STREAM_FLOATS);
  });
});

describe("given a packed mesh that a build outgrows", () => {
  // mutation: sed -i 's/      (next.array as Float32Array).set((stream.array as Float32Array).subarray(0, this.used \* STREAM_FLOATS));//' src/game/present/interiors/interior-pack.ts (the new storage starts empty)
  it("when it grows, then its storage is new, twice the size, and what was packed is kept; room enough, it is the same storage", () => {
    const mesh = packed(2 * BRICK_VERTICES);
    mesh.add([pieceAt(0, 0xff0000)], 0, 0, 0);
    const storage = mesh.storage;
    mesh.add([pieceAt(3, 0x00ff00)], 0, 0, 0);
    expect(mesh.storage, "room enough: the same array").toBe(storage);
    mesh.add([pieceAt(6, 0x0000ff)], 0, 0, 0);
    expect(mesh.storage, "a third one needs more").not.toBe(storage);
    expect(mesh.storage.length, "twice the size").toBe(2 * storage.length);
    const fresh = packed();
    for (const [x, hex] of [[0, 0xff0000], [3, 0x00ff00], [6, 0x0000ff]] as const) fresh.add([pieceAt(x, hex)], 0, 0, 0);
    expect(drawnAll(mesh), "what is drawn").toBe(drawnAll(fresh));
  });
});

describe("given a piece packed with a turn and a place", () => {
  // mutation: sed -i 's/      position\[out\] = cos \* px + sin \* pz + x;/      position[out] = cos * px - sin * pz + x;/' src/game/present/interiors/interior-pack.ts
  it("when its corners and normals are read, then they are the piece turned about y and moved, as a geometry's rotateY and translate do", () => {
    const mesh = packed();
    mesh.add([pieceAt(2, 0x336699)], YAW, PLACE.x, PLACE.z);
    const expected = brick(1, 2, 3, 2, 1, 0).rotateY(YAW).translate(PLACE.x, 0, PLACE.z);
    const index = expected.index!;
    /** The corners' coordinates weighted by where they stand in the order the triangles read them: a turned, moved or swapped corner reads differently. */
    const weighted = (attribute: THREE.BufferAttribute | THREE.InterleavedBufferAttribute, corners: (at: number) => number): number => {
      let sum = 0;
      for (let at = 0; at < BRICK_VERTICES; at++) sum += (attribute.getX(corners(at)) + 2 * attribute.getY(corners(at)) + 3 * attribute.getZ(corners(at))) * (at + 1);
      return sum;
    };
    for (const name of ["position", "normal"] as const) {
      expect(weighted(mesh.mesh.geometry.getAttribute(name), (at) => at), name).toBeCloseTo(weighted(expected.getAttribute(name), (at) => index.getX(at)), 3);
    }
  });

  it("when no piece has a vertex, then nothing is packed and there is no slot", () => {
    const mesh = packed();
    expect(mesh.add([], 0, 0, 0)).toBe(NO_SLOT);
    expect(mesh.vertices).toBe(0);
    expect(() => mesh.remove(NO_SLOT)).not.toThrow();
  });
});
