import * as THREE from "three";
import { detSin, hypot2 } from "../kernel/physics-core.js";
import { clamp, clamp01 } from "../kernel/scalar.ts";
import { finishOn, glslFloat } from "./car-finish.ts";
import { CLASS_LIFT } from "./constants.ts";
import type { BodyStyle } from "./car-variants.ts";

/**
 * Detail maps: a style's `details` (shut lines, creases, vents, grille bars) baked once into a height + cavity atlas with one tile
 * per view, drawn on the paint as a bump and a darkening at each pixel's rest point in the car frame, so a detail rides a crushed panel.
 */

type Details = NonNullable<BodyStyle["details"]>;
type DetailLine = Details["lines"][number];
type DetailPatch = Details["patches"][number];
type DetailView = DetailLine["view"];
type Pattern = NonNullable<DetailPatch["pattern"]>;

/** Atlas texel edge (m): a 6 mm shut line spans 1.5 texels; a sedan's four tiles take about 1200 x 1000 texels. */
const DETAIL_TEXEL_M = 0.004;
/** Neutral texels round each tile, so a mip or a clamped lookup past a tile's edge reads flat paint, not the next tile. */
const DETAIL_GUTTER_TEXELS = 8;
/** The format's height cap (m): ±6 mm stored in 8 bits about the middle byte, 0.047 mm a step. */
const DETAIL_HEIGHT_MAX_M = 0.006;
const HEIGHT_ZERO_BYTE = 128;
const HEIGHT_STEPS = 127;
const BYTE_MAX = 255;
/** A step's proud side falls back to the surface over this many stroke widths, so the step has no second edge where its band ends. */
const STEP_SHOULDER_WIDTHS = 8;

/** Bump fetches fade over this view distance (m) and stop past its end: a 6 mm groove is under a pixel by 25 m. */
const DETAIL_BUMP_FADE_START_M = 15;
const DETAIL_BUMP_END_M = 25;
/** The cavity's darkening carries a gap the bump no longer resolves, fading out to 80 m; past it no texel is fetched. */
const DETAIL_CAVITY_FADE_START_M = 60;
const DETAIL_CAVITY_END_M = 80;

/** The views in their uniform slots: the shader reads side 0, top 1, front 2, rear 3. */
const VIEWS: readonly DetailView[] = ["side", "top", "front", "rear"];

/** One view's tile: its view axes' origin (m), its size and its corner in the atlas (texels). */
type Tile = { a0: number; b0: number; width: number; height: number; x: number; y: number };

/** The rest frame's two attributes: each vertex and its normal in the car frame (`ensureRestFrame`), read by the spray and the detail map. */
const REST_POSITION = "sprayPos";
const REST_NORMAL = "sprayNrm";

/** The rest frame's attribute declarations: a compile hook adds them only where the shader lacks them, so chained hooks declare them once. */
export const REST_FRAME_ATTRIBUTES = `attribute vec3 ${REST_POSITION};\nattribute vec3 ${REST_NORMAL};`;

const _m = new THREE.Matrix4();
const _n = new THREE.Matrix3();
const _v = new THREE.Vector3();

/**
 * The rest frame on `mesh`'s geometry unless it has one: each vertex and its normal in the car frame of the style tables (through its
 * parents up to `group`, the class lift left out), read off the mesh as it is now.
 */
// ponytail: a car without details is read at its first look (`wearCarLook`); one already dented or with a lid open maps its spray off that shape.
export function ensureRestFrame(mesh: THREE.Mesh, group: THREE.Object3D): void {
  const geo = mesh.geometry;
  if (geo.hasAttribute(REST_POSITION)) return;
  _m.identity();
  for (let o: THREE.Object3D | null = mesh; o && o !== group; o = o.parent) {
    if (o.name === CLASS_LIFT) continue;
    o.updateMatrix();
    _m.premultiply(o.matrix);
  }
  _n.getNormalMatrix(_m);
  const pos = geo.getAttribute("position");
  const nrm = geo.getAttribute("normal");
  const outP = new Float32Array(pos.count * 3);
  const outN = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    _v.fromBufferAttribute(pos, i).applyMatrix4(_m).toArray(outP, i * 3);
    _v.fromBufferAttribute(nrm, i).applyMatrix3(_n).normalize().toArray(outN, i * 3);
  }
  geo.setAttribute(REST_POSITION, new THREE.BufferAttribute(outP, 3));
  geo.setAttribute(REST_NORMAL, new THREE.BufferAttribute(outN, 3));
}

// --- the bake ----------------------------------------------------------------------------------------------------------

/** The four tiles of a car of `dims` and the atlas they pack into: side and top along the length, front and rear side by side under them. */
function tileLayout(dims: BodyStyle["dims"]): { tiles: Tile[]; width: number; height: number } {
  const texels = (metres: number) => Math.ceil(metres / DETAIL_TEXEL_M);
  const zMin = -(dims.wheelbase / 2 + dims.overhang.rear);
  const along = texels(dims.wheelbase + dims.overhang.front + dims.overhang.rear);
  const up = texels(dims.height);
  const across = texels(dims.width / 2);
  const g = DETAIL_GUTTER_TEXELS;
  const tiles = [
    { a0: zMin, b0: 0, width: along, height: up, x: g, y: g },
    { a0: zMin, b0: 0, width: along, height: across, x: g, y: up + 3 * g },
    { a0: 0, b0: 0, width: across, height: up, x: g, y: up + across + 5 * g },
    { a0: 0, b0: 0, width: across, height: up, x: across + 3 * g, y: up + across + 5 * g },
  ];
  return { tiles, width: Math.max(along, 2 * across + 2 * g) + 2 * g, height: 2 * up + across + 6 * g };
}

/** The bake's float heights (m) and cavities (0..1), one per atlas texel, and the atlas width. */
type Canvas = { heights: Float32Array; cavities: Float32Array; width: number };

/** Texel `at` takes the deeper or prouder of its height and `height`, and the darker cavity. */
function combine(canvas: Canvas, at: number, height: number, cavity: number): void {
  if (Math.abs(height) > Math.abs(canvas.heights[at]!)) canvas.heights[at] = height;
  if (cavity > canvas.cavities[at]!) canvas.cavities[at] = cavity;
}

/** Every texel of `tile` whose centre lies in the view box [aMin, aMax] x [bMin, bMax] (m), clipped to the tile, with its centre and atlas index. */
function forTexels(tile: Tile, aMin: number, aMax: number, bMin: number, bMax: number, atlasWidth: number, visit: (a: number, b: number, at: number) => void): void {
  const i0 = Math.max(0, Math.ceil((aMin - tile.a0) / DETAIL_TEXEL_M - 0.5));
  const i1 = Math.min(tile.width - 1, Math.floor((aMax - tile.a0) / DETAIL_TEXEL_M - 0.5));
  const j0 = Math.max(0, Math.ceil((bMin - tile.b0) / DETAIL_TEXEL_M - 0.5));
  const j1 = Math.min(tile.height - 1, Math.floor((bMax - tile.b0) / DETAIL_TEXEL_M - 0.5));
  for (let j = j0; j <= j1; j++) {
    for (let i = i0; i <= i1; i++) visit(tile.a0 + (i + 0.5) * DETAIL_TEXEL_M, tile.b0 + (j + 0.5) * DETAIL_TEXEL_M, (tile.y + j) * atlasWidth + tile.x + i);
  }
}

/** The integral from 0 to `s` of a unit-peak even section of half-width `half`: a "v" (linear to 0) or, `rounded`, a "u" (raised cosine). */
function sectionIntegral(s: number, half: number, rounded: boolean): number {
  const a = Math.min(Math.abs(s), half);
  const area = rounded ? 0.5 * (a + (half / Math.PI) * detSin((Math.PI * a) / half)) : half / 2 - (half - a) ** 2 / (2 * half);
  return Math.sign(s) * area;
}

/** The section's mean over one texel centred `d` from the stroke: the analytic box filter, so a stroke narrower than two texels shows no stairs. */
function sectionOverTexel(d: number, half: number, rounded: boolean): number {
  const h = DETAIL_TEXEL_M / 2;
  return (sectionIntegral(d + h, half, rounded) - sectionIntegral(d - h, half, rounded)) / DETAIL_TEXEL_M;
}

/** A "step" at signed distance `s` (m, + on the left of travel): ramps from 0 to 1 across the stroke, then falls back over the shoulder. */
function stepSection(s: number, half: number): number {
  if (s <= -half) return 0;
  if (s < half) return (s + half) / (2 * half);
  return Math.max(0, 1 - (s - half) / (STEP_SHOULDER_WIDTHS * 2 * half));
}

/** One stroke into `canvas`, segment by segment, each only over its own box grown by its reach. */
// ponytail: a step's segments are drawn apart, so a sharp bend notches its shoulder on the outside; join the segments if a bent character line shows it.
function drawLine(canvas: Canvas, tile: Tile, line: DetailLine): void {
  const half = line.width / 2;
  const step = line.profile === "step";
  const rounded = line.profile === "u";
  const reach = (step ? half + STEP_SHOULDER_WIDTHS * line.width : half) + DETAIL_TEXEL_M;
  const points = line.points;
  const segments = line.closed ? points.length : points.length - 1;
  for (let k = 0; k < segments; k++) {
    const [pa, pb] = points[k]!;
    const [qa, qb] = points[(k + 1) % points.length]!;
    const da = qa - pa;
    const db = qb - pb;
    const length = hypot2(da, db);
    forTexels(tile, Math.min(pa, qa) - reach, Math.max(pa, qa) + reach, Math.min(pb, qb) - reach, Math.max(pb, qb) + reach, canvas.width, (a, b, at) => {
      const ra = a - pa;
      const rb = b - pb;
      const t = length > 0 ? (ra * da + rb * db) / (length * length) : 0;
      if (step) {
        if (t < 0 || t > 1 || length === 0) return;
        const s = (da * rb - db * ra) / length;
        combine(canvas, at, line.depth * stepSection(s, half), line.cavity * sectionOverTexel(Math.abs(s), half, false));
        return;
      }
      const tc = clamp01(t);
      const unit = sectionOverTexel(hypot2(ra - tc * da, rb - tc * db), half, rounded);
      combine(canvas, at, line.depth * unit, line.cavity * unit);
    });
  }
}

/** `x` folded into [0, period). */
function wrap(x: number, period: number): number {
  return x - period * Math.floor(x / period);
}

const HEX_ROW = Math.sqrt(3);

/** Distance (m) from (u, v) to the nearest edge of a pointy-top hexagon mesh whose cells sit `pitch` apart. */
function hexEdgeDistance(u: number, v: number, pitch: number): number {
  const ra = wrap(u, pitch) - pitch / 2;
  const rb = wrap(v, pitch * HEX_ROW) - (pitch * HEX_ROW) / 2;
  const sa = wrap(u - pitch / 2, pitch) - pitch / 2;
  const sb = wrap(v - (pitch * HEX_ROW) / 2, pitch * HEX_ROW) - (pitch * HEX_ROW) / 2;
  const nearR = ra * ra + rb * rb < sa * sa + sb * sb;
  const x = nearR ? ra : sa;
  const y = nearR ? rb : sb;
  const norm = Math.max(Math.abs(x), Math.abs(0.5 * x + (HEX_ROW / 2) * y), Math.abs(-0.5 * x + (HEX_ROW / 2) * y));
  return Math.abs(pitch / 2 - norm);
}

/** How much of a texel at (u, v) from the patch's corner a bar or dot of `pattern` covers, 0..1 (an interval's overlap with the texel). */
function patternCover(pattern: Pattern, u: number, v: number): number {
  const p = pattern.pitch;
  const d =
    pattern.kind === "hslats"
      ? Math.abs(wrap(v, p) - p / 2)
      : pattern.kind === "vslats"
        ? Math.abs(wrap(u, p) - p / 2)
        : pattern.kind === "dots"
          ? hypot2(wrap(u, p) - p / 2, wrap(v, p) - p / 2)
          : hexEdgeDistance(u, v, p);
  return clamp(DETAIL_TEXEL_M / 2 + pattern.bar / 2 - d, 0, Math.min(DETAIL_TEXEL_M, pattern.bar)) / DETAIL_TEXEL_M;
}

/** Each view's mirrored axis in its points ([a, b] index): an outline edge lying on x = 0 is the car's middle, not the patch's edge. */
const MIRROR_AXIS: Readonly<Record<DetailView, 0 | 1 | null>> = { side: null, top: 1, front: 0, rear: 0 };

/** Distance (m) from (a, b) to the outline of `points`, signed + inside (even-odd); edges on the `mirror` axis's zero are skipped. */
function signedPolygonDistance(points: DetailPatch["points"], a: number, b: number, mirror: 0 | 1 | null): number {
  let inside = false;
  let nearest = Infinity;
  for (let k = 0, m = points.length - 1; k < points.length; m = k++) {
    const [pa, pb] = points[k]!;
    const [qa, qb] = points[m]!;
    if (pb > b !== qb > b && a < ((qa - pa) * (b - pb)) / (qb - pb) + pa) inside = !inside;
    if (mirror !== null && points[k]![mirror] === 0 && points[m]![mirror] === 0) continue;
    const da = qa - pa;
    const db = qb - pb;
    const length2 = da * da + db * db;
    const t = length2 > 0 ? clamp01(((a - pa) * da + (b - pb) * db) / length2) : 0;
    nearest = Math.min(nearest, hypot2(a - pa - t * da, b - pb - t * db));
  }
  return inside ? nearest : -nearest;
}

/** One patch into `canvas`: its floor at `depth` ramped over `rim` inside the outline, its pattern's bars raised from the floor, its cavity on the floor. */
function drawPatch(canvas: Canvas, tile: Tile, patch: DetailPatch): void {
  let aMin = Infinity;
  let aMax = -Infinity;
  let bMin = Infinity;
  let bMax = -Infinity;
  for (const [a, b] of patch.points) {
    aMin = Math.min(aMin, a);
    aMax = Math.max(aMax, a);
    bMin = Math.min(bMin, b);
    bMax = Math.max(bMax, b);
  }
  const pattern = patch.pattern;
  const mirror = MIRROR_AXIS[patch.view];
  forTexels(tile, aMin - DETAIL_TEXEL_M, aMax + DETAIL_TEXEL_M, bMin - DETAIL_TEXEL_M, bMax + DETAIL_TEXEL_M, canvas.width, (a, b, at) => {
    const floor = clamp01((signedPolygonDistance(patch.points, a, b, mirror) + DETAIL_TEXEL_M / 2) / (patch.rim + DETAIL_TEXEL_M));
    if (floor === 0) return;
    const bars = pattern ? patternCover(pattern, a - aMin, b - bMin) : 0;
    combine(canvas, at, floor * (patch.depth + (pattern ? pattern.depth * bars : 0)), floor * patch.cavity * (1 - bars));
  });
}

/** `details` baked for a car of `dims`: an RG8 atlas (R height about the middle byte, G cavity), its tiles' lookups written into `tiles` / `bounds`. */
function bakeDetailAtlas(details: Details, dims: BodyStyle["dims"], tiles: readonly THREE.Vector4[], bounds: readonly THREE.Vector4[]): THREE.DataTexture {
  const layout = tileLayout(dims);
  const { width, height } = layout;
  const canvas: Canvas = { heights: new Float32Array(width * height), cavities: new Float32Array(width * height), width };
  for (const line of details.lines) drawLine(canvas, layout.tiles[VIEWS.indexOf(line.view)]!, line);
  for (const patch of details.patches) drawPatch(canvas, layout.tiles[VIEWS.indexOf(patch.view)]!, patch);
  const texels = new Uint8Array(width * height * 2);
  for (let i = 0; i < width * height; i++) {
    texels[2 * i] = Math.round(HEIGHT_ZERO_BYTE + clamp(canvas.heights[i]! / DETAIL_HEIGHT_MAX_M, -1, 1) * HEIGHT_STEPS);
    texels[2 * i + 1] = Math.round(clamp01(canvas.cavities[i]!) * BYTE_MAX);
  }
  const reach = DETAIL_GUTTER_TEXELS - 0.5;
  for (let k = 0; k < VIEWS.length; k++) {
    const t = layout.tiles[k]!;
    tiles[k]!.set((t.x - t.a0 / DETAIL_TEXEL_M) / width, (t.y - t.b0 / DETAIL_TEXEL_M) / height, 1 / (DETAIL_TEXEL_M * width), 1 / (DETAIL_TEXEL_M * height));
    bounds[k]!.set((t.x - reach) / width, (t.y - reach) / height, (t.x + t.width + reach) / width, (t.y + t.height + reach) / height);
  }
  const texture = new THREE.DataTexture(texels, width, height, THREE.RGFormat);
  texture.generateMipmaps = true;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

// --- the shader --------------------------------------------------------------------------------------------------------

const DETAIL_PARS = /* glsl */ `
uniform sampler2D detailMap;
uniform vec4 detailTiles[4];
uniform vec4 detailBounds[4];
uniform vec2 detailEnds;
varying vec3 vDetailPos;
varying vec3 vDetailNormal;
vec2 detailSample(vec4 tile, vec4 bounds, vec2 q) {
  return texture2D(detailMap, clamp(tile.xy + q * tile.zw, bounds.xy, bounds.zw)).rg - vec2(${glslFloat(HEIGHT_ZERO_BYTE / BYTE_MAX)}, 0.0);
}
// A tile's height and cavity at q (xy) and its height's slope one pixel right and down (zw), from the texel differences along q: the
// screen derivative of the filtered height is flat across each texel and steps between them, which draws a stroke as a sawtooth.
vec4 detailPlane(vec4 tile, vec4 bounds, vec2 q, vec2 qx, vec2 qy) {
  vec2 here = detailSample(tile, bounds, q);
  vec2 along = vec2(detailSample(tile, bounds, q + vec2(${glslFloat(DETAIL_TEXEL_M)}, 0.0)).r, detailSample(tile, bounds, q + vec2(0.0, ${glslFloat(DETAIL_TEXEL_M)})).r);
  vec2 gradient = (along - here.r) / ${glslFloat(DETAIL_TEXEL_M)};
  return vec4(here, dot(gradient, qx), dot(gradient, qy));
}`;

/**
 * After the clear coat's normal, inside FinishLod's draw gate (`finishMeshNear`, so only with the finish on): the three view tiles
 * the rest normal faces blended as the finish's planes (the underside reads none; the front tile only ahead of the front axle, the
 * rear only behind the rear axle), the cavity darkening the paint, and near enough the height's slope (`detailPlane`'s texel
 * differences) bending the base and coat normals.
 */
const DETAIL_SURFACE = /* glsl */ `
float detailCavity = 0.0;
float detailNear = finishMeshNear();
if (detailNear < ${glslFloat(DETAIL_CAVITY_END_M)}) {
  vec3 detailWeights = finishPlaneWeights(vDetailNormal);
  if (vDetailNormal.y < 0.0) detailWeights.y = 0.0;
  float detailX = abs(vDetailPos.x);
  bool detailFront = vDetailNormal.z >= 0.0;
  if (detailFront ? vDetailPos.z < detailEnds.x : vDetailPos.z > detailEnds.y) detailWeights.z = 0.0;
  vec2 detailSide = vDetailPos.zy;
  vec2 detailTop = vec2(vDetailPos.z, detailX);
  vec2 detailEnd = vec2(detailX, vDetailPos.y);
  vec4 detailTexel = detailWeights.x * detailPlane(detailTiles[0], detailBounds[0], detailSide, dFdx(detailSide), dFdy(detailSide))
    + detailWeights.y * detailPlane(detailTiles[1], detailBounds[1], detailTop, dFdx(detailTop), dFdy(detailTop))
    + detailWeights.z * detailPlane(detailFront ? detailTiles[2] : detailTiles[3], detailFront ? detailBounds[2] : detailBounds[3], detailEnd, dFdx(detailEnd), dFdy(detailEnd));
  float detailDistance = length(vViewPosition);
  detailCavity = detailTexel.g * (1.0 - smoothstep(${glslFloat(DETAIL_CAVITY_FADE_START_M)}, ${glslFloat(DETAIL_CAVITY_END_M)}, detailDistance));
  diffuseColor.rgb *= 1.0 - detailCavity;
  if (detailNear < ${glslFloat(DETAIL_BUMP_END_M)}) {
    vec2 detailSlope = detailTexel.zw * ${glslFloat((BYTE_MAX / HEIGHT_STEPS) * DETAIL_HEIGHT_MAX_M)} * (1.0 - smoothstep(${glslFloat(DETAIL_BUMP_FADE_START_M)}, ${glslFloat(DETAIL_BUMP_END_M)}, detailDistance));
    normal = finishPerturbedNormal(normal, detailSlope, faceDirection);
    #ifdef USE_CLEARCOAT
    clearcoatNormal = finishPerturbedNormal(clearcoatNormal, detailSlope, faceDirection);
    #endif
  }
}`;

/** A gap's clear coat thins with its darkening, so the coat's sheen does not bridge it. */
const DETAIL_COAT = /* glsl */ `
#ifdef USE_CLEARCOAT
material.clearcoat *= 1.0 - detailCavity;
#endif`;

type DetailUniforms = {
  detailMap: THREE.IUniform<THREE.DataTexture | null>;
  detailTiles: THREE.IUniform<THREE.Vector4[]>;
  detailBounds: THREE.IUniform<THREE.Vector4[]>;
  /** The front and rear axles' z (m): the end tiles print only past them. */
  detailEnds: THREE.IUniform<THREE.Vector2>;
};

/** One set of uniforms per style, shared by every material of its cars; its atlas is baked when the style's first car is built (race setup, before the warm-up), so no draw or tier flip bakes; never disposed. */
const uniformsByStyle = new WeakMap<BodyStyle, DetailUniforms>();

function detailUniforms(style: BodyStyle): DetailUniforms {
  let uniforms = uniformsByStyle.get(style);
  if (uniforms === undefined) {
    const axle = style.dims.wheelbase / 2;
    uniforms = {
      detailMap: { value: null },
      detailTiles: { value: VIEWS.map(() => new THREE.Vector4()) },
      detailBounds: { value: VIEWS.map(() => new THREE.Vector4()) },
      detailEnds: { value: new THREE.Vector2(axle, -axle) },
    };
    uniformsByStyle.set(style, uniforms);
  }
  return uniforms;
}

/**
 * Patch paint `material` (one with `applyFinish`) to draw `style`'s details while its finish is on: its program key gains `|detail`
 * and its shader samples the style's atlas at the rest frame, baked here whatever the tier so a flip to High finds it ready. A style
 * with no details leaves the material as it was. Chains the earlier compile hook, like `applyFinish`.
 */
export function applyDetailMap(material: THREE.MeshPhysicalMaterial, style: BodyStyle): void {
  const details = style.details;
  if (!details) return;
  const uniforms = detailUniforms(style);
  uniforms.detailMap.value ??= bakeDetailAtlas(details, style.dims, uniforms.detailTiles.value, uniforms.detailBounds.value);
  const previousHook = material.onBeforeCompile;
  const previousKey = material.customProgramCacheKey;
  material.onBeforeCompile = (shader, renderer) => {
    previousHook.call(material, shader, renderer);
    // Every compile carries the uniforms, as the finish's map does: three binds a material's latest uniforms to each program it returns to.
    Object.assign(shader.uniforms, uniforms);
    if (!finishOn(material)) return;
    const attributes = shader.vertexShader.includes(REST_FRAME_ATTRIBUTES) ? "" : REST_FRAME_ATTRIBUTES;
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", `#include <common>\n${attributes}\nvarying vec3 vDetailPos;\nvarying vec3 vDetailNormal;`)
      .replace("#include <begin_vertex>", `#include <begin_vertex>\nvDetailPos = ${REST_POSITION};\nvDetailNormal = ${REST_NORMAL};`);
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>\n${DETAIL_PARS}`)
      .replace("#include <clearcoat_normal_fragment_maps>", `#include <clearcoat_normal_fragment_maps>\n${DETAIL_SURFACE}`)
      .replace("#include <lights_physical_fragment>", `#include <lights_physical_fragment>\n${DETAIL_COAT}`);
  };
  material.customProgramCacheKey = () => (finishOn(material) ? `${previousKey.call(material)}|detail` : previousKey.call(material));
}
