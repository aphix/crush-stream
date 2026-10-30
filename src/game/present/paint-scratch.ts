import * as THREE from "three";
import type { DeformableCar } from "../vehicle/car.ts";
import { REST_FRAME_ATTRIBUTES } from "../vehicle/car-detail-map.ts";
import { FACE_BITS, FACE_MASK, FACE_METRES, FACE_WIDTH, SCRAPE_MAX, SEVERITY, STROKE_BYTES, U0, U1, V0, V1, WIDTH_STEP } from "../vehicle/paint-scrapes.ts";
import { CAR_SPRAY } from "../vehicle/spray-box.ts";
import { declareSprayFace } from "./spray.ts";

/** The FX tier's share of the scratches: 0 only at `off`. Shared by every car's paint. */
export const SCRATCH_TIER = { value: 1 };

/** What a car with no strokes samples: no wear. Shared, never disposed. */
const BARE_SCRATCH = new THREE.DataTexture(new Uint8Array(2), 1, 1, THREE.RGFormat);
BARE_SCRATCH.needsUpdate = true;

const SIDE = CAR_SPRAY.w;
const FACES = CAR_SPRAY.faces.length;
/** A stroke's least radius, in its face's coarser texel: a hairline narrower than a texel still covers one under linear filtering. */
const MIN_RADIUS_TEXELS = 0.75;
/** `WearMask.pending` once more rows wait than it has ranges for: only a whole upload covers them. */
const FULL = -1;

/** Line pitch (m) across the slide: each 1.6 mm row holds at most one scratch line. */
const PITCH = 0.0016;
/** A line's half width as a share of its row at the lightest wear: hashed per row between these, so lines differ in weight; heavier wear widens them by `WIDEN` at full severity until neighbours merge. */
const LINE_MIN = 0.08;
const LINE_MAX = 0.22;
const WIDEN = 2.4;
/** Rows that carry a line per unit severity: a light brush strikes a few, a hard shove nearly all. */
const DENSITY = 1.3;
/** Dash length (m) along the slide, and the share of dashes a line skips at the lightest wear (none at full): grit lifts off and bites again. */
const DASH = 0.05;
const DASH_GAP = 0.45;
/** Severity (mask R, 0..1) above which a line cuts from primer through to steel, full at the second, jittered per line by `STEEL_JITTER` so a band keeps grey strands. */
const STEEL_FROM = 0.45;
const STEEL_FULL = 0.85;
const STEEL_JITTER = 0.35;

const f = (x: number): string => (Number.isInteger(x) ? `${x}.0` : `${x}`);

/** `paintScratch()` (the seam in `vehicle/bare-metal.ts`): hash lines along the slide where the wear mask's R is up, more, wider and steelier the higher it is. */
const SCRATCH_GLSL = /* glsl */ `
#define PAINT_SCRATCH
uniform sampler2D wearMap;
uniform float scratchTier;
float scratchHash(float x) { return fract(sin(x * 127.1) * 43758.5453); }
vec2 paintScratch() {
  if (scratchTier == 0.0) return vec2(0.0);
  vec4 face = sprayFaceAt();
  if (face.x < 0.0) return vec2(0.0);
  float s = texture2D(wearMap, face.xy).r;
  if (s == 0.0) return vec2(0.0);
  vec3 a = abs(vSprayN);
  bool top = a.y > a.x && a.y > a.z;
  float row = (top ? vSprayP.x : vSprayP.y) / ${f(PITCH)};
  float id = floor(row);
  float pick = scratchHash(id);
  float hw = min(0.5, mix(${f(LINE_MIN)}, ${f(LINE_MAX)}, scratchHash(id + 0.37)) * (1.0 + ${f(WIDEN)} * s * s));
  float aa = fwidth(row);
  float line = 1.0 - smoothstep(hw - aa, hw + aa, abs(fract(row) - 0.5));
  // Rows under a pixel: their mean cover, not a moire.
  line = mix(line, 2.0 * hw, clamp(aa - 0.5, 0.0, 1.0));
  float along = (!top && a.z > a.x ? vSprayP.x : vSprayP.z) / ${f(DASH)};
  float dash = step(${f(DASH_GAP)} * (1.0 - s), scratchHash(floor(along + pick * 7.0) + id * 0.01));
  float hair = line * dash * step(pick, s * ${f(DENSITY)});
  float bite = s * (1.0 - ${f(STEEL_JITTER)} * scratchHash(id + 0.71));
  return hair * vec2(1.0, smoothstep(${f(STEEL_FROM)}, ${f(STEEL_FULL)}, bite));
}`;

/** A car's wear: the uniforms every paint of it samples, its mask while it has strokes, and the list the mask was drawn from. */
type Wear = {
  readonly uniforms: { wearMap: THREE.IUniform<THREE.Texture>; scratchTier: typeof SCRATCH_TIER };
  mask: WearMask | null;
  owner: PaintScratches | null;
  version: number;
  count: number;
  readonly list: Uint8Array;
};

const wears = new WeakMap<DeformableCar, Wear>();
const patched = new WeakSet<THREE.Material>();

/**
 * Car `car`'s paints (body, lids, doors) draw its scratches: each samples the car's wear mask in the `CAR_SPRAY` layout. Once per
 * material, and before `applySpray` on every paint of a car, so every car paint compiles to the same program key.
 */
export function applyScratch(car: DeformableCar): void {
  let wear = wears.get(car);
  const m = car.lookMeshes();
  if (!wear) {
    const own: Wear = { uniforms: { wearMap: { value: BARE_SCRATCH }, scratchTier: SCRATCH_TIER }, mask: null, owner: null, version: -1, count: 0, list: new Uint8Array(SCRAPE_MAX * STROKE_BYTES) };
    wears.set(car, (wear = own));
    // A discarded car (every path frees its body paint) hands its mask back.
    m.bodyPaint.addEventListener("dispose", () => own.owner?.draw(own, own.list, 0));
  }
  for (const mesh of [m.body, m.hood, m.trunk, ...m.doors]) patchPaint(mesh.material as THREE.Material, wear.uniforms);
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
  /** Ranges handed to three since its last upload (it clears them as it sends them), or `FULL`. */
  private pending = 0;

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
      if (wear === undefined || wear.version === car.scratches.version) continue;
      wear.version = car.scratches.version;
      this.draw(wear, car.scratches.list, car.scratches.count);
    }
  }

  /** `wear` drawn to `count` strokes of `list`; a car that has none hands its mask back and samples `BARE_SCRATCH`. */
  draw(wear: Wear, list: Uint8Array, count: number): void {
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
        if ((list[k * STROKE_BYTES + FACE_WIDTH]! & FACE_MASK) === face) stamp(mask.data, list, k * STROKE_BYTES, rects, o);
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

/** The stroke at `s` of `list` into R of `data`, inside face rect `o` of `rects`: a capsule, severity × (1 − (d/r)²) at distance d, the higher of it and what is there. */
function stamp(data: Uint8Array, list: Uint8Array, s: number, rects: Int32Array, o: number): void {
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
      data[i] = Math.max(data[i]!, Math.round(severity * (1 - q)));
    }
  }
}
