import * as THREE from "three";
import { sortByDrawClass } from "../present/draw-order.ts";

/**
 * Lit shaders skip a point or spot light's BRDF where the light adds nothing: past its range, outside its cone,
 * or at intensity 0. Every lit program carries the lamp pool's 4 spots and 4 points (`lamp-lights.ts`: changing
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
 * canvas has no MSAA: the post tiers draw the scene into their own target, antialiased at the tiers and device pixel ratios
 * `sceneSamples` picks (`engine-post.ts`), and the plain tiers that draw straight to the canvas have none.
 */
export function makeRenderer(canvas: HTMLCanvasElement): THREE.WebGLRenderer {
  // three r186 makes its own context with `alpha: true` whatever its `alpha` option says, compositing a transparent canvas.
  const context = canvas.getContext("webgl2", { alpha: false, antialias: false, powerPreference: "high-performance" });
  if (!context) throw new Error("WebGL2 is not available");
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
