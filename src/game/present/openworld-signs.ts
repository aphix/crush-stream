import * as THREE from "three";
import { hypot2 } from "../kernel/physics-core.js";
import { PLACE_KIND, type Place, type PlaceKind } from "../world/openworld/walk-graph.ts";
import { drawnHalf } from "../world/openworld/openworld-facade-solids.ts";
import { facadeFace, frontWallRoom, isBusiness, onFrontFace, ShopSigns, SHOP_SIGN, WHITE } from "./openworld-shop-signs.ts";
import { drawOutlinedText } from "./track-debug.ts";

/** Whether a thing of `radius` m at (x, z) is in view of a local eye (the open world's sight field). */
export type SignSight = { seen(x: number, z: number, radius: number): boolean };

/** Printable ASCII, space to tilde: each its own cell of the glyph atlas. */
const GLYPH_FIRST = 32;
const GLYPH_COUNT = 95;
const GLYPH_COLUMNS = 16;
const GLYPH_PX = 40;
/** A cell holds a glyph at `GLYPH_PX` and the room its outline takes on every side. */
const GLYPH_CELL = 56;
/** The cell after the glyphs is solid: a tinted plate samples it. */
const PLATE_CELL = GLYPH_COUNT;
const ATLAS_ROWS = Math.ceil((GLYPH_COUNT + 1) / GLYPH_COLUMNS);
const UNKNOWN_GLYPH = "?".charCodeAt(0) - GLYPH_FIRST;
const GLYPH_ANISOTROPY = 4;
const PLATE_ALPHA = 0.6;

/** The size (m) of a label's text, where its middle stands and how far its plate reaches past the text, per kind of building. Heights are of the label's middle over the sidewalk. */
export const NAME = {
  /** A rowhome's name sits over its door, under the 3.6 m ground storey's top. */
  homeY: 3.1,
  homeEm: 0.4,
  /** A business's name sits over its sign band, in letters big enough to read from across the street. */
  businessEm: 0.7,
  /** A place with no front of its own (a park, an alley, a bus stop) hovers at head height over its door point. */
  freeY: 2.6,
  freeEm: 0.5,
  /** Proud of the shop sign band (`SHOP_SIGN.standoff`). */
  standoff: 0.15,
  /** No name runs wider than this (m), however wide the place. */
  maxWidth: 12,
  /** Two labels over one door stack with this gap (m) between their plates. */
  stackGap: 0.1,
  /** The plate's height and its padding past the text's ends, in text heights. */
  plateHeightEm: 1.3,
  platePadEm: 0.3,
  /** Labels are drawn in chunks this wide (m): a chunk is one draw call, hidden whole when out of range or unseen. */
  chunkSize: 64,
} as const;
/** A door this near (m) its building's drawn front wall, or past it to the footprint's edge, stands on that wall: a yard's gate or a park's middle is metres off. */
const DOOR_ON_FACE = 0.05;
/** A name past this (m) from the eye is a speck: the crowd's drawing stops at the same distance. */
const NAMES_RANGE = 120;
/** A chunk's key packs its two grid coordinates; z counts never reach this many chunks either way. */
const CHUNK_KEY_STRIDE = 1024;

/** Ink by what the place is, picked to read on brick, glass and paint. */
const NAME_INK: Readonly<Record<PlaceKind, string>> = {
  [PLACE_KIND.home]: "#ffe08a",
  [PLACE_KIND.work]: "#8fd3ff",
  [PLACE_KIND.food]: "#ff9a6b",
  [PLACE_KIND.shop]: "#9dff9d",
  [PLACE_KIND.hangout]: "#ff7be5",
  [PLACE_KIND.hide]: "#c9b6ff",
  [PLACE_KIND.transit]: WHITE,
};

/** One printed name: where it hangs, which way it faces, the height of its letters and the widest it may run. `back` marks the second copy of a label with no front, so it reads from both sides. */
type NameSpec = { place: number; text: string; ink: string; x: number; y: number; z: number; normalX: number; normalZ: number; em: number; maxWidth: number; back: boolean };

/** Every named place inside the walls: its name over its door on its front face, kept inside the face's ends, a business's over its sign band; a place whose door another already uses stacks above it. */
export function nameSpecs(places: readonly Place[]): NameSpec[] {
  const specs: NameSpec[] = [];
  const tops = new Map<string, number>();
  for (let index = 0; index < places.length; index++) {
    const place = places[index]!;
    if (place.doorNode < 0 || place.name === "") continue;
    const business = isBusiness(place);
    const home = place.kind === PLACE_KIND.home;
    const em = business ? NAME.businessEm : home ? NAME.homeEm : NAME.freeEm;
    const baseY = business ? SHOP_SIGN.bottom + SHOP_SIGN.height + em : home ? NAME.homeY : NAME.freeY;
    const doorKey = `${place.doorX},${place.doorZ}`;
    const below = tops.get(doorKey);
    const y = below === undefined ? baseY : below + NAME.stackGap + (NAME.plateHeightEm * em) / 2;
    tops.set(doorKey, y + (NAME.plateHeightEm * em) / 2);
    const maxWidth = Math.min(frontWallRoom(place), NAME.maxWidth);
    const atDoor = facadeFace(place, NAME.standoff);
    const doorOut = (place.doorX - place.x) * atDoor.normalX + (place.doorZ - place.z) * atDoor.normalZ;
    const face = doorOut > drawnHalf(place.depth) - DOOR_ON_FACE ? onFrontFace(place, maxWidth, NAME.standoff) : atDoor;
    const spec: NameSpec = { place: index, text: place.name, ink: NAME_INK[place.kind], x: face.x, y, z: face.z, normalX: face.normalX, normalZ: face.normalZ, em, maxWidth, back: false };
    specs.push(spec);
    if (place.storeys === 0) specs.push({ ...spec, x: place.doorX - face.normalX * NAME.standoff, z: place.doorZ - face.normalZ * NAME.standoff, normalX: -face.normalX, normalZ: -face.normalZ, back: true });
  }
  return specs;
}

function glyphOf(char: string): number {
  const glyph = char.charCodeAt(0) - GLYPH_FIRST;
  return glyph >= 0 && glyph < GLYPH_COUNT ? glyph : UNKNOWN_GLYPH;
}

/** The glyph sheet: white letters on a dark outline (the track debug's label style), so a vertex colour inks them; the advance of each glyph in text heights; the UV rectangle of each cell. */
class GlyphAtlas {
  readonly texture: THREE.CanvasTexture;
  readonly advances = new Float32Array(GLYPH_COUNT);
  /** Per cell, [u0, v0, u1, v1] with v up. */
  readonly uvs = new Float32Array((GLYPH_COUNT + 1) * 4);
  /** The plate's cell sampled at its middle for all four corners: a quad of it is one flat tint. */
  readonly plateUvs = new Float32Array(4);

  constructor() {
    const canvas = document.createElement("canvas");
    canvas.width = GLYPH_COLUMNS * GLYPH_CELL;
    canvas.height = ATLAS_ROWS * GLYPH_CELL;
    const g = canvas.getContext("2d")!;
    g.font = `bold ${GLYPH_PX}px sans-serif`;
    for (let cell = 0; cell <= GLYPH_COUNT; cell++) {
      const left = (cell % GLYPH_COLUMNS) * GLYPH_CELL;
      const top = Math.floor(cell / GLYPH_COLUMNS) * GLYPH_CELL;
      this.uvs.set([left / canvas.width, 1 - (top + GLYPH_CELL) / canvas.height, (left + GLYPH_CELL) / canvas.width, 1 - top / canvas.height], cell * 4);
      if (cell === PLATE_CELL) continue;
      const char = String.fromCharCode(GLYPH_FIRST + cell);
      this.advances[cell] = g.measureText(char).width / GLYPH_PX;
      drawOutlinedText(g, char, WHITE, left + GLYPH_CELL / 2, top + GLYPH_CELL / 2, GLYPH_PX);
    }
    const plateLeft = (PLATE_CELL % GLYPH_COLUMNS) * GLYPH_CELL;
    const plateTop = Math.floor(PLATE_CELL / GLYPH_COLUMNS) * GLYPH_CELL;
    g.fillStyle = `rgba(255, 255, 255, ${PLATE_ALPHA})`;
    g.fillRect(plateLeft, plateTop, GLYPH_CELL, GLYPH_CELL);
    const plateU = (this.uvs[PLATE_CELL * 4]! + this.uvs[PLATE_CELL * 4 + 2]!) / 2;
    const plateV = (this.uvs[PLATE_CELL * 4 + 1]! + this.uvs[PLATE_CELL * 4 + 3]!) / 2;
    this.plateUvs.set([plateU, plateV, plateU, plateV]);
    this.texture = new THREE.CanvasTexture(canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.anisotropy = GLYPH_ANISOTROPY;
  }
}

/** A chunk's geometry while it is built. */
class QuadBuffers {
  readonly positions: number[] = [];
  readonly uvs: number[] = [];
  readonly colours: number[] = [];
  readonly indices: number[] = [];

  /** A quad `halfWidth` either side of `along` (m, to the label's right) and `halfHeight` either side of the label's middle, sampling `atlas.uvs` cell `cell`. */
  push(spec: NameSpec, along: number, halfWidth: number, halfHeight: number, uvs: Float32Array, cell: number, colour: THREE.Color): void {
    const rightX = spec.normalZ;
    const rightZ = -spec.normalX;
    const first = this.positions.length / 3;
    const at = cell * 4;
    for (let corner = 0; corner < 4; corner++) {
      const right = corner === 1 || corner === 2;
      const up = corner >= 2;
      const reach = along + (right ? halfWidth : -halfWidth);
      this.positions.push(spec.x + rightX * reach, spec.y + (up ? halfHeight : -halfHeight), spec.z + rightZ * reach);
      this.uvs.push(right ? uvs[at + 2]! : uvs[at]!, up ? uvs[at + 3]! : uvs[at + 1]!);
      this.colours.push(colour.r, colour.g, colour.b);
    }
    this.indices.push(first, first + 1, first + 2, first, first + 2, first + 3);
  }
}

type Chunk = { mesh: THREE.Mesh; x: number; z: number; radius: number };

const PLATE_INK = new THREE.Color(0x000000);

/** Every name as quads from one glyph atlas: one material, one draw call per chunk of the city. */
class NameLabels {
  readonly group = new THREE.Group();
  private readonly atlas = new GlyphAtlas();
  private readonly material = new THREE.MeshBasicMaterial({ map: this.atlas.texture, vertexColors: true, transparent: true, depthWrite: false, toneMapped: false });
  private readonly chunks: Chunk[] = [];

  constructor(places: readonly Place[]) {
    this.group.name = "openworld-names";
    const byChunk = new Map<number, NameSpec[]>();
    for (const spec of nameSpecs(places)) {
      const key = Math.floor(spec.x / NAME.chunkSize) * CHUNK_KEY_STRIDE + Math.floor(spec.z / NAME.chunkSize);
      const inChunk = byChunk.get(key);
      if (inChunk) inChunk.push(spec);
      else byChunk.set(key, [spec]);
    }
    for (const specs of byChunk.values()) this.addChunk(specs);
  }

  private addChunk(specs: readonly NameSpec[]): void {
    const buffers = new QuadBuffers();
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (const spec of specs) {
      this.addLabel(buffers, spec);
      minX = Math.min(minX, spec.x);
      maxX = Math.max(maxX, spec.x);
      minZ = Math.min(minZ, spec.z);
      maxZ = Math.max(maxZ, spec.z);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(Float32Array.from(buffers.positions), 3));
    geometry.setAttribute("uv", new THREE.BufferAttribute(Float32Array.from(buffers.uvs), 2));
    geometry.setAttribute("color", new THREE.BufferAttribute(Float32Array.from(buffers.colours), 3));
    geometry.setIndex(new THREE.BufferAttribute(Uint32Array.from(buffers.indices), 1));
    const mesh = new THREE.Mesh(geometry, this.material);
    mesh.name = "openworld-names:chunk";
    this.group.add(mesh);
    this.chunks.push({ mesh, x: (minX + maxX) / 2, z: (minZ + maxZ) / 2, radius: hypot2(maxX - minX, maxZ - minZ) / 2 + NAME.maxWidth / 2 });
  }

  /** The plate, then a quad per letter, the whole name shrunk until its plate fits `maxWidth`. */
  private addLabel(buffers: QuadBuffers, spec: NameSpec): void {
    const { advances, uvs, plateUvs } = this.atlas;
    let width = 0;
    for (let at = 0; at < spec.text.length; at++) width += advances[glyphOf(spec.text[at]!)]!;
    const em = spec.em * Math.min(1, spec.maxWidth / ((width + 2 * NAME.platePadEm) * spec.em));
    buffers.push(spec, 0, (width * em) / 2 + NAME.platePadEm * em, (NAME.plateHeightEm * em) / 2, plateUvs, 0, PLATE_INK);
    const ink = new THREE.Color(spec.ink);
    const cellWorld = ((GLYPH_CELL / GLYPH_PX) * em) / 2;
    let cursor = -(width * em) / 2;
    for (let at = 0; at < spec.text.length; at++) {
      const glyph = glyphOf(spec.text[at]!);
      const advance = advances[glyph]! * em;
      if (spec.text[at] !== " ") buffers.push(spec, cursor + advance / 2, cellWorld, cellWorld, uvs, glyph, ink);
      cursor += advance;
    }
  }

  update(eyeX: number, eyeZ: number, sight: SignSight | null): void {
    for (let at = 0; at < this.chunks.length; at++) {
      const chunk = this.chunks[at]!;
      const dx = chunk.x - eyeX;
      const dz = chunk.z - eyeZ;
      const reach = NAMES_RANGE + chunk.radius;
      chunk.mesh.visible = dx * dx + dz * dz <= reach * reach && (sight === null || sight.seen(chunk.x, chunk.z, chunk.radius));
    }
  }

  dispose(): void {
    for (const chunk of this.chunks) chunk.mesh.geometry.dispose();
    this.material.dispose();
    this.atlas.texture.dispose();
    this.group.removeFromParent();
    this.group.clear();
  }
}

/**
 * The open world's signage: every business's own sign always (`ShopSigns`), and, while the Track debug button is on, the name of every place inside the walls
 * printed on its front. The names are built the first time the button is on.
 */
export class OpenWorldSigns {
  readonly group = new THREE.Group();
  private readonly shop: ShopSigns;
  private names: NameLabels | null = null;
  private readonly places: readonly Place[];

  constructor(places: readonly Place[]) {
    this.places = places;
    this.group.name = "openworld-signs";
    this.shop = new ShopSigns(places);
    this.group.add(this.shop.group);
  }

  /** A frame: the names shown when `namesOn`, in the chunks within range of the eye that `sight` (when there is one) says are seen. */
  update(eyeX: number, eyeZ: number, namesOn: boolean, sight: SignSight | null): void {
    if (namesOn && this.names === null) this.buildNames();
    if (this.names === null) return;
    this.names.group.visible = namesOn;
    if (namesOn) this.names.update(eyeX, eyeZ, sight);
  }

  private buildNames(): void {
    this.names = new NameLabels(this.places);
    this.group.add(this.names.group);
  }

  dispose(): void {
    this.shop.dispose();
    this.names?.dispose();
    this.group.removeFromParent();
    this.group.clear();
  }
}
