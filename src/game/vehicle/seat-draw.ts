import * as THREE from "three";
import { PAINTED_ATTRIBUTE } from "./car-materials.ts";

/** Texels per seat in a `SeatDraw`'s seat texture: its world matrix's four columns, its colour, its glow. */
const SEAT_TEXELS = 6;
/** The seat texture's width (texels): three uploads an update range one texture row at a time, so a race's seats fit one or two rows. */
const SEAT_TEXTURE_WIDTH = 1024;
/** How much bigger than asked a grown geometry is, so a race's first few rebuilds don't each grow it again. */
const SEAT_GROW = 1.5;
/** Per vertex, the row of the seat it belongs to. */
const SEAT_ATTRIBUTE = "seat";

/** How a seat's colour paints its variant: `lamp` multiplies the diffuse and its glow the emissive, `tint` paints the `painted` share of its
 *  vertices, `none` leaves the material's own look (a flat pass). */
type SeatLook = "lamp" | "tint" | "none";

/**
 * Many seats, each drawing one of the draw's variant geometries, as ONE draw call in any browser (`THREE.BatchedMesh` needs
 * WEBGL_multi_draw, which Firefox lacks). The packed seats' variants are joined into one geometry, each vertex tagged with its seat, and
 * the vertex shader reads that seat's world matrix and look from a float texture. Only a change in the packed variants (a car shown or
 * hidden) rebuilds the geometry; a look change (brakes, a broken lamp) is a texture upload. The draw bills only the packed seats' triangles.
 */
export class SeatDraw {
  readonly mesh: THREE.Mesh;
  /** The geometries a seat may draw, by variant (the caller's). */
  readonly variants: readonly THREE.BufferGeometry[];
  /** Seats the draw holds. */
  readonly capacity: number;
  /** Seats packed by the last sync. */
  count = 0;
  private readonly data: Float32Array;
  /** The seats' matrices and looks; it uploads only on a sync that changed them (a resting field uploads nothing). */
  readonly texture: THREE.DataTexture;
  /** Whether this sync wrote seat data the texture does not hold yet. */
  private dirty = false;
  /** Variant per seat, packed this sync and as the geometry holds them. */
  private readonly packed: Int32Array;
  private readonly built: Int32Array;
  private builtCount = 0;
  private readonly attributes: readonly string[];
  private room = { vertices: 0, indices: 0 };
  /** `seated` materials by their base. */
  private readonly flat = new Map<THREE.Material, THREE.Material>();

  /** `variants` indexed, each with `position`, `normal`, `uv` and `color` (and, `tint`, `painted`). */
  constructor(variants: readonly THREE.BufferGeometry[], material: THREE.Material, capacity: number, look: SeatLook) {
    this.variants = variants;
    this.capacity = capacity;
    const rows = Math.ceil((capacity * SEAT_TEXELS) / SEAT_TEXTURE_WIDTH);
    this.data = new Float32Array(SEAT_TEXTURE_WIDTH * rows * 4);
    this.texture = new THREE.DataTexture(this.data, SEAT_TEXTURE_WIDTH, rows, THREE.RGBAFormat, THREE.FloatType);
    this.packed = new Int32Array(capacity);
    this.built = new Int32Array(capacity);
    this.attributes = ["position", "normal", "uv", "color", ...(look === "tint" ? [PAINTED_ATTRIBUTE] : [])];
    this.mesh = new THREE.Mesh(new THREE.BufferGeometry(), seatMaterial(material, this.texture, look));
    // Seats span the pad and move every frame; a stale bound would cull live ones.
    this.mesh.frustumCulled = false;
    // At the scene root with an identity transform: three need not compose its matrices every frame.
    this.mesh.matrixAutoUpdate = false;
    this.mesh.matrixWorldAutoUpdate = false;
    this.mesh.visible = false;
    // The real attribute set from the start, so the boot warm links the program the race draws with.
    this.grow(1, 3);
  }

  /** Start a sync: no seats packed. */
  begin(): void {
    this.count = 0;
  }

  /** Pack a seat drawing `variant` at world `matrix` in `color` (and `glow`); false once the draw is full. */
  put(variant: number, matrix: THREE.Matrix4, color: THREE.Color, glow?: THREE.Color): boolean {
    const row = this.count;
    if (row >= this.capacity) return false;
    const at = row * SEAT_TEXELS * 4;
    const e = matrix.elements;
    for (let k = 0; k < 16; k++) this.store(at + k, e[k]!);
    this.store(at + 16, color.r);
    this.store(at + 17, color.g);
    this.store(at + 18, color.b);
    if (glow) {
      this.store(at + 20, glow.r);
      this.store(at + 21, glow.g);
      this.store(at + 22, glow.b);
    }
    this.packed[row] = variant;
    this.count = row + 1;
    return true;
  }

  /** Publish this sync's seats: rebuild the geometry if the packed variants changed, upload the seats' texture rows if their data did. */
  end(): void {
    const n = this.count;
    let same = n === this.builtCount;
    for (let i = 0; same && i < n; i++) same = this.packed[i] === this.built[i];
    if (!same) this.rebuild(n);
    this.mesh.visible = this.mesh.geometry.drawRange.count > 0;
    if (!this.dirty) return;
    this.dirty = false;
    const t = this.texture;
    const floats = n * SEAT_TEXELS * 4;
    const row = SEAT_TEXTURE_WIDTH * 4;
    t.clearUpdateRanges();
    for (let s = 0; s < floats; s += row) t.addUpdateRange(s, Math.min(row, floats - s));
    t.needsUpdate = true;
  }

  /** Seat datum `i` set to `v` as the texture stores it (float32), marking the texture stale when it changes. */
  private store(i: number, v: number): void {
    const f = Math.fround(v);
    if (this.data[i] === f) return;
    this.data[i] = f;
    this.dirty = true;
  }

  /** Seat `i`'s world matrix as packed. */
  matrixAt(i: number, out: THREE.Matrix4): THREE.Matrix4 {
    return out.fromArray(this.data, i * SEAT_TEXELS * 4);
  }

  /** Seat `i`'s colour as packed. */
  colorAt(i: number, out: THREE.Color): THREE.Color {
    return out.fromArray(this.data, i * SEAT_TEXELS * 4 + 16);
  }

  /** Seat `i`'s glow as packed. */
  glowAt(i: number, out: THREE.Color): THREE.Color {
    return out.fromArray(this.data, i * SEAT_TEXELS * 4 + 20);
  }

  /** Seat `i`'s variant as packed. */
  variantAt(i: number): number {
    return this.packed[i]!;
  }

  /** Triangles the draw bills: the packed seats' own. */
  get triangles(): number {
    return this.mesh.geometry.drawRange.count / 3;
  }

  /** `material` (cached) drawing this draw's seats where they stand, in its own look: a flat pass swaps it in for the draw's. */
  seated(material: THREE.Material): THREE.Material {
    let m = this.flat.get(material);
    if (m === undefined) this.flat.set(material, (m = seatMaterial(material, this.texture, "none")));
    return m;
  }

  private rebuild(n: number): void {
    let vertices = 0;
    let indices = 0;
    for (let i = 0; i < n; i++) {
      const g = this.variants[this.packed[i]!]!;
      vertices += g.getAttribute("position")?.count ?? 0;
      indices += g.index?.count ?? 0;
    }
    if (vertices > this.room.vertices || indices > this.room.indices) this.grow(vertices, indices);
    const geo = this.mesh.geometry;
    const seat = geo.getAttribute(SEAT_ATTRIBUTE).array as Float32Array;
    const index = geo.index!.array as Uint32Array;
    let v = 0;
    let k = 0;
    for (let i = 0; i < n; i++) {
      this.built[i] = this.packed[i]!;
      const g = this.variants[this.packed[i]!]!;
      const count = g.getAttribute("position")?.count ?? 0;
      if (count === 0) continue;
      for (const name of this.attributes) {
        const a = geo.getAttribute(name);
        (a.array as Float32Array).set(g.getAttribute(name).array, v * a.itemSize);
      }
      seat.fill(i, v, v + count);
      const src = g.index!.array;
      for (let j = 0; j < src.length; j++) index[k + j] = src[j]! + v;
      v += count;
      k += src.length;
    }
    this.builtCount = n;
    for (const name of [...this.attributes, SEAT_ATTRIBUTE]) upload(geo.getAttribute(name) as THREE.BufferAttribute, v);
    upload(geo.index!, k);
    geo.setDrawRange(0, k);
  }

  /** A fresh geometry with room for `vertices` and `indices` and then some (a GL buffer never grows in place). */
  private grow(vertices: number, indices: number): void {
    this.room = { vertices: Math.ceil(vertices * SEAT_GROW), indices: Math.ceil(indices * SEAT_GROW) };
    const geo = new THREE.BufferGeometry();
    const sizes = { position: 3, normal: 3, uv: 2, color: 3, [PAINTED_ATTRIBUTE]: 1 } as Record<string, number>;
    for (const name of this.attributes) geo.setAttribute(name, dynamic(new Float32Array(this.room.vertices * sizes[name]!), sizes[name]!));
    geo.setAttribute(SEAT_ATTRIBUTE, dynamic(new Float32Array(this.room.vertices), 1));
    geo.setIndex(dynamic(new Uint32Array(this.room.indices), 1));
    geo.setDrawRange(0, 0);
    this.mesh.geometry.dispose();
    this.mesh.geometry = geo;
  }

  /** The draw's own geometry, materials and seat texture (the variants are the caller's). */
  dispose(): void {
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
    for (const m of this.flat.values()) m.dispose();
    this.texture.dispose();
  }
}

function dynamic(array: Float32Array | Uint32Array, itemSize: number): THREE.BufferAttribute {
  return new THREE.BufferAttribute(array, itemSize).setUsage(THREE.DynamicDrawUsage);
}

/** Mark the first `items` items of `attr` for upload. */
function upload(attr: THREE.BufferAttribute, items: number): void {
  attr.clearUpdateRanges();
  attr.addUpdateRange(0, items * attr.itemSize);
  attr.needsUpdate = true;
}

/** A copy of `base` (its compile hook and key chained) whose vertices sit at their seat's world matrix from `texture`, in the seat's `look`. */
function seatMaterial(base: THREE.Material, texture: THREE.DataTexture, look: SeatLook): THREE.Material {
  const m = base.clone();
  m.onBeforeCompile = (shader, renderer) => {
    base.onBeforeCompile.call(m, shader, renderer);
    shader.uniforms.seatTexture = { value: texture };
    shader.vertexShader = seatVertex(shader.vertexShader, look);
    if (look === "lamp") {
      shader.fragmentShader = shader.fragmentShader
        .replace("#include <common>", "#include <common>\nvarying vec3 vSeatColor;\nvarying vec3 vSeatGlow;")
        .replace("#include <color_fragment>", "#include <color_fragment>\ndiffuseColor.rgb *= vSeatColor;")
        .replace("#include <emissivemap_fragment>", "#include <emissivemap_fragment>\ntotalEmissiveRadiance *= vSeatGlow;");
    }
  };
  m.customProgramCacheKey = () => `${base.customProgramCacheKey()}|seat-${look}`;
  return m;
}

/** Vertex shader `source` placing each vertex (and normal) by its seat's matrix, passing on or painting in the seat's `look`. */
function seatVertex(source: string, look: SeatLook): string {
  const lamp = look === "lamp";
  const tint = look === "tint";
  return source
    .replace(
      "#include <common>",
      `#include <common>
uniform highp sampler2D seatTexture;
attribute float ${SEAT_ATTRIBUTE};
${tint ? `attribute float ${PAINTED_ATTRIBUTE};` : ""}
${lamp ? "varying vec3 vSeatColor;\nvarying vec3 vSeatGlow;" : ""}
vec4 seatTexel(int t) {
  int p = int(${SEAT_ATTRIBUTE}) * ${SEAT_TEXELS} + t;
  return texelFetch(seatTexture, ivec2(p % ${SEAT_TEXTURE_WIDTH}, p / ${SEAT_TEXTURE_WIDTH}), 0);
}`,
    )
    .replace(
      "void main() {",
      `void main() {
  mat4 seatM = mat4(seatTexel(0), seatTexel(1), seatTexel(2), seatTexel(3));
${lamp ? "  vSeatColor = seatTexel(4).rgb;\n  vSeatGlow = seatTexel(5).rgb;" : ""}`,
    )
    .replace("#include <color_vertex>", `#include <color_vertex>${tint ? `\nvColor.rgb *= mix(vec3(1.0), seatTexel(4).rgb, ${PAINTED_ATTRIBUTE});` : ""}`)
    .replace(
      "#include <beginnormal_vertex>",
      `#include <beginnormal_vertex>
mat3 seatN = mat3(seatM);
objectNormal = seatN * (objectNormal / vec3(dot(seatN[0], seatN[0]), dot(seatN[1], seatN[1]), dot(seatN[2], seatN[2])));`,
    )
    .replace("#include <begin_vertex>", "#include <begin_vertex>\ntransformed = (seatM * vec4(transformed, 1.0)).xyz;");
}
