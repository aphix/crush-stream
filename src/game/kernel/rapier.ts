import type RAPIER from "@dimforge/rapier3d-simd";
import type { RigidBody } from "@dimforge/rapier3d-simd";
import type * as RapierWasm from "@dimforge/rapier3d-simd/rapier_wasm3d_bg.wasm";
import { once } from "./scalar.ts";

/** The Rapier namespace (`@dimforge/rapier3d-simd`, Apache-2.0). */
export type Rapier = typeof RAPIER;

/**
 * The game's one Rapier (0.19.3, the SIMD wasm build: the same API as the plain one, contact-heavy ragdoll steps about 16 %
 * faster, 11.7 % on average; flat step allocation, RapierEval), loaded once on first call; every caller shares
 * the promise. Its own chunk (173 kB, 29 kB gz) plus the separate `.wasm` (1.57 MB, 0.59 MB gz) that the browser
 * compiles as it streams in: 618 kB over the wire and no frame over 33 ms at 4× CPU, where the base64-inlined
 * compat build is 832 kB and stalls one frame 183–217 ms. The engine starts it after boot. Use this, never a
 * second import path or version. WebAssembly SIMD is in every browser Vite's default target names (Chrome 111, Firefox 114, Safari 16.4).
 */
export const loadRapier = once(async (): Promise<Rapier> => {
  // Dynamic on purpose: a static import would put Rapier in the boot bundle. The `.wasm` is the module Rapier's own bindings import: the one instance.
  const [rapier, exports] = await Promise.all([import("@dimforge/rapier3d-simd"), import("@dimforge/rapier3d-simd/rapier_wasm3d_bg.wasm")]);
  loaded.wasm = exports;
  return rapier.default;
});

/** Rapier's wasm exports, null until `loadRapier` resolves; then never changes (Rapier's own module instance). */
const loaded: { wasm: typeof RapierWasm | null } = { wasm: null };

function wasmOf(): typeof RapierWasm {
  const w = loaded.wasm;
  if (w === null) throw new Error("Rapier is not loaded (loadRapier)");
  return w;
}

/** The wasm pointer of `body`'s body set: what each of its getters passes. */
function setOf(body: RigidBody): number {
  const ptr: unknown = Reflect.get(Reflect.get(body, "rawSet"), "__wbg_ptr");
  if (typeof ptr !== "number") throw new Error("Rapier's body set has no wasm pointer: its bindings changed");
  return ptr;
}

/** The `RawVector` at `ptr` into `out` at `o` (xyz), then freed. */
function takeVector(w: typeof RapierWasm, ptr: number, out: Float32Array | Float64Array, o: number): void {
  out[o] = w.rawvector_x(ptr);
  out[o + 1] = w.rawvector_y(ptr);
  out[o + 2] = w.rawvector_z(ptr);
  w.__wbg_rawvector_free(ptr, 0);
}

/*
 * `body`'s position, rotation (xyzw), linear or angular velocity into `out` at `o`: the wasm calls its getters make, without
 * the getters' own garbage (a `RawVector` registered with a `FinalizationRegistry` and a vector: about 190 B a read).
 */
export function readTranslation(body: RigidBody, out: Float32Array | Float64Array, o: number): void {
  const w = wasmOf();
  takeVector(w, w.rawrigidbodyset_rbTranslation(setOf(body), body.handle) >>> 0, out, o);
}

export function readLinvel(body: RigidBody, out: Float32Array | Float64Array, o: number): void {
  const w = wasmOf();
  takeVector(w, w.rawrigidbodyset_rbLinvel(setOf(body), body.handle) >>> 0, out, o);
}

export function readAngvel(body: RigidBody, out: Float32Array | Float64Array, o: number): void {
  const w = wasmOf();
  takeVector(w, w.rawrigidbodyset_rbAngvel(setOf(body), body.handle) >>> 0, out, o);
}

export function readRotation(body: RigidBody, out: Float32Array | Float64Array, o: number): void {
  const w = wasmOf();
  const ptr = w.rawrigidbodyset_rbRotation(setOf(body), body.handle) >>> 0;
  out[o] = w.rawrotation_x(ptr);
  out[o + 1] = w.rawrotation_y(ptr);
  out[o + 2] = w.rawrotation_z(ptr);
  out[o + 3] = w.rawrotation_w(ptr);
  w.__wbg_rawrotation_free(ptr, 0);
}

/**
 * Takes `body` and its colliders out of the world. In 0.19.3 `setEnabled(false)` alone leaves the colliders of a body
 * that moved or touched something in the last step behind as invisible fixed obstacles (a box dropped onto one rested
 * on it 240 of 240 steps): new bodies spawned onto them blew up to 10⁴ m/s and a non-finite bound panicked the broad
 * phase. So every collider's collision groups go to 0 first; whoever enables the body again sets them again.
 */
export function disable(body: RigidBody): void {
  for (let c = 0, n = body.numColliders(); c < n; c++) body.collider(c).setCollisionGroups(0);
  body.setEnabled(false);
}
