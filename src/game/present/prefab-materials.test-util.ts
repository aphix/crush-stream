import type * as THREE from "three";
import { FACADE, type FacadeStyle } from "./facades.ts";
import type { PrefabMaterials } from "./prefab-pieces.ts";

/** Every shared prefab material as `material`: for a test that reads the shapes, not the look. */
export function plainMaterials(material: THREE.Material): PrefabMaterials {
  const facades = Object.fromEntries(Object.keys(FACADE).map((style) => [style, material])) as Record<FacadeStyle, THREE.Material>;
  return { plain: material, concrete: material, facades, billboard: material, water: material };
}
