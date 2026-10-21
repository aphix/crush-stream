import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { once } from "../kernel/scalar.ts";
import { detSin, detCos } from "../kernel/physics-core.js";
import { applyFinish } from "./car-finish.ts";
import { BARE_METAL_FRAGMENT, BARE_METAL_VERTEX } from "./bare-metal.ts";

/** The shared car textures and materials (paint, tone grid, glass, crack map, lamp mask) and the multi-tone part helpers; the small parts built on them are in `part-geometry.ts`. */

/**
 * What the paint's colour (sRGB 0xf2f2f0, linear here) and roughness multiply in where its two 1 x 1 maps were sampled, those maps'
 * texels: every car's paint stays what it was, and no paint pixel fetches a texture for a constant.
 */
const PAINT_COLOR_TONE = new THREE.Color(0xf2f2f0);
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
      .replace("#include <roughnessmap_fragment>", `#include <roughnessmap_fragment>\nroughnessFactor *= ${PAINT_ROUGHNESS_TONE};\n${BARE_METAL_FRAGMENT.roughness}`)
      .replace("#include <metalnessmap_fragment>", `#include <metalnessmap_fragment>\n${BARE_METAL_FRAGMENT.metalness}`)
      .replace("#include <color_fragment>", `#include <color_fragment>\n${BARE_METAL_FRAGMENT.color}`)
      .replace("#include <lights_physical_fragment>", `#include <lights_physical_fragment>\n${BARE_METAL_FRAGMENT.clearcoat}`);
  };
  m.customProgramCacheKey = () => "car-paint-primer";
  return m;
}

/** What a wheel's spokes and disc blend to at full smear: the alloy and the dark disc averaged, as a shutter would. */
const SMEAR_TONE = new THREE.Color(0x6b6f76);

/**
 * The parts material for the wheel batch: the `blur` of each instance (0 sharp .. 1 smeared, `spokeSmear`) fades the
 * vertices with `smear` weight toward one flat, half-metal tone, so a rim turning too fast to read as spokes reads as a
 * soft disc instead of strobing slow or backwards. Wraps `capHighlights`' compile hook.
 */
export function makeWheelMaterial(): THREE.MeshStandardMaterial {
  const m = makePartsMaterial();
  const cap = m.onBeforeCompile;
  m.onBeforeCompile = (shader, renderer) => {
    cap.call(m, shader, renderer);
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nattribute float smear;\nattribute float blur;\nvarying float vSmear;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvSmear = smear * blur;");
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nvarying float vSmear;")
      .replace("#include <color_fragment>", `#include <color_fragment>\ndiffuseColor.rgb = mix(diffuseColor.rgb, vec3(${SMEAR_TONE.r}, ${SMEAR_TONE.g}, ${SMEAR_TONE.b}), vSmear);`)
      .replace("#include <roughnessmap_fragment>", "#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.5, vSmear);")
      .replace("#include <metalnessmap_fragment>", "#include <metalnessmap_fragment>\nmetalnessFactor = mix(metalnessFactor, 0.6, vSmear);");
  };
  m.customProgramCacheKey = () => "car-wheel-smear";
  return m;
}

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

const trimByColor = new Map<number, THREE.MeshStandardMaterial>();

/**
 * The bumper trim of `color`, one material for every car that wears it (the palette has a dozen): a material switch costs a
 * frame about 0.015 ms at 4x CPU, and 32 cars drew 64 trim materials. Never disposed, like `partsMaterial`.
 */
export function trimMaterial(color: number): THREE.MeshStandardMaterial {
  let m = trimByColor.get(color);
  if (m === undefined) {
    m = classed(applyFinish(capHighlights(new THREE.MeshStandardMaterial({ color, metalness: 0.55, roughness: 0.38 })), "trim"), DRAW_CLASS.trim);
    m.userData.shared = true;
    trimByColor.set(color, m);
  }
  return m;
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

/**
 * The one material every pane in `look` and `color` wears: a pane changes look by changing material, never by editing its own,
 * so a car's six panes and every other car's share it (the renderer re-sends a material's uniforms each time the draw
 * changes material, and a car's panes were six copies of one). Never edit what this returns.
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
export const LAMP_HOUSING: Readonly<Record<LampKind, readonly [number, number]>> = { head: [0.22, 0.09], tail: [0.31, 0.11] };

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

/** Roof light bar in bar space (+z forward): housing on two feet (`LIGHT_BAR_FOOT`), a red lens on the left (−x)
 *  and a blue one on the right, one draw. `LIGHT_BAR_LENS` lists each lens's vertices. */
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
      box(1.06, 0.05, 0.25, 0, 0.04, 0x16181c, 0),
      box(0.06, 0.07, 0.2, 0, 0.1, 0x8a909a, 0),
      box(0.08, -2 * LIGHT_BAR_FOOT.sole, 2 * LIGHT_BAR_FOOT.z, -LIGHT_BAR_FOOT.x, 0, 0x16181c, 0),
      box(0.08, -2 * LIGHT_BAR_FOOT.sole, 2 * LIGHT_BAR_FOOT.z, LIGHT_BAR_FOOT.x, 0, 0x16181c, 0),
      box(0.47, 0.075, 0.22, -0.27, 0.1, 0x8c1218, 1),
      box(0.47, 0.075, 0.22, 0.27, 0.1, 0x1a36a8, 2),
    ],
    "light bar",
  );
}

/** A push bar stands this far (m) ahead of its bumper's face, `tube` thick; its uprights `x` either side of the middle reach
 *  `rise` above the bumper's top, and its lower bar spans `span` either side: a cruiser's grille guard. */
const PUSH_BAR = { gap: 0.04, tube: 0.05, x: 0.2, rise: 0.3, span: 0.42 } as const;

/** Front bumper `bumper` (bumper space, +z forward, indexed) with a push bar in front of its face: one geometry, so the bar
 *  draws in the bumper's trim and tears off with it. */
export function withPushBar(bumper: THREE.BufferGeometry): THREE.BufferGeometry {
  bumper.computeBoundingBox();
  const { min, max } = bumper.boundingBox!;
  const { gap, tube, x, rise, span } = PUSH_BAR;
  const z = max.z + gap + tube / 2;
  const top = max.y + rise;
  const box = (w: number, h: number, d: number, bx: number, by: number, bz: number) => new THREE.BoxGeometry(w, h, d).translate(bx, by, bz);
  const parts = [bumper, box(2 * x + tube, tube, tube, 0, top - tube / 2, z), box(2 * span, tube, tube, 0, max.y - tube, z)];
  for (const side of [-1, 1]) {
    parts.push(box(tube, top - min.y, tube, side * x, (top + min.y) / 2, z));
    parts.push(box(0.07, 0.22, 0.025, side * x, max.y + rise / 2, z + tube / 2 + 0.0125));
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

/** Give every vertex of `g` a `smear` weight: 1 on the spokes and the disc behind them, which `makeWheelMaterial` fades toward a blur. */
function smeared(g: THREE.BufferGeometry, weight: number): THREE.BufferGeometry {
  g.setAttribute("smear", new THREE.BufferAttribute(new Float32Array(g.getAttribute("position").count).fill(weight), 1));
  return g;
}

/**
 * One wheel about the x axle, symmetric in x so the same instance serves both sides: a lathed tyre
 * (tread detail from `treadNormalMap`), a rim barrel, five spokes through the full rim width over a
 * dark centre disc, and the hub. ~680 triangles. The spokes and disc carry `smear` 1 (`spokeSmear`).
 */
export function makeWheelGeometry(): THREE.BufferGeometry {
  const parts = [latheX(TYRE_PROFILE, 24, TYRE_TREAD_V, TREAD_REPEATS, RUBBER), latheX(RIM_PROFILE, 16, null, 1, ALLOY)].map((g) => smeared(g, 0));
  for (const side of [1, -1]) parts.push(smeared(flatPart(new THREE.CircleGeometry(0.19, 16).rotateY((side * Math.PI) / 2), [0x1c1d20, 0.7, 0.3]), 1));
  for (let k = 0; k < 5; k++) {
    parts.push(smeared(flatPart(new THREE.BoxGeometry(0.17, 0.15, 0.042).translate(0, 0.115, 0).rotateX((k * 2 * Math.PI) / 5), ALLOY), 1));
  }
  parts.push(smeared(flatPart(new THREE.CylinderGeometry(0.062, 0.062, 0.19, 10).rotateZ(Math.PI / 2), [0x8a909a, 0.35, 0.8]), 0));
  return mergeToned(parts, "wheel");
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
  const parts = [smeared(latheX(profile, 12, treadV, TREAD_REPEATS, RUBBER), 0)];
  for (const side of [1, -1]) parts.push(smeared(flatPart(new THREE.CircleGeometry(0.2, 12).rotateY((side * Math.PI) / 2), FAR_DISC), 1));
  return mergeToned(parts, "far wheel");
}
