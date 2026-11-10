import * as THREE from "three";

/**
 * How many of each home's windows light at night: the open world's homes put a number in a small data texture, one texel per home, which the facade shaders read for the building they draw. The number
 * follows how many people are awake at home (`society-awake.ts`), eased a little each game minute, so the windows come on (and go out) one by one at their own thresholds as the people do.
 * A building with no texel (not a home, or a course that has none) keeps the style's fixed share.
 */

/** One texel is this many metres across: under half the narrowest lot's front, so no two buildings share a texel. */
export const HOME_CELL_METRES = 4;
/** The share of a home's windows lit at full night by the people awake in it (none, one, two, three, four or more). */
export const HOME_SHARE_BY_AWAKE = [0, 0.35, 0.6, 0.75, 0.85] as const;
/** How much a home's share may move in one game minute: a window or two a minute, so a house wakes or settles over a few seconds. */
export const HOME_FADE_PER_MINUTE = 0.1;
/** A texel of 0 holds no home; a home's share (0 to 1) is stored as 1 to 255. */
const SHARE_STEPS = 254;
const NO_HOME = 0;

/** The texel number of a home's share (the shader's decode of the red it reads is `facadeShareGlsl`, and `shareOfTexel` in the test util). */
export const texelOfShare = (share: number): number => 1 + Math.round(share * SHARE_STEPS);

/** The shaders' uniforms: the texels (one 1x1 empty one until a course sets its own) and the grid they cover (origin x, origin z, cells across, cells down). */
export const FACADE_HOMES = { value: emptyTexture() };
export const FACADE_HOMES_FRAME = { value: new THREE.Vector4(0, 0, 1, 1) };

function emptyTexture(): THREE.DataTexture {
  return gridTexture(new Uint8Array(1), 1, 1);
}

function gridTexture(data: Uint8Array, width: number, height: number): THREE.DataTexture {
  const texture = new THREE.DataTexture(data, width, height, THREE.RedFormat, THREE.UnsignedByteType);
  texture.minFilter = texture.magFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  texture.flipY = false;
  texture.needsUpdate = true;
  return texture;
}

/** The cell of (x, z) on a grid whose origin is (`originX`, `originZ`): the shader's own arithmetic in 32 bits, so the same texel is read as was written (a building's translation is a 32-bit float). */
export function homeCell(x: number, z: number, originX: number, originZ: number): { column: number; row: number } {
  const f32 = Math.fround;
  const perMetre = 1 / HOME_CELL_METRES;
  return { column: Math.floor(f32(f32(f32(x) - f32(originX)) * f32(perMetre))), row: Math.floor(f32(f32(f32(z) - f32(originZ)) * f32(perMetre))) };
}

/** A home: the place it is (the index awake counts come by) and where its building's instance stands. */
type Home = { place: number; x: number; z: number };

/** The homes' windows' shares: made for a map's homes, stepped once a game minute. */
export class HomeLights {
  private readonly homes: Home[];
  private readonly levels: Float32Array;
  private readonly texels: Uint8Array;
  private readonly cells: Int32Array;
  private readonly texture: THREE.DataTexture;
  private placed = false;

  constructor(homes: readonly Home[]) {
    this.homes = homes.slice();
    const f32 = Math.fround;
    const margin = 1;
    const minX = Math.min(...homes.map((home) => f32(home.x)));
    const minZ = Math.min(...homes.map((home) => f32(home.z)));
    const originX = f32(minX - margin * HOME_CELL_METRES);
    const originZ = f32(minZ - margin * HOME_CELL_METRES);
    const across = homes.length === 0 ? 1 : Math.max(...homes.map((home) => homeCell(home.x, home.z, originX, originZ).column)) + 1 + margin;
    const down = homes.length === 0 ? 1 : Math.max(...homes.map((home) => homeCell(home.x, home.z, originX, originZ).row)) + 1 + margin;
    this.texels = new Uint8Array(across * down);
    this.levels = new Float32Array(homes.length);
    this.cells = new Int32Array(homes.length);
    for (const [at, home] of this.homes.entries()) {
      const cell = homeCell(home.x, home.z, originX, originZ);
      this.cells[at] = cell.row * across + cell.column;
      this.texels[this.cells[at]!] = texelOfShare(0);
    }
    this.texture = gridTexture(this.texels, across, down);
    FACADE_HOMES.value = this.texture;
    FACADE_HOMES_FRAME.value.set(originX, originZ, across, down);
  }

  /**
   * One game minute: each home's share moves toward what the people awake in it call for (`awake[place]`), by at most `HOME_FADE_PER_MINUTE`; the first call, and one that `settles` (the clock was skipped hours, not a minute), sets them outright. The
   * texture is written only where a share moved, and sent to the device only if one did.
   */
  step(awake: ArrayLike<number>, settles = false): void {
    let changed = !this.placed;
    for (let at = 0; at < this.homes.length; at++) {
      const people = Math.min(awake[this.homes[at]!.place]!, HOME_SHARE_BY_AWAKE.length - 1);
      const target = HOME_SHARE_BY_AWAKE[people]!;
      const level = this.levels[at]!;
      const next = this.placed && !settles ? level + Math.max(-HOME_FADE_PER_MINUTE, Math.min(HOME_FADE_PER_MINUTE, target - level)) : target;
      const texel = texelOfShare(next);
      this.levels[at] = next;
      if (this.texels[this.cells[at]!] === texel) continue;
      this.texels[this.cells[at]!] = texel;
      changed = true;
    }
    this.placed = true;
    if (changed) this.texture.needsUpdate = true;
  }

  /** The texel of home `at` (the index in the homes this was made with) and the texture's own texels. */
  texelOf(at: number): number {
    return this.texels[this.cells[at]!]!;
  }

  /** Every texel of the grid. */
  get data(): Uint8Array {
    return this.texels;
  }

  /** The shaders go back to the style's fixed share. */
  dispose(): void {
    if (FACADE_HOMES.value === this.texture) {
      FACADE_HOMES.value = emptyTexture();
      FACADE_HOMES_FRAME.value.set(0, 0, 1, 1);
    }
    this.texture.dispose();
    this.texels.fill(NO_HOME);
  }
}

/** GLSL (a style whose windows may belong to a home): the texels and grid uniforms, and the share the instance's building reads from them (0 where it has none: the fixed share). */
export const FACADE_HOMES_VERTEX = /* glsl */ `
uniform sampler2D facadeHomes;
uniform vec4 facadeHomesFrame;
flat varying float vFacadeHome;`;
/** GLSL reading the texel of the building whose centre is the vec2 expression `point` (inside `#ifdef USE_INSTANCING`) into `vFacadeHome`. */
export const facadeHomesSeedGlsl = (point: string): string => `
vec2 facadeHomeCell = floor((${point} - facadeHomesFrame.xy) * ${(1 / HOME_CELL_METRES).toFixed(6)});
if (facadeHomeCell.x >= 0.0 && facadeHomeCell.y >= 0.0 && facadeHomeCell.x < facadeHomesFrame.z && facadeHomeCell.y < facadeHomesFrame.w) vFacadeHome = texelFetch(facadeHomes, ivec2(facadeHomeCell), 0).r;`;
/** The share of windows lit at full night that the fragment uses: a home's own, or `fixed` where the texel is empty. A home with nobody awake has a share of exactly 0 and no window of it lights. */
export const facadeShareGlsl = (fixed: string): string => `(vFacadeHome < 0.002 ? ${fixed} : (vFacadeHome * 255.0 - 1.0) / ${SHARE_STEPS.toFixed(1)})`;
