import * as THREE from "three";
import { mergeGeometries, mergeVertices } from "three/addons/utils/BufferGeometryUtils.js";

/** Triangles a style's rest caster is decimated to: every style's shadow stays within half a percent of its full shell's. */
const CASTER_TRIANGLES = 1000;
/** Parts' seam vertices closer than this (m) weld into one, so the decimator sees one shell. */
const WELD = 1e-4;
/** meshoptimizer's error bound, relative to the shell's extent: 1 lets the triangle count alone stop it. */
const ANY_ERROR = 1;

// three's bundled meshoptimizer is WebAssembly, which iOS Lockdown Mode switches off: a static import would throw on load there,
// so the caster keeps every triangle instead.
const simplifier = typeof WebAssembly === "object" ? (await import("three/addons/libs/meshopt_simplifier.module.js")).MeshoptSimplifier : null;
await simplifier?.ready;

/** `meshes` (world matrices current, the car at the origin) as one position-only shell, decimated to `CASTER_TRIANGLES`. */
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
  const index = shell.index!.array as Uint16Array | Uint32Array;
  if (!simplifier || index.length <= CASTER_TRIANGLES * 3) return shell;
  const positions = shell.getAttribute("position").array as Float32Array;
  const [kept] = simplifier.simplify(index, positions, 3, CASTER_TRIANGLES * 3, ANY_ERROR);
  return shell.setIndex(new THREE.BufferAttribute(kept, 1));
}
