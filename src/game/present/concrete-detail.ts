import * as THREE from "three";
import { MATERIAL_DETAIL, MATERIAL_DETAIL_READY } from "../vehicle/material-class.ts";
import { loadUprightBitmap } from "./bitmap-loader.ts";

/**
 * The worn-concrete detail map: "Concrete Floor Worn 02" by Dimitrios Savva, CC0, https://polyhaven.com/a/concrete_floor_worn_02.
 * Its 1k normal (GL) and diffuse, high-passed and scaled to 512, packed in one opaque WebP (`scripts/pack-concrete-detail.mjs`):
 * R, G the normal's x and y, B the tone (lightness over its mean, half).
 */
const DETAIL_URL = `${import.meta.env?.BASE_URL ?? "/"}materials/concrete-detail.webp`;
const DETAIL_ANISOTROPY = 4;

const state = { finishTier: false, loaded: false, asked: false };

/**
 * Turn the detail on for the finish tiers (high, ultra) and off elsewhere. The first finish tier fetches the map; until it arrives the
 * detail stays off, and its one texture is never created on the tiers that do not draw it. One map for the page's life, like the uniform it fills.
 */
export function setConcreteDetailTier(isFinishTier: boolean): void {
  state.finishTier = isFinishTier;
  MATERIAL_DETAIL_READY.value = state.finishTier && state.loaded ? 1 : 0;
  if (!state.finishTier || state.asked) return;
  state.asked = true;
  // No bitmap decoder (node, the headless tests): the detail stays off rather than failing a fetch it cannot decode.
  if (typeof createImageBitmap !== "function") return;
  void loadConcreteDetail();
}

async function loadConcreteDetail(): Promise<void> {
  try {
    const texture = new THREE.Texture(await loadUprightBitmap(DETAIL_URL));
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.anisotropy = DETAIL_ANISOTROPY;
    texture.flipY = false;
    texture.needsUpdate = true;
    MATERIAL_DETAIL.value = texture;
    state.loaded = true;
    MATERIAL_DETAIL_READY.value = state.finishTier ? 1 : 0;
  } catch (err) {
    console.error(`Crush Stream's worn-concrete detail ${DETAIL_URL} did not load`, err);
  }
}
