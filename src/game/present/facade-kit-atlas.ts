import * as THREE from "three";
import { detAtan2, detSin, hypot2 } from "../kernel/physics-core.js";
import { mulberry32 } from "../world/placements.ts";

/** A texture region: u and v run 0..1 over the atlas, v up. */
export type UvRect = { u0: number; v0: number; u1: number; v1: number };

/** The kit's atlas edge (texels): four cells with a gutter between them, so mipmaps do not bleed one into the next. */
export const ATLAS_SIZE = 256;
/** A cell is read from this many texels inside its edge (a texel's bleed under bilinear filtering). */
const CELL_INSET = 1;

type Cell = { x: number; y: number; width: number; height: number };

/** Texel rectangles, y up from the atlas's bottom row. */
const CELLS = {
  window: { x: 4, y: 160, width: 96, height: 96 },
  panel: { x: 108, y: 160, width: 96, height: 96 },
  stone: { x: 4, y: 108, width: 96, height: 40 },
  basement: { x: 108, y: 108, width: 64, height: 40 },
  louvre: { x: 4, y: 56, width: 96, height: 40 },
  marble: { x: 108, y: 56, width: 96, height: 40 },
  fanlight: { x: 4, y: 4, width: 96, height: 48 },
} as const satisfies Record<string, Cell>;

function uvOf(cell: Cell): UvRect {
  return {
    u0: (cell.x + CELL_INSET) / ATLAS_SIZE,
    v0: (cell.y + CELL_INSET) / ATLAS_SIZE,
    u1: (cell.x + cell.width - CELL_INSET) / ATLAS_SIZE,
    v1: (cell.y + cell.height - CELL_INSET) / ATLAS_SIZE,
  };
}

export const KIT_CELL = { window: uvOf(CELLS.window), panel: uvOf(CELLS.panel), stone: uvOf(CELLS.stone), basement: uvOf(CELLS.basement), louvre: uvOf(CELLS.louvre), marble: uvOf(CELLS.marble), fanlight: uvOf(CELLS.fanlight) } as const;

/** The railing strip: one bar's period across, its height up; bars sit between a bottom and a top rail. */
const RAIL_WIDTH = 32;
const RAIL_HEIGHT = 64;
const RAIL_BAR_FROM = 13;
const RAIL_BAR_TO = 19;
const RAIL_BOTTOM_ROW = 6;
const RAIL_TOP_ROW = 56;
/** The strip's opaque rows (the top rail): the uv a solid post reads. */
export const RAIL_SOLID_CELL: UvRect = { u0: 0, v0: (RAIL_TOP_ROW + 1) / RAIL_HEIGHT, u1: 1, v1: 1 };
/** The iron's colour. */
const IRON = [24, 24, 28] as const;

/** Window: white frame, cross muntins, glass from a dark low blue to a pale sky reflection with a diagonal streak. */
const FRAME_TEXELS = 7;
const MUNTIN_HALF = 2;
const FRAME_RGB = [236, 232, 222] as const;
const FRAME_SHADOW_RGB = [196, 192, 182] as const;
const GLASS_LOW_RGB = [52, 72, 98] as const;
const GLASS_HIGH_RGB = [134, 164, 188] as const;
const GLASS_STREAK_PERIOD = 24;
const GLASS_STREAK_WIDTH = 3;
const GLASS_STREAK_BOOST = 14;
/** A window pane's alpha in the atlas (frames and everything else are 255): the kit's shader cuts texels under `GLASS_ALPHA_BELOW` where the room behind them is built. */
const GLASS_ALPHA = 128;
export const GLASS_ALPHA_BELOW = 0.75;
/** What a lit window glows (linear-ish warm), at its brightest. */
const WINDOW_LIGHT_RGB = [255, 186, 104] as const;
const WINDOW_LIGHT_FLOOR = 0.75;

/** Raised panel: a flat border, a bevel lit from the upper left, a recessed field. */
const PANEL_BORDER = 6;
const PANEL_BEVEL = 10;
const PANEL_PAINT = 236;
const PANEL_LIT = 1;
const PANEL_SHADE = 0.74;
const PANEL_FIELD = 0.93;
const PANEL_BORDER_SHADE = 0.97;
const PANEL_NOISE = 0.02;

/** Stone: a warm grey with speckle. */
const STONE_RGB = [200, 196, 188] as const;
const STONE_NOISE = 0.09;

/** Louvred shutter: slats a pitch tall, lit on the upper part of each and dark in the gap under it. */
const LOUVRE_PITCH = 6;
const LOUVRE_SLAT = 4;
const LOUVRE_PAINT = 236;
const LOUVRE_GAP_SHADE = 0.5;
const LOUVRE_SLAT_SHADE = [1, 0.93, 0.86, 0.8] as const;

/** Marble: a near-white stone with grey veins running up and to the right, wobbling as they climb. */
const MARBLE_PAINT = 238;
const MARBLE_NOISE = 0.025;
const MARBLE_VEIN_SLOPE = 2.2;
const MARBLE_VEIN_FREQ = 0.13;
const MARBLE_WOBBLE = 2.5;
const MARBLE_WOBBLE_FREQ = 0.17;
const MARBLE_VEIN_THRESHOLD = 0.995;
const MARBLE_VEIN_SHADE = 0.8;

/** Fanlight: a half disc (its flat edge at the cell's bottom) of glass from a dark rim to a pale middle, cut by radial bars and one ring. */
const FAN_BARS = 7;
const FAN_BAR_HALF = 0.06;
const FAN_RING_AT = 0.55;
const FAN_RING_HALF = 0.04;
const FAN_BAR_RGB = [240, 238, 230] as const;

/** Basement window: a dark pane behind iron bars, in a stone frame. */
const BASEMENT_FRAME_TEXELS = 3;
const BASEMENT_PANE_RGB = [22, 24, 28] as const;
const BASEMENT_BAR_RGB = [92, 94, 102] as const;
const BASEMENT_BAR_PITCH = 6;
const BASEMENT_BAR_FROM = 2;
const BASEMENT_BAR_TO = 4;

/** A fixed seed: the speckle is the same on every machine. */
const ATLAS_SEED = 0x4b17;

export type KitTextures = { albedo: THREE.DataTexture; glow: THREE.DataTexture; rail: THREE.DataTexture };

type Texels = { data: Uint8Array; width: number };

function texels(width: number, height: number): Texels {
  return { data: new Uint8Array(width * height * 4), width };
}

function put(into: Texels, x: number, y: number, red: number, green: number, blue: number, alpha = 255): void {
  const at = (y * into.width + x) * 4;
  into.data[at] = Math.max(0, Math.min(255, Math.round(red)));
  into.data[at + 1] = Math.max(0, Math.min(255, Math.round(green)));
  into.data[at + 2] = Math.max(0, Math.min(255, Math.round(blue)));
  into.data[at + 3] = alpha;
}

const mix = (low: number, high: number, share: number): number => low + (high - low) * share;

/** Calls `visit` for every texel of `cell` with its column, row and distance from the nearest edge (texels). */
function eachTexel(cell: Cell, visit: (column: number, row: number, edge: number) => void): void {
  for (let row = 0; row < cell.height; row++) {
    for (let column = 0; column < cell.width; column++) visit(column, row, Math.min(column, row, cell.width - 1 - column, cell.height - 1 - row));
  }
}

function paintWindow(albedo: Texels, glow: Texels, cell: Cell): void {
  const middle = cell.width / 2;
  eachTexel(cell, (column, row, edge) => {
    const muntin = Math.abs(column - middle) < MUNTIN_HALF || Math.abs(row - middle) < MUNTIN_HALF;
    const x = cell.x + column;
    const y = cell.y + row;
    if (edge < FRAME_TEXELS || muntin) {
      const rgb = edge === FRAME_TEXELS - 1 ? FRAME_SHADOW_RGB : FRAME_RGB;
      put(albedo, x, y, rgb[0], rgb[1], rgb[2]);
      put(glow, x, y, 0, 0, 0);
      return;
    }
    const height = row / cell.height;
    const streak = (column + row) % GLASS_STREAK_PERIOD < GLASS_STREAK_WIDTH ? GLASS_STREAK_BOOST : 0;
    put(albedo, x, y, mix(GLASS_LOW_RGB[0], GLASS_HIGH_RGB[0], height) + streak, mix(GLASS_LOW_RGB[1], GLASS_HIGH_RGB[1], height) + streak, mix(GLASS_LOW_RGB[2], GLASS_HIGH_RGB[2], height) + streak, GLASS_ALPHA);
    const light = mix(WINDOW_LIGHT_FLOOR, 1, height);
    put(glow, x, y, WINDOW_LIGHT_RGB[0] * light, WINDOW_LIGHT_RGB[1] * light, WINDOW_LIGHT_RGB[2] * light);
  });
}

function paintPanel(albedo: Texels, cell: Cell, random: () => number): void {
  eachTexel(cell, (column, row, edge) => {
    let shade = PANEL_FIELD;
    if (edge < PANEL_BORDER) shade = PANEL_BORDER_SHADE;
    else if (edge < PANEL_BEVEL) shade = row > column ? PANEL_LIT : PANEL_SHADE;
    const grey = PANEL_PAINT * shade * (1 + (random() - 0.5) * 2 * PANEL_NOISE);
    put(albedo, cell.x + column, cell.y + row, grey, grey, grey);
  });
}

function paintStone(albedo: Texels, cell: Cell, random: () => number): void {
  eachTexel(cell, (column, row) => {
    const speckle = 1 + (random() - 0.5) * 2 * STONE_NOISE;
    put(albedo, cell.x + column, cell.y + row, STONE_RGB[0] * speckle, STONE_RGB[1] * speckle, STONE_RGB[2] * speckle);
  });
}

/** Horizontal slats up the cell: each a lit face shading toward its lower edge, then a dark gap. */
function paintLouvre(albedo: Texels, cell: Cell): void {
  eachTexel(cell, (column, row) => {
    const along = row % LOUVRE_PITCH;
    const shade = along < LOUVRE_SLAT ? LOUVRE_SLAT_SHADE[LOUVRE_SLAT - 1 - along]! : LOUVRE_GAP_SHADE;
    put(albedo, cell.x + column, cell.y + row, LOUVRE_PAINT * shade, LOUVRE_PAINT * shade, LOUVRE_PAINT * shade);
  });
}

function paintMarble(albedo: Texels, cell: Cell, random: () => number): void {
  eachTexel(cell, (column, row) => {
    const vein = Math.abs(detSin((column + MARBLE_VEIN_SLOPE * row) * MARBLE_VEIN_FREQ + MARBLE_WOBBLE * detSin(row * MARBLE_WOBBLE_FREQ))) > MARBLE_VEIN_THRESHOLD;
    const grey = MARBLE_PAINT * (vein ? MARBLE_VEIN_SHADE : 1) * (1 + (random() - 0.5) * 2 * MARBLE_NOISE);
    put(albedo, cell.x + column, cell.y + row, grey, grey, grey);
  });
}

/** The fan: glass lit warm toward its middle, white bars between its panes that never light; the cell outside the disc is bar white. */
function paintFanlight(albedo: Texels, glow: Texels, cell: Cell): void {
  const middle = cell.width / 2;
  eachTexel(cell, (column, row) => {
    const dx = column + 0.5 - middle;
    const dy = row + 0.5;
    const radius = hypot2(dx, dy) / middle;
    const sector = (detAtan2(dy, dx) / Math.PI) * FAN_BARS;
    const bar = Math.abs(sector - Math.round(sector)) < FAN_BAR_HALF * FAN_BARS || Math.abs(radius - FAN_RING_AT) < FAN_RING_HALF || radius > 1;
    const x = cell.x + column;
    const y = cell.y + row;
    if (bar) {
      put(albedo, x, y, FAN_BAR_RGB[0], FAN_BAR_RGB[1], FAN_BAR_RGB[2]);
      put(glow, x, y, 0, 0, 0);
      return;
    }
    put(albedo, x, y, mix(GLASS_HIGH_RGB[0], GLASS_LOW_RGB[0], radius), mix(GLASS_HIGH_RGB[1], GLASS_LOW_RGB[1], radius), mix(GLASS_HIGH_RGB[2], GLASS_LOW_RGB[2], radius));
    const light = mix(1, WINDOW_LIGHT_FLOOR, radius);
    put(glow, x, y, WINDOW_LIGHT_RGB[0] * light, WINDOW_LIGHT_RGB[1] * light, WINDOW_LIGHT_RGB[2] * light);
  });
}

function paintBasement(albedo: Texels, cell: Cell): void {
  eachTexel(cell, (column, row, edge) => {
    const bar = column % BASEMENT_BAR_PITCH >= BASEMENT_BAR_FROM && column % BASEMENT_BAR_PITCH < BASEMENT_BAR_TO;
    const rgb = edge < BASEMENT_FRAME_TEXELS ? STONE_RGB : bar ? BASEMENT_BAR_RGB : BASEMENT_PANE_RGB;
    put(albedo, cell.x + column, cell.y + row, rgb[0], rgb[1], rgb[2]);
  });
}

function paintRail(rail: Texels): void {
  for (let row = 0; row < RAIL_HEIGHT; row++) {
    for (let column = 0; column < RAIL_WIDTH; column++) {
      const onRail = row < RAIL_BOTTOM_ROW || row >= RAIL_TOP_ROW;
      const onBar = column >= RAIL_BAR_FROM && column < RAIL_BAR_TO;
      put(rail, column, row, IRON[0], IRON[1], IRON[2], onRail || onBar ? 255 : 0);
    }
  }
}

function textureOf(data: Uint8Array, width: number, height: number, repeatAcross: boolean): THREE.DataTexture {
  const texture = new THREE.DataTexture(data, width, height, THREE.RGBAFormat);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.generateMipmaps = true;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  if (repeatAcross) texture.wrapS = THREE.RepeatWrapping;
  texture.needsUpdate = true;
  return texture;
}

/** The kit's texels (RGBA, rows from the bottom), painted in code so every machine has the same pixels: the atlas, its lit-window glow, the railing's bar strip. */
type KitTexels = { albedo: Uint8Array; glow: Uint8Array; rail: Uint8Array };

export function paintKit(): KitTexels {
  const albedo = texels(ATLAS_SIZE, ATLAS_SIZE);
  const glow = texels(ATLAS_SIZE, ATLAS_SIZE);
  const rail = texels(RAIL_WIDTH, RAIL_HEIGHT);
  const random = mulberry32(ATLAS_SEED);
  paintWindow(albedo, glow, CELLS.window);
  paintPanel(albedo, CELLS.panel, random);
  paintStone(albedo, CELLS.stone, random);
  paintBasement(albedo, CELLS.basement);
  paintLouvre(albedo, CELLS.louvre);
  paintMarble(albedo, CELLS.marble, random);
  paintFanlight(albedo, glow, CELLS.fanlight);
  paintRail(rail);
  return { albedo: albedo.data, glow: glow.data, rail: rail.data };
}

export function makeKitTextures(): KitTextures {
  const painted = paintKit();
  return { albedo: textureOf(painted.albedo, ATLAS_SIZE, ATLAS_SIZE, false), glow: textureOf(painted.glow, ATLAS_SIZE, ATLAS_SIZE, false), rail: textureOf(painted.rail, RAIL_WIDTH, RAIL_HEIGHT, true) };
}
