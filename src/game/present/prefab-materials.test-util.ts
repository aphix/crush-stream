import type * as THREE from "three";
import { FACADE, type FacadeStyle } from "./facades.ts";
import type { PrefabMaterials } from "./prefab-pieces.ts";
import { ASSET_FAMILIES, type AssetFamily } from "../world/scenery-assets/types.ts";

/** Every shared prefab material as `material`: for a test that reads the shapes, not the look. */
export function plainMaterials(material: THREE.Material): PrefabMaterials {
  const facades = Object.fromEntries(Object.keys(FACADE).map((style) => [style, material])) as Record<FacadeStyle, THREE.Material>;
  const assets = Object.fromEntries(ASSET_FAMILIES.map((family) => [family, material])) as Record<AssetFamily, THREE.Material>;
  return { plain: material, nature: material, concrete: material, paving: material, facades, assets, billboard: material, water: material };
}
