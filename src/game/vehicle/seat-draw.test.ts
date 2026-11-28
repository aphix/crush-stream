import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { firstMismatch } from "../kernel/compare-arrays.test-util.ts";
import { SeatDraw } from "./seat-draw.ts";

/** A variant of `triangles` triangles whose every vertex carries `mark` in its x, so a copy that landed in the wrong place shows. */
function variant(triangles: number, mark: number): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  const verts = triangles * 3;
  const position = new Float32Array(verts * 3);
  for (let v = 0; v < verts; v++) position[v * 3] = mark + v / 1000;
  g.setAttribute("position", new THREE.BufferAttribute(position, 3));
  g.setAttribute("normal", new THREE.BufferAttribute(new Float32Array(verts * 3).fill(1), 3));
  g.setAttribute("uv", new THREE.BufferAttribute(new Float32Array(verts * 2), 2));
  g.setAttribute("color", new THREE.BufferAttribute(new Float32Array(verts * 3), 3));
  g.setIndex(Array.from({ length: verts }, (_, i) => i));
  return g;
}

const VARIANTS = [variant(2, 1), variant(3, 2), variant(1, 3)];
const WHITE = new THREE.Color(1, 1, 1);

function sync(draw: SeatDraw, seats: readonly number[]): void {
  draw.begin();
  for (const s of seats) draw.put(s, new THREE.Matrix4(), WHITE);
  draw.end();
}

/** The draw's geometry as a fresh draw packs the same seats, read as arrays: what a rebuild must leave in the buffers. */
function packedFresh(seats: readonly number[]): { position: Float32Array; seat: Float32Array; index: Uint32Array } {
  const draw = new SeatDraw(VARIANTS, new THREE.MeshBasicMaterial(), 16, "none");
  sync(draw, seats);
  return buffers(draw);
}

function buffers(draw: SeatDraw): { position: Float32Array; seat: Float32Array; index: Uint32Array } {
  const g = draw.mesh.geometry;
  const used = g.drawRange.count;
  return { position: (g.getAttribute("position").array as Float32Array).slice(0, used * 3), seat: (g.getAttribute("seat").array as Float32Array).slice(0, used), index: (g.index!.array as Uint32Array).slice(0, used) };
}

/** Three has uploaded every buffer of the draw: what its draws do, each calling back. */
function uploaded(draw: SeatDraw): void {
  const g = draw.mesh.geometry;
  for (const name of Object.keys(g.attributes)) (g.getAttribute(name) as THREE.BufferAttribute).onUploadCallback();
  g.index!.onUploadCallback();
}

const rangeOf = (draw: SeatDraw): { start: number; count: number } => (draw.mesh.geometry.getAttribute("position") as THREE.BufferAttribute).updateRanges[0]!;

describe("given a draw whose packed seats change from the middle", () => {
  it("when its third seat changes variant, then only the vertices from that seat on are written for upload and the buffers equal a fresh pack's", () => {
    const draw = new SeatDraw(VARIANTS, new THREE.MeshBasicMaterial(), 16, "none");
    sync(draw, [0, 1, 2, 0]);
    uploaded(draw);
    sync(draw, [0, 1, 0, 0, 2]);
    // Seats 0 and 1 hold 6 + 9 = 15 vertices, unchanged.
    expect(rangeOf(draw).start, "first float written").toBe(15 * 3);
    const fresh = packedFresh([0, 1, 0, 0, 2]);
    const now = buffers(draw);
    expect(firstMismatch(now.position, fresh.position), "positions").toBeUndefined();
    expect(firstMismatch(now.seat, fresh.seat), "seat rows").toBeUndefined();
    expect(firstMismatch(now.index, fresh.index), "indices").toBeUndefined();
  });

  it("when two rebuilds come before the draw that uploads them, then the range still starts at the first of them", () => {
    const draw = new SeatDraw(VARIANTS, new THREE.MeshBasicMaterial(), 16, "none");
    sync(draw, [0, 1, 2, 0]);
    uploaded(draw);
    sync(draw, [0, 2, 2, 0]);
    sync(draw, [0, 2, 2, 0, 1]);
    expect(rangeOf(draw).start, "after the first change, at seat 1").toBe(6 * 3);
    const fresh = packedFresh([0, 2, 2, 0, 1]);
    expect(firstMismatch(buffers(draw).position, fresh.position), "positions").toBeUndefined();
  });

  it("when seats only leave the end, then nothing is marked for upload and the draw shrinks", () => {
    const draw = new SeatDraw(VARIANTS, new THREE.MeshBasicMaterial(), 16, "none");
    sync(draw, [0, 1, 2]);
    uploaded(draw);
    const position = draw.mesh.geometry.getAttribute("position") as THREE.BufferAttribute;
    const before = position.version;
    sync(draw, [0, 1]);
    expect(position.version, "no upload").toBe(before);
    expect(draw.triangles, "triangles billed").toBe(5);
  });
});
