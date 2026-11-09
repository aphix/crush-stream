import * as THREE from "three";
import { drawnHalf } from "../world/openworld/openworld-facade-solids.ts";
import { PLACE_KIND, type Place } from "../world/openworld/walk-graph.ts";

/** A business's sign band on its drawn front wall (m): 1 m tall under the first floor over the shop glass, proud enough of the wall that its relief never covers it. */
export const SHOP_SIGN = { bottom: 2.9, height: 1, standoff: 0.1 } as const;
/** Texels per metre of sign: 96 px for the 1 m band reads at street level and up close. */
const SIGN_PX_PER_METRE = 96;
/** A frontage wider than this still gets a sign this wide: two cells then fit a row of the atlas. */
const SIGN_MAX_WIDTH = 10.6;
const ATLAS_WIDTH = 2048;
/** Texels between cells: mip levels would blend a neighbour's colour into a sign's edge. */
const CELL_GUTTER = 4;
const CELL_HEIGHT = SHOP_SIGN.height * SIGN_PX_PER_METRE;
const ATLAS_ANISOTROPY = 8;

const SIGN_MARGIN = 24;
const SIGN_NAME_MAX_PX = 56;
const SIGN_DESCRIPTOR_PX = 17;
const SIGN_EXTRA_PX = 19;
const SIGN_EXTRA_LINE = 24;
/** Narrower than this a sign keeps to the name and its line: the extras would crowd it. */
const SIGN_EXTRAS_MIN_WIDTH = 700;
/** Share of the sign's width the name and its line take when extras stand beside them. */
const SIGN_NAME_SHARE = 0.58;
const SIGN_EDGE_PX = 3;

type SignLook = { fill: string; edge: string; ink: string; descriptor: string; extras: readonly string[] };

export const WHITE = "white";
const NAVY = "#16307a";
const GOLD = "#f2c230";
const CREAM = "#f6ecd0";
const TEAL = "#0f6b73";
const MAROON = "#5a1620";
const COPPER = "#d99a3a";
const AMBER = "#ffcf6b";
const FOREST = "#1d4a2c";
const SAND = "#e6d9a8";
const CHARCOAL = "#2b2f36";
const BRICK_RED = "#9d1c1c";
const PLUM = "#4a2a63";
const FROST = "#e8f6f6";
const IVORY = "#fff4dc";
const LINEN = "#f6f0d6";

/** By `Place.style` where a facade has a trade of its own, else by `Place.sector`. */
const SIGN_LOOKS: Readonly<Record<string, SignLook>> = {
  bodega: { fill: NAVY, edge: GOLD, ink: CREAM, descriptor: "GROCERY - DELI", extras: ["COLD BEER", "SODAS", "ICE CREAM"] },
  laundromat: { fill: TEAL, edge: FROST, ink: WHITE, descriptor: "WASH - DRY - FOLD", extras: ["OPEN DAILY", "COIN OR CARD"] },
  divebar: { fill: MAROON, edge: COPPER, ink: AMBER, descriptor: "COLD BEER - SHOTS", extras: ["POOL", "OPEN LATE"] },
  food: { fill: BRICK_RED, edge: CREAM, ink: IVORY, descriptor: "HOT - FRESH - FAST", extras: ["SLICES", "WINGS", "SUBS"] },
  services: { fill: FOREST, edge: SAND, ink: LINEN, descriptor: "WALK-INS WELCOME", extras: ["CUTS", "SHAVES"] },
  auto: { fill: CHARCOAL, edge: GOLD, ink: GOLD, descriptor: "AUTO BODY - TOWING", extras: ["REPAIRS", "PARTS"] },
  retail: { fill: NAVY, edge: GOLD, ink: CREAM, descriptor: "OPEN DAILY", extras: [] },
  nightlife: { fill: MAROON, edge: COPPER, ink: AMBER, descriptor: "OPEN LATE", extras: [] },
};
/** A business of a trade the table does not know: one of these by its name, its sector as the line under it. */
const FALLBACK_FILLS = [NAVY, FOREST, MAROON, CHARCOAL, TEAL, PLUM] as const;
const FALLBACK_INK = CREAM;
const FALLBACK_EDGE = SAND;
const FNV_OFFSET = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

/** Kept clear at each end of a building's drawn front wall (m): a sign or a name stops short of its corner and of the neighbour's wall. */
export const FACE_MARGIN = 0.4;

/** A point on a place's front face, `standoff` m out along the face's outward normal (the place's front is local +x of its yaw; north is -z). */
type FacadeFace = { x: number; z: number; normalX: number; normalZ: number };

/** Where a place's door stands, `standoff` m out from it: a place with no front of its own hangs its name there. */
export function facadeFace(place: Place, standoff: number): FacadeFace {
  const normalX = Math.cos(place.yaw);
  const normalZ = -Math.sin(place.yaw);
  return { x: place.doorX + normalX * standoff, z: place.doorZ + normalZ * standoff, normalX, normalZ };
}

/**
 * The middle of something `width` m wide on a building's drawn front wall (`drawnHalf`: short of the footprint's edges), `standoff` m proud of it: over the door, slid along the wall as far
 * as it must to stay `FACE_MARGIN` inside both ends (an interior's door stands off the wall's middle, a corner store's toward one end).
 */
export function onFrontFace(place: Place, width: number, standoff: number): FacadeFace {
  const normalX = Math.cos(place.yaw);
  const normalZ = -Math.sin(place.yaw);
  const doorAlong = (place.doorX - place.x) * normalZ - (place.doorZ - place.z) * normalX;
  const reach = Math.max(0, drawnHalf(place.width) - FACE_MARGIN - width / 2);
  const along = Math.min(reach, Math.max(-reach, doorAlong));
  const out = drawnHalf(place.depth) + standoff;
  return { x: place.x + normalZ * along + normalX * out, z: place.z - normalX * along + normalZ * out, normalX, normalZ };
}

/** A rectangle on a front face: its middle, the face's outward normal, its size (m). */
type FacadeRect = FacadeFace & { y: number; width: number; height: number };

/** A trade inside the walls: a building that is not a home. */
export function isBusiness(place: Place): boolean {
  return place.storeys > 0 && place.kind !== PLACE_KIND.home && place.doorNode >= 0;
}

/** The widest a thing on a building's drawn front wall may run (m) to stay `FACE_MARGIN` inside both its ends. */
export function frontWallRoom(place: Place): number {
  return 2 * (drawnHalf(place.width) - FACE_MARGIN);
}

/** Whole texels, rounded down: the sign never grows past the wall it was fitted to. */
function cellWidth(place: Place): number {
  return Math.floor(Math.min(frontWallRoom(place), SIGN_MAX_WIDTH) * SIGN_PX_PER_METRE);
}

function shopSignRect(place: Place): FacadeRect {
  const width = cellWidth(place) / SIGN_PX_PER_METRE;
  return { ...onFrontFace(place, width, SHOP_SIGN.standoff), y: SHOP_SIGN.bottom + SHOP_SIGN.height / 2, width, height: SHOP_SIGN.height };
}

function nameHash(name: string): number {
  let hash = FNV_OFFSET;
  for (let at = 0; at < name.length; at++) hash = Math.imul(hash ^ name.charCodeAt(at), FNV_PRIME);
  return hash >>> 0;
}

function lookOf(place: Place): SignLook {
  const known = SIGN_LOOKS[place.style] ?? SIGN_LOOKS[place.sector];
  if (known) return known;
  return { fill: FALLBACK_FILLS[nameHash(place.name) % FALLBACK_FILLS.length]!, edge: FALLBACK_EDGE, ink: FALLBACK_INK, descriptor: place.sector.toUpperCase(), extras: [] };
}

/** The font size (px) at most `maxPx` that fits `text` in `maxWidth` under the font `fontOf` names. */
function fittedPx(g: CanvasRenderingContext2D, text: string, maxPx: number, maxWidth: number, fontOf: (px: number) => string): number {
  g.font = fontOf(maxPx);
  const width = g.measureText(text).width;
  return width > maxWidth ? (maxPx * maxWidth) / width : maxPx;
}

const nameFont = (px: number): string => `italic bold ${px}px Georgia, serif`;
const lineFont = (px: number): string => `bold ${px}px sans-serif`;

function drawSign(g: CanvasRenderingContext2D, place: Place, x: number, y: number, width: number): void {
  const look = lookOf(place);
  g.fillStyle = look.fill;
  g.fillRect(x, y, width, CELL_HEIGHT);
  g.fillStyle = "rgba(255, 255, 255, 0.12)";
  g.fillRect(x, y, width, CELL_HEIGHT * 0.3);
  g.fillStyle = "rgba(0, 0, 0, 0.25)";
  g.fillRect(x, y + CELL_HEIGHT * 0.88, width, CELL_HEIGHT * 0.12);
  g.strokeStyle = look.edge;
  g.lineWidth = SIGN_EDGE_PX;
  g.strokeRect(x + SIGN_EDGE_PX, y + SIGN_EDGE_PX, width - 2 * SIGN_EDGE_PX, CELL_HEIGHT - 2 * SIGN_EDGE_PX);
  const withExtras = look.extras.length > 0 && width >= SIGN_EXTRAS_MIN_WIDTH;
  const textWidth = (withExtras ? width * SIGN_NAME_SHARE : width) - 2 * SIGN_MARGIN;
  g.textAlign = "left";
  g.textBaseline = "alphabetic";
  g.fillStyle = look.ink;
  g.font = nameFont(fittedPx(g, place.name, SIGN_NAME_MAX_PX, textWidth, nameFont));
  g.fillText(place.name, x + SIGN_MARGIN, y + CELL_HEIGHT * 0.58);
  g.font = lineFont(fittedPx(g, look.descriptor, SIGN_DESCRIPTOR_PX, textWidth, lineFont));
  g.fillText(look.descriptor, x + SIGN_MARGIN, y + CELL_HEIGHT * 0.84);
  if (!withExtras) return;
  const dividerX = x + width * SIGN_NAME_SHARE;
  g.beginPath();
  g.moveTo(dividerX, y + SIGN_MARGIN * 0.5);
  g.lineTo(dividerX, y + CELL_HEIGHT - SIGN_MARGIN * 0.5);
  g.stroke();
  g.font = lineFont(SIGN_EXTRA_PX);
  g.textAlign = "center";
  const centreX = (dividerX + x + width) / 2;
  const top = y + (CELL_HEIGHT - look.extras.length * SIGN_EXTRA_LINE) / 2 + SIGN_EXTRA_PX * 0.75;
  for (let line = 0; line < look.extras.length; line++) g.fillText(look.extras[line]!, centreX, top + line * SIGN_EXTRA_LINE, x + width - dividerX - SIGN_MARGIN);
}

type Cell = { place: number; x: number; y: number; width: number };

/** Cells in rows of the atlas, left to right, a new row when one would not fit. */
function packCells(places: readonly Place[]): { cells: Cell[]; rows: number } {
  const cells: Cell[] = [];
  let cursorX = 0;
  let row = 0;
  for (let index = 0; index < places.length; index++) {
    const place = places[index]!;
    if (!isBusiness(place)) continue;
    const width = cellWidth(place);
    if (cursorX > 0 && cursorX + width > ATLAS_WIDTH) {
      cursorX = 0;
      row++;
    }
    cells.push({ place: index, x: cursorX, y: row * (CELL_HEIGHT + CELL_GUTTER), width });
    cursorX += width + CELL_GUTTER;
  }
  return { cells, rows: cells.length === 0 ? 0 : row + 1 };
}

/**
 * Every business's sign in one atlas texture and one mesh (one draw call): the place's name and what it sells on a band over the shop glass. A shopfront's own
 * sign band geometry can take `texture` and `uvRect` instead of the panels this builds.
 */
export class ShopSigns {
  readonly group = new THREE.Group();
  readonly texture: THREE.CanvasTexture;
  private readonly uvRects = new Map<number, readonly [number, number, number, number]>();
  private readonly geometry = new THREE.BufferGeometry();
  private readonly material: THREE.MeshBasicMaterial;

  constructor(places: readonly Place[]) {
    this.group.name = "openworld-shop-signs";
    const { cells, rows } = packCells(places);
    const canvas = document.createElement("canvas");
    canvas.width = ATLAS_WIDTH;
    canvas.height = THREE.MathUtils.ceilPowerOfTwo(Math.max(1, rows * (CELL_HEIGHT + CELL_GUTTER)));
    const g = canvas.getContext("2d")!;
    for (const cell of cells) drawSign(g, places[cell.place]!, cell.x, cell.y, cell.width);
    this.texture = new THREE.CanvasTexture(canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.anisotropy = ATLAS_ANISOTROPY;
    this.material = new THREE.MeshBasicMaterial({ map: this.texture, toneMapped: false });
    for (const cell of cells) this.uvRects.set(cell.place, [cell.x / canvas.width, 1 - (cell.y + CELL_HEIGHT) / canvas.height, (cell.x + cell.width) / canvas.width, 1 - cell.y / canvas.height]);
    if (cells.length === 0) return;
    this.buildPanels(places, cells);
    const mesh = new THREE.Mesh(this.geometry, this.material);
    mesh.name = "openworld-shop-signs:panels";
    this.group.add(mesh);
  }

  /** The sign's rectangle in the atlas, [u0, v0, u1, v1] with v up (a texture's own orientation), null when the place has no sign. */
  uvRect(placeIndex: number): readonly [number, number, number, number] | null {
    return this.uvRects.get(placeIndex) ?? null;
  }

  private buildPanels(places: readonly Place[], cells: readonly Cell[]): void {
    const positions = new Float32Array(cells.length * 12);
    const uvs = new Float32Array(cells.length * 8);
    const indices = new Uint16Array(cells.length * 6);
    for (let at = 0; at < cells.length; at++) {
      const rect = shopSignRect(places[cells[at]!.place]!);
      const [u0, v0, u1, v1] = this.uvRects.get(cells[at]!.place)!;
      const rightX = rect.normalZ * (rect.width / 2);
      const rightZ = -rect.normalX * (rect.width / 2);
      const bottom = rect.y - rect.height / 2;
      const top = rect.y + rect.height / 2;
      positions.set([rect.x - rightX, bottom, rect.z - rightZ, rect.x + rightX, bottom, rect.z + rightZ, rect.x + rightX, top, rect.z + rightZ, rect.x - rightX, top, rect.z - rightZ], at * 12);
      uvs.set([u0, v0, u1, v0, u1, v1, u0, v1], at * 8);
      indices.set([at * 4, at * 4 + 1, at * 4 + 2, at * 4, at * 4 + 2, at * 4 + 3], at * 6);
    }
    this.geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    this.geometry.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
    this.geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
    this.texture.dispose();
    this.group.removeFromParent();
    this.group.clear();
  }
}
