import * as THREE from "three";
import { hypot3 } from "../kernel/physics-core.js";
import { SPRAY_DEPTH_BAND, SPRAY_FACE, SPRAY_PALETTE, sprayFace, type SprayLayout, type SprayPaint, type SpraySurface } from "../match/look-data.ts";

/**
 * Spray paint drawn: a bitmap's texels as the premultiplied texture the paint shader samples (`SprayBitmap`), the can's
 * stamp, and the shader patch that lays the paint over a material (`applySpray`), with the face mapping of `sprayFace`
 * (`match/look-data.ts`) in GLSL.
 */

/** Along a stroke, a puff every this many dot radii of its travel (world), so a fast drag leaves a line, not dots: the garage's can and the rivals' pen (`rival-pen.ts`) both step by it. */
export const PUFF_STEP = 0.5;

const _uv = new Float64Array(2);

/** One bitmap: an ink per texel, each ink's colour (`palette`, the presets until a colour of the player's own takes an ink), and the premultiplied RGBA texture the shader samples (linear filtered: soft edges). */
export class SprayBitmap {
  readonly layout: SprayLayout;
  readonly texels: Uint8Array;
  readonly palette: number[] = [...SPRAY_PALETTE];
  readonly rgba: Uint8Array;
  readonly texture: THREE.DataTexture;
  /** Paint a bare texel shows (a cop's livery under its player's spray): drawn only, never in `texels` or `palette`, so never on the wire or in storage. */
  private under: SprayPaint | null = null;

  /** `mipmapped`: the texture keeps a mip chain (the rivals' finer bitmaps, which a far car would otherwise alias); the garage's stays unmipped. */
  constructor(layout: SprayLayout, mipmapped = false) {
    this.layout = layout;
    this.texels = new Uint8Array(layout.w * layout.h);
    this.rgba = new Uint8Array(layout.w * layout.h * 4);
    this.texture = new THREE.DataTexture(this.rgba, layout.w, layout.h);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.magFilter = THREE.LinearFilter;
    this.texture.minFilter = mipmapped ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter;
    this.texture.generateMipmaps = mipmapped;
    this.texture.needsUpdate = true;
  }

  /** Whether any texel is painted. */
  painted(): boolean {
    for (let i = 0; i < this.texels.length; i++) if (this.texels[i] !== 0) return true;
    return false;
  }

  /**
   * The ink that sprays `colour` (sRGB): one that has it already, else the first ink no texel shows takes it; with all 15
   * shown, the nearest one's. ponytail: 15 inks keep the wire at 4 bits a texel; go to a byte a texel if a 16th colour must stay exact.
   */
  inkOf(colour: number): number {
    const has = this.palette.indexOf(colour, 1);
    if (has > 0) return has;
    const shown = new Uint8Array(this.palette.length);
    for (let i = 0; i < this.texels.length; i++) shown[this.texels[i]!] = 1;
    const free = shown.indexOf(0, 1);
    if (free > 0) {
      this.palette[free] = colour;
      return free;
    }
    let nearest = 1;
    for (let ink = 2; ink < this.palette.length; ink++) if (colourDistance(this.palette[ink]!, colour) < colourDistance(this.palette[nearest]!, colour)) nearest = ink;
    return nearest;
  }

  /**
   * A puff of the can at rest point `p` with normal `n`: texels within `radius` m of it on its face take ink `ink`, each
   * with a chance falling from 1 at the middle to 0 at the edge (`rand`), so the dot is dense in the middle and speckled at
   * its rim. With `surface` (the outermost surface per texel) the paint belongs to the body part `part` (an index + 1) the
   * can hit: only texels whose outermost surface is that part take it, so a hip beside or behind a hand stays bare.
   * False when the point's face takes no paint.
   */
  spray(p: THREE.Vector3, n: THREE.Vector3, radius: number, ink: number, rand: () => number, surface: SpraySurface | null = null, part = 0): boolean {
    const face = sprayFace(this.layout, p.x, p.y, p.z, n.x, n.y, n.z, _uv);
    if (face < 0) return false;
    const [fx, fy, fw, fh] = this.layout.faces[face]!;
    const { min, max } = this.layout;
    // The face's axes in metres: u runs along z on the sides and the top, x on the ends; v along y, x on the top.
    const spanU = face === SPRAY_FACE.front || face === SPRAY_FACE.back ? max[0] - min[0] : max[2] - min[2];
    const spanV = face === SPRAY_FACE.top ? max[0] - min[0] : max[1] - min[1];
    const cu = fx + _uv[0]! * fw;
    const cv = fy + _uv[1]! * fh;
    const ru = (radius * fw) / spanU;
    const rv = (radius * fh) / spanV;
    for (let y = Math.max(fy, Math.floor(cv - rv)); y < Math.min(fy + fh, Math.ceil(cv + rv)); y++) {
      for (let x = Math.max(fx, Math.floor(cu - ru)); x < Math.min(fx + fw, Math.ceil(cu + ru)); x++) {
        const du = (x + 0.5 - cu) / ru;
        const dv = (y + 0.5 - cv) / rv;
        const d = Math.sqrt(du * du + dv * dv);
        if (surface && surface.part[y * this.layout.w + x] !== part) continue;
        if (d < 1 && rand() < 1 - d) this.set(y * this.layout.w + x, ink);
      }
    }
    this.texture.needsUpdate = true;
    return true;
  }

  /** Every texel and ink from `paint` (a bitmap of this layout), or bare with the presets when null. */
  load(paint: SprayPaint | null): void {
    for (let ink = 0; ink < this.palette.length; ink++) this.palette[ink] = paint ? paint.palette[ink]! : SPRAY_PALETTE[ink]!;
    if (paint) for (let i = 0; i < this.texels.length; i++) this.set(i, paint.texels[i]!);
    else for (let i = 0; i < this.texels.length; i++) this.set(i, 0);
    this.texture.needsUpdate = true;
  }

  /** Texels `at` take `inks` (one each) with the bitmap's inks set to `palette`: an undo or redo step (`SprayUndo`). Every other texel's ink keeps its colour across a step. */
  restore(at: Uint16Array, inks: Uint8Array, palette: readonly number[]): void {
    for (let ink = 0; ink < this.palette.length; ink++) this.palette[ink] = palette[ink]!;
    for (let k = 0; k < at.length; k++) this.set(at[k]!, inks[k]!);
    this.texture.needsUpdate = true;
  }

  /** Bare texels show `paint` (a bitmap of this layout), or nothing when null; the painted ones keep their ink. */
  underlay(paint: SprayPaint | null): void {
    if (paint === this.under) return;
    this.under = paint;
    for (let i = 0; i < this.texels.length; i++) if (this.texels[i] === 0) this.set(i, 0);
    this.texture.needsUpdate = true;
  }

  dispose(): void {
    this.texture.dispose();
  }

  /** Texel `i` takes ink `ink`; bare (0) shows the underlay's texel, else all zeros, so its premultiplied RGB stays black. */
  private set(i: number, ink: number): void {
    this.texels[i] = ink;
    const from: SprayPaint = ink === 0 && this.under ? this.under : this;
    const shown = from.texels[i]!;
    const hex = from.palette[shown]!;
    this.rgba[i * 4] = hex >> 16;
    this.rgba[i * 4 + 1] = (hex >> 8) & 0xff;
    this.rgba[i * 4 + 2] = hex & 0xff;
    this.rgba[i * 4 + 3] = shown === 0 ? 0 : 255;
  }
}

/** Colours `a` and `b` (sRGB) this far apart. */
export function colourDistance(a: number, b: number): number {
  return hypot3((a >> 16) - (b >> 16), ((a >> 8) & 0xff) - ((b >> 8) & 0xff), (a & 0xff) - (b & 0xff));
}

/**
 * A spray's depth test: under `map`'s texel's outermost surface by more than `band` m a fragment draws no paint. With `torn` (a car's),
 * only under a cover the car has lost: `map`'s second byte names the cover (1-4), `torn`'s component for it is 1 once it is off.
 */
type SprayDepth = { readonly map: THREE.Texture; readonly band?: number; readonly torn?: THREE.Vector4 };

/** The shader's spray uniforms for a bitmap of `layout` sampled from `map`, `rows` bitmaps stacked up it (one per dummy slot), with `depth`'s test. */
export function sprayUniforms(layout: SprayLayout, map: THREE.Texture, rows: number, depth: SprayDepth | null = null): Record<string, THREE.IUniform> {
  return {
    sprayMap: { value: map },
    sprayMin: { value: new THREE.Vector3(...layout.min) },
    spraySpan: { value: new THREE.Vector3(layout.max[0] - layout.min[0], layout.max[1] - layout.min[1], layout.max[2] - layout.min[2]) },
    sprayFaces: { value: layout.faces.map(([x, y, w, h]) => new THREE.Vector4(x / layout.w, y / layout.h, w / layout.w, h / layout.h)) },
    sprayRows: { value: rows },
    ...(depth && { sprayDepth: { value: depth.map }, sprayBand: { value: depth.band ?? SPRAY_DEPTH_BAND } }),
    ...(depth?.torn && { sprayTorn: { value: depth.torn } }),
  };
}

/** `sprayFace` and `sprayDraws` on the GPU: the premultiplied spray over this fragment (none off the box's painted faces, or with no rest normal). */
const SPRAY_FRAGMENT = /* glsl */ `
uniform sampler2D sprayMap;
uniform vec3 sprayMin;
uniform vec3 spraySpan;
uniform vec4 sprayFaces[5];
uniform float sprayRows;
#ifdef SPRAY_DEPTH
uniform sampler2D sprayDepth;
uniform float sprayBand;
#endif
#ifdef SPRAY_TORN
uniform vec4 sprayTorn;
#endif
varying vec3 vSprayP;
varying vec3 vSprayN;
varying float vSprayRow;
vec4 sprayTexel() {
  vec3 n = vSprayN;
  vec3 a = abs(n);
  if (a.x + a.y + a.z < 0.5) return vec4(0.0);
  vec3 t = clamp((vSprayP - sprayMin) / spraySpan, 0.0, 1.0);
  vec4 f;
  vec2 uv;
  float depth;
  float axis;
  if (a.x >= a.y && a.x >= a.z) { if (n.x < 0.0) { f = sprayFaces[0]; depth = 1.0 - t.x; } else { f = sprayFaces[1]; depth = t.x; } uv = t.zy; axis = spraySpan.x; }
  else if (a.y >= a.z) { if (n.y < 0.0) return vec4(0.0); f = sprayFaces[2]; uv = t.zx; depth = t.y; axis = spraySpan.y; }
  else { if (n.z > 0.0) { f = sprayFaces[3]; depth = t.z; } else { f = sprayFaces[4]; depth = 1.0 - t.z; } uv = t.xy; axis = spraySpan.z; }
  vec2 st = f.xy + uv * f.zw;
#ifdef SPRAY_DEPTH
  vec4 cover = texture2D(sprayDepth, st);
  float code = floor(cover.r * 255.0 + 0.5);
  float under = (code - 1.0) / 254.0 - depth;
  bool hidden = code > 0.0 && under > sprayBand / axis;
#ifdef SPRAY_TORN
  hidden = hidden && dot(sprayTorn, vec4(equal(vec4(floor(cover.g * 255.0 + 0.5)), vec4(1.0, 2.0, 3.0, 4.0)))) > 0.5;
#endif
  if (hidden) return vec4(0.0);
#endif
  return texture2D(sprayMap, vec2(st.x, (vSprayRow + st.y) / sprayRows));
}`;

/**
 * Patch `material` to lay its spray over the paint. `vertex` sets `vSprayP` / `vSprayN` (the rest point and normal) and
 * `vSprayRow` (which stacked bitmap) from attributes it declares in `attributes`, unless an earlier hook (the detail map) declared
 * them. Chains any earlier compile hook, like `applyMarkMap`.
 */
export function applySpray(material: THREE.Material, uniforms: Record<string, THREE.IUniform>, attributes: string, vertex: string, key: string): void {
  const prev = material.onBeforeCompile;
  const prevKey = material.customProgramCacheKey;
  material.onBeforeCompile = (shader, renderer) => {
    prev.call(material, shader, renderer);
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", `#include <common>\n${shader.vertexShader.includes(attributes) ? "" : attributes}\nvarying vec3 vSprayP;\nvarying vec3 vSprayN;\nvarying float vSprayRow;`)
      .replace("#include <begin_vertex>", `#include <begin_vertex>\n${vertex}`);
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>\n${"sprayDepth" in uniforms ? "#define SPRAY_DEPTH\n" : ""}${"sprayTorn" in uniforms ? "#define SPRAY_TORN\n" : ""}${SPRAY_FRAGMENT}`)
      .replace("#include <color_fragment>", "#include <color_fragment>\nvec4 sprayS = sprayTexel();\ndiffuseColor.rgb = diffuseColor.rgb * (1.0 - sprayS.a) + sprayS.rgb;");
  };
  material.customProgramCacheKey = () => `${prevKey.call(material)}|spray-${key}`;
  material.needsUpdate = true;
}

/** A bare 1 x 1 spray: what a car's patched paint samples once its player's look is gone. Shared, never disposed. */
export const BARE_SPRAY = new THREE.DataTexture(new Uint8Array(4), 1, 1);
BARE_SPRAY.needsUpdate = true;
