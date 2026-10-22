import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { mergeGeometries, mergeVertices } from "three/addons/utils/BufferGeometryUtils.js";
import { once } from "../kernel/scalar.ts";
import { detSin, detCos } from "../kernel/physics-core.js";
import { applyFinish, glslFloat } from "./car-finish.ts";
import { BARE_METAL_FRAGMENT, BARE_METAL_VERTEX } from "./bare-metal.ts";
import { FITTING_ATTRIBUTE, FITTING_TONE, GLASS_ATTRIBUTE } from "./constants.ts";
import type { BodySource } from "./car-mesh.ts";
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

/**
 * Specular anti-aliasing for the normals a car hook perturbs (the finish's waviness, peel, flake and trim grain; the detail map's grooves
 * and vents): three widens roughness by the screen-space change of the unperturbed vertex normal only (`geometryRoughness`), so a
 * perturbation finer than a pixel at play distance aliased into sparkle and crawl along feature lines and shut lines. The perturbation's
 * own screen-space variance widens each lobe instead (Tokuyoshi and Kaplanyan's kernel, on alpha = roughness²): `SPEC_AA_SIGMA2` the pixel
 * filter's variance, `SPEC_AA_KAPPA` the most any lobe widens. A surface no hook perturbs is untouched.
 */
const SPEC_AA_SIGMA2 = 0.25;
const SPEC_AA_KAPPA = 0.18;
const SPECULAR_AA = /* glsl */ `#include <lights_physical_fragment>
vec3 specAaDx = dFdx( normal - nonPerturbedNormal );
vec3 specAaDy = dFdy( normal - nonPerturbedNormal );
float specAaAlpha = pow2( material.roughness );
material.roughness = min( sqrt( sqrt( pow2( specAaAlpha ) + min( ${SPEC_AA_SIGMA2 * 2} * ( dot( specAaDx, specAaDx ) + dot( specAaDy, specAaDy ) ), ${SPEC_AA_KAPPA} ) ) ), 1.0 );
#ifdef USE_CLEARCOAT
specAaDx = dFdx( clearcoatNormal - nonPerturbedNormal );
specAaDy = dFdy( clearcoatNormal - nonPerturbedNormal );
specAaAlpha = pow2( material.clearcoatRoughness );
material.clearcoatRoughness = min( sqrt( sqrt( pow2( specAaAlpha ) + min( ${SPEC_AA_SIGMA2 * 2} * ( dot( specAaDx, specAaDx ) + dot( specAaDy, specAaDy ) ), ${SPEC_AA_KAPPA} ) ) ), 1.0 );
#endif`;

function capHighlights<T extends THREE.MeshStandardMaterial>(m: T): T {
  m.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace("#include <opaque_fragment>", HIGHLIGHT_CAP).replace("#include <lights_physical_fragment>", SPECULAR_AA);
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

/** Per vertex 1 where a part takes its panel's paint (its seat's tint, `SeatDraw`), else 0. */
export const PAINTED_ATTRIBUTE = "painted";

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
 * `MATTE_BLACKOUT` vertex (-1.25): that black at black plastic's roughness, its clear coat off. A `CABIN_TRIM` vertex (primer -2): the
 * cabin's matte dark trim, its clear coat off.
 */
const GLOSS_BLACK = {
  color: [
    "float glossW = smoothstep(0.3, 0.6, -vPrimer) - smoothstep(1.3, 1.6, -vPrimer);",
    "float matteW = smoothstep(1.0, 1.25, -vPrimer) * glossW;",
    "float cabinW = smoothstep(1.3, 1.6, -vPrimer);",
    `diffuseColor.rgb = mix(diffuseColor.rgb, ${glslTone(TRIM_BLACK)}, glossW);`,
    `diffuseColor.rgb = mix(diffuseColor.rgb, ${glslTone(CABIN_TONE[0])}, cabinW);`,
  ].join("\n"),
  roughness: `roughnessFactor = mix(mix(mix(roughnessFactor, ${glslFloat(TRIM_FINISH.gloss.roughness)}, glossW), ${glslFloat(TRIM_FINISH.plastic.roughness)}, matteW), ${glslFloat(CABIN_TONE[1])}, cabinW);`,
  metalness: `metalnessFactor = mix(mix(metalnessFactor, ${glslFloat(TRIM_FINISH.gloss.metalness)}, glossW), ${glslFloat(CABIN_TONE[2])}, cabinW);`,
  clearcoat: "#ifdef USE_CLEARCOAT\nmaterial.clearcoat *= (1.0 - cabinW) * (1.0 - matteW);\n#endif",
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
  return withGlassTone(
    new THREE.MeshStandardMaterial({
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
    }),
  );
}

/** What a pane looks like: as built, cleared by a reset (`resetGlass`), or cracked (`crackGlass`). */
export type GlassLook = "fresh" | "clear" | "cracked";
const GLASS_LOOKS = {
  fresh: { opacity: 0.72, roughness: 0.08 },
  clear: { opacity: 0.78, roughness: 0.06 },
  cracked: { opacity: 0.55, roughness: 0.32 },
} as const satisfies Record<GlassLook, { opacity: number; roughness: number }>;
const glassByLook = new Map<string, THREE.MeshStandardMaterial>();
/** A privacy pane's colour this much darker (linear): the cargo behind dark-tinted rear glass reads dim, as in the references. */
export const PRIVACY_SHADE = 0.3;
/** A privacy pane's floor opacity: its tint alone still let ~28% of the cabin through, so the reference's black rear glass read clear. */
const PRIVACY_OPACITY = 0.93;
/** A matte privacy pane's roughness: the reference SUV's quarter glass reads a dark blur, not the sky's sharp mirror. */
const MATTE_GLASS_ROUGHNESS = 0.4;

/** Per-vertex glass tone (`GLASS_ATTRIBUTE`): x 1 black frit, y 1 privacy (darker by `PRIVACY_SHADE`, opacity floored before the crack map multiplies alpha, as `material.opacity` was), y `MATTE_PRIVACY` matte privacy (rougher too); 0 on a mesh without one. */
function withGlassTone<T extends THREE.MeshStandardMaterial>(m: T): T {
  m.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", `#include <common>\nattribute vec2 ${GLASS_ATTRIBUTE};\nvarying vec2 vGlassTone;`)
      .replace("#include <begin_vertex>", `#include <begin_vertex>\nvGlassTone = ${GLASS_ATTRIBUTE};`);
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nvarying vec2 vGlassTone;")
      .replace(
        "#include <map_fragment>",
        `float privacy = min(vGlassTone.y, 1.0);\ndiffuseColor.a = max(diffuseColor.a, privacy * ${glslFloat(PRIVACY_OPACITY)});\n#include <map_fragment>\ndiffuseColor.rgb *= 1.0 - max(vGlassTone.x, privacy * (1.0 - ${glslFloat(PRIVACY_SHADE)}));`,
      )
      .replace(
        "#include <roughnessmap_fragment>",
        `#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, ${glslFloat(MATTE_GLASS_ROUGHNESS)}, clamp(vGlassTone.y - 1.0, 0.0, 1.0));`,
      );
  };
  m.customProgramCacheKey = () => "car-glass-tone";
  return m;
}

/**
 * The one material every pane in `look` and `color` wears: a pane changes look by changing material, never by editing its own,
 * so a car's six panes and every other car's share it (the renderer re-sends a material's uniforms each time the draw
 * changes material, and a car's panes were six copies of one). Privacy panes and the black frit band are per-vertex
 * (`GLASS_ATTRIBUTE`), so they wear it too. Never edit what this returns.
 */
export function glassMaterial(look: GlassLook, color: number = GLASS_COLOR): THREE.MeshStandardMaterial {
  const key = `${look}:${color}`;
  let m = glassByLook.get(key);
  if (m === undefined) {
    m = makeGlassMaterial();
    m.color.setHex(color);
    m.opacity = GLASS_LOOKS[look].opacity;
    m.roughness = GLASS_LOOKS[look].roughness;
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

/** The head bulbs' lens texels (linear multipliers of the head lamp's white emissive): halogen an amber past the post's bloom threshold, so its lens glows warm with a halo as the references light it; LED cool white. */
const LAMP_BULB_TEXEL = { halogen: [2.4, 1.6, 0.8], led: [240 / 255, 247 / 255, 1] } as const;
/**
 * 2×2 emissive mask for the lamps (float, so a bulb can sit over 1), by (u, v): housing (.25, .25) black, lens (.75, .75) white, and
 * the head bulbs' lens texels, halogen (.75, .25) and LED (.25, .75) (`LAMP_BULB_UV`). Shared, never disposed.
 */
export const lampEmissiveMap = once((): THREE.DataTexture => {
  const t = new THREE.DataTexture(new Float32Array([0, 0, 0, 1, ...LAMP_BULB_TEXEL.halogen, 1, ...LAMP_BULB_TEXEL.led, 1, 1, 1, 1, 1]), 2, 2, THREE.RGBAFormat, THREE.FloatType);
  t.needsUpdate = true;
  return t;
});

/** Where a head lens with its `lamps.bulb` samples `lampEmissiveMap` ([u, v]). */
export const LAMP_BULB_UV = { halogen: [0.75, 0.25], led: [0.25, 0.75] } as const;

/** Light bar lens texels in `sirenEmissiveMap` order: housing, red lens, blue lens. */
const SIREN_U = [1 / 6, 3 / 6, 5 / 6] as const;

/** The light bar's two feet in bar space: at ±`x`, their soles `sole` below the origin, `2z` deep (front to back). They rest on the roof. */
export const LIGHT_BAR_FOOT = { x: 0.4, sole: -0.03, z: 0.09 } as const;

/** A light bar part in bar space at (`x`, `y`, 0): one tone, every vertex on its `sirenEmissiveMap` texel. */
function lightBarPart(g: THREE.BufferGeometry, x: number, y: number, tone: number, texel: 0 | 1 | 2): THREE.BufferGeometry {
  toned(g, tone, 0, 0).translate(x, y, 0);
  const uv = g.getAttribute("uv").array as Float32Array;
  for (let i = 0; i < uv.length; i += 2) {
    uv[i] = SIREN_U[texel];
    uv[i + 1] = 0.5;
  }
  return g;
}

/** A lens module [width, height, depth] (m), centred `LENS_Y` up in bar space, its edges rounded over `LENS_ROUND` (m) in one segment (two chords a
 *  round, 108 triangles a lens; three segments cost 588 and broke the police's triangle budget): a domed lens, as the reference's, not a brick. */
const LENS_SIZE = [0.42, 0.075, 0.23] as const;
const LENS_Y = 0.1;
const LENS_ROUND = 0.035;
const LENS_ROUND_SEGMENTS = 1;
/** The white lamp cell at each lens's centre [width, height] (m): it stands 2 mm proud of the lens's front and back, as the reference's white hot spot. */
const LENS_CELL = [0.07, 0.03] as const;

/** A domed lens at `x` (RoundedBoxGeometry comes unindexed; the bar's other parts are indexed, and a merge takes one kind). */
function domeLens(x: number, tone: number, texel: 1 | 2): THREE.BufferGeometry {
  const [w, h, d] = LENS_SIZE;
  return mergeVertices(lightBarPart(new RoundedBoxGeometry(w, h, d, LENS_ROUND_SEGMENTS, LENS_ROUND), x, LENS_Y, tone, texel));
}

/** Roof light bar in bar space (+z forward, so +x is the car's left): housing on two feet (`LIGHT_BAR_FOOT`), a domed red lens on
 *  the car's left (+x) and a blue one on its right (−x), each with a white lamp cell at its centre, as the reference cruiser's, with a
 *  clear takedown module between, one draw. `LIGHT_BAR_LENS` lists each lens's vertices. The `cage` build (the bar's cage panel) keeps
 *  brick lenses and no cells: the dome is drawn only. */
export function makeLightBar(source: BodySource = "drawn"): THREE.BufferGeometry {
  const box = (w: number, h: number, d: number, x: number, y: number, tone: number, texel: 0 | 1 | 2) => lightBarPart(new THREE.BoxGeometry(w, h, d), x, y, tone, texel);
  const [cellW, cellH] = LENS_CELL;
  const [lensW, lensH, lensD] = LENS_SIZE;
  const lenses =
    source === "cage"
      ? [box(lensW, lensH, lensD, 0.3, LENS_Y, 0x8c1218, 1), box(lensW, lensH, lensD, -0.3, LENS_Y, 0x1a36a8, 2)]
      : [
          domeLens(0.3, 0x8c1218, 1),
          domeLens(-0.3, 0x1a36a8, 2),
          box(cellW, cellH, lensD + 0.004, 0.3, LENS_Y, 0xf2f4f6, 0),
          box(cellW, cellH, lensD + 0.004, -0.3, LENS_Y, 0xf2f4f6, 0),
        ];
  return mergeToned(
    [
      box(1.04, 0.045, 0.26, 0, 0.04, 0x16181c, 0),
      box(0.16, 0.07, 0.22, 0, 0.1, 0xd8dce2, 0),
      box(0.08, -2 * LIGHT_BAR_FOOT.sole, 2 * LIGHT_BAR_FOOT.z, -LIGHT_BAR_FOOT.x, 0, 0x16181c, 0),
      box(0.08, -2 * LIGHT_BAR_FOOT.sole, 2 * LIGHT_BAR_FOOT.z, LIGHT_BAR_FOOT.x, 0, 0x16181c, 0),
      ...lenses,
    ],
    "light bar",
  );
}

/** A push bar stands this far (m) ahead of its bumper's face, `tube` thick; its uprights `x` either side of the middle reach
 *  `above` the bumper's top, carry a `plate` thick pad on their face, and its lower bar spans `span` either side: a cruiser's grille guard.
 *  As the reference cruiser's (front iso): uprights at |x| 0.36 about 4 cm ahead of the face, the top bar at y ~0.62 just over the
 *  hood's leading edge, the lower bar at the grille's foot. */
const PUSH_BAR = { gap: 0.015, tube: 0.05, x: 0.36, above: 0.18, span: 0.38, plate: 0.025 } as const;
/** A push bar tube's sides: round steel as the reference's, the square box read as a plank at the chase camera. */
const PUSH_BAR_SIDES = 10;
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
  // A tube `length` long along y, then turned onto its axis.
  const pipe = (length: number) => new THREE.CylinderGeometry(tube / 2, tube / 2, length, PUSH_BAR_SIDES);
  const parts = [bumper, pipe(2 * x + tube).rotateZ(Math.PI / 2).translate(0, top - tube / 2, z), pipe(2 * span).rotateZ(Math.PI / 2).translate(0, max.y - tube, z)];
  for (const side of [-1, 1]) {
    parts.push(pipe(top - min.y).translate(side * x, (top + min.y) / 2, z));
    parts.push(new THREE.BoxGeometry(0.07, 0.22, plate).translate(side * x, max.y + above / 2, z + tube / 2 + plate / 2));
    parts.push(pipe(gap + tube).rotateX(Math.PI / 2).translate(side * x, max.y - tube, max.z + (gap + tube) / 2));
  }
  const geo = mergeGeometries(parts, false);
  for (const g of parts) g.dispose();
  if (!geo) throw new Error("Failed to merge the push bar into its bumper");
  return geo;
}

/** A domed lens's vertex count (`domeLens`). */
const LENS_VERTICES = (() => {
  const lens = domeLens(0, 0, 1);
  const n = lens.getAttribute("position").count;
  lens.dispose();
  return n;
})();
/** [first vertex, count] of the red and blue lens in `makeLightBar`, after its four boxes (24 vertices each). */
export const LIGHT_BAR_LENS = [
  [96, LENS_VERTICES],
  [96 + LENS_VERTICES, LENS_VERTICES],
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
/** A black-painted centre (the pickup's alloy). */
const DARK_HUB = [0x232428, 0.55, 0.45] as const;
/** A polished rim lip (muscle, monster). */
const CHROME = [0xeef0f3, 0.12, 1] as const;
/** The muscle car's mag centre cap (reference: a big grey dome): 7.8 cm in radius, standing 4 cm over the dish ([r, x] m, lathed). */
const MAG_CAP = [[0, -0.1], [0.05, -0.092], [0.078, -0.07], [0.078, 0.07], [0.05, 0.092], [0, 0.1]] as const;

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

/** A slot window's polar outline: from `r0` to `r1` (m) off the axle, `a0`/`a1` (rad) wide at each end, rounded by a quadratic curve at each corner over `round` of its depth. */
function slotShape(r0: number, r1: number, a0: number, a1: number, round: number): THREE.Shape {
  const p = (r: number, a: number): [number, number] => [r * detSin(a), r * detCos(a)];
  const d = (r1 - r0) * round;
  const [ia, ib, oa, ob] = [p(r0, -a0 / 2), p(r0, a0 / 2), p(r1, a1 / 2), p(r1, -a1 / 2)];
  const [ia2, ib2, oa2, ob2] = [p(r0 + d, -a0 / 2), p(r0 + d, a0 / 2), p(r1 - d, a1 / 2), p(r1 - d, -a1 / 2)];
  return new THREE.Shape()
    .moveTo(...ia2).quadraticCurveTo(...ia, ...p(r0, 0)).quadraticCurveTo(...ib, ...ib2)
    .lineTo(...oa2).quadraticCurveTo(...oa, ...p(r1, 0)).quadraticCurveTo(...ob, ...ob2)
    .lineTo(...ia2);
}

/** `g`'s face normals (±x) bent toward the axle, 0 at the centre to `bend` rad at radius `r`: a flat face that shades as a concave dish. */
function dished(g: THREE.BufferGeometry, r: number, bend: number): THREE.BufferGeometry {
  const [p, n] = [g.getAttribute("position"), g.getAttribute("normal")];
  for (let i = 0; i < p.count; i++) {
    const rho = Math.sqrt(p.getY(i) ** 2 + p.getZ(i) ** 2);
    const a = bend * Math.min(rho / r, 1);
    const k = rho > 0 ? detSin(a) / rho : 0;
    n.setXYZ(i, Math.sign(n.getX(i)) * detCos(a), -p.getY(i) * k, -p.getZ(i) * k);
  }
  return g;
}

/** Each face a solid dish of radius `r` at `x` (m off centre) in `tone`, with `n` dark slot windows (`slotShape`) 1 mm proud of it: a slotted mag; `bend` (rad) shades it `dished`. */
function slottedDish(n: number, r: number, x: number, tone: readonly [number, number, number], slot: Parameters<typeof slotShape>, bend = 0): THREE.BufferGeometry[] {
  const face = (g: THREE.BufferGeometry) => (bend ? dished(g, r, bend) : g);
  const out: THREE.BufferGeometry[] = [];
  for (const side of [1, -1]) {
    out.push(smeared(flatPart(face(new THREE.CircleGeometry(r, 16).rotateY((side * Math.PI) / 2).translate(side * x, 0, 0)), tone), 1));
    for (let k = 0; k < n; k++) {
      const window = face(new THREE.ShapeGeometry(slotShape(...slot), 2).rotateZ((k * 2 * Math.PI) / n).rotateY((side * Math.PI) / 2).translate(side * (x + 0.001), 0, 0));
      out.push(smeared(flatPart(window, DARK_DISC), 1));
    }
  }
  return out;
}

/** The rim designs the references show; each is one instanced draw in the wheel batch. `split10l`: `split10` on the SUV's larger rim. */
export type WheelDesign = "five" | "split10" | "mag5" | "six" | "beadlock" | "split10l";
export const WHEEL_DESIGNS: readonly WheelDesign[] = ["five", "split10", "mag5", "six", "beadlock", "split10l"];

/** Mud-terrain lugs round the monster tyre: pitches, and each block's [across, radial, round] size (m) and chevron yaw (rad). */
const MONSTER_LUGS = 22;
const LUG_SIZE = [0.1, 0.05, 0.06] as const;
const LUG_CHEVRON = 0.45;
/** How far (m) a lug stands above the crown under it; the rest of the block is sunk in, showing only where the shoulder rolls off. */
const LUG_RISE = 0.024;
/** Monster tyre: bead radius (m) for a tall sidewall on the small rim, and its crown under the lugs, whose tops are the rig's crown. */
const MONSTER_TYRE: readonly [number, number] = [0.165, ROAD_TYRE[1] - LUG_RISE];
/**
 * A design's rim and face scaled about the axle, its tyre's bead moved with them (absent: the road rim, lip at .675 of the crown).
 * The monster's reference rim is half the tyre's height; the SUV's lip reaches .76 of it (reference side: .74 to the tyre, .80 to its own).
 */
const RIM_SCALE: Partial<Record<WheelDesign, number>> = { beadlock: 0.8, split10l: 1.12 };

/** `TYRE_PROFILE` with its bead at `bead` and its crown at `crown`, the sidewall's shape stretched between. */
function rebeaded(bead: number, crown: number): (readonly [number, number])[] {
  const k = (crown - bead) / (ROAD_TYRE[1] - ROAD_TYRE[0]);
  return TYRE_PROFILE.map(([r, x]) => [bead + (r - ROAD_TYRE[0]) * k, x] as const);
}

/** A design's rim and face slid inboard by this share of their offsets (absent: none), so the tall sidewall stands proud of the lip as the monster reference's wraps its rim. */
const RIM_INSET: Partial<Record<WheelDesign, number>> = { beadlock: 0.9 };
/** How far (rad) the beadlock's dish shades toward the axle at its edge: the reference's deep polished bowl. */
const BEADLOCK_DISH_BEND = 0.5;

function monsterTyre(): THREE.BufferGeometry[] {
  const [bead, base] = MONSTER_TYRE;
  const parts = [smeared(latheX(rebeaded(bead, base), 24, TYRE_TREAD_V, TREAD_REPEATS, RUBBER), 0, [bead, ROAD_TYRE[1]])];
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
    case "split10l":
      return [...disc, ...spokes(5, [0.16, 0.15, 0.018], ALLOY, 0.2), hub(0.055, HUB)];
    case "mag5":
      return [...slottedDish(5, 0.19, 0.06, ALLOY, [0.075, 0.175, 0.45, 0.85, 0.15]), ...faceRings(0.18, 0.222, 0.1, CHROME), smeared(latheX(MAG_CAP, 10, null, 1, HUB), 0)];
    case "six":
      // The pickup's polished six-slot alloy, its black centre.
      return [...slottedDish(6, 0.19, 0.07, ALLOY, [0.09, 0.17, 0.42, 0.62, 0.2]), hub(0.075, DARK_HUB)];
    case "beadlock":
      // The monster's polished deep dish, eight slots 5 cm in under its chrome lip ring.
      return [...slottedDish(8, 0.19, 0.055, ALLOY, [0.105, 0.168, 0.32, 0.42, 0.25], BEADLOCK_DISH_BEND), ...faceRings(0.17, 0.222, 0.104, CHROME), hub(0.05, HUB)];
  }
}

/**
 * One wheel about the x axle, symmetric in x so the same instance serves both sides: a lathed tyre (tread detail from
 * `treadNormalMap`; the monster's carries lug blocks), a rim barrel and `design`'s face. The face's spokes and disc carry
 * `smear` 1 (`spokeSmear`); the rubber carries its `tyre` weight (`makeWheelMaterial`'s loaded foot).
 */
export function makeWheelGeometry(design: WheelDesign = "five"): THREE.BufferGeometry {
  const rim = [smeared(latheX(RIM_PROFILE, 16, null, 1, ALLOY), 0), ...rimFace(design)];
  const k = RIM_SCALE[design];
  if (k !== undefined) for (const g of rim) g.scale(RIM_INSET[design] ?? 1, k, k);
  if (design === "beadlock") return mergeToned([...monsterTyre(), ...rim], "wheel");
  if (k === undefined) return mergeToned([smeared(latheX(TYRE_PROFILE, 24, TYRE_TREAD_V, TREAD_REPEATS, RUBBER), 0, ROAD_TYRE), ...rim], "wheel");
  const bead = ROAD_TYRE[0] * k;
  return mergeToned([smeared(latheX(rebeaded(bead, ROAD_TYRE[1]), 24, TYRE_TREAD_V, TREAD_REPEATS, RUBBER), 0, [bead, ROAD_TYRE[1]]), ...rim], "wheel");
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
