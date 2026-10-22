import * as THREE from "three";
import { clamp } from "../kernel/scalar.ts";
import { applyCarFinish } from "./car-finish.ts";
import { applyDetailMap } from "./car-detail-map.ts";
import { makePaintMaterial } from "./car-materials.ts";
import type { BodyStyle } from "./car-variants.ts";

/** The detail format's texels read back: RGBA8, height ±6 mm about byte 128 in 127 steps, cavity 0..255, and the height's slope along
 * the tile's two axes square-root coded about byte 128 up to ±1.5 m/m. */
const CHANNELS = 4;
const HEIGHT_ZERO_BYTE = 128;
const HEIGHT_STEPS = 127;
const HEIGHT_MAX_M = 0.006;
const SLOPE_MAX = 1.5;
const BYTE_MAX = 255;
/** The shader's tile slots. */
const VIEW_SLOT = { side: 0, top: 1, front: 2, rear: 3, bottom: 4 } as const;

type DetailView = keyof typeof VIEW_SLOT;

/** What a three program build hands `onBeforeCompile` (the physical template, includes unresolved), after `material`'s hooks ran on it. */
export function compileHooks(material: THREE.Material): { uniforms: Record<string, THREE.IUniform>; vertexShader: string; fragmentShader: string } {
  const shader = { uniforms: {}, vertexShader: THREE.ShaderLib.physical.vertexShader, fragmentShader: THREE.ShaderLib.physical.fragmentShader };
  Reflect.apply(material.onBeforeCompile, material, [shader]);
  return shader;
}

/** Switch the finish of `material` on or off, as the FX tier does. */
export function switchFinish(material: THREE.Material, on: boolean): void {
  applyCarFinish(new THREE.Mesh(new THREE.BufferGeometry(), material), on);
}

/** A fresh paint material wearing `style`'s detail map, its finish on. */
export function detailPaint(style: BodyStyle): THREE.MeshPhysicalMaterial {
  const material = makePaintMaterial(0xffffff);
  applyDetailMap(material, style);
  switchFinish(material, true);
  return material;
}

/**
 * `style`'s baked atlas read as the shader reads it: the `view` tile at its own axes (a, b) in metres (side [z, y], top and bottom [z, x],
 * front / rear [x, y]), x folded to |x|, through the tile and bounds uniforms; the nearest texel's height (m), cavity and the height's
 * slope (m/m) along a and b.
 */
export function detailReader(style: BodyStyle): (view: DetailView, a: number, b: number) => { height: number; cavity: number; slope: [number, number] } {
  const { uniforms } = compileHooks(detailPaint(style));
  const texture = uniforms.detailMap!.value as THREE.DataTexture;
  const { data, width, height } = texture.image as { data: Uint8Array; width: number; height: number };
  const tiles = uniforms.detailTiles!.value as THREE.Vector4[];
  const bounds = uniforms.detailBounds!.value as THREE.Vector4[];
  const slope = (byte: number) => {
    const code = (byte - HEIGHT_ZERO_BYTE) / HEIGHT_STEPS;
    return code * Math.abs(code) * SLOPE_MAX;
  };
  return (view, a, b) => {
    const tile = tiles[VIEW_SLOT[view]]!;
    const box = bounds[VIEW_SLOT[view]]!;
    const u = view === "front" || view === "rear" ? Math.abs(a) : a;
    const v = view === "top" || view === "bottom" ? Math.abs(b) : b;
    const s = clamp(tile.x + u * tile.z, box.x, box.z);
    const t = clamp(tile.y + v * tile.w, box.y, box.w);
    const at = CHANNELS * (Math.floor(t * height) * width + Math.floor(s * width));
    return {
      height: ((data[at]! - HEIGHT_ZERO_BYTE) / HEIGHT_STEPS) * HEIGHT_MAX_M,
      cavity: data[at + 1]! / BYTE_MAX,
      slope: [slope(data[at + 2]!), slope(data[at + 3]!)],
    };
  };
}
