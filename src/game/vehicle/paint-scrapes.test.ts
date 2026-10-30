import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { PaintScrapes, SCRAPE_MAX, STROKE_BYTES, paintCover } from "./paint-scrapes.ts";
import { CAR_SPRAY, SPRAY_FACE } from "./spray-box.ts";
import { FITTING_ATTRIBUTE, FITTING_TONE } from "./constants.ts";

/** A flank's texel column of rest z (m) and texel row of rest height y (m). */
const flankU = (z: number) => Math.floor(((z - CAR_SPRAY.min[2]) / (CAR_SPRAY.max[2] - CAR_SPRAY.min[2])) * CAR_SPRAY.faces[SPRAY_FACE.left]![2]);
const flankV = (y: number) => Math.floor(((y - CAR_SPRAY.min[1]) / (CAR_SPRAY.max[1] - CAR_SPRAY.min[1])) * CAR_SPRAY.faces[SPRAY_FACE.left]![3]);

/** One slide along the left flank at height `y` from rest z `z0` to `z1` (at most 0.6 m), hard, closed by two slices. */
function slide(s: PaintScrapes, y: number, z0: number, z1: number): void {
  s.scrape(new THREE.Vector3(CAR_SPRAY.min[0], y, (z0 + z1) / 2), new THREE.Vector3(-1, 0, 0), new THREE.Vector3(0, 0, 1), new THREE.Vector2(y, y), (z1 - z0) / 2, 3, 1);
  s.slice(0.25);
  s.slice(0.25);
}

const list = (s: PaintScrapes) => Array.from({ length: s.count }, (_, k) => Array.from(s.list.subarray(k * STROKE_BYTES, (k + 1) * STROKE_BYTES)).join(","));

describe("given a car whose 32 strokes are full: a 4 x 8 grid on its left flank less one cell, and a short one 5 cm on along the first's row", () => {
  const cols: [number, number][] = [[-2.2, -1.6], [-1, -0.4], [0.2, 0.8], [1.4, 2]];
  const rows = Array.from({ length: 8 }, (_, r) => 0.15 + 0.17 * r);
  const s = new PaintScrapes();
  for (const y of rows) for (const [z0, z1] of cols) if (s.count < SCRAPE_MAX - 1) slide(s, y, z0, z1);
  slide(s, rows[0]!, -1.55, -1.25);

  it("when a new slide lands in the empty cell, then it shows, and the two nearest strokes became one spanning both while every other stroke stays as it was", () => {
    expect(s.count, "the control: full").toBe(SCRAPE_MAX);
    const before = list(s);
    slide(s, rows[7]!, cols[3]![0], cols[3]![1]);
    const after = list(s);
    expect(s.count, after.join(" | ")).toBe(SCRAPE_MAX);
    const fresh = [flankU(cols[3]![0] + 0.001), flankU(cols[3]![1] - 0.001), flankV(rows[7]!)];
    expect(after.some((b) => { const [u0, u1, v0] = b.split(",").map(Number); return Math.abs(u0! - fresh[0]!) <= 1 && Math.abs(u1! - fresh[1]!) <= 1 && v0 === fresh[2]; }), `the new stroke: ${after.join(" | ")}`).toBeTruthy();
    const merged = [flankU(-2.2), flankU(-1.25)];
    expect(after.some((b) => { const [u0, u1] = b.split(",").map(Number); return Math.min(u0!, u1!) <= merged[0]! + 1 && Math.max(u0!, u1!) >= merged[1]! - 1; }), `one stroke spans the first and the short one: ${after.join(" | ")}`).toBeTruthy();
    const kept = before.slice(1, SCRAPE_MAX - 1);
    expect(kept.every((b) => after.includes(b)), "every other stroke kept, byte for byte").toBeTruthy();
  });
});

describe("given a rear bumper's one mesh: its own trim left of the middle, a black fitting drawn in it right of the middle, both facing back at 0.3-0.5 m", () => {
  const quad = (x: number, tone: number) => {
    const geo = new THREE.PlaneGeometry(0.4, 0.2).rotateY(Math.PI).translate(x, 0.4, CAR_SPRAY.min[2] + 0.05);
    return geo.setAttribute(FITTING_ATTRIBUTE, new THREE.Float32BufferAttribute(new Float32Array(geo.getAttribute("position").count).fill(tone), 1));
  };
  const group = new THREE.Group();
  group.add(new THREE.Mesh(mergeGeometries([quad(-0.3, 0), quad(0.3, FITTING_TONE.black)])));
  const cover = paintCover({}, group.children as THREE.Mesh[], group);
  /** A car with that bumper's cover after one hard 30 cm slide along its back at 0.4 m, centred at `x`. */
  const slid = (x: number) => {
    const s = new PaintScrapes();
    s.cover = cover;
    s.scrape(new THREE.Vector3(x, 0.4, CAR_SPRAY.min[2]), new THREE.Vector3(0, 0, -1), new THREE.Vector3(1, 0, 0), new THREE.Vector2(0.4, 0.4), 0.15, 3, 1);
    s.slice(0.25);
    s.slice(0.25);
    return s;
  };

  it("when it slides along the fitting, then no stroke is kept (the fitting shows none), and along the trim one is", () => {
    expect(slid(-0.3).count, "the control: the trim keeps the slide").toBe(1);
    expect(list(slid(0.3)), "the fitting's strokes").toEqual([]);
  });
});
