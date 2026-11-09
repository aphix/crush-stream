import * as THREE from "three";
import { FURNISHING, ROOM_LOOK, type Furnishing, type FurnishingKind } from "../../world/openworld/interior-kinds.ts";
import type { InteriorKind } from "../../world/openworld/walk-graph.ts";
import { box, cyl, type Piece } from "../prefab-pieces.ts";

/** What a furnishing draws: lit and unlit pieces, in its own frame (its front along +x, its width along z, its base at y = 0, its middle at the origin). */
type Parts = { solid: Piece[]; glow: Piece[] };

type Look = (typeof ROOM_LOOK)[InteriorKind];

const BLACK = 0x1b1d22;
const WHITE = 0xe8ebee;
const STEEL = 0x8a9298;
const GLASS = 0x7fb4c9;
const FOLIAGE = 0x2f6b3a;
const SCREEN_LIGHT = 0x9fd0ff;
const LAMP_LIGHT = 0xffe0a3;
/** A board or plate's thickness and the margin it keeps from an edge, and a larger inset (m). */
const TRIM = 0.05;
const INSET = 0.1;
/** The depth of a pool table's apron and how far a leg stands below it, a gondola upright's share of its depth, and a panel's setback from a cabinet's top (m). */
const APRON = 0.3;
const UPRIGHT_SHARE = 0.4;
const PANEL_SETBACK = 0.2;
/** Product bands on gondolas and bottle shelves. */
const PRODUCTS = [0x2f6b3a, 0xc0392b, 0xe0c040, 0x2b5ea8, 0xd98a2b] as const;

/** A box of size (sx, sy, sz) centred at (x, z) with its base at `y0`. */
const part = (sx: number, sy: number, sz: number, x: number, y0: number, z: number): THREE.BufferGeometry => box(sx, sy, sz, x, y0 + sy / 2, z);

/** A vertical cylinder at (x, z) from `y0` to `y1`. */
function post(radiusTop: number, radiusBottom: number, y0: number, y1: number, x = 0, z = 0): THREE.BufferGeometry {
  return cyl(radiusTop, radiusBottom, y0, y1, 10).translate(x, 0, z);
}

type Maker = (piece: Furnishing, look: Look, kind: InteriorKind, out: Parts) => void;

const counter: Maker = (piece, look, _kind, out) => {
  out.solid.push([part(piece.depth, piece.height - TRIM, piece.width, 0, 0, 0), look.wood], [part(piece.depth + TRIM, 0.05, piece.width + TRIM, 0.03, piece.height - TRIM, 0), look.accent]);
  if (piece.serves) out.solid.push([part(0.35, 0.25, 0.4, -0.05, piece.height, piece.width / 4), BLACK]);
};

const backShelf: Maker = (piece, look, _kind, out) => {
  out.solid.push([part(piece.depth, piece.height, piece.width, 0, 0, 0), look.wood]);
  for (let row = 0; row < 3; row++) out.solid.push([part(0.08, 0.28, piece.width - INSET, piece.depth / 2 + 0.03, 0.5 + row * 0.6, 0), PRODUCTS[row % PRODUCTS.length]!]);
};

const gondola: Maker = (piece, look, _kind, out) => {
  out.solid.push([part(piece.depth, 0.2, piece.width, 0, 0, 0), BLACK], [part(piece.depth * UPRIGHT_SHARE, piece.height, piece.width - TRIM, 0, 0.2, 0), look.trim]);
  for (let shelf = 0; shelf < 4; shelf++) out.solid.push([part(piece.depth, 0.22, piece.width - TRIM, 0, 0.35 + shelf * 0.38, 0), PRODUCTS[shelf % PRODUCTS.length]!]);
};

const fridge: Maker = (piece, _look, _kind, out) => {
  out.solid.push([part(piece.depth, piece.height, piece.width, 0, 0, 0), WHITE], [part(0.03, piece.height - PANEL_SETBACK, piece.width - INSET, piece.depth / 2, 0.1, 0), GLASS]);
};

const cabinet: Maker = (piece, look, _kind, out) => {
  out.solid.push([part(piece.depth, piece.height - 0.04, piece.width, 0, 0, 0), look.wood], [part(piece.depth + TRIM, 0.04, piece.width, 0, piece.height - 0.04, 0), look.trim]);
};

const stove: Maker = (piece, _look, _kind, out) => {
  out.solid.push([part(piece.depth, piece.height, piece.width, 0, 0, 0), STEEL], [part(piece.depth - TRIM, 0.02, piece.width - TRIM, 0, piece.height, 0), BLACK]);
};

const sink: Maker = (piece, look, kind, out) => {
  cabinet(piece, look, kind, out);
  out.solid.push([part(piece.depth - 0.2, 0.02, piece.width - 0.3, 0, piece.height, 0), STEEL], [part(0.05, 0.25, 0.05, -piece.depth / 2 + 0.1, piece.height, 0), STEEL]);
};

const table: Maker = (piece, look, _kind, out) => {
  out.solid.push([part(piece.depth, 0.05, piece.width, 0, piece.height - TRIM, 0), look.wood]);
  for (const side of [-1, 1]) {
    for (const end of [-1, 1]) out.solid.push([part(0.05, piece.height - TRIM, 0.05, end * (piece.depth / 2 - 0.06), 0, side * (piece.width / 2 - 0.06)), look.wood]);
  }
};

const desk: Maker = (piece, look, _kind, out) => {
  out.solid.push([part(piece.depth, 0.04, piece.width, 0, piece.height - 0.04, 0), look.wood], [part(0.03, piece.height - PANEL_SETBACK, piece.width - INSET, -piece.depth / 2 + 0.05, 0.1, 0), look.trim]);
  for (const side of [-1, 1]) out.solid.push([part(piece.depth - TRIM, piece.height - 0.04, 0.04, 0, 0, side * (piece.width / 2 - 0.03)), look.trim]);
  out.solid.push([part(0.04, 0.32, 0.55, -0.12, piece.height + INSET, 0), BLACK], [part(0.15, 0.1, 0.2, -0.12, piece.height, 0), BLACK]);
  out.glow.push([part(0.01, 0.28, 0.5, -0.095, piece.height + INSET, 0), SCREEN_LIGHT]);
};

const bed: Maker = (piece, look, _kind, out) => {
  out.solid.push([part(piece.depth, 0.3, piece.width, 0, 0, 0), look.wood], [part(piece.depth - INSET, 0.22, piece.width - INSET, 0, 0.3, 0), look.fabric], [part(0.06, 0.9, piece.width, -piece.depth / 2, 0, 0), look.wood]);
  for (const side of [-1, 1]) out.solid.push([part(0.4, 0.1, 0.55, -piece.depth / 2 + 0.35, 0.52, side * piece.width * 0.22), WHITE]);
};

const dresser: Maker = (piece, look, _kind, out) => {
  out.solid.push([part(piece.depth, piece.height, piece.width, 0, 0, 0), look.wood]);
  for (let drawer = 0; drawer < 3; drawer++) out.solid.push([part(0.02, 0.2, piece.width - INSET, piece.depth / 2, 0.15 + drawer * 0.25, 0), look.trim]);
};

const bathtub: Maker = (piece, _look, _kind, out) => {
  out.solid.push([part(piece.depth, piece.height - TRIM, piece.width, 0, 0, 0), WHITE], [part(piece.depth - INSET, 0.02, piece.width - INSET, 0, piece.height - TRIM, 0), GLASS]);
  for (const side of [-1, 1]) {
    out.solid.push([part(piece.depth, 0.05, 0.06, 0, piece.height - TRIM, side * (piece.width / 2 - 0.03)), WHITE], [part(0.06, 0.05, piece.width - INSET, side * (piece.depth / 2 - 0.03), piece.height - TRIM, 0), WHITE]);
  }
};

const toilet: Maker = (_piece, look, _kind, out) => {
  out.solid.push([part(0.45, 0.4, 0.36, 0.1, 0, 0), WHITE], [part(0.45, 0.03, 0.36, 0.1, 0.4, 0), look.trim], [part(0.2, 0.3, 0.38, -0.25, 0.4, 0), WHITE]);
};

const basin: Maker = (piece, _look, _kind, out) => {
  out.solid.push([part(0.15, 0.7, 0.15, 0, 0, 0), WHITE], [part(piece.depth, 0.15, piece.width, 0, 0.7, 0), WHITE], [part(0.04, 0.12, 0.04, -piece.depth / 2 + 0.06, 0.85, 0), STEEL]);
};

const tvUnit: Maker = (piece, look, _kind, out) => {
  out.solid.push([part(piece.depth, piece.height, piece.width, 0, 0, 0), look.wood]);
};

const screen: Maker = (piece, _look, _kind, out) => {
  out.glow.push([part(piece.depth, piece.height, piece.width, 0, 0, 0), SCREEN_LIGHT]);
};

const poolTable: Maker = (piece, look, _kind, out) => {
  out.solid.push([part(piece.depth - TRIM, 0.2, piece.width - TRIM, 0, piece.height - APRON, 0), look.wood], [part(piece.depth - 0.15, 0.04, piece.width - 0.15, 0, piece.height - TRIM, 0), FOLIAGE]);
  for (const side of [-1, 1]) {
    out.solid.push([part(piece.depth, 0.1, 0.1, 0, piece.height - INSET, side * (piece.width / 2 - 0.05)), look.wood], [part(0.1, 0.1, piece.width, side * (piece.depth / 2 - 0.05), piece.height - INSET, 0), look.wood]);
    for (const end of [-1, 1]) out.solid.push([part(0.12, piece.height - APRON, 0.12, end * (piece.depth / 2 - 0.1), 0, side * (piece.width / 2 - 0.1)), look.wood]);
  }
};

const jukebox: Maker = (piece, look, _kind, out) => {
  out.solid.push([part(piece.depth, piece.height, piece.width, 0, 0, 0), look.accent]);
  out.glow.push([part(0.02, 0.9, piece.width - 0.15, piece.depth / 2, 0.3, 0), 0xffb347]);
};

const rail: Maker = (piece, look, _kind, out) => {
  out.solid.push([part(piece.depth, piece.height, piece.width, 0, 0, 0), look.trim]);
};

/** Seat furniture: a base, cushions along its width, a back on its far side and arms. */
function upholstered(piece: Furnishing, look: Look, out: Parts, baseHeight: number, withArms: boolean): void {
  const seats = FURNISHING[piece.kind].seats;
  const cushionHeight = FURNISHING[piece.kind].seatHeight - baseHeight;
  out.solid.push([part(piece.depth, baseHeight, piece.width, 0, 0, 0), look.wood]);
  for (let seat = 0; seat < seats; seat++) out.solid.push([part(piece.depth - 0.25, cushionHeight, piece.width / seats - 0.05, 0.12, baseHeight, (seat - (seats - 1) / 2) * (piece.width / seats)), look.fabric]);
  out.solid.push([part(0.22, piece.height - baseHeight, piece.width, -piece.depth / 2 + 0.11, baseHeight, 0), look.fabric]);
  if (withArms) for (const side of [-1, 1]) out.solid.push([part(piece.depth, 0.3, 0.15, 0, baseHeight, side * (piece.width / 2 - 0.075)), look.fabric]);
}

const sofa: Maker = (piece, look, _kind, out) => upholstered(piece, look, out, 0.25, true);
const armchair: Maker = (piece, look, _kind, out) => upholstered(piece, look, out, 0.25, true);

const bench: Maker = (piece, look, _kind, out) => {
  out.solid.push([part(piece.depth, 0.3, piece.width, 0, 0, 0), look.wood], [part(piece.depth - TRIM, 0.16, piece.width - TRIM, 0.02, 0.3, 0), look.fabric], [part(0.1, piece.height - 0.46, piece.width, -piece.depth / 2 + 0.05, 0.46, 0), look.wood]);
};

const stool: Maker = (piece, look, _kind, out) => {
  out.solid.push([post(0.2, 0.2, piece.height - TRIM, piece.height), look.fabric], [post(0.025, 0.025, 0.05, piece.height - TRIM), STEEL], [post(0.17, 0.2, 0, 0.05), STEEL]);
};

const chair: Maker = (_piece, look, _kind, out) => {
  out.solid.push([part(0.45, 0.05, 0.45, 0, 0.41, 0), look.wood], [part(0.04, 0.4, 0.42, -0.205, 0.46, 0), look.wood]);
  for (const side of [-1, 1]) {
    for (const end of [-1, 1]) out.solid.push([part(0.04, 0.41, 0.04, end * 0.19, 0, side * 0.19), look.wood]);
  }
};

const deskChair: Maker = (_piece, look, _kind, out) => {
  out.solid.push([part(0.5, 0.08, 0.5, 0, 0.42, 0), look.fabric], [part(0.06, 0.45, 0.46, -0.23, 0.5, 0), look.fabric], [post(0.03, 0.03, 0.08, 0.42), STEEL], [part(0.55, 0.04, 0.06, 0, 0.04, 0), STEEL], [part(0.06, 0.04, 0.55, 0, 0.04, 0), STEEL]);
};

const plant: Maker = (_piece, _look, _kind, out) => {
  out.solid.push([post(0.17, 0.12, 0, 0.3), 0x8a4b32], [part(0.4, 0.5, 0.4, 0, 0.3, 0), FOLIAGE], [part(0.28, 0.4, 0.28, 0, 0.8, 0), FOLIAGE]);
};

const lamp: Maker = (piece, _look, _kind, out) => {
  out.solid.push([part(0.02, 0.05, 0.02, 0, piece.height, 0), BLACK]);
  out.glow.push([part(0.4, 0.16, 0.4, 0, 0.12, 0), LAMP_LIGHT]);
};

const MAKERS: Record<FurnishingKind, Maker> = {
  counter,
  backShelf,
  gondola,
  fridge,
  cabinet,
  stove,
  sink,
  table,
  desk,
  bed,
  dresser,
  bathtub,
  toilet,
  basin,
  tvUnit,
  poolTable,
  jukebox,
  rail,
  sofa,
  armchair,
  bench,
  stool,
  chair,
  deskChair,
  plant,
  lamp,
  screen,
};

/** One furnishing's pieces in its own frame. */
export function furnishingParts(piece: Furnishing, kind: InteriorKind): Parts {
  const out: Parts = { solid: [], glow: [] };
  MAKERS[piece.kind](piece, ROOM_LOOK[kind], kind, out);
  return out;
}
