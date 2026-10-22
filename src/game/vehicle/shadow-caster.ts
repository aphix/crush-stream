import * as THREE from "three";
import { hypot3 } from "../kernel/physics-core.js";
import { mergeGeometries, mergeVertices } from "three/addons/utils/BufferGeometryUtils.js";

/** Triangles a style's one-sided shell is decimated to: every style's shadow stays within the flush-casters bar of its full shell's. */
const CASTER_TRIANGLES = 1000;
/** Parts' seam vertices closer than this (m) weld into one, so the decimator sees one shell. */
const WELD = 1e-4;
/** meshoptimizer's error bound, relative to the shell's extent: 1 lets the triangle count alone stop it. */
const ANY_ERROR = 1;
/** The two-sided sheets' (wheel liners') error bound, relative to their extent: they stop on shape, not on a count. */
const SHEET_ERROR = 0.01;
/** The decimated shell is pushed out along its own normals this far (m): its chords cut inside the full shell's outline, most at thin edges (a roof's cant rail, roof bars). */
const CASTER_INFLATE = 0.006;

// three's bundled meshoptimizer is WebAssembly, which iOS Lockdown Mode switches off: a static import would throw on load there,
// so the caster keeps every triangle instead.
const simplifier = typeof WebAssembly === "object" ? (await import("three/addons/libs/meshopt_simplifier.module.js")).MeshoptSimplifier : null;
await simplifier?.ready;

/**
 * `meshes` (world matrices current, the car at the origin) as one position-only shell, decimated to `CASTER_TRIANGLES` and pushed
 * out `CASTER_INFLATE`. A two-sided sheet (a triangle and its reversed twin) is decimated apart as one side and drawn both ways:
 * welded together, the decimator drops it.
 */
export function restShell(meshes: readonly THREE.Mesh[]): THREE.BufferGeometry {
  const parts = meshes.map((m) => {
    const src = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry;
    return new THREE.BufferGeometry().setAttribute("position", src.getAttribute("position").clone()).applyMatrix4(m.matrixWorld);
  });
  const merged = mergeGeometries(parts, false);
  for (const g of parts) g.dispose();
  if (!merged) throw new Error("Failed to merge a rest caster");
  const shell = mergeVertices(merged, WELD);
  merged.dispose();
  const index = shell.index!.array;
  if (!simplifier || index.length <= CASTER_TRIANGLES * 3) return shell;
  const positions = shell.getAttribute("position").array as Float32Array;
  const [solid, sheet] = splitTwinSheets(index);
  const [keptSolid] = simplifier.simplify(solid, positions, 3, CASTER_TRIANGLES * 3, ANY_ERROR);
  const [keptSheet] = simplifier.simplify(sheet, positions, 3, 0, SHEET_ERROR);
  inflate(positions, keptSolid);
  const out = new Uint32Array(keptSolid.length + keptSheet.length * 2);
  out.set(keptSolid);
  out.set(keptSheet, keptSolid.length);
  for (let t = 0, o = keptSolid.length + keptSheet.length; t < keptSheet.length; t += 3, o += 3) {
    out[o] = keptSheet[t]!;
    out[o + 1] = keptSheet[t + 2]!;
    out[o + 2] = keptSheet[t + 1]!;
  }
  return shell.setIndex(new THREE.BufferAttribute(out, 1));
}

/** Moves each vertex of the `index` triangles `CASTER_INFLATE` out along their area-weighted normal there. */
function inflate(positions: Float32Array, index: Uint32Array): void {
  const normals = new Float32Array(positions.length);
  for (let t = 0; t < index.length; t += 3) {
    const [a, b, c] = [index[t]! * 3, index[t + 1]! * 3, index[t + 2]! * 3];
    const [ux, uy, uz] = [positions[b]! - positions[a]!, positions[b + 1]! - positions[a + 1]!, positions[b + 2]! - positions[a + 2]!];
    const [vx, vy, vz] = [positions[c]! - positions[a]!, positions[c + 1]! - positions[a + 1]!, positions[c + 2]! - positions[a + 2]!];
    const [nx, ny, nz] = [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx];
    for (const v of [a, b, c]) {
      normals[v] += nx;
      normals[v + 1] += ny;
      normals[v + 2] += nz;
    }
  }
  for (let v = 0; v < positions.length; v += 3) {
    const length = hypot3(normals[v]!, normals[v + 1]!, normals[v + 2]!);
    if (length === 0) continue;
    for (let k = 0; k < 3; k++) positions[v + k] += (normals[v + k]! / length) * CASTER_INFLATE;
  }
}

/** `index`'s triangles without a twin on the same three vertices, and one side of each twinned pair. */
function splitTwinSheets(index: ArrayLike<number>): [Uint32Array, Uint32Array] {
  const firstOf = new Map<string, number>();
  const twinned = new Uint8Array(index.length / 3);
  for (let t = 0; t < twinned.length; t++) {
    const key = [index[t * 3]!, index[t * 3 + 1]!, index[t * 3 + 2]!].sort((x, y) => x - y).join(",");
    const first = firstOf.get(key);
    if (first === undefined) firstOf.set(key, t);
    else twinned[first] = twinned[t] = 1;
  }
  const solid: number[] = [];
  const sheet: number[] = [];
  const seen = new Set<string>();
  for (let t = 0; t < twinned.length; t++) {
    const tri = [index[t * 3]!, index[t * 3 + 1]!, index[t * 3 + 2]!];
    if (!twinned[t]) solid.push(...tri);
    else {
      const key = [...tri].sort((x, y) => x - y).join(",");
      if (!seen.has(key)) sheet.push(...tri);
      seen.add(key);
    }
  }
  return [Uint32Array.from(solid), Uint32Array.from(sheet)];
}
