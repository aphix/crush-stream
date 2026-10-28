import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { CELL as GROUND_CELL, Track, type TrackGround } from "../world/track.ts";
import { SURFACE_IDS, SURFACES } from "../world/catalog.ts";
import { MATERIAL } from "../vehicle/material-class.ts";
import { OFF_MENU, TRACKS } from "../world/tracks/index.ts";
import { FLAT_TOL, type Mesher, RoadIndex, surfaceClass } from "./track-mesh.ts";
import { sections } from "../world/track-sections.ts";
import { buildGroundLayers, TerrainBatch } from "./track-ground.ts";

/** A course's terrain as `TrackArt` draws it: the near mesh (chunk after chunk, then the far skirt), the chunks, the road index, and the ground the mesh was cut from with its terrain's surface index. */
type Terrain = { near: Mesher; chunks: { coarse: Mesher; box: Float32Array; fineAt: Int32Array; coarseAt: Int32Array }; roads: RoadIndex; ground: TrackGround; terrainSurface: number };

function terrainOf(course: string): Terrain {
  const track = [...TRACKS, ...OFF_MENU].map((raw) => new Track(raw)).find((t) => t.id === course)!;
  const paths = track.paths();
  const roads = new RoadIndex(paths);
  const terrain = buildGroundLayers(track, track.ground(), roads, paths, paths.map((p) => sections(p, 0)))[0]!;
  assert.equal(terrain.kind, "terrain");
  assert.ok(terrain.chunks, "the terrain is cut into chunks");
  return { near: terrain.m, chunks: terrain.chunks, roads, ground: track.ground(), terrainSurface: SURFACE_IDS.indexOf(track.json.environment.terrain) };
}

/** Sample offsets inside each 2 m grid cell: 1 mm past each grid line, and the middle. */
const OFFSETS = [0.001, 1, 1.999];
const CELL = 2;

/** Drawn heights on the sample grid, row by row (NaN where nothing is drawn). */
type Sampled = { y: Float32Array; nx: number; nz: number };

/** The chunks' ground sampled at `OFFSETS` in every 2 m cell: chunk c draws from its far mesh when `far(c)`, else from its near one. */
function sampleGround(t: Terrain, far: (chunk: number) => boolean): Sampled {
  const { box } = t.chunks;
  const chunks = box.length / 4;
  const x0 = box[0]!;
  const z0 = box[1]!;
  const nx = Math.round((box[(chunks - 1) * 4 + 2]! - x0) / CELL) * OFFSETS.length;
  const nz = Math.round((box[(chunks - 1) * 4 + 3]! - z0) / CELL) * OFFSETS.length;
  const y = new Float32Array(nx * nz).fill(NaN);
  const at = (s: number) => Math.floor(s / OFFSETS.length) * CELL + OFFSETS[s % OFFSETS.length]!;
  /** First sample at or past `v` m from the grid's origin. */
  const from = (v: number) => {
    let s = Math.max(0, Math.floor(v / CELL)) * OFFSETS.length;
    while (at(s) < v) s++;
    return s;
  };
  for (let c = 0; c < chunks; c++) {
    const { pos, idx } = far(c) ? t.chunks.coarse : t.near;
    const ranges = far(c) ? t.chunks.coarseAt : t.chunks.fineAt;
    for (let i = ranges[c * 2 + 1]!; i < ranges[c * 2 + 3]!; i += 3) {
      const a = idx[i]! * 3;
      const b = idx[i + 1]! * 3;
      const d = idx[i + 2]! * 3;
      const ax = pos[a]! - x0;
      const az = pos[a + 2]! - z0;
      const bx = pos[b]! - x0;
      const bz = pos[b + 2]! - z0;
      const dx = pos[d]! - x0;
      const dz = pos[d + 2]! - z0;
      const area = (bx - ax) * (dz - az) - (dx - ax) * (bz - az);
      for (let sz = from(Math.min(az, bz, dz)); sz < nz && at(sz) <= Math.max(az, bz, dz); sz++) {
        for (let sx = from(Math.min(ax, bx, dx)); sx < nx && at(sx) <= Math.max(ax, bx, dx); sx++) {
          const px = at(sx);
          const pz = at(sz);
          const wb = ((px - ax) * (dz - az) - (dx - ax) * (pz - az)) / area;
          const wd = ((bx - ax) * (pz - az) - (px - ax) * (bz - az)) / area;
          const wa = 1 - wb - wd;
          if (wa < -1e-9 || wb < -1e-9 || wd < -1e-9) continue;
          y[sz * nx + sx] = wa * pos[a + 1]! + wb * pos[b + 1]! + wd * pos[d + 1]!;
        }
      }
    }
  }
  return { y, nx, nz };
}

/** World (x, z) of the corner of the 2 m cell holding sample `s` of a `sampleGround` grid whose first chunk starts at (x0, z0), and the corners of the 1 m cell holding it. */
function sampleCellCorners(g: Sampled, s: number, x0: number, z0: number): [number, number][] {
  const [cornerX, cornerZ] = [x0 + Math.floor((s % g.nx) / OFFSETS.length) * CELL, z0 + Math.floor(Math.floor(s / g.nx) / OFFSETS.length) * CELL];
  const [px, pz] = [cornerX + OFFSETS[(s % g.nx) % OFFSETS.length]!, cornerZ + OFFSETS[Math.floor(s / g.nx) % OFFSETS.length]!];
  const [unitX, unitZ] = [Math.floor(px), Math.floor(pz)];
  return [[cornerX, cornerZ], [unitX, unitZ], [unitX + 1, unitZ], [unitX, unitZ + 1], [unitX + 1, unitZ + 1]];
}

/** The largest height step (m) across a 2 m grid line, between the samples 1 mm either side of it. */
function largestStep(g: Sampled): number {
  let worst = 0;
  const last = OFFSETS.length - 1;
  for (let sz = 0; sz < g.nz; sz++) {
    for (let sx = last; sx + 1 < g.nx; sx += OFFSETS.length) {
      const step = Math.abs(g.y[sz * g.nx + sx]! - g.y[sz * g.nx + sx + 1]!);
      if (step > worst) worst = step;
    }
  }
  for (let sz = last; sz + 1 < g.nz; sz += OFFSETS.length) {
    for (let sx = 0; sx < g.nx; sx++) {
      const step = Math.abs(g.y[sz * g.nx + sx]! - g.y[(sz + 1) * g.nx + sx]!);
      if (step > worst) worst = step;
    }
  }
  return worst;
}

/** The near and far meshes may differ in what they cover only in a cell under a ribbon: its corner lies this far (m) inside a road's or runoff's edge. */
const ROAD_INSET = 0.5;

const courseCases = [
  { it: "the hilliest course", course: "dam-spine", fewerFarTrianglesPct: 20 },
  { it: "the second hilliest course", course: "four-count", fewerFarTrianglesPct: 30 },
  { it: "a course of cliff shelves", course: "razor-shelf", fewerFarTrianglesPct: 30 },
  { it: "a course with paved yards painted on its ground", course: "breaker-yard", fewerFarTrianglesPct: 20 },
  { it: "the National Mall, flat lawns and streets over concrete", course: "national-mall", fewerFarTrianglesPct: 18 },
] as const;

describe("given a course's terrain drawn in chunks, each with a near mesh and a coarser far mesh", () => {
  for (const testCase of courseCases) {
    describe(`given ${testCase.it} (${testCase.course})`, () => {
      const t = terrainOf(testCase.course);
      const { box } = t.chunks;
      const chunks = box.length / 4;
      // Chunks run row by row; the last column may be narrower.
      const columns = Math.ceil((box[(chunks - 1) * 4 + 2]! - box[0]!) / (box[2]! - box[0]!) - 1e-6);
      const near = sampleGround(t, () => false);

      it("when neighbouring chunks are drawn one near and one far (both ways round), then no crack opens: the ground's height agrees within 1 cm across every 2 m grid line", () => {
        assert.ok(largestStep(near) < 0.01, `near everywhere: a ${largestStep(near)} m step`);
        for (const parity of [0, 1]) {
          const step = largestStep(sampleGround(t, (c) => (Math.floor(c / columns) + (c % columns)) % 2 === parity));
          assert.ok(step < 0.01, `checkerboard ${parity}: a ${step} m step`);
        }
      });

      it(`when every chunk is drawn far, then the ground covers what the near ground does but under a road, stays within 0.2 m of it, and has at least ${testCase.fewerFarTrianglesPct} % fewer triangles`, () => {
        const far = sampleGround(t, () => true);
        let uncoveredAwayFromRoads = 0;
        let addedAwayFromRoads = 0;
        let worst = 0;
        let compared = 0;
        for (let s = 0; s < near.y.length; s++) {
          const a = near.y[s]!;
          const b = far.y[s]!;
          if (Number.isNaN(a) !== Number.isNaN(b)) {
            if (sampleCellCorners(far, s, box[0]!, box[1]!).some(([x, z]) => t.roads.coveredBy(x, z, ROAD_INSET) >= 0)) continue;
            if (Number.isNaN(b)) uncoveredAwayFromRoads++;
            else addedAwayFromRoads++;
            continue;
          }
          if (Number.isNaN(a)) continue;
          compared++;
          worst = Math.max(worst, Math.abs(a - b));
        }
        assert.ok(compared > 0, "ground was sampled");
        assert.equal(uncoveredAwayFromRoads, 0, "far ground left a hole away from a road");
        assert.equal(addedAwayFromRoads, 0, "far ground covers a hole the near ground leaves away from a road");
        assert.ok(worst <= 0.2 + 1e-4, `${worst} m from the near ground`);
        const nearTriangles = t.chunks.fineAt[chunks * 2 + 1]! / 3;
        const farTriangles = t.chunks.coarseAt[chunks * 2 + 1]! / 3;
        assert.ok(farTriangles <= nearTriangles * (1 - testCase.fewerFarTrianglesPct / 100), `${farTriangles} far triangles against ${nearTriangles} near`);
      });
    });
  }
});

describe("given the National Mall's terrain, its lawns painted over a flat concrete ground", () => {
  const t = terrainOf("national-mall");
  const nearTriangles = t.chunks.fineAt[(t.chunks.box.length / 4) * 2 + 1]! / 3;
  const farTriangles = t.chunks.coarseAt[(t.chunks.box.length / 4) * 2 + 1]! / 3;

  it("when the chunks are built, then flat and gently sloping lawn and road verge are merged into large quads and a colour's straight edge into strips: the near mesh stays under 76 000 triangles", () => {
    assert.ok(nearTriangles < 76_000, `${nearTriangles} near triangles`);
  });

  it("when the chunks are built, then the far mesh stays under 62 000 triangles", () => {
    assert.ok(farTriangles < 62_000, `${farTriangles} far triangles`);
  });
});

/** What stops a terrain being watertight: its triangles' count, those not facing up, and the seams the rasteriser can open into a line of sky. */
type Seams = { triangles: number; notFacingUp: number; tJunctions: number; splitHeights: number };

/** Triangle indices [from, to) of `mesh`. */
type Drawn = { mesh: Mesher; from: number; to: number };

const lattice = (x: number, z: number) => `${Math.round(x * 1000)},${Math.round(z * 1000)}`;

/**
 * The seams of the triangles `drawn` together: `tJunctions` counts the lattice points where a vertex lies inside another
 * triangle's edge instead of ending it (the two sides then rasterise the line apart); `splitHeights` the lattice points drawn at
 * more than one height (a step between neighbours, open to the sky from a low camera).
 */
function seamsOf(drawn: readonly Drawn[], cell: number): Seams {
  const heightAt = new Map<string, number>();
  let splitHeights = 0;
  for (const { mesh, from, to } of drawn) {
    for (let k = from; k < to; k++) {
      const v = mesh.idx[k]! * 3;
      const key = lattice(mesh.pos[v]!, mesh.pos[v + 2]!);
      const known = heightAt.get(key);
      if (known === undefined) heightAt.set(key, mesh.pos[v + 1]!);
      else if (Math.abs(known - mesh.pos[v + 1]!) > 1e-4) splitHeights++;
    }
  }
  const edges = new Set<string>();
  let triangles = 0;
  let tJunctions = 0;
  let notFacingUp = 0;
  for (const { mesh, from, to } of drawn) {
    const { pos, idx } = mesh;
    for (let k = from; k < to; k += 3) {
      triangles++;
      const [a, b, c] = [idx[k]! * 3, idx[k + 1]! * 3, idx[k + 2]! * 3];
      if ((pos[b]! - pos[a]!) * (pos[c + 2]! - pos[a + 2]!) - (pos[b + 2]! - pos[a + 2]!) * (pos[c]! - pos[a]!) >= -1e-9) notFacingUp++;
      for (const [p, q] of [[a, b], [b, c], [c, a]] as const) {
        const dx = pos[q]! - pos[p]!;
        const dz = pos[q + 2]! - pos[p + 2]!;
        const cells = Math.round(Math.max(Math.abs(dx), Math.abs(dz)) / cell);
        if (cells < 2 || (Math.abs(dx) > 1e-6 && Math.abs(dz) > 1e-6)) continue;
        const edge = `${lattice(pos[p]!, pos[p + 2]!)}|${lattice(pos[q]!, pos[q + 2]!)}`;
        if (edges.has(edge)) continue;
        edges.add(edge);
        for (let s = 1; s < cells; s++) if (heightAt.has(lattice(pos[p]! + (dx * s) / cells, pos[p + 2]! + (dz * s) / cells))) tJunctions++;
      }
    }
  }
  return { triangles, notFacingUp, tJunctions, splitHeights };
}

/** The borders between a fine cell and a coarse one that `drawn` draws on the fine side, and of those the ones a triangle edge runs across the middle of (a crack) and the ones whose middle is drawn at two heights. */
type Borders = { drawn: number; spanned: number; splitHeights: number };

/** Largest gap (m) between two heights drawn at one border middle. */
const BORDER_HEIGHT_TOLERANCE = 1e-4;

/**
 * Walks every border between a fine cell and a coarse one of the course's baked cells. Where the fine side draws the border's middle node, the coarse side's edge must end
 * there too: no triangle edge along the border's line may run from one side of the middle to the other, and every vertex at the middle has one height.
 */
function bordersOf(t: Terrain, drawn: readonly Drawn[]): Borders {
  const { ground } = t;
  const { cols, rows, fine, fromU, fromV } = ground.terrainCells;
  const edgesAlong = new Map<string, [number, number][]>();
  const heightsAt = new Map<string, number[]>();
  for (const { mesh, from, to } of drawn) {
    const { pos, idx } = mesh;
    for (let k = from; k < to; k += 3) {
      const corners = [idx[k]! * 3, idx[k + 1]! * 3, idx[k + 2]! * 3];
      for (const v of corners) {
        const key = lattice(pos[v]!, pos[v + 2]!);
        heightsAt.set(key, [...(heightsAt.get(key) ?? []), pos[v + 1]!]);
      }
      for (const [p, q] of [[corners[0]!, corners[1]!], [corners[1]!, corners[2]!], [corners[2]!, corners[0]!]] as const) {
        const [dx, dz] = [pos[q]! - pos[p]!, pos[q + 2]! - pos[p + 2]!];
        if (Math.abs(dx) > 1e-6 && Math.abs(dz) > 1e-6) continue;
        const along = Math.abs(dx) > 1e-6 ? `h${Math.round(pos[p + 2]! * 1000)}` : `v${Math.round(pos[p]! * 1000)}`;
        const span: [number, number] = Math.abs(dx) > 1e-6 ? [Math.min(pos[p]!, pos[q]!), Math.max(pos[p]!, pos[q]!)] : [Math.min(pos[p + 2]!, pos[q + 2]!), Math.max(pos[p + 2]!, pos[q + 2]!)];
        edgesAlong.set(along, [...(edgesAlong.get(along) ?? []), span]);
      }
    }
  }
  const isFine = (ci: number, cj: number) => ci >= 0 && cj >= 0 && ci < cols && cj < rows && fine[cj * cols + ci] === 1;
  const result: Borders = { drawn: 0, spanned: 0, splitHeights: 0 };
  for (let cj = 0; cj < rows; cj++) {
    for (let ci = 0; ci < cols; ci++) {
      if (!isFine(ci, cj)) continue;
      const [x, z] = [ground.minX + fromU + 2 * ci, ground.minZ + fromV + 2 * cj];
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        if (isFine(ci + di, cj + dj) || ci + di < 0 || cj + dj < 0 || ci + di >= cols || cj + dj >= rows) continue;
        // The middle of the shared edge, and the line it lies on.
        const [mx, mz] = [x + 1 + di, z + 1 + dj];
        const heights = heightsAt.get(lattice(mx, mz));
        if (!heights) continue;
        result.drawn++;
        const [line, at] = di !== 0 ? [`v${Math.round(mx * 1000)}`, mz] : [`h${Math.round(mz * 1000)}`, mx];
        if ((edgesAlong.get(line) ?? []).some(([a, b]) => a < at - 1e-6 && b > at + 1e-6)) result.spanned++;
        if (Math.max(...heights) - Math.min(...heights) > BORDER_HEIGHT_TOLERANCE) result.splitHeights++;
      }
    }
  }
  return result;
}

describe("given every course's terrain, drawn near, far, or a checkerboard of both", () => {
  for (const raw of [...TRACKS, ...OFF_MENU]) {
    const course = new Track(raw).id;
    describe(`given ${course}`, () => {
      const t = terrainOf(course);
      const { box, fineAt, coarseAt } = t.chunks;
      const chunks = box.length / 4;
      const columns = Math.ceil((box[(chunks - 1) * 4 + 2]! - box[0]!) / (box[2]! - box[0]!) - 1e-6);
      const near = (c: number): Drawn => ({ mesh: t.near, from: fineAt[c * 2 + 1]!, to: fineAt[c * 2 + 3]! });
      const far = (c: number): Drawn => ({ mesh: t.chunks.coarse, from: coarseAt[c * 2 + 1]!, to: coarseAt[c * 2 + 3]! });
      const chunkNumbers = Array.from({ length: chunks }, (_, c) => c);
      const cases = [
        { name: "every chunk near", drawn: chunkNumbers.map(near) },
        { name: "every chunk far", drawn: chunkNumbers.map(far) },
        ...[0, 1].map((parity) => ({ name: `a checkerboard of near and far chunks (${parity})`, drawn: chunkNumbers.map((c) => ((Math.floor(c / columns) + (c % columns)) % 2 === parity ? far(c) : near(c))) })),
      ];
      for (const testCase of cases) {
        it(`when ${testCase.name} are drawn, then no vertex lies inside another triangle's edge, no lattice point is drawn at two heights, and every triangle faces up`, () => {
          const { triangles, ...seams } = seamsOf(testCase.drawn, GROUND_CELL);
          assert.ok(triangles > 0, "something is drawn");
          assert.deepEqual(seams, { notFacingUp: 0, tJunctions: 0, splitHeights: 0 }, `${triangles} triangles`);
        });
        it(`when ${testCase.name} are drawn, then every border between a fine cell and a coarse one has its middle drawn as a vertex on both sides, at one height`, () => {
          const { drawn, spanned, splitHeights } = bordersOf(t, testCase.drawn);
          assert.deepEqual({ spanned, splitHeights }, { spanned: 0, splitHeights: 0 }, `${drawn} borders drawn`);
          if (MIXED_COURSES.includes(course) && testCase.name === "every chunk near") assert.ok(drawn >= MIN_POINTS, `${drawn} borders drawn`);
        });
      }
    });
  }
});

/** Where inside a drawn triangle the ground is read (barycentric weights of its three corners). */
const INTERIOR_POINTS = [[1 / 3, 1 / 3, 1 / 3], [0.6, 0.3, 0.1], [0.1, 0.2, 0.7]] as const;
/** Every this-many-th triangle of the near mesh is read, so a course costs a fraction of a second. */
const SAMPLE_EVERY = 5;
/** How far (m) a drawn corner may lie from its node's height and still be drawn at it: the arithmetic of a float32 and a double. */
const ON_NODE = 1e-6;

/** What a drawn single-cell triangle is: a 2 m cell's (coarse), a unit cell of a fine cell (fine), one on a fine cell's edge with a coarse cell, whose middle node lies on the coarse edge (transition), or one with a node on the road's crease (seam). */
const CELL_KINDS = ["coarse", "fine", "transition", "seam"] as const;

/** The ground read at interior points of drawn triangles: how many points, and the largest |ground - drawn| (m). */
type Reading = { compared: number; worst: number };

const noReading = (): Reading => ({ compared: 0, worst: 0 });

/**
 * The ground read at interior points of the near mesh's single-cell triangles (legs of one or two nodes) on the baked grid, where the point's unit cell is not
 * the road's crease (the ground reads that as the crease). Merged quads and the skirt are not single cells. A triangle whose corners are drawn at the baked
 * nodes' heights (`TerrainCells.drawn`) is `onNodes`, by what its cell is; one beside a coarser block has a corner eased along that block's edge (`vertexY`), `eased`.
 */
function groundAgainstDrawnCells(t: Terrain): { onNodes: Record<(typeof CELL_KINDS)[number], Reading>; eased: Reading } {
  const { pos, idx } = t.near;
  const { ground } = t;
  const { drawn } = ground.terrainCells;
  const creaseLat = ground.lat[0]!;
  const onCrease = (node: number) => !Number.isNaN(creaseLat[node]!);
  const onNodes = { coarse: noReading(), fine: noReading(), transition: noReading(), seam: noReading() };
  const eased = noReading();
  for (let k = 0; k < idx.length; k += 3 * SAMPLE_EVERY) {
    const [a, b, c] = [idx[k]! * 3, idx[k + 1]! * 3, idx[k + 2]! * 3];
    const area2 = Math.abs((pos[b]! - pos[a]!) * (pos[c + 2]! - pos[a + 2]!) - (pos[b + 2]! - pos[a + 2]!) * (pos[c]! - pos[a]!));
    const cellX = Math.min(pos[a]!, pos[b]!, pos[c]!);
    const cellZ = Math.min(pos[a + 2]!, pos[b + 2]!, pos[c + 2]!);
    const side = Math.round(Math.max(pos[a]!, pos[b]!, pos[c]!) - cellX);
    const deep = Math.max(pos[a + 2]!, pos[b + 2]!, pos[c + 2]!) - cellZ;
    if ((side !== 1 && side !== 2) || Math.abs(area2 - side * side) > 1e-6 || Math.abs(Math.max(pos[a]!, pos[b]!, pos[c]!) - cellX - side) > 1e-6 || Math.abs(deep - side) > 1e-6) continue;
    const gridX = cellX - ground.minX;
    const gridZ = cellZ - ground.minZ;
    if (gridX < 0 || gridZ < 0 || gridX + side >= ground.nx || gridZ + side >= ground.nz) continue;
    const first = gridZ * ground.nx + gridX;
    const corners = [first, first + side, first + side * ground.nx, first + side * ground.nx + side];
    const nodeOf = (v: number) => (Math.round(pos[v + 2]!) - ground.minZ) * ground.nx + Math.round(pos[v]!) - ground.minX;
    const touchesCrease = Array.from({ length: (side + 1) ** 2 }, (_, n) => first + Math.floor(n / (side + 1)) * ground.nx + (n % (side + 1))).some(onCrease);
    const kind = touchesCrease ? "seam" : side === 2 ? "coarse" : corners.some((n) => drawn[n] !== ground.heights[n]) ? "transition" : "fine";
    const drawnOnNodes = [a, b, c].every((v) => Math.abs(pos[v + 1]! - drawn[nodeOf(v)]!) <= ON_NODE);
    const reading = drawnOnNodes ? onNodes[kind] : eased;
    for (const [wa, wb, wc] of INTERIOR_POINTS) {
      const x = wa * pos[a]! + wb * pos[b]! + wc * pos[c]!;
      const z = wa * pos[a + 2]! + wb * pos[b + 2]! + wc * pos[c + 2]!;
      const unit = (Math.floor(z) - ground.minZ) * ground.nx + Math.floor(x) - ground.minX;
      if ([unit, unit + 1, unit + ground.nx, unit + ground.nx + 1].every(onCrease)) continue;
      const height = wa * pos[a + 1]! + wb * pos[b + 1]! + wc * pos[c + 1]!;
      reading.compared++;
      reading.worst = Math.max(reading.worst, Math.abs(ground.heightAt(x, z, -Infinity) - height));
    }
  }
  return { onNodes, eased };
}

/** How far (m) the ground may lie from a drawn triangle on the nodes' heights: the arithmetic of the two readings, not a modelling gap. */
const GROUND_DRAWN_TOLERANCE = 1e-6;
/** Courses with hills, crests or a banked road: every kind of cell must be read on them, at least `MIN_POINTS` points each (the others are flat, or a few big quads). */
const MIXED_COURSES = ["rally", "stunt", "four-count", "dam-spine", "razor-shelf", "havana"];
const MIN_POINTS = 40;

describe("given every course's terrain, its single-cell triangles drawn in 2 m cells and, where the shape needs them, 1 m cells", () => {
  for (const raw of [...TRACKS, ...OFF_MENU]) {
    const course = new Track(raw).id;
    it(`when the ground is read inside them on ${course}, then it is the height of the drawn triangle there in every kind of cell, to ${FLAT_TOL} m where a corner is eased to a coarser block's edge`, () => {
      const { onNodes, eased } = groundAgainstDrawnCells(terrainOf(course));
      for (const kind of CELL_KINDS) {
        const { compared, worst } = onNodes[kind];
        if (MIXED_COURSES.includes(course)) assert.ok(compared >= MIN_POINTS, `${compared} ${kind} points read`);
        assert.ok(worst <= GROUND_DRAWN_TOLERANCE, `${worst} m from the drawn triangle over ${compared} ${kind} points`);
      }
      assert.ok(eased.worst <= FLAT_TOL + GROUND_DRAWN_TOLERANCE, `${eased.worst} m from the eased triangle over ${eased.compared} points`);
    });
  }
});

describe("given a course's terrain batch (four-count)", () => {
  const t = terrainOf("four-count");
  const batch = new TerrainBatch(t.near, t.chunks, new THREE.MeshBasicMaterial());
  const camera = new THREE.PerspectiveCamera();
  const view = (x: number, z: number) => {
    camera.position.set(x, 3, z);
    camera.updateMatrixWorld(true);
    batch.view(camera);
  };
  /** Flat distance from (x, z) to drawn chunk k's nearest point. */
  const gap = (k: number, x: number, z: number) => {
    const b = batch.box;
    return Math.hypot(Math.max(b[k * 4]! - x, x - b[k * 4 + 2]!, 0), Math.max(b[k * 4 + 1]! - z, z - b[k * 4 + 3]!, 0));
  };

  it("when the camera stands on the course, then every chunk whose nearest point lies within 240 m draws near, and every other far", () => {
    const x = (batch.box[0]! + batch.box[batch.box.length - 2]!) / 2;
    const z = (batch.box[1]! + batch.box[batch.box.length - 1]!) / 2;
    view(x, z);
    let nearCount = 0;
    for (let k = 0; k < batch.far.length; k++) {
      assert.equal(batch.far[k], gap(k, x, z) > 240 ? 1 : 0, `chunk ${k} at ${gap(k, x, z)} m`);
      nearCount += 1 - batch.far[k]!;
    }
    assert.ok(nearCount > 0 && nearCount < batch.far.length, `${nearCount} of ${batch.far.length} near`);
  });

  it("when a far chunk's nearest point comes back to 230 m, then it stays far, and at 220 m it draws near again", () => {
    const z = (batch.box[1]! + batch.box[3]!) / 2;
    const edge = batch.box[2]!;
    view(edge + 300, z);
    assert.equal(batch.far[0], 1);
    view(edge + 230, z);
    assert.equal(batch.far[0], 1);
    view(edge + 220, z);
    assert.equal(batch.far[0], 0);
  });

  it("when the camera looks east from the middle of the course, then every chunk wholly behind it is left out, and the chunks straight ahead are drawn", () => {
    const x = (batch.box[0]! + batch.box[batch.box.length - 2]!) / 2;
    const z = (batch.box[1]! + batch.box[batch.box.length - 1]!) / 2;
    camera.position.set(x, 3, z);
    camera.lookAt(x + 100, 3, z);
    camera.updateMatrixWorld(true);
    batch.view(camera);
    let behind = 0;
    let ahead = 0;
    for (let k = 0; k < batch.far.length; k++) {
      const b = batch.box;
      if (b[k * 4 + 2]! < x) {
        behind++;
        assert.equal(batch.getVisibleAt(k), false, `chunk ${k} behind the camera`);
      } else if (b[k * 4]! > x && b[k * 4 + 1]! <= z && b[k * 4 + 3]! >= z) {
        ahead++;
        assert.equal(batch.getVisibleAt(k), true, `chunk ${k} straight ahead`);
      }
    }
    assert.ok(behind > 0 && ahead > 0, `${behind} chunks behind, ${ahead} straight ahead`);
  });
});

describe("given Razor Shelf, whose inside cut is a dirt road across dirt terrain", () => {
  it("when its ground layers are built, then every vertex of the dirt road strip is darker than the darkest terrain mottle (0.9 of the surface colour), and the paved road keeps its own colour", () => {
    const track = TRACKS.map((raw) => new Track(raw)).find((t) => t.id === "razor-shelf")!;
    assert.equal(track.json.environment.terrain, "dirt", "the staging: dirt terrain");
    const paths = track.paths();
    const layers = buildGroundLayers(track, track.ground(), new RoadIndex(paths), paths, paths.map((p) => sections(p, 0)));
    const brightest = (kind: string, surface: keyof typeof SURFACES): number => {
      const layer = layers.find((l) => l.kind === kind && l.surface === surface && l.level !== "deck");
      assert.ok(layer, `a ${kind} layer of ${surface}`);
      const base = new THREE.Color(SURFACES[surface].color);
      let most = 0;
      for (let i = 0; i < layer.m.col.length; i += 3) most = Math.max(most, layer.m.col[i]! / base.r, layer.m.col[i + 1]! / base.g, layer.m.col[i + 2]! / base.b);
      return most;
    };
    // The terrain draws each patch at 0.9 to 1.1 of its colour: a road at its full colour matched every patch beside it and 720 m read as open desert.
    const dirt = brightest("road", "dirt");
    assert.ok(dirt < 0.9, `the dirt road is drawn at up to ${dirt.toFixed(3)} of the dirt colour`);
    const paved = brightest("road", "asphalt");
    assert.ok(Math.abs(paved - 1) < 1e-6, `asphalt drawn at ${paved.toFixed(3)} of its colour`);
  });
});

describe("given the National Mall, whose lawns are painted on a concrete terrain drawn in one material", () => {
  const t = terrainOf("national-mall");
  const surfaceAt = (m: Mesher, v: number): number => SURFACE_IDS.findIndex((id) => {
    const c = new THREE.Color(SURFACES[id].color);
    return Math.abs(m.col[v * 3]! - c.r) + Math.abs(m.col[v * 3 + 1]! - c.g) + Math.abs(m.col[v * 3 + 2]! - c.b) < 1e-4;
  });

  for (const [name, mesher] of [["near", t.near], ["far", t.chunks.coarse]] as const) {
    it(`when its ${name} mesh is built, then a vertex coloured as grass is classed as soil and one coloured as concrete as concrete, so the lawn takes no concrete's shine or detail`, () => {
      assert.equal(mesher.cls?.length, mesher.pos.length / 3, "a class per vertex");
      const seen = new Set<number>();
      for (let v = 0; v < mesher.pos.length / 3; v++) {
        const surface = surfaceAt(mesher, v);
        if (surface < 0) continue;
        assert.equal(mesher.cls![v], surfaceClass(surface), `vertex ${v} of surface ${SURFACE_IDS[surface]}`);
        seen.add(surface);
      }
      assert.ok(seen.has(SURFACE_IDS.indexOf("grass")), "lawn vertices exist");
      assert.ok(seen.has(SURFACE_IDS.indexOf("concrete")), "concrete vertices exist");
      assert.equal(surfaceClass(SURFACE_IDS.indexOf("grass")), MATERIAL.SOIL, "grass is soil");
      assert.equal(surfaceClass(SURFACE_IDS.indexOf("concrete")), MATERIAL.CONCRETE, "concrete is concrete");
    });
  }
});
