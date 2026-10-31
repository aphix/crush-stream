import * as THREE from "three";
import type { DeformableCar } from "../vehicle/car.ts";
import { ensureRestFrame, REST_FRAME_ATTRIBUTES, REST_NORMAL, REST_POSITION } from "../vehicle/car-detail-map.ts";
import { perturbedNormalGlsl } from "../vehicle/car-finish.ts";
import { FACE_BITS, FACE_MASK, FACE_METRES, FACE_WIDTH, SCRAPE_MAX, SEVERITY, STROKE_BYTES, U0, U1, V0, V1, WIDTH_STEP } from "../vehicle/paint-scrapes.ts";
import { CAR_SPRAY, SPRAY_FACE, sprayFace, sprayPlace } from "../vehicle/spray-box.ts";
import { MAT, type MaterialId } from "../kernel/material-ids.ts";
import { declareSprayFace, sprayFaceUniforms } from "./spray.ts";

/** The FX tier's share of the paint wear, shared by every car's paint: 0 at `off`, 1 the flat wear (scratches, dent darkening and dulling) at `minimal` and `low`, 2 with the dents' relief where the finish draws (`high`, `ultra`). */
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

/** A skin vertex moved less than this (m) along its rest normal, in or out, is not dented: a 50 km/h wall hit's untouched rear settles up to 2.7 cm (p99) with the masses. */
const DENT_MIN = 0.03;
/** The move (m) past `DENT_MIN` at which a dent's paint is fully dulled: a 50 km/h wall hit's crumpled hood folds about this far. */
const DENT_FULL = 0.08;
/** Seconds between two rebuilds of one car's dents while its skin keeps moving: a crush plays out over a few tenths. */
export const DENT_REBUILD_S = 0.25;
/** Texels a triangle is grown by as it is laid on the mask: closes the seams between neighbours and across the box's edges. */
const DENT_GROW_TEXELS = 0.75;
/** A triangle facing a box face less than this (its unit normal's share on the face's axis) is not laid on it: edge-on, it would smear its far corners' sinks across the face. */
const DENT_FACING = 0.3;
/** The least depth (`sprayPlace`, 0..1, the face's own side 1) a triangle laid on a flank, the nose or the tail reaches: one in the box's far half (a crushed nose's inner walls facing back) is not that side's paint. The roof has none: up-facing paint stands at every height. */
const DENT_NEAR = 0.5;
/** Each `SPRAY_FACE`'s rest axis: x for the flanks, y the roof, z the nose and tail. */
const FACE_AXIS = [0, 0, 1, 2, 2] as const;
/** Gaussian σ (texels, 1.8-2.7 cm each) of the skin round a texel whose bend is read: a third of a crush lobe, so a crease is one smooth band, never a texel step. */
const CREASE_NEAR = 1.5;
/** Gaussian σ (texels) of the wider skin that bend is weighed against: about a crush lobe's half, so one fold draws one broad crease, never a crinkle. */
const CREASE_FAR = 4;
/** The bend (m: how far the skin round a texel sinks below the wider skin) at which a crease is full. */
const BEND_FULL = 0.025;
/** G's share (0..1) a fully dented texel off any crease takes: dulled paint, no fold; a crease takes the rest. Exported for the rows. */
export const DENT_FLOOR = 0.4;
/** The depth (m) a full crease sinks the paint by: the light catches its shoulders, its trough is in shade. */
const DENT_CREASE = 0.05;

const f = (x: number): string => (Number.isInteger(x) ? `${x}.0` : `${x}`);

/**
 * `paintWear(lines)` (the seam in `vehicle/bare-metal.ts`): one fetch of the wear mask, four more where G is up. R draws `lines`: thin dashed lines along the
 * slide, in wavy bundles whose density comes and goes along it, mostly abraded paint, some cut to steel, and past `FLAKE_FROM` primer
 * flakes: the shares (abraded, primer, steel). It returns G read as the dent's dulled share (full at `DENT_FLOOR`) and its crease
 * (G past the floor). `paintScratch()` (a bumper trim's seam) is the lines alone.
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
vec3 scratchLines(float s) {
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
}
vec3 paintScratch() {
  if (scratchTier == 0.0) return vec3(0.0);
  vec4 face = sprayFaceAt();
  if (face.x < 0.0) return vec3(0.0);
  float s = texture2D(wearMap, face.xy).r;
  return s == 0.0 ? vec3(0.0) : scratchLines(s);
}
vec2 paintWear(out vec3 lines) {
  lines = vec3(0.0);
  if (scratchTier == 0.0) return vec2(0.0);
  vec4 face = sprayFaceAt();
  if (face.x < 0.0) return vec2(0.0);
  vec2 w = texture2D(wearMap, face.xy).rg;
  if (w.r > 0.0) lines = scratchLines(w.r);
  if (w.g == 0.0) return vec2(0.0);
  // Read again as a cubic B-spline (4 bilinear fetches): bilinear G kinks at every texel, which the relief's slope draws as blocky steps.
  vec2 t = face.xy * ${f(SIDE)} - 0.5;
  vec2 i = floor(t);
  vec2 u = t - i;
  vec2 v = 1.0 - u;
  vec2 w0 = v * v * v / 6.0;
  vec2 w1 = (4.0 - 6.0 * u * u + 3.0 * u * u * u) / 6.0;
  vec2 w3 = u * u * u / 6.0;
  vec2 lo = w0 + w1;
  vec2 at0 = (i - 0.5 + w1 / lo) / ${f(SIDE)};
  vec2 at1 = (i + 1.5 + w3 / (1.0 - lo)) / ${f(SIDE)};
  float g = lo.y * (lo.x * texture2D(wearMap, at0).g + (1.0 - lo.x) * texture2D(wearMap, vec2(at1.x, at0.y)).g)
    + (1.0 - lo.y) * (lo.x * texture2D(wearMap, vec2(at0.x, at1.y)).g + (1.0 - lo.x) * texture2D(wearMap, at1).g);
  return vec2(min(1.0, g / ${f(DENT_FLOOR)}), smoothstep(${f(DENT_FLOOR)}, 1.0, g));
}
${perturbedNormalGlsl("dentPerturbedNormal")}`;

/** After the clear coat's normal is declared: where the relief draws, the paint and coat normals tilt into each crease's trough. */
const DENT_NORMALS = /* glsl */ `
if (scratchTier > 1.5) {
  vec2 dentSlope = -${f(DENT_CREASE)} * vec2(dFdx(creaseW), dFdy(creaseW));
  normal = dentPerturbedNormal(normal, dentSlope, faceDirection);
#ifdef USE_CLEARCOAT
  clearcoatNormal = dentPerturbedNormal(clearcoatNormal, dentSlope, faceDirection);
#endif
}`;

/**
 * A car's wear: the uniforms every paint of it samples, its mask while it has strokes or dents, the list the mask was drawn from, its
 * bumpers with the own materials they draw it in once it has strokes, and its painted shells' skins and the dents drawn from them.
 */
type Wear = {
  readonly uniforms: Record<string, THREE.IUniform> & { wearMap: THREE.IUniform<THREE.Texture>; scratchTier: typeof SCRATCH_TIER };
  mask: WearMask | null;
  owner: PaintScratches | null;
  version: number;
  count: number;
  readonly list: Uint8Array;
  /** The car, its bumpers and their own trims, the painted shells (body, hood, trunk, door skins), their rest skins each in its own mesh frame, and the attributes their skin is written to. */
  readonly car: DeformableCar;
  readonly bumpers: readonly THREE.Mesh[];
  readonly bumperOwn: (THREE.MeshStandardMaterial | null)[];
  readonly shells: readonly THREE.Mesh[];
  readonly rests: readonly Float32Array[];
  readonly positions: readonly THREE.BufferAttribute[];
  /** Each shell's `RestPlaces`, read at the car's first dent draw. */
  readonly places: (RestPlaces | null)[];
  /** The shells' position versions summed when the dents were last drawn: a skin write moves it. */
  skin: number;
  /** `PaintScratches`' clock (s) when the dents were last drawn. */
  dentAt: number;
  /** Per face: the texel rect (x0, y0, x1, y1) G is up in; x1 < x0 is none. */
  readonly dents: Int32Array;
  dented: boolean;
};

const wears = new WeakMap<DeformableCar, Wear>();
const patched = new WeakSet<THREE.Material>();

/**
 * Car `car`'s paints (body, lids, doors) draw its scratches and dents: each samples the car's wear mask in the `CAR_SPRAY` layout. Once
 * per material, and before `applySpray` on every paint of a car, so every car paint compiles to the same program key. Its bumpers' shared
 * trims learn to draw the scratches too (sampling no wear until the car has strokes: `PaintScratches.frame` gives it its own).
 */
export function applyScratch(car: DeformableCar): void {
  let wear = wears.get(car);
  const m = car.lookMeshes();
  const shells = [m.body, m.hood, m.trunk, ...m.doors];
  if (!wear) {
    for (const mesh of shells) ensureRestFrame(mesh, car.group);
    const dents = new Int32Array(FACES * 4);
    for (let face = 0; face < FACES; face++) clearRect(dents, face * 4);
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
      shells,
      rests: car.shellRests(),
      positions: shells.map((mesh) => mesh.geometry.getAttribute("position")).filter((attr) => attr instanceof THREE.BufferAttribute),
      places: shells.map(() => null),
      skin: -1,
      dentAt: -Infinity,
      dents,
      dented: false,
    };
    wears.set(car, (wear = own));
    // A discarded car (every path frees its body paint) hands its mask back and frees its bumpers' own trims.
    m.bodyPaint.addEventListener("dispose", () => {
      own.owner?.release(own);
      for (const trim of own.bumperOwn) trim?.dispose();
    });
  }
  for (const mesh of shells) patchPaint(mesh.material as THREE.Material, wear.uniforms);
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
  // A car dressed again (`applyScratch` on a reused car) still wears its own copies: they compile the scratch already, and patching one
  // again compiles it twice (`redefinition`: the program fails to link, and three recompiles it every frame).
  if (patched.has(material) || material.userData.sharedTrim) return;
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
  // The copy is made in `ownTrim`: a closure built in this loop's body would give each pass a block context, garbage every frame until V8 optimizes it out.
  for (let i = 0; i < wear.bumpers.length; i++) if (wear.bumpers[i]!.material !== wear.bumperOwn[i]) ownTrim(wear, i);
}

/** `wear`'s bumper `i` drawn in a new own copy of its trim. */
function ownTrim(wear: Wear, i: number): void {
  const mesh = wear.bumpers[i]!;
  // A bumper re-skinned (a new wear on the same car) wears an earlier own copy: copy the shared trim it came from, never the copy (that
  // compiles the scratch twice: `redefinition`, and the program fails to link).
  const worn = mesh.material as THREE.MeshStandardMaterial;
  const trim = (worn.userData.sharedTrim as THREE.MeshStandardMaterial | undefined) ?? worn;
  patchTrim(trim);
  ensureRestFrame(mesh, wear.car.group);
  const own = trim.clone();
  own.userData.shared = false;
  own.userData.sharedTrim = trim;
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
    shader.fragmentShader = shader.fragmentShader
      .replace("void main() {", `${SCRATCH_GLSL}\nvoid main() {`)
      .replace("#include <clearcoat_normal_fragment_maps>", `#include <clearcoat_normal_fragment_maps>\n${DENT_NORMALS}`);
  };
  material.customProgramCacheKey = () => `${prevKey.call(material)}|scratch`;
  material.needsUpdate = true;
}

/** One car's RG8 wear mask (R scratch severity, G dent height) and the reused row ranges that upload what changed. */
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
 * Draws each car's wear mask: R from its stroke list (`car.scratches`) whenever the list's version moves, so every viewer draws the
 * same texels from the same bytes (only the strokes that changed are redrawn: their face rects are cleared and every stroke crossing
 * them stamped again, so R is always exactly a function of the list); G from its skin's dents, before the drawn tyre hold (`dent`).
 */
export class PaintScratches {
  private readonly free: WearMask[] = [];
  private readonly made: WearMask[] = [];
  /** Per face: the texel rect (x0, y0, x1, y1) a draw clears and restamps; x1 < x0 is none. */
  private readonly rects = new Int32Array(FACES * 4);
  /** A dent draw's last rects, and its per-vertex sinks (m), grown to the largest shell. */
  private readonly was = new Int32Array(FACES * 4);
  private sinks = new Float32Array(0);
  /** The last dent draw's depth (m past `DENT_MIN`) per mask texel, zero off its rects `laid`: what its creases are read from. */
  private readonly depths = new Float32Array(SIDE * SIDE);
  private readonly laid = Int32Array.from({ length: FACES * 4 }, (_, i) => (i % 4 < 2 ? SIDE : -1));
  /** A dent draw's `depths` blurred at `CREASE_NEAR` and `CREASE_FAR` over its rects, and one blur's row pass. */
  private readonly blurs: Blurs = { near: new Float32Array(SIDE * SIDE), far: new Float32Array(SIDE * SIDE), pass: new Float32Array(SIDE * SIDE) };
  /** Seconds of `frame` time: what spaces a car's dent draws. */
  private clock = 0;
  /** The car the next frame's dent draw is first offered to. */
  private turn = 0;

  /** Once a frame (`dt` s since the last), every built car that draws (live, podium, showcase; a replay's cars are the live ones). */
  frame(cars: readonly DeformableCar[], dt: number): void {
    this.clock += dt;
    for (let i = 0; i < cars.length; i++) {
      const car = cars[i]!;
      const wear = wears.get(car);
      if (wear === undefined) continue;
      // A scratched car's bumpers draw in trims of its own; a look that swapped one for a shared trim gets a new own copy.
      if (car.scratches.count > 0) wearBumpers(wear);
      if (wear.version !== car.scratches.version) {
        wear.version = car.scratches.version;
        this.draw(wear, car.scratches.list, car.scratches.count, car.scratches.cover);
      }
      // An undamaged car's skin is its rest: a repaired one's dents go at once.
      if (!car.panelsFollow && wear.dented) this.dent(wear, false);
    }
    // One dent draw a frame, the cars taking turns: a pile-up's crushes spread over frames and none waits on the ones before it.
    for (let k = 0; k < cars.length; k++) {
      const i = (this.turn + k) % cars.length;
      if (!this.dentDue(cars[i]!)) continue;
      this.turn = i + 1;
      return;
    }
  }

  /** `car`'s dents drawn if they are due: it is crashed or load-crushed, its skin moved since its last draw, `DENT_REBUILD_S` ago at least. */
  private dentDue(car: DeformableCar): boolean {
    const wear = wears.get(car);
    if (wear === undefined || !car.panelsFollow) return false;
    let skin = 0;
    for (let k = 0; k < wear.positions.length; k++) skin += wear.positions[k]!.version;
    if (skin === wear.skin || this.clock < wear.dentAt + DENT_REBUILD_S) return false;
    wear.skin = skin;
    wear.dentAt = this.clock;
    this.dent(wear, true);
    return true;
  }

  /** `wear`'s mask handed back, its strokes and dents cleared: its car is gone. */
  release(wear: Wear): void {
    this.draw(wear, wear.list, 0);
    if (wear.dented) this.dent(wear, false);
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
    if (count === 0 && !wear.dented) this.give(wear);
  }

  /**
   * `wear`'s G cleared where it was up and, with `build`, drawn again from its shells' skins: each triangle with a vertex sunk past
   * `DENT_MIN` along its rest normal laid on every face its vertices map to as depth, the sink interpolated across it, and each
   * texel's G read from its depth and its bend there (`creaseFace`). R is never touched.
   */
  private dent(wear: Wear, build: boolean): void {
    const was = this.was;
    const now = wear.dents;
    was.set(now);
    for (let face = 0; face < FACES; face++) clearRect(now, face * 4);
    if (build && wear.mask === null) this.take(wear);
    const mask = wear.mask;
    if (mask === null) return;
    for (let face = 0; face < FACES; face++) {
      const o = face * 4;
      const fx = CAR_SPRAY.faces[face]![0];
      const fy = CAR_SPRAY.faces[face]![1];
      for (let y = was[o + 1]!; y <= was[o + 3]!; y++) {
        for (let x = was[o]!; x <= was[o + 2]!; x++) mask.data[((fy + y) * SIDE + fx + x) * 2 + 1] = 0;
      }
    }
    if (build) {
      const depths = this.depths;
      const laid = this.laid;
      for (let face = 0; face < FACES; face++) {
        const o = face * 4;
        const base = CAR_SPRAY.faces[face]![1] * SIDE + CAR_SPRAY.faces[face]![0];
        for (let y = laid[o + 1]!; y <= laid[o + 3]!; y++) {
          for (let x = laid[o]!; x <= laid[o + 2]!; x++) depths[base + y * SIDE + x] = 0;
        }
      }
      for (let k = 0; k < wear.shells.length; k++) this.layShell(depths, wear, k, now);
      for (let face = 0; face < FACES; face++) creaseFace(mask.data, depths, this.blurs, now, face);
      this.laid.set(now);
    }
    wear.dented = false;
    for (let face = 0; face < FACES; face++) {
      const o = face * 4;
      const up = now[o + 2]! >= now[o]!;
      wear.dented ||= up;
      if (!up && was[o + 2]! < was[o]!) continue;
      const fx = CAR_SPRAY.faces[face]![0];
      const fy = CAR_SPRAY.faces[face]![1];
      const x0 = up ? Math.min(now[o]!, was[o]!) : was[o]!;
      const y0 = up ? Math.min(now[o + 1]!, was[o + 1]!) : was[o + 1]!;
      const x1 = Math.max(now[o + 2]!, was[o + 2]!);
      const y1 = Math.max(now[o + 3]!, was[o + 3]!);
      mask.touch(fx + x0, fy + y0, fx + x1, fy + y1);
    }
    if (!wear.dented && wear.count === 0) this.give(wear);
  }

  /** The dents of `wear`'s shell `k` into `depths`, growing the face rects `rects` round what it lays: from its skin before the drawn tyre hold, which host, guest and replay share. */
  private layShell(depths: Float32Array, wear: Wear, k: number, rects: Int32Array): void {
    const geometry = wear.shells[k]!.geometry;
    const rest = wear.rests[k]!;
    const restP = geometry.getAttribute(REST_POSITION);
    const restN = geometry.getAttribute(REST_NORMAL);
    const drawn = geometry.getAttribute("position");
    if (!(restP instanceof THREE.BufferAttribute && restN instanceof THREE.BufferAttribute && drawn instanceof THREE.BufferAttribute)) return;
    const pos = wear.car.unheldSkin(k) ?? drawn.array;
    const rn = restN.array;
    const count = rest.length / 3;
    if (this.sinks.length < count) this.sinks = new Float32Array(count);
    const sinks = this.sinks;
    let any = false;
    for (let i = 0, j = 0; i < count; i++, j += 3) {
      const sink = Math.abs((rest[j]! - pos[j]!) * rn[j]! + (rest[j + 1]! - pos[j + 1]!) * rn[j + 1]! + (rest[j + 2]! - pos[j + 2]!) * rn[j + 2]!);
      sinks[i] = sink;
      if (sink > DENT_MIN) any = true;
    }
    if (!any) return;
    const places = (wear.places[k] ??= restPlaces(restP, restN));
    const rp = restP.array;
    const index = geometry.index;
    const corners = index === null ? count : index.count;
    for (let t = 0; t < corners; t += 3) {
      const a = index === null ? t : index.getX(t);
      const b = index === null ? t + 1 : index.getX(t + 1);
      const c = index === null ? t + 2 : index.getX(t + 2);
      if (sinks[a]! <= DENT_MIN && sinks[b]! <= DENT_MIN && sinks[c]! <= DENT_MIN) continue;
      const fa = places.face[a]!;
      const fb = places.face[b]!;
      const fc = places.face[c]!;
      if (fa >= 0) layTriangle(depths, rects, fa, rp, places.at, a, b, c, sinks);
      if (fb >= 0 && fb !== fa) layTriangle(depths, rects, fb, rp, places.at, a, b, c, sinks);
      if (fc >= 0 && fc !== fa && fc !== fb) layTriangle(depths, rects, fc, rp, places.at, a, b, c, sinks);
    }
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

const _p = new THREE.Vector3();
const _n = new THREE.Vector3();
const _uv = new Float64Array(2);
/** A triangle's three corners on one face, in that face's texels (texel x's centre at x), and their depths (m past `DENT_MIN`). */
const _corners = new Float64Array(6);
const _cornerDepth = new Float64Array(3);

/** A shell's rest vertices on the wear mask: each one's face (`sprayFace`, -1 none) and its place on every face, in that face's texels (u, v) and its depth along the face's axis (`sprayPlace`). */
type RestPlaces = { readonly face: Int8Array; readonly at: Float32Array };
/** Numbers `RestPlaces.at` keeps a vertex a face. */
const PLACE = 3;

/** `RestPlaces` of a shell's rest points `restP` and normals `restN`: read once a car, its first dent draw, so no draw places a vertex again. */
function restPlaces(restP: THREE.BufferAttribute, restN: THREE.BufferAttribute): RestPlaces {
  const face = new Int8Array(restP.count);
  const at = new Float32Array(restP.count * FACES * PLACE);
  for (let v = 0; v < restP.count; v++) {
    face[v] = sprayFace(CAR_SPRAY, _p.fromBufferAttribute(restP, v), _n.fromBufferAttribute(restN, v), _uv);
    for (let f = 0; f < FACES; f++) {
      const o = (v * FACES + f) * PLACE;
      at[o + 2] = sprayPlace(CAR_SPRAY, f, _p, _uv);
      at[o] = _uv[0]! * CAR_SPRAY.faces[f]![2] - 0.5;
      at[o + 1] = _uv[1]! * CAR_SPRAY.faces[f]![3] - 0.5;
    }
  }
  return { face, at };
}

/** Face rect `o` of `rects` set to none. */
function clearRect(rects: Int32Array, o: number): void {
  rects[o] = SIDE;
  rects[o + 1] = SIDE;
  rects[o + 2] = -1;
  rects[o + 3] = -1;
}

/** Whether triangle a, b, c of rest points `rp` faces rest axis `axis` (0 x, 1 y, 2 z) at least `DENT_FACING`: its unit normal's share on it. */
function facesAxis(rp: THREE.TypedArray, a: number, b: number, c: number, axis: number): boolean {
  const ux = rp[3 * b]! - rp[3 * a]!;
  const uy = rp[3 * b + 1]! - rp[3 * a + 1]!;
  const uz = rp[3 * b + 2]! - rp[3 * a + 2]!;
  const vx = rp[3 * c]! - rp[3 * a]!;
  const vy = rp[3 * c + 1]! - rp[3 * a + 1]!;
  const vz = rp[3 * c + 2]! - rp[3 * a + 2]!;
  const nx = uy * vz - uz * vy;
  const ny = uz * vx - ux * vz;
  const nz = ux * vy - uy * vx;
  return Math.abs(axis === 0 ? nx : axis === 1 ? ny : nz) >= DENT_FACING * Math.sqrt(nx * nx + ny * ny + nz * nz);
}

/**
 * Triangle a, b, c of a shell (rest points `rp`, placed `at`, sinks `sinks`) laid on `face` in `depths`, unless it stands too edge-on
 * to it (`DENT_FACING`) or, off the roof, lies in the box's far half (`DENT_NEAR`): every texel centre within `DENT_GROW_TEXELS` of it
 * takes the sink interpolated there past `DENT_MIN`, the higher of it and what is there.
 */
function layTriangle(depths: Float32Array, rects: Int32Array, face: number, rp: THREE.TypedArray, at: Float32Array, a: number, b: number, c: number, sinks: Float32Array): void {
  if (!facesAxis(rp, a, b, c, FACE_AXIS[face]!)) return;
  const oa = (a * FACES + face) * PLACE;
  const ob = (b * FACES + face) * PLACE;
  const oc = (c * FACES + face) * PLACE;
  if (face !== SPRAY_FACE.top && Math.max(at[oa + 2]!, at[ob + 2]!, at[oc + 2]!) < DENT_NEAR) return;
  _corners[0] = at[oa]!;
  _corners[1] = at[oa + 1]!;
  _corners[2] = at[ob]!;
  _corners[3] = at[ob + 1]!;
  _corners[4] = at[oc]!;
  _corners[5] = at[oc + 1]!;
  _cornerDepth[0] = sinks[a]! - DENT_MIN;
  _cornerDepth[1] = sinks[b]! - DENT_MIN;
  _cornerDepth[2] = sinks[c]! - DENT_MIN;
  fillTriangle(depths, rects, face);
}

/** `_corners`' triangle on `face` (corner depths `_cornerDepth`) filled into `depths`, grown `DENT_GROW_TEXELS`, row by row over the span each row's grown edges leave. */
function fillTriangle(depths: Float32Array, rects: Int32Array, face: number): void {
  const ga = _cornerDepth[0]!;
  const gb = _cornerDepth[1]!;
  const gc = _cornerDepth[2]!;
  const x0 = _corners[0]!;
  const y0 = _corners[1]!;
  const x1 = _corners[2]!;
  const y1 = _corners[3]!;
  const x2 = _corners[4]!;
  const y2 = _corners[5]!;
  const area = (x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0);
  if (Math.abs(area) < 1e-6) return;
  const inv = 1 / area;
  // How far below 0 each corner's weight may go: the grow over the height on its opposite edge.
  const g0 = DENT_GROW_TEXELS * Math.sqrt((x2 - x1) * (x2 - x1) + (y2 - y1) * (y2 - y1)) * Math.abs(inv);
  const g1 = DENT_GROW_TEXELS * Math.sqrt((x0 - x2) * (x0 - x2) + (y0 - y2) * (y0 - y2)) * Math.abs(inv);
  const g2 = DENT_GROW_TEXELS * Math.sqrt((x1 - x0) * (x1 - x0) + (y1 - y0) * (y1 - y0)) * Math.abs(inv);
  // Each weight, and so the depth, is linear along a row: w = A + B·x. Past the edges (the grow) it holds within its corners'.
  const b0 = (y1 - y2) * inv;
  const b1 = (y2 - y0) * inv;
  const b2 = -b0 - b1;
  const bg = b0 * ga + b1 * gb + b2 * gc;
  const gLow = Math.min(ga, gb, gc);
  const gHigh = Math.max(ga, gb, gc);
  const box = CAR_SPRAY.faces[face]!;
  const fw = box[2];
  const left = Math.max(0, Math.ceil(Math.min(x0, x1, x2) - DENT_GROW_TEXELS));
  const right = Math.min(fw - 1, Math.floor(Math.max(x0, x1, x2) + DENT_GROW_TEXELS));
  const bottom = Math.max(0, Math.ceil(Math.min(y0, y1, y2) - DENT_GROW_TEXELS));
  const top = Math.min(box[3] - 1, Math.floor(Math.max(y0, y1, y2) + DENT_GROW_TEXELS));
  const o = face * 4;
  for (let y = bottom; y <= top; y++) {
    const a0 = (x1 * (y2 - y) - x2 * (y1 - y)) * inv;
    const a1 = (x2 * (y0 - y) - x0 * (y2 - y)) * inv;
    const a2 = 1 - a0 - a1;
    const ag = a0 * ga + a1 * gb + a2 * gc;
    const from = Math.max(left, spanFrom(a0, b0, g0), spanFrom(a1, b1, g1), spanFrom(a2, b2, g2));
    const to = Math.min(right, spanTo(a0, b0, g0), spanTo(a1, b1, g1), spanTo(a2, b2, g2));
    const row = (box[1] + y) * SIDE + box[0];
    let first = SIDE;
    let last = -1;
    for (let x = from; x <= to; x++) {
      const d = Math.min(gHigh, Math.max(gLow, ag + bg * x));
      if (d <= 0) continue;
      depths[row + x] = Math.max(depths[row + x]!, d);
      first = Math.min(first, x);
      last = x;
    }
    if (last < 0) continue;
    rects[o] = Math.min(rects[o]!, first);
    rects[o + 1] = Math.min(rects[o + 1]!, y);
    rects[o + 2] = Math.max(rects[o + 2]!, last);
    rects[o + 3] = Math.max(rects[o + 3]!, y);
  }
}

type Blurs = { readonly near: Float32Array; readonly far: Float32Array; readonly pass: Float32Array };

/** Normalized Gaussian weights of σ `sigma` texels, out to 3σ either side. */
function gaussian(sigma: number): Float32Array {
  const r = Math.ceil(3 * sigma);
  const k = Float32Array.from({ length: 2 * r + 1 }, (_, i) => Math.exp(-((i - r) ** 2) / (2 * sigma * sigma)));
  const sum = k.reduce((a, b) => a + b, 0);
  return k.map((w) => w / sum);
}
const NEAR_KERNEL = gaussian(CREASE_NEAR);
const FAR_KERNEL = gaussian(CREASE_FAR);

/**
 * G of `data` over `face`'s rect in `rects`, from the laid `depths`: a texel that moved takes `DENT_FLOOR` (dulled paint) as it nears
 * `DENT_FULL` deep, and a crease over the rest as far as its skin blurred at `CREASE_NEAR` sinks below it blurred at `CREASE_FAR`:
 * a fold's trough, one smooth broad band per fold, never its crest too; paint that never moved stays 0.
 */
function creaseFace(data: Uint8Array, depths: Float32Array, blurs: Blurs, rects: Int32Array, face: number): void {
  const o = face * 4;
  if (rects[o + 2]! < rects[o]!) return;
  const box = CAR_SPRAY.faces[face]!;
  const base = box[1] * SIDE + box[0];
  blurFace(blurs.near, depths, blurs.pass, box, rects, o, NEAR_KERNEL);
  blurFace(blurs.far, depths, blurs.pass, box, rects, o, FAR_KERNEL);
  for (let y = rects[o + 1]!; y <= rects[o + 3]!; y++) {
    for (let x = rects[o]!; x <= rects[o + 2]!; x++) {
      const i = base + y * SIDE + x;
      const d = depths[i]!;
      if (d <= 0) continue;
      const crease = Math.min(1, Math.max(0, blurs.near[i]! - blurs.far[i]!) / BEND_FULL);
      data[i * 2 + 1] = Math.round(255 * Math.min(1, d / DENT_FULL) * (DENT_FLOOR + (1 - DENT_FLOOR) * crease));
    }
  }
}

/** `src` blurred by `kernel` (rows into `pass`, then columns) into `out` over `rects`' rect at `o` on face `box`, the face's edge texels standing in past it: a blur never reads a neighbouring face's paint. */
function blurFace(out: Float32Array, src: Float32Array, pass: Float32Array, box: readonly number[], rects: Int32Array, o: number, kernel: Float32Array): void {
  const r = (kernel.length - 1) >> 1;
  const base = box[1]! * SIDE + box[0]!;
  const w = box[2]! - 1;
  const h = box[3]! - 1;
  const x0 = rects[o]!;
  const x1 = rects[o + 2]!;
  const y0 = rects[o + 1]!;
  const y1 = rects[o + 3]!;
  for (let y = Math.max(0, y0 - r); y <= Math.min(h, y1 + r); y++) {
    const row = base + y * SIDE;
    for (let x = x0; x <= x1; x++) {
      let sum = 0;
      for (let k = -r; k <= r; k++) sum += kernel[k + r]! * src[row + Math.min(w, Math.max(0, x + k))]!;
      pass[row + x] = sum;
    }
  }
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      let sum = 0;
      for (let k = -r; k <= r; k++) sum += kernel[k + r]! * pass[base + Math.min(h, Math.max(0, y + k)) * SIDE + x]!;
      out[base + y * SIDE + x] = sum;
    }
  }
}

/** The first texel x at which weight `a + b·x` is at least `-g` (none: past any row). */
function spanFrom(a: number, b: number, g: number): number {
  if (b > 0) return Math.ceil((-g - a) / b);
  return a + b * SIDE >= -g || a >= -g ? 0 : SIDE;
}

/** The last texel x at which weight `a + b·x` is at least `-g` (none: -1). */
function spanTo(a: number, b: number, g: number): number {
  if (b < 0) return Math.floor((-g - a) / b);
  return a + b * SIDE >= -g || a >= -g ? SIDE : -1;
}
