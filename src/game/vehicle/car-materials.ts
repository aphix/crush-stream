import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { once } from "../kernel/scalar.ts";
import { detSin, detCos } from "../kernel/physics-core.js";
import { applyFinish, glslFloat } from "./car-finish.ts";
import { BARE_METAL_FRAGMENT, BARE_METAL_VERTEX } from "./bare-metal.ts";
import { FITTING_ATTRIBUTE, FITTING_TONE } from "./constants.ts";
import type { BodyStyle } from "./car-variants.ts";

/** The shared car textures and materials (paint, tone grid, glass, crack map, lamp mask) and the multi-tone part helpers; the small parts built on them are in `part-geometry.ts`. */

/**
 * What the paint's colour (sRGB 0xf2f2f0, linear here) and roughness multiply in where its two 1 x 1 maps were sampled, those maps'
 * texels: every car's paint stays what it was, and no paint pixel fetches a texture for a constant.
 */
export const PAINT_COLOR_TONE = new THREE.Color(0xf2f2f0);
const PAINT_ROUGHNESS_TONE = 0x8a / 0xff;

/**
 * Soft shoulder on a car material's final linear radiance: untouched up to 0.7, rolling off to at most 1.1.
 * A white body under the sun reached 14 (sun specular through roughness 0.42 + clearcoat), which bloomed
 * (post threshold 1.6) and pushed a fifth of the body to near-white after exposure 1.45. Capped, lit paint
 * stays below the bloom threshold and tone-maps to ≤ ~240/255 at every FX tier; only emissive FX bloom.
 */
const HIGHLIGHT_CAP = /* glsl */ `
float capM = max(outgoingLight.r, max(outgoingLight.g, outgoingLight.b));
if (capM > 0.7) outgoingLight *= (0.7 + 0.4 * (1.0 - exp((0.7 - capM) / 0.4))) / capM;
#include <opaque_fragment>`;

function capHighlights<T extends THREE.MeshStandardMaterial>(m: T): T {
  m.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace("#include <opaque_fragment>", HIGHLIGHT_CAP);
  };
  m.customProgramCacheKey = () => "car-highlight-cap";
  return m;
}

/**
 * Per-vertex primer on the paint: a `primer` attribute (0 on any mesh without one) turns the paint to bare riveted steel
 * (`bare-metal.ts`), the vertex blend sharpened to a thin edge (a thin torn arch spans only a row or two of the coarse body loft; a
 * linear blend smears it to a faint gradient). A torn panel's or bumper's under-panel is the body's own triangles turned this way, so
 * it costs no draw. Multiplies in the paint tones (`PAINT_COLOR_TONE`) and wraps `capHighlights`' compile hook.
 */
function withPrimer<T extends THREE.MeshStandardMaterial>(m: T): T {
  const cap = m.onBeforeCompile;
  m.onBeforeCompile = (shader, renderer) => {
    cap.call(m, shader, renderer);
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", `#include <common>\nattribute float primer;\nvarying float vPrimer;\n${BARE_METAL_VERTEX.pars}`)
      .replace("#include <begin_vertex>", `#include <begin_vertex>\nvPrimer = primer;\n${BARE_METAL_VERTEX.main}`);
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>\nvarying float vPrimer;\n${BARE_METAL_FRAGMENT.pars}`)
      .replace("#include <map_fragment>", `#include <map_fragment>\ndiffuseColor.rgb *= vec3(${PAINT_COLOR_TONE.r}, ${PAINT_COLOR_TONE.g}, ${PAINT_COLOR_TONE.b});`)
      .replace("#include <roughnessmap_fragment>", `#include <roughnessmap_fragment>\nroughnessFactor *= ${PAINT_ROUGHNESS_TONE};\n${BARE_METAL_FRAGMENT.roughness}\n${GLOSS_BLACK.roughness}`)
      .replace("#include <metalnessmap_fragment>", `#include <metalnessmap_fragment>\n${BARE_METAL_FRAGMENT.metalness}\n${GLOSS_BLACK.metalness}`)
      .replace("#include <color_fragment>", `#include <color_fragment>\n${BARE_METAL_FRAGMENT.color}\n${GLOSS_BLACK.color}`)
      .replace("#include <lights_physical_fragment>", `#include <lights_physical_fragment>\n${BARE_METAL_FRAGMENT.clearcoat}\n${GLOSS_BLACK.clearcoat}`);
  };
  m.customProgramCacheKey = () => "car-paint-primer";
  return m;
}

/** What a wheel's spokes and disc blend to at full smear: the alloy and the dark disc averaged, as a shutter would. */
const SMEAR_TONE = new THREE.Color(0x6b6f76);

/**
 * The loaded tyre's foot in the hub frame: within the patch's half-angle `ap` (where an unloaded tyre `1 + tyreLoad.z` crowns
 * across would cut the ground) the crown lies on the flat ground at its own radius, then eases back to round by `2 ap`.
 */
const LOADED_FOOT = `if (tyre > 0.0 && tyreLoad.z > 0.0) {
  float rho = max(length(transformed.yz), 1e-6);
  float c = dot(transformed.yz, tyreLoad.xy) / rho;
  float a = acos(clamp(c, -1.0, 1.0));
  float ap = acos(1.0 / (1.0 + tyreLoad.z));
  float k = a < ap ? 1.0 / c : 1.0 + tyreLoad.z * (1.0 - smoothstep(ap, 2.0 * ap, a));
  transformed.yz *= 1.0 + (k - 1.0) * tyre;
  transformed.x += sign(transformed.x) * tyreLoad.w * 4.0 * tyre * (1.0 - tyre) * (1.0 - smoothstep(0.0, 3.0 * ap, a));
}`;

/**
 * The parts material for the wheel batch: the `blur` of each instance (0 sharp .. 1 smeared, `spokeSmear`) fades the
 * vertices with `smear` weight toward one flat, half-metal tone, so a rim turning too fast to read as spokes reads as a
 * soft disc instead of strobing slow or backwards. Each instance's `tyreLoad` (`WheelBatch`) loads its tyre: the rubber
 * (`tyre` weight) is pushed out onto a flat foot round the hub-frame down `tyreLoad.xy`, `tyreLoad.z` the flatten over the
 * crown radius, and the sidewall bulges `tyreLoad.w` across near the foot. Wraps `capHighlights`' compile hook.
 */
export function makeWheelMaterial(): THREE.MeshStandardMaterial {
  const m = makePartsMaterial();
  const cap = m.onBeforeCompile;
  m.onBeforeCompile = (shader, renderer) => {
    cap.call(m, shader, renderer);
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nattribute float smear;\nattribute float blur;\nattribute float tyre;\nattribute vec4 tyreLoad;\nvarying float vSmear;")
      .replace("#include <begin_vertex>", `#include <begin_vertex>\nvSmear = smear * blur;\n${LOADED_FOOT}`);
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nvarying float vSmear;")
      .replace("#include <color_fragment>", `#include <color_fragment>\ndiffuseColor.rgb = mix(diffuseColor.rgb, vec3(${SMEAR_TONE.r}, ${SMEAR_TONE.g}, ${SMEAR_TONE.b}), vSmear);`)
      .replace("#include <roughnessmap_fragment>", "#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.5, vSmear);")
      .replace("#include <metalnessmap_fragment>", "#include <metalnessmap_fragment>\nmetalnessFactor = mix(metalnessFactor, 0.6, vSmear);");
  };
  m.customProgramCacheKey = () => "car-wheel-smear";
  return m;
}

/** Per vertex 1 where a part takes its panel's paint (the instance colour), else 0. */
export const PAINTED_ATTRIBUTE = "painted";

/** `m` painting its `painted` vertices with the instance colour (a styled part's panel paint). Chains `m`'s compile hook and key. */
function withPaintedInstances<T extends THREE.MeshStandardMaterial>(m: T): T {
  const hook = m.onBeforeCompile;
  const key = m.customProgramCacheKey;
  m.onBeforeCompile = (shader, renderer) => {
    hook.call(m, shader, renderer);
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", `#include <common>\nattribute float ${PAINTED_ATTRIBUTE};`)
      .replace(
        "#include <color_vertex>",
        `vColor = vec4(color, 1.0);\n#ifdef USE_INSTANCING_COLOR\nvColor.rgb *= mix(vec3(1.0), instanceColor.rgb, ${PAINTED_ATTRIBUTE});\n#endif`,
      );
  };
  m.customProgramCacheKey = () => `${key.call(m)}|painted-instances`;
  return m;
}

/** The part batch's material for a kind drawn in style variants (mirrors, grille, tail trim): one draw per variant, painted per instance. */
export const variantPartsMaterial = once((): THREE.MeshStandardMaterial => withPaintedInstances(makePartsMaterial()));

/**
 * A car material's draw class: opaque draws of one class need one shader program, so `sortByDrawClass` (present/draw-order.ts)
 * draws a class together instead of switching programs once per car. 0 (unset) sorts first.
 */
const DRAW_CLASS = { paint: 1, parts: 2, trim: 3 } as const;

function classed<T extends THREE.Material>(m: T, drawClass: number): T {
  m.userData.drawClass = drawClass;
  return m;
}

export function drawClassOf(m: THREE.Material): number {
  return (m.userData.drawClass as number | undefined) ?? 0;
}

export function makePaintMaterial(color: number): THREE.MeshPhysicalMaterial {
  return classed(
    applyFinish(
      withPrimer(
        capHighlights(
          new THREE.MeshPhysicalMaterial({
            color,
            metalness: 0.2,
            roughness: 0.42,
            clearcoat: 0.72,
            clearcoatRoughness: 0.24,
            side: THREE.FrontSide,
          }),
        ),
      ),
      "paint",
    ),
    DRAW_CLASS.paint,
  );
}

const trimByKey = new Map<string, THREE.MeshStandardMaterial>();

/**
 * Trim finishes: the accent trim's satin, chrome, black plastic, gloss black (blacked-out trim and black mirror housings: piano black,
 * crisp highlights), and a painted bumper's (the paint's metalness and roughness, no clear coat).
 */
export const TRIM_FINISH = {
  satin: { metalness: 0.55, roughness: 0.38 },
  chrome: { metalness: 0.95, roughness: 0.16 },
  plastic: { metalness: 0.3, roughness: 0.6 },
  gloss: { metalness: 0.05, roughness: 0.14 },
  paint: { metalness: 0.2, roughness: 0.42 },
} as const;

/** Black plastic and chrome (sRGB): a black or chrome bumper or mirror, and the fittings drawn in any bumper (`FITTING_TONE`). */
export const TRIM_BLACK = 0x121316;
export const TRIM_CHROME = 0xd2d6db;

/** A `vec3` literal of sRGB `hex` in the shader's linear space. */
function glslTone(hex: number): string {
  const c = new THREE.Color(hex);
  return `vec3(${c.r}, ${c.g}, ${c.b})`;
}

/** A `CABIN_TRIM` vertex's tone [sRGB, roughness, metalness]: the drawn cabin's own matte trim (`interior-geometry.ts`). */
const CABIN_TONE = [0x16191d, 0.85, 0.05] as const;

/**
 * A `BLACKOUT` vertex (primer -1) on the paint: the black trim's colour, as smooth as gloss trim, under the paint's own clear coat: the
 * references' blacked-out pillars, cowls and roof rails are piano black with crisp highlights, not bare steel or satin plastic. A
 * `CABIN_TRIM` vertex (primer -2): the cabin's matte dark trim, its clear coat off.
 */
const GLOSS_BLACK = {
  color: [
    "float glossW = smoothstep(0.3, 0.6, -vPrimer) - smoothstep(1.3, 1.6, -vPrimer);",
    "float cabinW = smoothstep(1.3, 1.6, -vPrimer);",
    `diffuseColor.rgb = mix(diffuseColor.rgb, ${glslTone(TRIM_BLACK)}, glossW);`,
    `diffuseColor.rgb = mix(diffuseColor.rgb, ${glslTone(CABIN_TONE[0])}, cabinW);`,
  ].join("\n"),
  roughness: `roughnessFactor = mix(mix(roughnessFactor, ${glslFloat(TRIM_FINISH.gloss.roughness)}, glossW), ${glslFloat(CABIN_TONE[1])}, cabinW);`,
  metalness: `metalnessFactor = mix(mix(metalnessFactor, ${glslFloat(TRIM_FINISH.gloss.metalness)}, glossW), ${glslFloat(CABIN_TONE[2])}, cabinW);`,
  clearcoat: "#ifdef USE_CLEARCOAT\nmaterial.clearcoat *= 1.0 - cabinW;\n#endif",
};

/** Fittings drawn in the trim's one mesh: a `FITTING_ATTRIBUTE` vertex (0 on a mesh without one) of a `FITTING_TONE` takes that tone's colour and finish. Wraps `capHighlights`' compile hook. */
function withFittings<T extends THREE.MeshStandardMaterial>(m: T): T {
  const cap = m.onBeforeCompile;
  const fitted = `vFitting > ${FITTING_TONE.black - 0.5}`;
  const chrome = `vFitting > ${FITTING_TONE.chrome - 0.5}`;
  const { chrome: shine, plastic } = TRIM_FINISH;
  m.onBeforeCompile = (shader, renderer) => {
    cap.call(m, shader, renderer);
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", `#include <common>\nattribute float ${FITTING_ATTRIBUTE};\nvarying float vFitting;`)
      .replace("#include <begin_vertex>", `#include <begin_vertex>\nvFitting = ${FITTING_ATTRIBUTE};`);
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nvarying float vFitting;")
      .replace("#include <color_fragment>", `#include <color_fragment>\nif (${fitted}) diffuseColor.rgb = ${chrome} ? ${glslTone(TRIM_CHROME)} : ${glslTone(TRIM_BLACK)};`)
      .replace("#include <roughnessmap_fragment>", `#include <roughnessmap_fragment>\nif (${fitted}) roughnessFactor = ${chrome} ? ${shine.roughness} : ${plastic.roughness};`)
      .replace("#include <metalnessmap_fragment>", `#include <metalnessmap_fragment>\nif (${fitted}) metalnessFactor = ${chrome} ? ${shine.metalness} : ${plastic.metalness};`);
  };
  m.customProgramCacheKey = () => "car-trim-fittings";
  return m;
}

/**
 * The bumper trim of `color` in `finish`, one material for every car that wears it (the palette has a dozen): a material switch costs a
 * frame about 0.015 ms at 4x CPU, and 32 cars drew 64 trim materials. Never disposed, like `partsMaterial`.
 */
export function trimMaterial(color: number, finish: keyof typeof TRIM_FINISH = "satin"): THREE.MeshStandardMaterial {
  const key = `${finish}:${color}`;
  let m = trimByKey.get(key);
  if (m === undefined) {
    m = classed(applyFinish(withFittings(capHighlights(new THREE.MeshStandardMaterial({ color, ...TRIM_FINISH[finish] }))), "trim"), DRAW_CLASS.trim);
    m.userData.shared = true;
    trimByKey.set(key, m);
  }
  return m;
}

/** A bumper's material for its style's `trim` (`BumperSpec.trim`): the car's `accent` trim when unset, else black, chrome, or its body colour `body` in a painted finish. */
export function bumperMaterial(trim: BodyStyle["bumpers"]["front"]["trim"], accent: number, body: number): THREE.MeshStandardMaterial {
  if (trim === "chrome") return trimMaterial(TRIM_CHROME, "chrome");
  if (trim === "black") return trimMaterial(TRIM_BLACK, "plastic");
  return trim === "body" ? trimMaterial(body, "paint") : trimMaterial(accent);
}

/** Roughness/metalness lookup in 0.01 steps: texel (i, j) = roughness i/100 (G), metalness j/100 (B). */
const TONE_STEPS = 100;
const toneGrid = once((): THREE.DataTexture => {
  const n = TONE_STEPS + 1;
  const data = new Float32Array(n * n * 4);
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const o = (j * n + i) * 4;
      data[o] = 1;
      data[o + 1] = i / TONE_STEPS;
      data[o + 2] = j / TONE_STEPS;
      data[o + 3] = 1;
    }
  }
  const t = new THREE.DataTexture(data, n, n, THREE.RGBAFormat, THREE.FloatType);
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.NearestFilter;
  t.generateMipmaps = false;
  t.needsUpdate = true;
  return t;
});

/** Shared by every car's multi-tone static parts (interior, mirrors, trim; the wheels have their own copy): colour
 * comes from vertex colours and roughness/metalness from `toneGrid` via UV, so dozens of tiny meshes
 * collapse into a few draws that all reuse one program and one uniform upload. Never disposed. */
export const partsMaterial = once(makePartsMaterial);

/** A torn part's mesh wears its own copy: three re-selects the program on every instanced<->plain switch of one material. Never disposed. */
export const loosePartsMaterial = once(makePartsMaterial);

/** The sun-shadow casters' material (`PartBatch.casters`): no colour or depth in the camera's pass; front side, as the body casts. Never disposed. */
export const shadowOnlyMaterial = once((): THREE.MeshBasicMaterial => {
  const m = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false });
  m.userData.shared = true;
  return m;
});

function makePartsMaterial(): THREE.MeshStandardMaterial {
  const grid = toneGrid();
  const m = classed(
    capHighlights(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 1, roughnessMap: grid, metalnessMap: grid })),
    DRAW_CLASS.parts,
  );
  m.userData.shared = true;
  return m;
}

/** Paint `geo` one flat tone: vertex colour (linear, as `material.color` would be) and a UV at the
 * tone-grid texel for this roughness/metalness. */
export function toned(geo: THREE.BufferGeometry, color: number, roughness: number, metalness: number): THREE.BufferGeometry {
  const n = geo.getAttribute("position").count;
  const c = new THREE.Color(color);
  const u = (Math.round(roughness * TONE_STEPS) + 0.5) / (TONE_STEPS + 1);
  const v = (Math.round(metalness * TONE_STEPS) + 0.5) / (TONE_STEPS + 1);
  const col = new Float32Array(n * 3);
  const uv = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) {
    col[i * 3] = c.r;
    col[i * 3 + 1] = c.g;
    col[i * 3 + 2] = c.b;
    uv[i * 2] = u;
    uv[i * 2 + 1] = v;
  }
  geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
  geo.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  return geo;
}

export function mergeToned(parts: THREE.BufferGeometry[], what: string): THREE.BufferGeometry {
  const geo = mergeGeometries(parts, false);
  for (const g of parts) g.dispose();
  if (!geo) throw new Error(`Failed to merge ${what}`);
  return geo;
}

/** The glass colour a car is built with. */
export const GLASS_COLOR = 0x1a2832;

export function makeGlassMaterial(): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color: GLASS_COLOR,
    metalness: 0.18,
    roughness: 0.08,
    transparent: true,
    opacity: 0.72,
    side: THREE.DoubleSide,
    // Panes are near-planar: each pixel sees one face, so three's back-then-front two-pass draw
    // only doubled the draws and re-resolved the program twice per pane per frame.
    forceSinglePass: true,
    depthWrite: true,
  });
}

/** What a pane looks like: as built, cleared by a reset (`resetGlass`), or cracked (`crackGlass`). */
export type GlassLook = "fresh" | "clear" | "cracked";
const GLASS_LOOKS = {
  fresh: { opacity: 0.72, roughness: 0.08 },
  clear: { opacity: 0.78, roughness: 0.06 },
  cracked: { opacity: 0.55, roughness: 0.32 },
} as const satisfies Record<GlassLook, { opacity: number; roughness: number }>;
const glassByLook = new Map<string, THREE.MeshStandardMaterial>();
/** A privacy pane's floor opacity: its tint alone still let ~28% of the cabin through, so the reference's black rear glass read clear. */
const PRIVACY_OPACITY = 0.93;

/**
 * The one material every pane in `look` and `color` wears: a pane changes look by changing material, never by editing its own,
 * so a car's six panes and every other car's share it (the renderer re-sends a material's uniforms each time the draw
 * changes material, and a car's panes were six copies of one). `privacy` panes are near-opaque; `frit` panes draw their vertex
 * colours (a framed rear glass's black band). Never edit what this returns.
 */
export function glassMaterial(look: GlassLook, color: number = GLASS_COLOR, privacy = false, frit = false): THREE.MeshStandardMaterial {
  const key = `${look}:${color}:${privacy}:${frit}`;
  let m = glassByLook.get(key);
  if (m === undefined) {
    m = makeGlassMaterial();
    m.color.setHex(color);
    m.opacity = privacy ? Math.max(GLASS_LOOKS[look].opacity, PRIVACY_OPACITY) : GLASS_LOOKS[look].opacity;
    m.roughness = GLASS_LOOKS[look].roughness;
    m.vertexColors = frit;
    if (look === "cracked") m.map = getCrackMap();
    m.userData.shared = true;
    glassByLook.set(key, m);
  }
  return m;
}

export const getCrackMap = once((): THREE.Texture => {
  if (typeof document === "undefined") {
    const t = new THREE.DataTexture(new Uint8Array([180, 200, 210, 48]), 1, 1);
    t.needsUpdate = true;
    return t;
  }
  const c = document.createElement("canvas");
  c.width = 512;
  c.height = 512;
  const ctx = c.getContext("2d")!;
  ctx.clearRect(0, 0, 512, 512);
  ctx.fillStyle = "rgba(180,200,210,0.18)";
  ctx.fillRect(0, 0, 512, 512);
  ctx.strokeStyle = "rgba(12,14,18,0.82)";
  ctx.lineWidth = 1.4;
  const cx = 256;
  const cy = 256;
  for (let i = 0; i < 18; i++) {
    const ang = (i / 18) * Math.PI * 2 + Math.random() * 0.2;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    let x = cx;
    let y = cy;
    const steps = 4 + Math.floor(Math.random() * 4);
    for (let s = 0; s < steps; s++) {
      x += detCos(ang + (Math.random() - 0.5) * 0.8) * (40 + Math.random() * 50);
      y += detSin(ang + (Math.random() - 0.5) * 0.8) * (40 + Math.random() * 50);
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  ctx.lineWidth = 0.8;
  for (let i = 0; i < 22; i++) {
    ctx.beginPath();
    ctx.moveTo(Math.random() * 512, Math.random() * 512);
    ctx.lineTo(Math.random() * 512, Math.random() * 512);
    ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
});

export type LampKind = "head" | "tail";

/** Lamp housing [width, height] (m). The head lamp fits the nose between the grille and the header panel. */
const LAMP_HOUSING: Readonly<Record<LampKind, readonly [number, number]>> = { head: [0.22, 0.09], tail: [0.31, 0.11] };

/** Lamp unit in lamp space (lens toward +z, origin on the body skin): dark housing plus lens, one draw.
 *  uv picks the `lampEmissiveMap` texel — housing 0, lens 1 — so a per-lamp emissive lights the lens alone. */
export function makeLampUnit(kind: LampKind): THREE.BufferGeometry {
  const head = kind === "head";
  const [w, h] = LAMP_HOUSING[kind];
  const housing = toned(new THREE.BoxGeometry(w, h, 0.05), head ? 0x1a1c20 : 0x15171a, 0, 0);
  const lens = toned(new THREE.BoxGeometry(w - 0.04, h * 0.72, 0.03), head ? 0xf4f1e8 : 0xc4121c, 0, 0);
  (housing.getAttribute("uv").array as Float32Array).fill(0.25);
  (lens.getAttribute("uv").array as Float32Array).fill(0.75);
  return mergeToned([housing.translate(0, 0, 0.015), lens.translate(0, 0, 0.03)], "lamp unit");
}

/** 2×1 emissive mask for `makeLampUnit`: black housing texel, white lens texel. Shared, never disposed. */
export const lampEmissiveMap = once((): THREE.DataTexture => {
  const t = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255, 255, 255, 255, 255]), 2, 1);
  t.needsUpdate = true;
  return t;
});

/** Light bar lens texels in `sirenEmissiveMap` order: housing, red lens, blue lens. */
const SIREN_U = [1 / 6, 3 / 6, 5 / 6] as const;

/** The light bar's two feet in bar space: at ±`x`, their soles `sole` below the origin, `2z` deep (front to back). They rest on the roof. */
export const LIGHT_BAR_FOOT = { x: 0.4, sole: -0.03, z: 0.09 } as const;

/** Roof light bar in bar space (+z forward, so +x is the car's left): housing on two feet (`LIGHT_BAR_FOOT`), a red lens on
 *  the car's left (+x) and a blue one on its right (−x), as the reference cruiser's, with a clear takedown module between,
 *  one draw. `LIGHT_BAR_LENS` lists each lens's vertices. */
export function makeLightBar(): THREE.BufferGeometry {
  const box = (w: number, h: number, d: number, x: number, y: number, tone: number, texel: 0 | 1 | 2) => {
    const g = toned(new THREE.BoxGeometry(w, h, d), tone, 0, 0).translate(x, y, 0);
    const uv = g.getAttribute("uv").array as Float32Array;
    for (let i = 0; i < uv.length; i += 2) {
      uv[i] = SIREN_U[texel];
      uv[i + 1] = 0.5;
    }
    return g;
  };
  return mergeToned(
    [
      box(1.04, 0.045, 0.26, 0, 0.04, 0x16181c, 0),
      box(0.16, 0.07, 0.22, 0, 0.1, 0xd8dce2, 0),
      box(0.08, -2 * LIGHT_BAR_FOOT.sole, 2 * LIGHT_BAR_FOOT.z, -LIGHT_BAR_FOOT.x, 0, 0x16181c, 0),
      box(0.08, -2 * LIGHT_BAR_FOOT.sole, 2 * LIGHT_BAR_FOOT.z, LIGHT_BAR_FOOT.x, 0, 0x16181c, 0),
      box(0.42, 0.075, 0.23, 0.3, 0.1, 0x8c1218, 1),
      box(0.42, 0.075, 0.23, -0.3, 0.1, 0x1a36a8, 2),
    ],
    "light bar",
  );
}

/** A push bar stands this far (m) ahead of its bumper's face, `tube` thick; its uprights `x` either side of the middle reach
 *  `above` the bumper's top, carry a `plate` thick pad on their face, and its lower bar spans `span` either side: a cruiser's grille guard.
 *  As the reference cruiser's (front iso): uprights at |x| 0.36 about 4 cm ahead of the face, the top bar at y ~0.62 just over the
 *  hood's leading edge, the lower bar at the grille's foot. */
const PUSH_BAR = { gap: 0.015, tube: 0.05, x: 0.36, above: 0.18, span: 0.38, plate: 0.025 } as const;
/** How far (m) a push bar's pads stand ahead of its bumper's face: a car's length spec leaves it off, as its height leaves off the light bar. */
export const PUSH_BAR_REACH = PUSH_BAR.gap + PUSH_BAR.tube + PUSH_BAR.plate;

/** Front bumper `bumper` (bumper space, +z forward, indexed) with a push bar in front of its face: one geometry, so the bar
 *  draws in the bumper's trim and tears off with it. */
export function withPushBar(bumper: THREE.BufferGeometry): THREE.BufferGeometry {
  bumper.computeBoundingBox();
  const { min, max } = bumper.boundingBox!;
  const { gap, tube, x, above, span, plate } = PUSH_BAR;
  const z = max.z + gap + tube / 2;
  const top = max.y + above;
  const box = (w: number, h: number, d: number, bx: number, by: number, bz: number) => new THREE.BoxGeometry(w, h, d).translate(bx, by, bz);
  const parts = [bumper, box(2 * x + tube, tube, tube, 0, top - tube / 2, z), box(2 * span, tube, tube, 0, max.y - tube, z)];
  for (const side of [-1, 1]) {
    parts.push(box(tube, top - min.y, tube, side * x, (top + min.y) / 2, z));
    parts.push(box(0.07, 0.22, plate, side * x, max.y + above / 2, z + tube / 2 + plate / 2));
    parts.push(box(tube, tube, gap + tube, side * x, max.y - tube, max.z + (gap + tube) / 2));
  }
  const geo = mergeGeometries(parts, false);
  for (const g of parts) g.dispose();
  if (!geo) throw new Error("Failed to merge the push bar into its bumper");
  return geo;
}

/** [first vertex, count] of the red and blue lens in `makeLightBar` (a box is 24 vertices). */
export const LIGHT_BAR_LENS = [
  [96, 24],
  [120, 24],
] as const;

/** 3×1 emissive mask for `makeLightBar`: black housing, pure red lens, pure blue lens. The bar material's
 *  emissive colour picks the lit lens: (k, 0, 0) lights only red, (0, 0, k) only blue (any green or
 *  cross-channel in a texel tints the dark lens: the first cut lit the blue lens magenta). Shared, never disposed. */
const sirenEmissiveMap = once((): THREE.DataTexture => {
  const t = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255, 255, 0, 0, 255, 0, 0, 255, 255]), 3, 1);
  t.needsUpdate = true;
  return t;
});

/** Per-car light bar material: emissive stays black until `setSirens` flashes it. */
export function makeSirenMaterial(): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.3, metalness: 0.25, emissive: 0x000000, emissiveMap: sirenEmissiveMap() });
}

/** Lug pitches across one repeat of `treadNormalMap` (u runs around the tyre). */
const TREAD_LUGS = 4;

/** `treadNormalMap` columns: one repeat round the tyre. */
export const TYRE_MAP_WIDTH = 128;

/** Its rows: the tread band, an outer sidewall band above it and the inner sidewall's below; a power of two for the mip chain. */
export const TYRE_MAP_HEIGHT = 128;

/** Rows of the tread band: the tread-only map's 64, so every tread texel keeps the normal it had before the sidewalls. */
export const TREAD_BAND_ROWS = 64;

/** First row of the tread band; the rows above it are the outer sidewall's. Row 0 is the flat row the rim and spokes sample (their `uv1` is (·, 0)). */
export const TREAD_BAND_FIRST_ROW = 32;

/** Share of the tread band, at each edge, that is flat shoulder rubber (the lugs fill the share between). */
const TREAD_EDGE_SHARE = 0.06;
const TREAD_LUG_SHARE = 0.88;

/** The row where the lugs start: the tread edge, where the sidewall's last profile point sits. */
const TREAD_EDGE_ROW = TREAD_BAND_FIRST_ROW + TREAD_BAND_ROWS * TREAD_EDGE_SHARE;

/**
 * The map row each outer-sidewall profile point samples, bead first. Spaced like the profile's arc lengths
 * (0.058, 0.037, 0.027 m) so a row is about 3.4 mm of sidewall on every segment; the inner sidewall mirrors them about the tread band.
 */
const OUTER_SIDEWALL_POINT_ROWS = [0, 17, 28, TREAD_EDGE_ROW] as const;

/** Sidewall relief is in map rows counted from the bead and in tread heights: 1 is flat rubber, ridges stand above it. */
export const BEAD_RING_CENTRE_ROW = 7;
export const BEAD_RING_HALF_ROWS = 4;
/** Rim-protector ring: broad and rounded, the strongest relief on the sidewall. */
const BEAD_RING_HEIGHT = 0.5;

/** Fine concentric ribs: rows of their crests, each a rounded ridge as wide as the spacing so they touch without a flat between. */
export const RIB_CREST_ROWS = [23, 26, 29] as const;
export const RIB_HALF_ROWS = 1.5;
const RIB_HEIGHT = 0.15;

/** Moulded lettering on the outer sidewall alone: a band of raised dashes, `LETTER_SLOTS` slots round each repeat. */
export const LETTER_FIRST_ROW = 14;
export const LETTER_SLOTS = 12;
/** Between the ribs' and the bead ring's relief: dash edges tilt the normal about 25 degrees (the bead ring 38, the ribs 18). */
const LETTER_HEIGHT = 0.15;
/** Per slot (cycling): the dash's share of the slot and its rows tall from `LETTER_FIRST_ROW`, so the band reads as text rather than a dotted line. */
const LETTER_DASH_SHARES = [0.4, 0.7, 0.55, 0.85, 0.3] as const;
export const LETTER_DASH_ROWS = [5, 3, 5, 4, 2] as const;

/** A 0..1 rounded ridge `distanceRows` from its crest, gone `halfRows` away on either side. */
function roundedRidge(distanceRows: number, halfRows: number): number {
  if (Math.abs(distanceRows) >= halfRows) return 0;
  return 0.5 * (1 + detCos((Math.PI * distanceRows) / halfRows));
}

/** 1 where a letter dash stands at (u, row), else 0; slot and fraction wrap at u = 1 so the seam has no step. */
function letterDash(u: number, row: number): number {
  const slotPosition = u * LETTER_SLOTS;
  const slot = Math.floor(slotPosition) % LETTER_SLOTS;
  const dashKind = slot % LETTER_DASH_SHARES.length;
  if (row < LETTER_FIRST_ROW || row >= LETTER_FIRST_ROW + LETTER_DASH_ROWS[dashKind]!) return 0;
  return slotPosition % 1 < LETTER_DASH_SHARES[dashKind]! ? 1 : 0;
}

/** Rubber height of the sidewall rows: a bead ring and ribs on both, lettering on the outer one (rows above the tread band) only. */
function sidewallHeight(u: number, row: number): number {
  const isOuter = row < TYRE_MAP_HEIGHT / 2;
  const rowsFromBead = isOuter ? row : TYRE_MAP_HEIGHT - row;
  let height = 1 + BEAD_RING_HEIGHT * roundedRidge(rowsFromBead - BEAD_RING_CENTRE_ROW, BEAD_RING_HALF_ROWS);
  for (const crestRow of RIB_CREST_ROWS) height += RIB_HEIGHT * roundedRidge(rowsFromBead - crestRow, RIB_HALF_ROWS);
  return isOuter ? height + LETTER_HEIGHT * letterDash(u, row) : height;
}

/** Rubber height in [0, 1] of the tread band at (u, v across the band): two circumferential grooves, chevron sipes on the centre rib, lug slots on the shoulders. */
function treadHeight(u: number, v: number): number {
  if (v < TREAD_EDGE_SHARE || v > 1 - TREAD_EDGE_SHARE) return 1;
  const t = (v - TREAD_EDGE_SHARE) / TREAD_LUG_SHARE;
  if (Math.abs(t - 0.33) < 0.035 || Math.abs(t - 0.67) < 0.035) return 0;
  const lug = (u * TREAD_LUGS) % 1;
  if (t < 0.33 || t > 0.67) return Math.abs(lug - 0.5) < 0.09 ? 0.25 : 1;
  const chevron = (lug + Math.abs(t - 0.5) * 0.9) % 1;
  return Math.abs(chevron - 0.5) < 0.05 ? 0.4 : 1;
}

function rubberHeight(u: number, row: number): number {
  const rowInTread = row - TREAD_BAND_FIRST_ROW;
  if (rowInTread < 0 || rowInTread >= TREAD_BAND_ROWS) return sidewallHeight(u, row);
  return treadHeight(u, rowInTread / TREAD_BAND_ROWS);
}

/**
 * Tyre normal map: the tread band in the middle rows (`TREAD_LUGS` lug pitches across u, flat shoulders), a sidewall
 * band each side of it (bead ring, ribs, outer lettering), row 0 flat for the rim and spokes. Built in code (no DOM). Shared, never disposed.
 */
export const treadNormalMap = once((): THREE.DataTexture => {
  const w = TYRE_MAP_WIDTH;
  const h = TYRE_MAP_HEIGHT;
  const data = new Uint8Array(w * h * 4);
  const n = new THREE.Vector3();
  const k = 2.2;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx = (rubberHeight((x + 1) / w, y) - rubberHeight((x - 1 + w) / w, y)) * k;
      const dy = (rubberHeight(x / w, Math.min(h, y + 1)) - rubberHeight(x / w, Math.max(0, y - 1))) * k;
      n.set(-dx, -dy, 1).normalize();
      const o = (y * w + x) * 4;
      data[o] = Math.round((n.x * 0.5 + 0.5) * 255);
      data[o + 1] = Math.round((n.y * 0.5 + 0.5) * 255);
      data[o + 2] = Math.round((n.z * 0.5 + 0.5) * 255);
      data[o + 3] = 255;
    }
  }
  const t = new THREE.DataTexture(data, w, h);
  t.wrapS = THREE.RepeatWrapping;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = 4;
  // Its own uv set (`uv1`): `uv` is the tone-grid lookup on every toned part.
  t.channel = 1;
  t.needsUpdate = true;
  return t;
});

/** Tyre half-section, bead to bead ([radius, axle offset] m, axle offset ascending so faces point out):
 *  bulged sidewalls, rounded shoulders, a slightly crowned tread whose crown is the rig's `TYRE_R` (0.32). */
const TYRE_PROFILE = [
  [0.205, -0.1],
  [0.262, -0.112],
  [0.298, -0.104],
  [0.314, -0.082],
  [0.32, 0],
  [0.314, 0.082],
  [0.298, 0.104],
  [0.262, 0.112],
  [0.205, 0.1],
] as const;
/** `treadNormalMap` v per profile point (`OUTER_SIDEWALL_POINT_ROWS` / map height): the outer sidewall from the flat guard row at the bead, the tread across its band, the inner sidewall mirrored to the other bead. */
const TYRE_TREAD_V = [
  ...OUTER_SIDEWALL_POINT_ROWS.map((row) => row / TYRE_MAP_HEIGHT),
  0.5,
  ...OUTER_SIDEWALL_POINT_ROWS.map((row) => 1 - row / TYRE_MAP_HEIGHT).reverse(),
];
/** Normal-map repeats round the tyre (× `TREAD_LUGS` lugs each). */
const TREAD_REPEATS = 8;
/** Rim barrel lip to lip, axle offset descending so the faces point at the axle (seen through the spokes). */
const RIM_PROFILE = [
  [0.216, 0.1],
  [0.2, 0.102],
  [0.188, 0.086],
  [0.188, -0.086],
  [0.2, -0.102],
  [0.216, -0.1],
] as const;

/** Lathe `profile` about the x axle, toned; `uv1` (the tread normal map's set) runs ×`repeats` round it, `v` per point. */
function latheX(
  profile: readonly (readonly [number, number])[],
  segs: number,
  v: readonly number[] | null,
  repeats: number,
  tone: readonly [number, number, number],
): THREE.BufferGeometry {
  const g = new THREE.LatheGeometry(profile.map(([r, x]) => new THREE.Vector2(r, x)), segs);
  const uv = g.getAttribute("uv");
  const uv1 = new Float32Array(uv.count * 2);
  for (let i = 0; i < uv.count; i++) {
    uv1[i * 2] = uv.getX(i) * repeats;
    uv1[i * 2 + 1] = v ? v[Math.round(uv.getY(i) * (profile.length - 1))]! : 0;
  }
  g.setAttribute("uv1", new THREE.BufferAttribute(uv1, 2));
  return toned(g, ...tone).rotateZ(-Math.PI / 2);
}

/** A toned part with a flat `uv1` (row 0 of the tread map). */
function flatPart(g: THREE.BufferGeometry, tone: readonly [number, number, number]): THREE.BufferGeometry {
  g.setAttribute("uv1", new THREE.BufferAttribute(new Float32Array(g.getAttribute("position").count * 2), 2));
  return toned(g, ...tone);
}

/** The tyre's tone: its vertices are the wheel's only ones this colour. */
export const RUBBER = [0x121214, 0.92, 0.05] as const;
const ALLOY = [0xc9cdd4, 0.28, 0.92] as const;
const DARK_DISC = [0x1c1d20, 0.7, 0.3] as const;
const HUB = [0x8a909a, 0.35, 0.8] as const;
/** A black-painted centre (pickup steel wheel, monster hub). */
const DARK_HUB = [0x232428, 0.55, 0.45] as const;
/** The muscle car's polished rim lip. */
const CHROME = [0xeef0f3, 0.12, 1] as const;

/** Bead and crown radius (m) of `TYRE_PROFILE`: the `tyre` weight runs 0 at the bead to 1 at the crown. */
const ROAD_TYRE: readonly [number, number] = [0.205, 0.32];

/**
 * Give every vertex of `g` a `smear` weight (1 on the spokes and the disc behind them, which `makeWheelMaterial` fades toward a blur)
 * and a `tyre` weight: 0 off the rubber, else 0 at `tyre`'s bead radius to 1 at its crown, how far it follows the loaded foot.
 */
function smeared(g: THREE.BufferGeometry, weight: number, tyre: readonly [number, number] | null = null): THREE.BufferGeometry {
  const p = g.getAttribute("position");
  const w = new Float32Array(p.count);
  if (tyre) for (let i = 0; i < p.count; i++) w[i] = THREE.MathUtils.clamp((Math.sqrt(p.getY(i) ** 2 + p.getZ(i) ** 2) - tyre[0]) / (tyre[1] - tyre[0]), 0, 1);
  g.setAttribute("smear", new THREE.BufferAttribute(new Float32Array(p.count).fill(weight), 1));
  g.setAttribute("tyre", new THREE.BufferAttribute(w, 1));
  return g;
}

/** `n` spokes `size` = [across, radial, round] (m) from the hub out to the rim, `split` rad apart in pairs when given. */
function spokes(n: number, size: readonly [number, number, number], tone: readonly [number, number, number], split = 0): THREE.BufferGeometry[] {
  const out: THREE.BufferGeometry[] = [];
  for (let k = 0; k < n; k++) {
    for (const s of split ? [-1, 1] : [0]) {
      const box = new THREE.BoxGeometry(...size).translate(0, 0.19 - size[1] / 2, 0);
      out.push(smeared(flatPart(box.rotateX((k * 2 * Math.PI) / n + (s * split) / 2), tone), 1));
    }
  }
  return out;
}

/** A flat ring each face at `x` (m off centre), between radii `inner` and `outer`. */
function faceRings(inner: number, outer: number, x: number, tone: readonly [number, number, number]): THREE.BufferGeometry[] {
  return [1, -1].map((side) => smeared(flatPart(new THREE.RingGeometry(inner, outer, 16).rotateY((side * Math.PI) / 2).translate(side * x, 0, 0), tone), 0));
}

/** The rim designs the references show; each is one instanced draw in the wheel batch. */
export type WheelDesign = "five" | "split10" | "mag5" | "six" | "beadlock";
export const WHEEL_DESIGNS: readonly WheelDesign[] = ["five", "split10", "mag5", "six", "beadlock"];

/** Mud-terrain lugs round the monster tyre: pitches, and each block's [across, radial, round] size (m) and chevron yaw (rad). */
const MONSTER_LUGS = 22;
const LUG_SIZE = [0.1, 0.05, 0.06] as const;
const LUG_CHEVRON = 0.45;
/** How far (m) a lug stands above the crown under it; the rest of the block is sunk in, showing only where the shoulder rolls off. */
const LUG_RISE = 0.024;
/** Monster tyre: bead radius (m) for a tall sidewall on the small rim, and its crown under the lugs, whose tops are the rig's crown. */
const MONSTER_TYRE: readonly [number, number] = [0.165, ROAD_TYRE[1] - LUG_RISE];
/** The monster's rim and face shrunk about the axle: the reference rim is half the tyre's height. */
const MONSTER_RIM = 0.8;

function monsterTyre(): THREE.BufferGeometry[] {
  const [bead, base] = MONSTER_TYRE;
  const k = (base - bead) / (ROAD_TYRE[1] - ROAD_TYRE[0]);
  const profile = TYRE_PROFILE.map(([r, x]) => [bead + (r - ROAD_TYRE[0]) * k, x] as const);
  const parts = [smeared(latheX(profile, 24, TYRE_TREAD_V, TREAD_REPEATS, RUBBER), 0, [bead, ROAD_TYRE[1]])];
  for (let k2 = 0; k2 < MONSTER_LUGS; k2++) {
    for (const s of [1, -1]) {
      const lug = new THREE.BoxGeometry(...LUG_SIZE).rotateY(s * LUG_CHEVRON).translate((s * LUG_SIZE[0]) / 2, ROAD_TYRE[1] - LUG_SIZE[1] / 2, 0);
      parts.push(smeared(flatPart(lug.rotateX(((k2 + (s > 0 ? 0 : 0.5)) * 2 * Math.PI) / MONSTER_LUGS), RUBBER), 0, [bead, ROAD_TYRE[1]]));
    }
  }
  return parts;
}

/** The face of each design: what sits inside the rim barrel. */
function rimFace(design: WheelDesign): THREE.BufferGeometry[] {
  const disc = [1, -1].map((side) => smeared(flatPart(new THREE.CircleGeometry(0.19, 16).rotateY((side * Math.PI) / 2), DARK_DISC), 1));
  const hub = (r: number, tone: readonly [number, number, number]) => smeared(flatPart(new THREE.CylinderGeometry(r, r, 0.19, 10).rotateZ(Math.PI / 2), tone), 0);
  switch (design) {
    case "five":
      return [...disc, ...spokes(5, [0.17, 0.15, 0.042], ALLOY), hub(0.062, HUB)];
    case "split10":
      return [...disc, ...spokes(5, [0.16, 0.15, 0.018], ALLOY, 0.2), hub(0.055, HUB)];
    case "mag5":
      return [...disc, ...spokes(5, [0.11, 0.15, 0.065], ALLOY), ...faceRings(0.188, 0.222, 0.1, CHROME), hub(0.05, CHROME)];
    case "six":
      return [...disc, ...spokes(6, [0.15, 0.15, 0.075], ALLOY), hub(0.08, DARK_HUB)];
    case "beadlock":
      return [...disc, ...spokes(6, [0.1, 0.15, 0.05], ALLOY), ...faceRings(0.17, 0.222, 0.104, ALLOY), hub(0.085, DARK_HUB)];
  }
}

/**
 * One wheel about the x axle, symmetric in x so the same instance serves both sides: a lathed tyre (tread detail from
 * `treadNormalMap`; the monster's carries lug blocks), a rim barrel and `design`'s face. The face's spokes and disc carry
 * `smear` 1 (`spokeSmear`); the rubber carries its `tyre` weight (`makeWheelMaterial`'s loaded foot).
 */
export function makeWheelGeometry(design: WheelDesign = "five"): THREE.BufferGeometry {
  const rim = [smeared(latheX(RIM_PROFILE, 16, null, 1, ALLOY), 0), ...rimFace(design)];
  if (design !== "beadlock") return mergeToned([smeared(latheX(TYRE_PROFILE, 24, TYRE_TREAD_V, TREAD_REPEATS, RUBBER), 0, ROAD_TYRE), ...rim], "wheel");
  for (const g of rim) g.scale(1, MONSTER_RIM, MONSTER_RIM);
  return mergeToned([...monsterTyre(), ...rim], "wheel");
}

/** Which of `TYRE_PROFILE`'s nine points the far wheel keeps: bead, shoulder, crown, shoulder, bead. */
const FAR_TYRE_POINTS = [0, 2, 4, 6, 8] as const;
/** The far wheel's disc where the near one has spokes over a dark disc: their average at rest, and the blur tone once smeared. */
const FAR_DISC = [0x4a4d53, 0.5, 0.6] as const;

/**
 * The wheel of a car the distance detail has cut to its body (`present/car-detail.ts`): the same tyre silhouette and width
 * on twelve segments and a flat disc each side, 120 triangles for the near wheel's ~680. A far car is about 20 px at the
 * rungs' far distances, its wheel a couple of pixels. Same attributes and axle as `makeWheelGeometry`, so the one material draws both.
 */
export function makeWheelGeometryFar(): THREE.BufferGeometry {
  const profile = FAR_TYRE_POINTS.map((i) => TYRE_PROFILE[i]!);
  const treadV = FAR_TYRE_POINTS.map((i) => TYRE_TREAD_V[i]!);
  const parts = [smeared(latheX(profile, 12, treadV, TREAD_REPEATS, RUBBER), 0, ROAD_TYRE)];
  for (const side of [1, -1]) parts.push(smeared(flatPart(new THREE.CircleGeometry(0.2, 12).rotateY((side * Math.PI) / 2), FAR_DISC), 1));
  return mergeToned(parts, "far wheel");
}
