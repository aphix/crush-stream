import type * as THREE from "three";
import type { PrefabMaterials } from "./prefab-pieces.ts";

/** Every shared prefab material as `material`: for a test that reads the shapes, not the look. */
export function plainMaterials(material: THREE.Material): PrefabMaterials {
  return { plain: material, concrete: material, facades: { prague: material, dc: material, stucco: material, glass: material, adobe: material }, billboard: material, water: material };
}
