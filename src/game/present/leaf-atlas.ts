import * as THREE from "three";
import { once } from "../kernel/scalar.ts";
import { mulberry32 } from "../world/placements.ts";

export type LeafSpecies = "plane" | "linden" | "young" | "cherry";
const SPECIES: readonly LeafSpecies[] = ["plane", "linden", "young", "cherry"];
const CELL = 256;
const ROWS = 2;
const GUTTER = 6;
const WIDTH = CELL * SPECIES.length;
const HEIGHT = CELL * ROWS;
/** Leaves in a cell, a leaf's width as a share of the cell, and its outline: 5 a lobed leaf, 1 an oval, 0 a round petal. */
const SHAPE: Record<LeafSpecies, { count: number; size: number; lobes: number }> = {
  plane: { count: 34, size: 0.16, lobes: 5 },
  linden: { count: 46, size: 0.13, lobes: 1 },
  young: { count: 60, size: 0.11, lobes: 1 },
  cherry: { count: 96, size: 0.05, lobes: 0 },
};
/** A cherry's spray has this many green leaves under its petals, each this wide a share of the cell. */
const CHERRY_LEAVES = 6;
const CHERRY_LEAF_SIZE = 0.11;
/** An oval leaf is this share of its length across. */
const OVAL_WIDTH = 0.4;

/** Each species' two atlas cells as uv rects `[u0, v0, du, dv]` (v up), the clear gutter left out. */
export const LEAF_CELLS: Record<LeafSpecies, readonly (readonly [number, number, number, number])[]> = Object.fromEntries(
  SPECIES.map((species, column) => [
    species,
    [0, 1].map((row) => [(column * CELL + GUTTER) / WIDTH, 1 - ((row + 1) * CELL - GUTTER) / HEIGHT, (CELL - 2 * GUTTER) / WIDTH, (CELL - 2 * GUTTER) / HEIGHT] as const),
  ] as const),
) as Record<LeafSpecies, (readonly [number, number, number, number])[]>;

function leafPath(ctx: CanvasRenderingContext2D, width: number, lobes: number): void {
  ctx.beginPath();
  if (lobes === 0) ctx.arc(0, 0, width / 2, 0, Math.PI * 2);
  else if (lobes === 1) ctx.ellipse(0, 0, width * OVAL_WIDTH, width / 2, 0, 0, Math.PI * 2);
  else
    for (let point = 0; point < lobes * 2; point++) {
      const radius = point % 2 === 0 ? width / 2 : width * 0.28;
      const angle = (point * Math.PI) / lobes;
      if (point === 0) ctx.moveTo(Math.sin(angle) * radius, -Math.cos(angle) * radius);
      else ctx.lineTo(Math.sin(angle) * radius, -Math.cos(angle) * radius);
    }
  ctx.closePath();
}

/** One spray in the cell whose corner is (x0, y0): twigs from the middle, then leaves scattered through a disc, so the cell's edge is ragged and clear. */
function drawSpray(ctx: CanvasRenderingContext2D, x0: number, y0: number, species: LeafSpecies, seed: number): void {
  const random = mulberry32(seed);
  const reach = CELL / 2 - GUTTER;
  const { count, size, lobes } = SHAPE[species];
  const under = species === "cherry" ? CHERRY_LEAVES : 0;
  ctx.save();
  ctx.translate(x0 + CELL / 2, y0 + CELL / 2);
  ctx.strokeStyle = "rgb(70,70,70)";
  ctx.lineWidth = 3;
  for (let twig = 0; twig < 5; twig++) {
    const angle = random() * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(Math.cos(angle) * reach * 0.8, Math.sin(angle) * reach * 0.8);
    ctx.stroke();
  }
  for (let leaf = 0; leaf < under + count; leaf++) {
    const green = leaf < under;
    const width = (green ? CHERRY_LEAF_SIZE : size) * CELL;
    const shape = green ? 1 : lobes;
    const angle = random() * Math.PI * 2;
    const out = Math.sqrt(random()) * (reach - width / 2);
    const grey = 150 + Math.floor(random() * 105);
    ctx.save();
    ctx.translate(Math.cos(angle) * out, Math.sin(angle) * out);
    ctx.rotate(random() * Math.PI * 2);
    ctx.fillStyle = `rgb(${grey},${grey},${grey})`;
    leafPath(ctx, width, shape);
    ctx.fill();
    if (shape !== 0) {
      ctx.strokeStyle = `rgb(${grey - 50},${grey - 50},${grey - 50})`;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(0, -width / 2);
      ctx.lineTo(0, width / 2);
      ctx.stroke();
    }
    ctx.restore();
  }
  ctx.restore();
}

/** The street trees' leaf sprays: one canvas, a column a species, two variants each, brightness only (the vertex colour tints it), alpha 0 or 1. Made once, in a page. */
export const leafAtlas = once((): THREE.CanvasTexture => {
  const canvas = document.createElement("canvas");
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  const ctx = canvas.getContext("2d")!;
  ctx.clearRect(0, 0, WIDTH, HEIGHT);
  for (const [column, species] of SPECIES.entries()) for (let row = 0; row < ROWS; row++) drawSpray(ctx, column * CELL, row * CELL, species, column * ROWS + row + 1);
  const image = ctx.getImageData(0, 0, WIDTH, HEIGHT);
  for (let at = 3; at < image.data.length; at += 4) image.data[at] = image.data[at]! < 128 ? 0 : 255;
  ctx.putImageData(image, 0, 0);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
});
