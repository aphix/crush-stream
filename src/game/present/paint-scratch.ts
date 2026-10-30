import * as THREE from "three";
import type { DeformableCar } from "../vehicle/car.ts";
import { ensureRestFrame, REST_FRAME_ATTRIBUTES } from "../vehicle/car-detail-map.ts";
import { FACE_BITS, FACE_MASK, FACE_METRES, FACE_WIDTH, SCRAPE_MAX, SEVERITY, STROKE_BYTES, U0, U1, V0, V1, WIDTH_STEP } from "../vehicle/paint-scrapes.ts";
import { CAR_SPRAY } from "../vehicle/spray-box.ts";
import { MAT, type MaterialId } from "../kernel/material-ids.ts";
import { declareSprayFace, sprayFaceUniforms } from "./spray.ts";

/** The FX tier's share of the scratches: 0 only at `off`. Shared by every car's paint. */
export const SCRATCH_TIER = { value: 1 };

/** What a car with no strokes samples: no wear. Shared, never disposed. */
const BARE_SCRATCH = new THREE.DataTexture(new Uint8Array(2), 1, 1, THREE.RGFormat);
BARE_SCRATCH.needsUpdate = true;
/** The `CAR_SPRAY` face mapping the strokes are made in: a paint with no spray of its own has no other, and unset it maps every fragment to texel (0, 0). Every car layout's normalized faces are these. */
const FACE_UNIFORMS = sprayFaceUniforms(CAR_SPRAY);

const SIDE = CAR_SPRAY.w;
const FACES = CAR_SPRAY.faces.length;
/** A stroke's least radius, in its face's coarser texel: a hairline narrower than a texel still covers one under linear filtering. */
const MIN_RADIUS_TEXELS = 0.75;
/** `WearMask.pending` once more rows wait than it has ranges for: only a whole upload covers them. */
const FULL = -1;

/** Row pitch (m) across the slide: each 6 mm row holds at most one scratch line, set off its middle by up to `JITTER` of the row, so lines stand apart at uneven spacing with paint between them. */
const PITCH = 0.006;
const JITTER = 0.6;
/** A line's half width as a share of its row, hashed per line between these (0.5-1.2 mm wide): a scratch, never a band. */
const LINE_MIN = 0.04;
const LINE_MAX = 0.1;
/** Rows that carry a line per unit severity: a light brush strikes a few, a hard shove most; deeper is more lines, not wider ones. */
const DENSITY = 0.85;
/** A line's dash length (m) along the slide, hashed per line between these shares of it, and the share of dashes it skips at the lightest wear (`DASH_GAP_DEEP` at full): grit lifts off and bites again. */
const DASH = 0.06;
const DASH_SHORT = 0.4;
const DASH_LONG = 1.8;
const DASH_GAP = 0.55;
const DASH_GAP_DEEP = 0.2;
/** Up to this share of a dash's length frays off each of its ends, hashed per dash: lines start and stop at their own places. */
const DASH_FRAY = 0.35;
/** The share of lines cut through to steel at full severity (the rest abrade the clear coat and paint to a whitish streak), and of gouges among them: twice as wide, twice as long, always steel. */
const STEEL_SHARE = 0.18;
const GOUGE_SHARE = 0.06;
const GOUGE_WIDEN = 2;
/** The least screen pitch (px) between the rows a line may stand on: farther off, only every 2^k-th row keeps its line, at least a pixel wide, so a scratched panel reads as a few distinct streaks, not as their faded mean. */
const SPARSE_PX = 4;
/** A bundle's sway (rows) across the slide, and its two wavelengths (m) along it: the lines ride the panel's bulges together, so a zone's edges are wavy. */
const WAVE_ROWS = 2.5;
const WAVE_LONG = 0.9;
const WAVE_SHORT = 0.35;
/** How much of a zone's line density comes and goes along the slide (0 none): the striker bites harder in places. */
const DENSITY_SWAY = 0.45;
/** Past this severity paint flakes off to the primer in crisp patches (`FLAKE_CELL` m across, a finer `FLAKE_FINE` m edge), up to `FLAKE_SHARE` of the zone at full. */
const FLAKE_FROM = 0.6;
const FLAKE_SHARE = 0.4;
const FLAKE_CELL = 0.035;
const FLAKE_FINE = 0.012;

const f = (x: number): string => (Number.isInteger(x) ? `${x}.0` : `${x}`);

/**
 * `paintScratch()` (the seam in `vehicle/bare-metal.ts`): thin dashed lines along the slide where the wear mask's R is up, in wavy
 * bundles whose density comes and goes along it, mostly abraded paint, some cut to steel, and past `FLAKE_FROM` primer flakes: the
 * shares (abraded, primer, steel).
 */
const SCRATCH_GLSL = /* glsl */ `
#define PAINT_SCRATCH
uniform sampler2D wearMap;
uniform float scratchTier;
float scratchHash(float x) { return fract(sin(x * 127.1) * 43758.5453); }
float scratchNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 u = fract(p);
  u = u * u * (3.0 - 2.0 * u);
  float n = i.x + i.y * 57.0;
  return mix(mix(scratchHash(n), scratchHash(n + 1.0), u.x), mix(scratchHash(n + 57.0), scratchHash(n + 58.0), u.x), u.y);
}
vec3 paintScratch() {
  if (scratchTier == 0.0) return vec3(0.0);
  vec4 face = sprayFaceAt();
  if (face.x < 0.0) return vec3(0.0);
  float s = texture2D(wearMap, face.xy).r;
  if (s == 0.0) return vec3(0.0);
  vec3 a = abs(vSprayN);
  bool top = a.y > a.x && a.y > a.z;
  float m = !top && a.z > a.x ? vSprayP.x : vSprayP.z;
  float row = (top ? vSprayP.x : vSprayP.y) / ${f(PITCH)};
  row += ${f(WAVE_ROWS)} * (sin(m * ${f((2 * Math.PI) / WAVE_LONG)} + row * 0.09) + 0.5 * sin(m * ${f((2 * Math.PI) / WAVE_SHORT)} - row * 0.05));
  float aa = fwidth(row);
  // Rows thinner than \`SPARSE_PX\` px: keep the lines of every \`span\`-th row only, where they are, each at least a pixel wide.
  float span = exp2(max(0.0, ceil(log2(aa * ${f(SPARSE_PX)}))));
  float cell = row / span;
  float id = floor(cell) * span;
  float pick = scratchHash(id);
  float gouge = step(1.0 - ${f(GOUGE_SHARE)} * s, scratchHash(id + 0.53));
  float hw = mix(${f(LINE_MIN)}, ${f(LINE_MAX)}, scratchHash(id + 0.37)) * (1.0 + ${f(GOUGE_WIDEN - 1)} * gouge);
  float centre = 0.5 + ${f(JITTER)} * (scratchHash(id + 0.13) - 0.5);
  float ac = aa / span;
  float hc = max(hw / span, 0.5 * ac);
  float line = 1.0 - smoothstep(hc - ac, hc + ac, abs(fract(cell) - centre / span));
  float len = ${f(DASH)} * span * mix(${f(DASH_SHORT)}, ${f(DASH_LONG)}, scratchHash(id + 0.29)) * (1.0 + gouge);
  float along = m / len + pick * 7.0;
  float dashCell = floor(along) + id * 0.01;
  float t = fract(along);
  float dash = step(mix(${f(DASH_GAP)}, ${f(DASH_GAP_DEEP)}, s), scratchHash(dashCell))
    * step(${f(DASH_FRAY)} * scratchHash(dashCell + 0.41), t) * step(t, 1.0 - ${f(DASH_FRAY)} * scratchHash(dashCell + 0.83));
  float sway = 0.5 + 0.5 * sin(m * 4.1 + row * 0.03) * sin(m * 9.7 + 1.3);
  // A kept row stands for its \`span\` rows: it carries a line where any of them would.
  float hair = line * dash * step(pick, 1.0 - pow(1.0 - min(1.0, s * ${f(DENSITY)} * (1.0 - ${f(DENSITY_SWAY)} * sway)), span));
  float steel = hair * max(gouge, step(scratchHash(id + 0.71), ${f(STEEL_SHARE)} * s));
  vec2 q = vec2(m, row * ${f(PITCH)});
  float flaky = 0.65 * scratchNoise(q / ${f(FLAKE_CELL)}) + 0.35 * scratchNoise(q / ${f(FLAKE_FINE)} + 31.0);
  float flake = step(1.0 - ${f(FLAKE_SHARE)} * smoothstep(${f(FLAKE_FROM)}, 1.0, s), flaky) * (1.0 - steel);
  return vec3((hair - steel) * (1.0 - flake), flake, steel);
}`;

/** A car's wear: the uniforms every paint of it samples, its mask while it has strokes, the list the mask was drawn from, and its bumpers with the own materials they draw it in once it has strokes. */
type Wear = {
  readonly uniforms: Record<string, THREE.IUniform> & { wearMap: THREE.IUniform<THREE.Texture>; scratchTier: typeof SCRATCH_TIER };
  mask: WearMask | null;
  owner: PaintScratches | null;
  version: number;
  count: number;
  readonly list: Uint8Array;
  readonly car: DeformableCar;
  readonly bumpers: readonly THREE.Mesh[];
  readonly bumperOwn: (THREE.MeshStandardMaterial | null)[];
};

const wears = new WeakMap<DeformableCar, Wear>();
const patched = new WeakSet<THREE.Material>();

/**
 * Car `car`'s paints (body, lids, doors) draw its scratches: each samples the car's wear mask in the `CAR_SPRAY` layout. Once per
 * material, and before `applySpray` on every paint of a car, so every car paint compiles to the same program key. Its bumpers' shared
 * trims learn to draw them too (sampling no wear until the car has strokes: `PaintScratches.frame` gives it its own).
 */
export function applyScratch(car: DeformableCar): void {
  let wear = wears.get(car);
  const m = car.lookMeshes();
  if (!wear) {
    const own: Wear = {
      uniforms: { ...FACE_UNIFORMS, wearMap: { value: BARE_SCRATCH }, scratchTier: SCRATCH_TIER },
      mask: null,
      owner: null,
      version: -1,
      count: 0,
      list: new Uint8Array(SCRAPE_MAX * STROKE_BYTES),
      car,
      bumpers: m.bumpers,
      bumperOwn: m.bumpers.map(() => null),
    };
    wears.set(car, (wear = own));
    // A discarded car (every path frees its body paint) hands its mask back and frees its bumpers' own trims.
    m.bodyPaint.addEventListener("dispose", () => {
      own.owner?.draw(own, own.list, 0);
      for (const trim of own.bumperOwn) trim?.dispose();
    });
  }
  for (const mesh of [m.body, m.hood, m.trunk, ...m.doors]) patchPaint(mesh.material as THREE.Material, wear.uniforms);
  for (const mesh of m.bumpers) patchTrim(mesh.material as THREE.MeshStandardMaterial);
}

/**
 * How each bumper finish scuffs: the colour its abraded lines and flakes turn, how far over the trim (0..1), the colour its deep
 * lines cut to, and the scuff's roughness. Paint as the body's; black plastic whitens grey; chrome scratches bright.
 */
const TRIM_SCUFF: ReadonlyMap<MaterialId, { scuff: readonly number[]; lift: number; deep: readonly number[]; rough: number }> = new Map([
  [MAT.BUMPER_PAINTED, { scuff: [0.78, 0.78, 0.76], lift: 0.7, deep: [0.62, 0.63, 0.65], rough: 0.85 }],
  [MAT.BUMPER_SATIN, { scuff: [0.78, 0.78, 0.76], lift: 0.7, deep: [0.62, 0.63, 0.65], rough: 0.85 }],
  [MAT.BUMPER_BLACK, { scuff: [0.42, 0.42, 0.41], lift: 0.8, deep: [0.6, 0.6, 0.58], rough: 0.9 }],
  [MAT.BUMPER_CHROME, { scuff: [0.95, 0.95, 0.95], lift: 0.85, deep: [1, 1, 1], rough: 0.5 }],
]);

/** Each patched trim's compile without its uniforms, and its scuff's uniforms: a car's own copy compiles through the first with its own wear. */
const trimCompile = new WeakMap<THREE.Material, (shader: THREE.WebGLProgramParametersWithUniforms, renderer: THREE.WebGLRenderer) => void>();
const trimScuff = new WeakMap<THREE.Material, Record<string, THREE.IUniform>>();
const BARE_TRIM_WEAR = { wearMap: { value: BARE_SCRATCH }, scratchTier: SCRATCH_TIER };

/** Shared trim `material` draws scratches (its finish's scuff, `TRIM_SCUFF`) from the wear its uniforms bind; a fitting drawn in it shows none. One program for every finish. */
function patchTrim(material: THREE.MeshStandardMaterial): void {
  if (patched.has(material)) return;
  patched.add(material);
  const look = TRIM_SCUFF.get(material.userData.materialId as MaterialId) ?? TRIM_SCUFF.get(MAT.BUMPER_SATIN)!;
  const scuff = { scratchScuff: { value: new THREE.Vector3().fromArray(look.scuff) }, scratchLift: { value: look.lift }, scratchDeep: { value: new THREE.Vector3().fromArray(look.deep) }, scratchRough: { value: look.rough } };
  const prev = material.onBeforeCompile;
  const prevKey = material.customProgramCacheKey;
  const compile = (shader: THREE.WebGLProgramParametersWithUniforms, renderer: THREE.WebGLRenderer): void => {
    prev.call(material, shader, renderer);
    Object.assign(shader.uniforms, FACE_UNIFORMS, scuff);
    declareSprayFace(shader, REST_FRAME_ATTRIBUTES);
    shader.vertexShader = shader.vertexShader.replace("#include <begin_vertex>", "#include <begin_vertex>\nvSprayP = sprayPos;\nvSprayN = sprayNrm;");
    shader.fragmentShader = shader.fragmentShader
      .replace("void main() {", `${SCRATCH_GLSL}\nuniform vec3 scratchScuff;\nuniform float scratchLift;\nuniform vec3 scratchDeep;\nuniform float scratchRough;\nvoid main() {`)
      .replace("#include <color_fragment>", "#include <color_fragment>\nvec3 trimScratch = paintScratch();\ndiffuseColor.rgb = mix(diffuseColor.rgb, scratchScuff, max(trimScratch.x, trimScratch.y) * scratchLift);\ndiffuseColor.rgb = mix(diffuseColor.rgb, scratchDeep, trimScratch.z);")
      .replace("#include <roughnessmap_fragment>", "#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, scratchRough, max(trimScratch.x, max(trimScratch.y, trimScratch.z)));");
  };
  trimCompile.set(material, compile);
  trimScuff.set(material, scuff);
  material.onBeforeCompile = (shader, renderer) => {
    compile(shader, renderer);
    Object.assign(shader.uniforms, BARE_TRIM_WEAR);
  };
  material.customProgramCacheKey = () => `${prevKey.call(material)}|scratch`;
  material.needsUpdate = true;
}

/** `wear`'s car's bumpers each draw in a copy of their trim of their own that samples the car's mask (one program with the shared trim's), made the first time it is needed: a bumper's rest frame with it. */
function wearBumpers(wear: Wear): void {
  for (let i = 0; i < wear.bumpers.length; i++) {
    const mesh = wear.bumpers[i]!;
    const trim = mesh.material as THREE.MeshStandardMaterial;
    if (trim === wear.bumperOwn[i]) continue;
    patchTrim(trim);
    ensureRestFrame(mesh, wear.car.group);
    const own = trim.clone();
    own.userData.shared = false;
    const compile = trimCompile.get(trim)!;
    const uniforms = { ...trimScuff.get(trim), ...wear.uniforms };
    own.onBeforeCompile = (shader, renderer) => {
      compile(shader, renderer);
      Object.assign(shader.uniforms, uniforms);
    };
    own.customProgramCacheKey = trim.customProgramCacheKey;
    wear.bumperOwn[i]?.dispose();
    wear.bumperOwn[i] = own;
    mesh.material = own;
  }
}

function patchPaint(material: THREE.Material, uniforms: Wear["uniforms"]): void {
  if (patched.has(material)) return;
  patched.add(material);
  const prev = material.onBeforeCompile;
  const prevKey = material.customProgramCacheKey;
  material.onBeforeCompile = (shader, renderer) => {
    prev.call(material, shader, renderer);
    Object.assign(shader.uniforms, uniforms);
    declareSprayFace(shader, REST_FRAME_ATTRIBUTES);
    shader.vertexShader = shader.vertexShader.replace("#include <begin_vertex>", "#include <begin_vertex>\nvSprayP = sprayPos;\nvSprayN = sprayNrm;");
    shader.fragmentShader = shader.fragmentShader.replace("void main() {", `${SCRATCH_GLSL}\nvoid main() {`);
  };
  material.customProgramCacheKey = () => `${prevKey.call(material)}|scratch`;
  material.needsUpdate = true;
}

/** One car's RG8 wear mask (R scratch severity, G reserved for dents) and the reused row ranges that upload what changed. */
class WearMask {
  readonly data = new Uint8Array(SIDE * SIDE * 2);
  readonly texture = new THREE.DataTexture(this.data, SIDE, SIDE, THREE.RGFormat);
  private readonly rows = Array.from({ length: SIDE }, () => ({ start: 0, count: 0 }));
  /** Ranges handed to three since its last upload (it clears them as it sends them), or `FULL`: also before the first, as a partial upload to an unallocated texture makes Firefox clear it first. */
  private pending = FULL;

  constructor() {
    const t = this.texture;
    t.magFilter = THREE.LinearFilter;
    t.minFilter = THREE.LinearFilter;
    t.generateMipmaps = false;
    t.needsUpdate = true;
    t.onUpdate = () => {
      this.pending = 0;
    };
  }

  /** Bitmap texels x0..x1 of rows y0..y1 upload at the next draw; ranges in three's RGBA units, which it reads back as pixels. */
  touch(x0: number, y0: number, x1: number, y1: number): void {
    const t = this.texture;
    for (let y = y0; y <= y1 && this.pending !== FULL; y++) {
      if (this.pending === SIDE) {
        t.clearUpdateRanges();
        this.pending = FULL;
        break;
      }
      const r = this.rows[this.pending++]!;
      r.start = (y * SIDE + x0) * 4;
      r.count = (x1 - x0 + 1) * 4;
      t.updateRanges[t.updateRanges.length] = r;
    }
    t.needsUpdate = true;
  }
}

/**
 * Draws each car's wear mask from its stroke list (`car.scratches`) whenever the list's version moves: every viewer draws the same
 * texels from the same bytes. Only the strokes that changed are redrawn: their face rects are cleared and every stroke crossing them
 * stamped again, so the mask is always exactly a function of the list.
 */
export class PaintScratches {
  private readonly free: WearMask[] = [];
  private readonly made: WearMask[] = [];
  /** Per face: the texel rect (x0, y0, x1, y1) a draw clears and restamps; x1 < x0 is none. */
  private readonly rects = new Int32Array(FACES * 4);

  /** Once a frame, every built car that draws (live, podium, showcase; a replay's cars are the live ones). */
  frame(cars: readonly DeformableCar[]): void {
    for (let i = 0; i < cars.length; i++) {
      const car = cars[i]!;
      const wear = wears.get(car);
      if (wear === undefined) continue;
      // A scratched car's bumpers draw in trims of its own; a look that swapped one for a shared trim gets a new own copy.
      if (car.scratches.count > 0) wearBumpers(wear);
      if (wear.version === car.scratches.version) continue;
      wear.version = car.scratches.version;
      this.draw(wear, car.scratches.list, car.scratches.count, car.scratches.cover);
    }
  }

  /** `wear` drawn to `count` strokes of `list` over the style's paint cover `cover` (`paintCover`: recess per texel); a car that has none hands its mask back and samples `BARE_SCRATCH`. */
  draw(wear: Wear, list: Uint8Array, count: number, cover: Uint8Array | null = null): void {
    if (count > 0 && wear.mask === null) this.take(wear);
    const mask = wear.mask;
    const rects = this.rects;
    for (let face = 0; face < FACES; face++) {
      rects[face * 4] = SIDE;
      rects[face * 4 + 1] = SIDE;
      rects[face * 4 + 2] = -1;
      rects[face * 4 + 3] = -1;
    }
    const n = Math.max(count, wear.count);
    for (let k = 0; k < n; k++) {
      const s = k * STROKE_BYTES;
      const was = k < wear.count;
      const is = k < count;
      if (was && is && sameStroke(wear.list, list, s)) continue;
      if (was) growRect(rects, wear.list, s);
      if (is) growRect(rects, list, s);
    }
    for (let i = 0; i < count * STROKE_BYTES; i++) wear.list[i] = list[i]!;
    wear.list.fill(0, count * STROKE_BYTES);
    wear.count = count;
    if (mask === null) return;
    for (let face = 0; face < FACES; face++) {
      const o = face * 4;
      if (rects[o + 2]! < rects[o]!) continue;
      const fx = CAR_SPRAY.faces[face]![0];
      const fy = CAR_SPRAY.faces[face]![1];
      for (let y = rects[o + 1]!; y <= rects[o + 3]!; y++) {
        for (let x = rects[o]!; x <= rects[o + 2]!; x++) mask.data[((fy + y) * SIDE + fx + x) * 2] = 0;
      }
      for (let k = 0; k < count; k++) {
        if ((list[k * STROKE_BYTES + FACE_WIDTH]! & FACE_MASK) === face) stamp(mask.data, list, k * STROKE_BYTES, rects, o, cover);
      }
      mask.touch(fx + rects[o]!, fy + rects[o + 1]!, fx + rects[o + 2]!, fy + rects[o + 3]!);
    }
    if (count === 0) this.give(wear);
  }

  private take(wear: Wear): void {
    const mask = this.free.pop() ?? this.make();
    wear.mask = mask;
    wear.owner = this;
    wear.uniforms.wearMap.value = mask.texture;
  }

  private give(wear: Wear): void {
    this.free.push(wear.mask!);
    wear.mask = null;
    wear.owner = null;
    wear.uniforms.wearMap.value = BARE_SCRATCH;
  }

  private make(): WearMask {
    const mask = new WearMask();
    this.made.push(mask);
    return mask;
  }

  dispose(): void {
    for (const mask of this.made) mask.texture.dispose();
  }
}

function sameStroke(a: Uint8Array, b: Uint8Array, s: number): boolean {
  for (let i = s; i < s + STROKE_BYTES; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** A stroke's radius (m): half its width, at least `MIN_RADIUS_TEXELS` of its face's coarser texel. */
function radiusOf(list: Uint8Array, s: number, face: number): number {
  const width = ((list[s + FACE_WIDTH]! >> FACE_BITS) + 1) * WIDTH_STEP;
  return Math.max(width / 2, MIN_RADIUS_TEXELS * Math.max(FACE_METRES[2 * face]!, FACE_METRES[2 * face + 1]!));
}

/** Face `face`'s rect in `rects` grown to cover the texels the stroke at `s` of `list` stamps. */
function growRect(rects: Int32Array, list: Uint8Array, s: number): void {
  const face = list[s + FACE_WIDTH]! & FACE_MASK;
  const fw = CAR_SPRAY.faces[face]![2];
  const fh = CAR_SPRAY.faces[face]![3];
  const r = radiusOf(list, s, face);
  const ru = r / FACE_METRES[2 * face]!;
  const rv = r / FACE_METRES[2 * face + 1]!;
  const o = face * 4;
  rects[o] = Math.min(rects[o]!, Math.max(0, Math.ceil(Math.min(list[s + U0]!, list[s + U1]!) - ru)));
  rects[o + 1] = Math.min(rects[o + 1]!, Math.max(0, Math.ceil(Math.min(list[s + V0]!, list[s + V1]!) - rv)));
  rects[o + 2] = Math.max(rects[o + 2]!, Math.min(fw - 1, Math.floor(Math.max(list[s + U0]!, list[s + U1]!) + ru)));
  rects[o + 3] = Math.max(rects[o + 3]!, Math.min(fh - 1, Math.floor(Math.max(list[s + V0]!, list[s + V1]!) + rv)));
}

/**
 * The stroke at `s` of `list` into R of `data`, inside face rect `o` of `rects`: a capsule, severity × (1 − (d/r)²) at distance d, the
 * higher of it and what is there; on a texel recessed in `cover` past the stroke's reach (`proudShare`), less.
 */
function stamp(data: Uint8Array, list: Uint8Array, s: number, rects: Int32Array, o: number, cover: Uint8Array | null): void {
  const face = list[s + FACE_WIDTH]! & FACE_MASK;
  const fx = CAR_SPRAY.faces[face]![0];
  const fy = CAR_SPRAY.faces[face]![1];
  const mu = FACE_METRES[2 * face]!;
  const mv = FACE_METRES[2 * face + 1]!;
  const r = radiusOf(list, s, face);
  const u0 = list[s + U0]!;
  const v0 = list[s + V0]!;
  const bx = (list[s + U1]! - u0) * mu;
  const by = (list[s + V1]! - v0) * mv;
  const ll = bx * bx + by * by;
  const severity = list[s + SEVERITY]!;
  const x0 = Math.max(rects[o]!, Math.ceil(Math.min(u0, list[s + U1]!) - r / mu));
  const x1 = Math.min(rects[o + 2]!, Math.floor(Math.max(u0, list[s + U1]!) + r / mu));
  const y0 = Math.max(rects[o + 1]!, Math.ceil(Math.min(v0, list[s + V1]!) - r / mv));
  const y1 = Math.min(rects[o + 3]!, Math.floor(Math.max(v0, list[s + V1]!) + r / mv));
  for (let y = y0; y <= y1; y++) {
    const py = (y - v0) * mv;
    for (let x = x0; x <= x1; x++) {
      const px = (x - u0) * mu;
      const k = ll === 0 ? 0 : Math.min(1, Math.max(0, (px * bx + py * by) / ll));
      const ex = px - k * bx;
      const ey = py - k * by;
      const q = (ex * ex + ey * ey) / (r * r);
      if (q >= 1) continue;
      const i = ((fy + y) * SIDE + fx + x) * 2;
      const recess = cover === null ? 0 : Math.max(0, cover[(fy + y) * SIDE + fx + x]! - 1);
      data[i] = Math.max(data[i]!, Math.round(severity * (1 - q) * proudShare(recess, severity)));
    }
  }
}

/** A striker meets the outermost paint first: it reaches this far (mm) behind it at the lightest stroke and at the hardest, and fades out over `PROUD_FADE` past that. */
const PROUD_REACH_LIGHT = 6;
const PROUD_REACH_HARD = 40;
const PROUD_FADE = 12;

/** The share of a stroke of `severity` (0..255) a texel `recess` mm behind the outermost paint near it shows: the high places first, deeper ones as the stroke gets harder. */
function proudShare(recess: number, severity: number): number {
  const reach = PROUD_REACH_LIGHT + ((PROUD_REACH_HARD - PROUD_REACH_LIGHT) * severity) / 255;
  return Math.min(1, Math.max(0, 1 - (recess - reach) / PROUD_FADE));
}
