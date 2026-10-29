import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { Track } from "../world/track.ts";
import { OFF_MENU, TRACKS } from "../world/tracks/index.ts";
import { depthProxy, groundMaterial, GROUND_LIFT_M, GROUND_LIFT_PX, isBaseLevel, levelOrder, type GroundLevel } from "../scenes/ground-stack.ts";
import { buildGroundLayers } from "./track-ground.ts";
import { RoadIndex } from "./track-mesh.ts";
import { sections } from "../world/track-sections.ts";
import { firstMismatch } from "../kernel/compare-arrays.test-util.ts";

/**
 * Headless ground-layer overlap scan: where two ground layers (terrain, road / runoff ribbons, marks, kerbs ...) cover the
 * same (x, z), can the renderer tell which is in front? Layers above the terrain are painted over what is below them in the
 * order of the one stack (`scenes/ground-stack.ts`) and write no depth, so two of them are ambiguous only where the one
 * painted later lies clearly under the one painted earlier. A layer that writes depth (the terrain, a bridge deck) is
 * compared with what is drawn on it by depth: the depth buffer is `DEPTH_BITS` fixed point over the camera's near / far, so
 * one step is `z² (far - near) / (far · near · 2^bits)` metres of view depth at distance z, and a height `g` between two
 * planes seen from a camera `CAMERA_HEIGHT` up at that distance is `g · z / CAMERA_HEIGHT` of it (a grazing view). The lift
 * of the layer drawn on it (pixels of the ground's depth slope, `depthSlope`) adds to its height; the pair is ambiguous when
 * the result is under the raster noise (`rasterNoise`).
 */

const DEPTH_BITS = 24;
const CAMERA_NEAR = 0.1;
/** The race camera's far plane (m); the menu scenes use 180. */
const CAMERA_FAR = 900;
/** Reference distance (m) the ground must order correctly at: a chase cam sees cars 100+ m down the road, and the fog is thin out to here. */
const RANGE = 250;
/** Height (m) of the chase camera over the road; its floor is 0.45 m, a hood cam sits at about 1.2 m. */
const CAMERA_HEIGHT = 2.4;
/** Sub-pixel bits of a GPU that rounds vertices coarsely (4 is the least GLES 3 allows; desktop GPUs have 8). */
const SUBPIXEL_BITS = 4;
/** A layer painted over one this much (m) above it is drawn the wrong way round. */
const INVERT_GAP = 0.15;
/** Scan cell (m). */
const SCAN_CELL = 0.25;
/** Side (m) of the bins an overlap's spots are grouped in. */
const SPOT_BIN = 12;

/** Metres of view depth one depth step spans at distance `z`. */
function depthStep(z: number): number {
  return (z * z * (CAMERA_FAR - CAMERA_NEAR)) / (CAMERA_FAR * CAMERA_NEAR * 2 ** DEPTH_BITS);
}

/**
 * Depth steps one pixel row of flat ground climbs, seen from a camera `height` up with a 62° vertical field of view over
 * 616 rows: the same at every distance, since both the step and the climb grow with the square of it.
 */
function depthSlope(height = CAMERA_HEIGHT): number {
  const focal = 616 / 2 / Math.tan((62 * Math.PI) / 360);
  return (CAMERA_FAR * CAMERA_NEAR * 2 ** DEPTH_BITS) / ((CAMERA_FAR - CAMERA_NEAR) * height * focal);
}

/** Depth steps two planes of the same slope can differ by through vertex rounding to 1/2^bits px (at worst, both corners of a pixel). */
function rasterNoise(height = CAMERA_HEIGHT, bits = SUBPIXEL_BITS): number {
  return (depthSlope(height) * Math.SQRT2) / 2 ** (bits + 1);
}

/** Depth steps a height of `g` metres between two planes spans at distance `z` from the camera. */
function heightSteps(g: number, z: number): number {
  return (g * z) / CAMERA_HEIGHT / depthStep(z);
}

/** A ground layer's triangles and how it is drawn: its place in the draw order, whether it writes depth, how much nearer (pixels of its depth slope) it is tested than it lies. */
type ScanLayer = { name: string; pos: ArrayLike<number>; idx: ArrayLike<number>; order: number; writes: boolean; lift: number };

type Overlap = {
  a: string;
  b: string;
  /** Area (m²) where the pair is ambiguous at `RANGE`. */
  area: number;
  /** Smallest separation (depth steps; 0 for a pair painted the wrong way round) in that area. */
  minSteps: number;
  /** Smallest height gap (m) in that area. */
  minGap: number;
  /** Centre of the worst cell. */
  x: number;
  z: number;
  /** The largest `SPOT_BIN` m bins of the overlap: [centre x, centre z, area m²]. */
  spots: [number, number, number][];
};

type Hit = { layer: number; y: number };

/**
 * Every pair of layers the renderer cannot tell apart at `RANGE`, with the area, worst separation and its place.
 * The terrain is rasterised only where another layer already is (it would be most of the map).
 * `cell` is the raster step (m): an overlap thinner than it can be missed. `noise` is the separation (steps) a pair needs.
 */
function scanOverlaps(layers: readonly ScanLayer[], range = RANGE, cell = SCAN_CELL, noise = rasterNoise()): Overlap[] {
  const cells = new Map<number, Hit[]>();
  const key = (i: number, j: number) => (i + 32768) * 65536 + (j + 32768);
  const raster = (li: number, onlyKnown: boolean) => {
    const { pos, idx } = layers[li]!;
    for (let t = 0; t + 2 < idx.length; t += 3) {
      const ia = idx[t]! * 3;
      const ib = idx[t + 1]! * 3;
      const ic = idx[t + 2]! * 3;
      const ax = pos[ia]!;
      const ay = pos[ia + 1]!;
      const az = pos[ia + 2]!;
      const bx = pos[ib]!;
      const by = pos[ib + 1]!;
      const bz = pos[ib + 2]!;
      const cx = pos[ic]!;
      const cy = pos[ic + 1]!;
      const cz = pos[ic + 2]!;
      const det = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz);
      if (Math.abs(det) < 1e-9) continue;
      const i0 = Math.floor(Math.min(ax, bx, cx) / cell);
      const i1 = Math.floor(Math.max(ax, bx, cx) / cell);
      const j0 = Math.floor(Math.min(az, bz, cz) / cell);
      const j1 = Math.floor(Math.max(az, bz, cz) / cell);
      for (let i = i0; i <= i1; i++) {
        for (let j = j0; j <= j1; j++) {
          const k = key(i, j);
          const list = cells.get(k);
          if (onlyKnown && !list) continue;
          const x = (i + 0.5) * cell;
          const z = (j + 0.5) * cell;
          const l0 = ((bz - cz) * (x - cx) + (cx - bx) * (z - cz)) / det;
          const l1 = ((cz - az) * (x - cx) + (ax - cx) * (z - cz)) / det;
          const l2 = 1 - l0 - l1;
          if (l0 < 0 || l1 < 0 || l2 < 0) continue;
          const hit = { layer: li, y: l0 * ay + l1 * by + l2 * cy };
          // A centre exactly on a shared edge lies in both triangles: the layer counts once there.
          if (list?.some((h) => h.layer === li && Math.abs(h.y - hit.y) < 1e-6)) continue;
          if (list) list.push(hit);
          else cells.set(k, [hit]);
        }
      }
    }
  };
  for (const [li, l] of layers.entries()) {
    if (l.name !== "terrain") raster(li, false);
  }
  for (const [li, l] of layers.entries()) {
    if (l.name === "terrain") raster(li, true);
  }

  const out = new Map<string, Overlap>();
  const bins = new Map<string, Map<string, [number, number, number]>>();
  for (const [k, list] of cells) {
    for (let p = 0; p < list.length; p++) {
      for (let q = p + 1; q < list.length; q++) {
        const hp = list[p]!;
        const hq = list[q]!;
        const lp = layers[hp.layer]!;
        const lq = layers[hq.layer]!;
        const gap = Math.abs(hp.y - hq.y);
        let steps: number;
        if (lp.name === lq.name) {
          // One mesh: parts of it that lie at one height look the same; painted in index order, parts at two heights are a coin toss.
          if (lp.writes || gap <= INVERT_GAP) continue;
          steps = 0;
        } else {
          const pBack = lp.order <= lq.order;
          const back = pBack ? lp : lq;
          const front = pBack ? lq : lp;
          const yBack = pBack ? hp.y : hq.y;
          const yFront = pBack ? hq.y : hp.y;
          if (!back.writes) {
            // Painted over: wrong only where the one painted later lies clearly under the one painted earlier.
            if (yBack - yFront <= INVERT_GAP) continue;
            steps = 0;
          } else if (front.order === back.order) {
            // Two depth-writing layers (a bridge's top and its paint): by height alone.
            steps = heightSteps(gap, range);
          } else {
            // Drawn on a depth-writing layer: its height over it and its lift, against the raster noise.
            steps = heightSteps(yFront - yBack, range) + (front.lift - back.lift) * depthSlope();
          }
          if (Math.abs(steps) >= noise) continue;
        }
        const [first, second] = lp.name < lq.name ? [lp.name, lq.name] : [lq.name, lp.name];
        const id = `${first}|${second}`;
        let o = out.get(id);
        if (!o) {
          o = { a: first, b: second, area: 0, minSteps: Infinity, minGap: Infinity, x: 0, z: 0, spots: [] };
          out.set(id, o);
          bins.set(id, new Map());
        }
        const cx = (Math.floor(k / 65536) - 32768 + 0.5) * cell;
        const cz = ((k % 65536) - 32768 + 0.5) * cell;
        const bk = `${Math.floor(cx / SPOT_BIN)},${Math.floor(cz / SPOT_BIN)}`;
        const bin = bins.get(id)!;
        const spot = bin.get(bk);
        if (spot) spot[2] += cell * cell;
        else bin.set(bk, [(Math.floor(cx / SPOT_BIN) + 0.5) * SPOT_BIN, (Math.floor(cz / SPOT_BIN) + 0.5) * SPOT_BIN, cell * cell]);
        o.area += cell * cell;
        o.minGap = Math.min(o.minGap, gap);
        if (steps < o.minSteps) {
          o.minSteps = steps;
          o.x = cx;
          o.z = cz;
        }
      }
    }
  }
  for (const [id, o] of out) o.spots = [...bins.get(id)!.values()].sort((u, v) => v[2] - u[2]).slice(0, 3);
  return [...out.values()].sort((u, v) => v.area - u.area);
}

/** A course's ground meshes as the scan's layers, named by kind and surface (a bridge's with `.deck`), drawn as `TrackArt` draws them. */
function courseLayers(track: Track): ScanLayer[] {
  const paths = track.paths();
  const layers = buildGroundLayers(track, track.ground(), new RoadIndex(paths), paths, paths.map((p) => sections(p, 0)));
  return layers.map((l) => ({
    name: `${l.surface && l.kind !== "terrain" ? `${l.kind}.${l.surface}` : l.kind}${l.level === "deck" ? ".deck" : ""}`,
    pos: l.m.pos,
    idx: l.m.idx,
    order: levelOrder(l.level),
    writes: isBaseLevel(l.level),
    lift: isBaseLevel(l.level) ? 0 : GROUND_LIFT_PX,
  }));
}

/** A flat 4 × 4 m square `y` m over the ground, two triangles, drawn as a ground layer of `level` would be. */
const quad = (name: string, y: number, level: GroundLevel): ScanLayer => ({
  name,
  pos: [0, y, 0, 4, y, 0, 4, y, 4, 0, y, 4],
  idx: [0, 1, 2, 0, 2, 3],
  order: levelOrder(level),
  writes: isBaseLevel(level),
  lift: isBaseLevel(level) ? 0 : GROUND_LIFT_PX,
});

describe("given a 24-bit depth buffer over 0.1 to 900 m and flat ground seen from the race camera 2.4 m up", () => {
  it("when the depth resolution is read, then a step is 13 mm at 150 m and under a millimetre at 30 m", () => {
    expect(Math.abs(depthStep(150) - 0.0134)).toBeLessThan(0.0005);
    expect(depthStep(30)).toBeLessThan(0.001);
  });

  it("when a pixel row of the ground is read, then it climbs about 1360 steps at any distance, five times that from the 0.45 m floor of the chase cam", () => {
    expect(Math.abs(depthSlope(2.4) - 1363)).toBeLessThan(20);
    expect(Math.abs(depthSlope(0.45) / depthSlope(2.4) - 2.4 / 0.45)).toBeLessThan(1e-9);
  });

  const roundingCases = [
    { it: "when a GPU places vertices on a 1/16 pixel grid (a phone), then two triangulations of one plane differ by about 60 steps", bits: 4, from: 58, to: 62 },
    { it: "when a GPU places vertices on a 1/8 pixel grid, then they differ by about 120 steps", bits: 3, from: 118, to: 123 },
    { it: "when a GPU places vertices on a 1/256 pixel grid (a desktop), then they differ by under 4 steps", bits: 8, from: 0, to: 4 },
  ] as const;
  for (const testCase of roundingCases) {
    it(testCase.it, () => {
      const noise = rasterNoise(2.4, testCase.bits);
      expect(noise >= testCase.from && noise <= testCase.to, `${noise}`).toBeTruthy();
    });
  }
});

describe("given the scan for ground layers that z-fight (are drawn at the same depth)", () => {
  it("when two painted layers of different levels share a plane, then none is found whichever is listed first: the higher level is painted over the lower", () => {
    expect(scanOverlaps([quad("road.dirt", 0.015, "dirt"), quad("road.asphalt", 0.015, "asphalt")])).toHaveLength(0);
    expect(scanOverlaps([quad("road.asphalt", 0.015, "asphalt"), quad("road.dirt", 0.015, "dirt")])).toHaveLength(0);
  });

  it("when two depth-writing layers share a plane, then the whole shared square is found: only the depth buffer could tell them apart", () => {
    const flat = scanOverlaps([quad("road.asphalt.deck", 0.015, "deck"), quad("marking.deck", 0.015, "deck")]);
    expect(flat.length).toBe(1);
    expect(Math.abs(flat[0]!.area - 16), "the whole 4 × 4 m square").toBeLessThan(1e-6);
  });

  it("when a layer is painted over another that lies 20 cm above it, then it is found: the higher level would hide what is clearly above it", () => {
    const inverted = scanOverlaps([quad("road.dirt", 0, "dirt"), quad("road.asphalt", 0.2, "asphalt")]);
    expect(inverted.length).toBe(1);
    expect(inverted[0]!.minSteps).toBe(0);
  });

  it("when one painted mesh has parts at two heights, then it is found, unless they are within 5 cm: its own triangle order would decide which shows", () => {
    const low = quad("road.asphalt", 0, "asphalt");
    expect(scanOverlaps([low, quad("road.asphalt", 0.3, "asphalt")]).length).toBe(1);
    expect(scanOverlaps([low, quad("road.asphalt", 0.05, "asphalt")]).length).toBe(0);
  });

  it("when a road lies 1.5 cm over the terrain at 250 m, then its lift clears the raster noise of a 1/8 pixel grid and its height alone does not", () => {
    const noise = rasterNoise(2.4, 3);
    expect(heightSteps(0.015, RANGE), "1.5 cm of height is a few dozen steps there").toBeLessThan(noise);
    const ground = quad("terrain", 0, "terrain");
    expect(scanOverlaps([ground, quad("road.asphalt", 0.015, "asphalt")], RANGE, 0.5, noise)).toHaveLength(0);
    const unlifted = { ...quad("road.asphalt", 0.015, "asphalt"), lift: 0 };
    expect(scanOverlaps([ground, unlifted], RANGE, 0.5, noise).length).toBe(1);
  });

  it("when every course's ground layers are scanned at 250 m for a phone's 1/16 pixel grid, then under 2 m² of its whole ground is ambiguous", () => {
    for (const raw of [...TRACKS, ...OFF_MENU]) {
      const track = new Track(raw);
      const overlaps = scanOverlaps(courseLayers(track), RANGE, 0.5);
      const area = overlaps.reduce((sum, o) => sum + o.area, 0);
      expect(area, `${track.id}: ${area} m² ambiguous: ${overlaps.map((o) => `${o.a} over ${o.b} ${o.area} m² at ${o.x},${o.z}`).join("; ")}`).toBeLessThan(2);
    }
  });
});

describe("given the ground stack", () => {
  it("when its levels are listed bottom to top, then they draw in that order before the rest of the scene, and only the terrain and a bridge's top write depth", () => {
    const order = (["terrain", "deck", "runoff", "concrete", "asphalt", "cobble", "marking", "kerb", "dirt", "gravel", "grass", "sand", "decal", "glow"] as const).map(levelOrder);
    for (let i = 1; i < order.length; i++) expect(order[i]!, `level ${i} draws at ${order[i]}, not after ${order[i - 1]}`).toBeGreaterThan(order[i - 1]!);
    expect(order.every((o) => o < 0), "the ground draws before the rest of the scene").toBeTruthy();
    expect(firstMismatch((["terrain", "deck", "runoff", "asphalt", "marking", "decal", "glow"] as const).filter(isBaseLevel), ["terrain", "deck"])).toBeUndefined();
  });

  it("when a road's, a transparent decal's and the terrain's materials are made ground surfaces, then the road and the decal stop writing depth and are depth-tested a pixel of their own depth slope nearer, the opaque road alone is also moved 3 cm toward the camera along its view ray (once, however often it is made one), and the terrain is left as it was", () => {
    // The renderer is not used by a ground surface's compile step; a vertex shader is all it reads.
    const renderer = {} as THREE.WebGLRenderer;
    const compiled = (material: THREE.Material): string => {
      const shader = { vertexShader: "void main() {\n#include <project_vertex>\n}" } as THREE.WebGLProgramParametersWithUniforms;
      material.onBeforeCompile(shader, renderer);
      return shader.vertexShader;
    };
    const road = groundMaterial(groundMaterial(new THREE.MeshBasicMaterial(), "asphalt"), "asphalt");
    const decal = groundMaterial(new THREE.MeshBasicMaterial({ transparent: true }), "decal");
    const terrain = groundMaterial(new THREE.MeshBasicMaterial(), "terrain");
    const lift = `gl_Position = projectionMatrix * vec4(mvPosition.xyz * max(1.0 - ${GROUND_LIFT_M} / length(mvPosition.xyz), 0.0), 1.0);`;
    expect(GROUND_LIFT_M).toBe(0.03);
    const expected = [
      { name: "road", material: road, depthWrite: false, polygonOffset: true, factor: -1, lifts: 1 },
      { name: "decal", material: decal, depthWrite: false, polygonOffset: true, factor: -1, lifts: 0 },
      { name: "terrain", material: terrain, depthWrite: true, polygonOffset: false, factor: 0, lifts: 0 },
    ];
    for (const row of expected) {
      expect(row.material.depthWrite, `${row.name} depthWrite`).toBe(row.depthWrite);
      expect(row.material.polygonOffset, `${row.name} polygonOffset`).toBe(row.polygonOffset);
      expect(row.material.polygonOffsetFactor, `${row.name} polygonOffsetFactor`).toBe(row.factor);
      expect(compiled(row.material).split(lift).length - 1, `${row.name} lifts`).toBe(row.lifts);
    }
  });

  it("when the depth copy is built from a painted road, its run-off, its paint, a bridge's top, the terrain and a second road, then it holds the road, the run-off and the second road, one after the other", () => {
    const tri = (y: number) => ({ pos: [0, y, 0, 1, y, 0, 0, y, 1], idx: [0, 1, 2] });
    const proxy = depthProxy([
      { kind: "terrain", level: "terrain", m: tri(-1) },
      { kind: "road", level: "asphalt", m: tri(0) },
      { kind: "runoff", level: "runoff", m: tri(2) },
      { kind: "marking", level: "marking", m: tri(4) },
      { kind: "road", level: "deck", m: tri(3) },
      { kind: "road", level: "dirt", m: { pos: [5, 1, 5, 6, 1, 5, 5, 1, 6], idx: [0, 1, 2] } },
    ]);
    expect(firstMismatch(Array.from(proxy.geometry.index!.array), [0, 1, 2, 3, 4, 5, 6, 7, 8])).toBeUndefined();
    expect(firstMismatch(Array.from(proxy.geometry.attributes.position!.array), [0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 2, 0, 1, 2, 0, 0, 2, 1, 5, 1, 5, 6, 1, 5, 5, 1, 6])).toBeUndefined();
    proxy.geometry.dispose();
    (proxy.material as THREE.Material).dispose();
  });

  it("when the depth copy is built, then it writes depth and no colour, and draws between the terrain and a bridge's top", () => {
    const proxy = depthProxy([]);
    const material = proxy.material as THREE.MeshBasicMaterial;
    expect(material.colorWrite, "colorWrite").toBe(false);
    expect(material.depthWrite, "depthWrite").toBe(true);
    expect(proxy.renderOrder > levelOrder("terrain") && proxy.renderOrder < levelOrder("deck")).toBeTruthy();
    proxy.geometry.dispose();
    material.dispose();
  });
});
