import * as THREE from "three";
import { sortByDrawClass } from "../present/draw-order.ts";

/**
 * Lit shaders skip a point or spot light's BRDF where the light adds nothing: past its range, outside its cone,
 * or at intensity 0. Every lit program carries the lamp pool's 4 head and 4 tail spots (`lamp-lights.ts`: changing
 * the count relinks every program), the impact flash and the derby winner's spot, and three ran the full BRDF
 * for each of them on every fragment. Exact: three already zeroes such a light's colour and clears `visible`.
 */
const RE_DIRECT = "RE_Direct( directLight, ";
const SKIP_DARK = `if ( directLight.visible ) ${RE_DIRECT}`;
const lightsChunk = THREE.ShaderChunk.lights_fragment_begin;
if (!lightsChunk.includes(RE_DIRECT)) throw new Error("three's lights_fragment_begin changed: re-check the dark-light skip");
if (!lightsChunk.includes(SKIP_DARK)) THREE.ShaderChunk.lights_fragment_begin = lightsChunk.replaceAll(RE_DIRECT, SKIP_DARK);

/**
 * The page's renderer: sRGB out, ACES at the game's exposure, PCF shadows; its pixel ratio is the Render scale (`PlayerQuality`). The
 * canvas has MSAA on a device of pixel ratio 1 or less, as it always has: the plain tiers (off, minimal), which draw straight to it,
 * take their edges from it. The post tiers draw the scene into their own target, antialiased at the tiers and device pixel ratios
 * `sceneSamples` picks (`engine-post.ts`).
 */
export function makeRenderer(canvas: HTMLCanvasElement, onContext?: (gl: WebGL2RenderingContext) => void): THREE.WebGLRenderer {
  // three r186 makes its own context with `alpha: true` whatever its `alpha` option says, compositing a transparent canvas.
  const context = canvas.getContext("webgl2", { alpha: false, antialias: (window.devicePixelRatio || 1) <= 1, powerPreference: "high-performance" });
  if (!context) throw new Error("WebGL2 is not available");
  onContext?.(context);
  const renderer = new THREE.WebGLRenderer({ canvas, context });
  renderer.setClearColor(0x12141a, 1);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.45;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.setOpaqueSort(sortByDrawClass);
  return renderer;
}
