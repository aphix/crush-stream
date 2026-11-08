import * as THREE from "three";
import { once } from "../kernel/scalar.ts";
import { finishForTier } from "../vehicle/car-finish.ts";
import { loadUprightBitmap } from "./bitmap-loader.ts";
import type { FxTier } from "./engine-post.ts";

/**
 * The tileable normal maps of the drawn world (ground, building facades and roofs), shared by tier. Every user binds one flat 1x1 normal at scale 0 until
 * the relief tier is on and its map has loaded: the shader keeps the normal map's define either way, so a tier switch changes uniforms and
 * bindings, never a program (a relinked program mid-play is a frame hitch, `scripts/check-programs.mjs`). A map is fetched the first time the
 * tier is on with a user of it, so the tiers without relief never download, decode or upload one.
 */

/** A tileable normal map: where it is served from, how many times it repeats over the mesh's own uv, and whether v clamps where the colour maps beside it do (a facade's foot). */
export type ReliefSpec = { url: string; repeat: number; clampV?: boolean };

/** Takes the map to draw with and the normal's strength (0: flat). */
type Apply = (map: THREE.Texture, scale: number) => void;

type Slot = { spec: ReliefSpec; real: THREE.Texture | null; asked: boolean; users: Set<Apply> };

/** Relief is for the finish tiers (high, ultra) on a desktop: a phone and the software rasterizer keep today's flat look at any tier. */
export function reliefForTier(tier: FxTier, phone: boolean): boolean {
  return finishForTier(tier) && !phone;
}

const state = { on: false };
const slots = new Map<string, Slot>();
const flat = once((): THREE.DataTexture => {
  const tex = new THREE.DataTexture(new Uint8Array([128, 128, 255, 255]), 1, 1);
  tex.colorSpace = THREE.NoColorSpace;
  tex.needsUpdate = true;
  return tex;
});

function show(slot: Slot, apply: Apply): void {
  if (state.on && slot.real) apply(slot.real, 1);
  else apply(flat(), 0);
}

async function load(slot: Slot): Promise<void> {
  try {
    const tex = new THREE.Texture(await loadUprightBitmap(slot.spec.url));
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = slot.spec.clampV ? THREE.ClampToEdgeWrapping : THREE.RepeatWrapping;
    tex.repeat.set(slot.spec.repeat, slot.spec.repeat);
    tex.flipY = false;
    tex.colorSpace = THREE.NoColorSpace;
    tex.anisotropy = 4;
    tex.needsUpdate = true;
    slot.real = tex;
    for (const apply of slot.users) show(slot, apply);
  } catch (err) {
    console.error(`Crush Stream's relief map ${slot.spec.url} did not load`, err);
  }
}

/** Fetch a slot's map when the tier is on and it has users; where there is no bitmap decoder (node) nothing is fetched and the flat map stays. */
function ask(slot: Slot): void {
  if (!state.on || slot.asked || slot.users.size === 0 || typeof createImageBitmap !== "function") return;
  slot.asked = true;
  void load(slot);
}

/**
 * `apply` gets the flat map now and the real one while the relief tier is on and the map is loaded. Returns the call that stops it
 * (a disposed material). Every user of one url shares one texture, so they share `spec.repeat`.
 */
export function followRelief(spec: ReliefSpec, apply: Apply): () => void {
  let slot = slots.get(spec.url);
  if (!slot) slots.set(spec.url, (slot = { spec, real: null, asked: false, users: new Set() }));
  slot.users.add(apply);
  show(slot, apply);
  ask(slot);
  return () => slot.users.delete(apply);
}

/** A material's normal map follows the relief: it owns the slot only while nothing else (Ultra's photographs) has taken it. */
export function reliefMaterial(material: THREE.MeshStandardMaterial, spec: ReliefSpec): void {
  let owned: THREE.Texture | null = null;
  const stop = followRelief(spec, (map, scale) => {
    if (material.normalMap !== owned) return;
    owned = map;
    material.normalMap = map;
    material.normalScale.set(scale, scale);
  });
  material.addEventListener("dispose", stop);
}

/**
 * Relief on or off, for every user and every map from now on. Call it after Ultra's wear or unwear: a material Ultra has dressed keeps its photograph,
 * and one it has just undressed takes the state again here.
 */
export function setReliefTier(on: boolean): void {
  state.on = on;
  for (const slot of slots.values()) {
    ask(slot);
    for (const apply of slot.users) show(slot, apply);
  }
}
